/**
 * Spaced-repetition retention scheduler — exact TypeScript port of DeepTutor
 * `deeptutor/learning/scheduler.py` (commit 1284116).
 */

import {
  createLearningEvidence,
  type KnowledgeType,
  type LearningEvidence,
  type LearningProgress,
  type RepetitionState,
  type ReviewTask,
} from "./models.js";

export const INTERVAL_SEQUENCES: Readonly<Record<KnowledgeType, readonly number[]>> = {
  memory: [0, 1, 3, 7, 14, 30, 60],
  concept: [3, 7, 14, 30],
  procedure: [3, 7, 14],
  design: [14, 28],
} as const;

const TYPE_PRIORITY: Readonly<Record<KnowledgeType, number>> = {
  memory: 2,
  concept: 3,
  procedure: 4,
  design: 5,
};

const TYPE_DIFFICULTY: Readonly<Record<KnowledgeType, number>> = {
  memory: 0.3,
  concept: 0.4,
  procedure: 0.5,
  design: 0.6,
};

export const DEFAULT_DESIRED_RETENTION = 0.9;
export const MIN_DESIRED_RETENTION = 0.7;
export const MAX_DESIRED_RETENTION = 0.99;

const MIN_STABILITY_DAYS = 0.5;
const FAIL_QUALITY = 0.5;
const EPS = 1e-6;
const SAME_SESSION_DAYS = 0.25;

const EVIDENCE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  deep_question: "Question Bank",
  immersive_reading: "Reading",
  book: "Book",
  partner_chat: "Study Partner",
  import: "Imported",
};

export function validateDesiredRetention(value: number): number {
  const desired = Number(value);
  if (
    !Number.isFinite(desired) ||
    desired < MIN_DESIRED_RETENTION ||
    desired > MAX_DESIRED_RETENTION
  ) {
    throw new RangeError(
      `desired_retention must be between ${MIN_DESIRED_RETENTION} and ${MAX_DESIRED_RETENTION}`,
    );
  }
  return desired;
}

function normalizeIntervalSequences(
  intervalSequences?: Partial<Record<KnowledgeType, readonly number[]>> | null,
): Record<KnowledgeType, number[]> {
  const sequences: Record<KnowledgeType, number[]> = {
    memory: [...INTERVAL_SEQUENCES.memory],
    concept: [...INTERVAL_SEQUENCES.concept],
    procedure: [...INTERVAL_SEQUENCES.procedure],
    design: [...INTERVAL_SEQUENCES.design],
  };
  if (intervalSequences) {
    for (const [kt, rounds] of Object.entries(intervalSequences) as [
      KnowledgeType,
      readonly number[] | undefined,
    ][]) {
      if (rounds) {
        sequences[kt] = rounds.map((d) => Number(d));
      }
    }
  }
  return sequences;
}

function errorKpIds(progress: LearningProgress): Set<string> {
  const ids = new Set<string>();
  for (const rec of progress.error_records) {
    if (rec.status === "active" || rec.status === "retrying") {
      ids.add(rec.knowledge_point_id);
    }
  }
  return ids;
}

export function compareReviewTasks(a: ReviewTask, b: ReviewTask, now: number): number {
  const riskDiff = b.forgetting_risk - a.forgetting_risk;
  if (riskDiff !== 0) return riskDiff;
  const overdueA = Math.max(0.0, now - a.due_at);
  const overdueB = Math.max(0.0, now - b.due_at);
  const overdueDiff = overdueB - overdueA;
  if (overdueDiff !== 0) return overdueDiff;
  return a.priority - b.priority;
}

export function resolvedQuality(evidence: LearningEvidence): number {
  let quality: number;
  if (evidence.quality !== null && evidence.quality !== undefined) {
    quality = Number(evidence.quality);
  } else if (evidence.result === "correct") {
    quality = 1.0;
  } else if (evidence.result === "partial") {
    quality = 0.4;
  } else {
    quality = 0.0;
  }
  if (evidence.quality === null || evidence.quality === undefined) {
    quality -= Math.min(0.25, evidence.hints_used * 0.08);
    quality -= Math.min(0.2, Math.max(0, evidence.attempt_count - 1) * 0.05);
  }
  return Math.max(0.0, Math.min(1.0, quality));
}

function snapIntervalIndex(
  intervals: readonly number[],
  intervalDays: number,
  maxIndex: number,
): number {
  let nearest = 0;
  let bestDist = Math.abs(intervals[0]! - intervalDays);
  for (let i = 1; i < intervals.length; i++) {
    const dist = Math.abs(intervals[i]! - intervalDays);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = i;
    }
  }
  return Math.max(0, Math.min(nearest, maxIndex));
}

function formatSpan(days: number): string {
  if (days < 1.0 / 24.0) {
    return "moments";
  }
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }
  if (days < 1.5) {
    return "1 day";
  }
  return `${Math.round(days)} days`;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface SpacedRepetitionSchedulerOptions {
  desired_retention?: number;
  interval_sequences?: Partial<Record<KnowledgeType, readonly number[]>> | null;
  debug_mode?: boolean;
}

export class SpacedRepetitionScheduler {
  public debugMode: boolean;
  public readonly desiredRetention: number;
  private readonly _intervalSequences: Record<KnowledgeType, number[]>;

  constructor(options: SpacedRepetitionSchedulerOptions = {}) {
    this.debugMode = options.debug_mode ?? false;
    this.desiredRetention = validateDesiredRetention(
      options.desired_retention ?? DEFAULT_DESIRED_RETENTION,
    );
    this._intervalSequences = normalizeIntervalSequences(options.interval_sequences);
  }

  get intervalSequences(): Record<KnowledgeType, number[]> {
    return {
      memory: [...this._intervalSequences.memory],
      concept: [...this._intervalSequences.concept],
      procedure: [...this._intervalSequences.procedure],
      design: [...this._intervalSequences.design],
    };
  }

  private rounds(knowledgeType: KnowledgeType): number[] {
    return this._intervalSequences[knowledgeType];
  }

  private usesCustomIntervals(knowledgeType: KnowledgeType): boolean {
    const current = this.rounds(knowledgeType);
    const baseline = INTERVAL_SEQUENCES[knowledgeType];
    if (current.length !== baseline.length) return true;
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== baseline[i]) return true;
    }
    return false;
  }

  private secondsPerUnit(): number {
    return this.debugMode ? 1.0 : 86400.0;
  }

  static stabilityFromInterval(intervalDays: number, desiredRetention: number): number {
    const retention = Math.min(Math.max(desiredRetention, EPS), 1.0 - EPS);
    if (intervalDays <= 0) {
      return MIN_STABILITY_DAYS;
    }
    return Math.max(MIN_STABILITY_DAYS, intervalDays / -Math.log(retention));
  }

  static intervalFromStability(stability: number, desiredRetention: number): number {
    const retention = Math.min(Math.max(desiredRetention, EPS), 1.0 - EPS);
    return Math.max(EPS, Math.max(stability, EPS) * -Math.log(retention));
  }

  private scheduledIntervalDays(state: RepetitionState, knowledgeType: KnowledgeType): number {
    const rounds = this.rounds(knowledgeType);
    if (state.review_count === 0 && rounds[0] === 0) {
      return 0.0;
    }
    let intervalDays = SpacedRepetitionScheduler.intervalFromStability(
      state.stability,
      state.desired_retention,
    );
    if (this.usesCustomIntervals(knowledgeType)) {
      const configured = rounds[Math.min(state.review_count, rounds.length - 1)]!;
      const target = SpacedRepetitionScheduler.intervalFromStability(
        SpacedRepetitionScheduler.stabilityFromInterval(configured, DEFAULT_DESIRED_RETENTION),
        state.desired_retention,
      );
      if (!state.scheduled_after_failure) {
        return target;
      }
      intervalDays = Math.min(intervalDays, target);
    }
    if (state.scheduled_after_failure) {
      intervalDays = Math.min(
        intervalDays,
        Math.max(intervalDays * 0.5, MIN_STABILITY_DAYS * 0.2),
      );
    }
    return intervalDays;
  }

  hydrate(state: RepetitionState, knowledgeType: KnowledgeType): RepetitionState {
    if (state.stability > 0) {
      if (state.difficulty <= 0) {
        state.difficulty = TYPE_DIFFICULTY[knowledgeType] ?? 0.3;
      }
      return state;
    }
    const intervals = this.rounds(knowledgeType);
    const maxIndex = intervals.length - 1;
    state.interval_index = Math.max(0, Math.min(state.interval_index, maxIndex));
    state.desired_retention = state.desired_retention || DEFAULT_DESIRED_RETENTION;
    state.stability = SpacedRepetitionScheduler.stabilityFromInterval(
      intervals[state.interval_index]!,
      state.desired_retention,
    );
    state.difficulty = TYPE_DIFFICULTY[knowledgeType] ?? 0.3;
    if (state.retrievability <= 0) {
      state.retrievability = 1.0;
    }
    return state;
  }

  getInitialState(
    knowledgeType: KnowledgeType,
    options: { now?: number; desired_retention?: number } = {},
  ): RepetitionState {
    const intervals = this.rounds(knowledgeType);
    const firstInterval = intervals[0]!;
    const moment = options.now ?? Date.now() / 1000;
    const desired =
      options.desired_retention === undefined
        ? this.desiredRetention
        : validateDesiredRetention(options.desired_retention);
    const stability = SpacedRepetitionScheduler.stabilityFromInterval(
      firstInterval,
      DEFAULT_DESIRED_RETENTION,
    );
    const initialInterval =
      firstInterval === 0
        ? firstInterval
        : SpacedRepetitionScheduler.intervalFromStability(stability, desired);

    return {
      interval_index: 0,
      consecutive_correct: 0,
      consecutive_wrong: 0,
      next_review_at: moment + initialInterval * this.secondsPerUnit(),
      difficulty: TYPE_DIFFICULTY[knowledgeType],
      stability,
      retrievability: 1.0,
      desired_retention: desired,
      review_count: 0,
      lapse_count: 0,
      last_review_at: null,
      last_scheduled_at: moment,
      scheduled_after_failure: false,
    };
  }

  scheduleNext(
    state: RepetitionState,
    knowledgeType: KnowledgeType,
    isCorrect: boolean,
    now?: number,
  ): RepetitionState {
    const evidence = createLearningEvidence({
      knowledge_point_id: "",
      assessment_type: "review",
      result: isCorrect ? "correct" : "incorrect",
      quality: isCorrect ? 1.0 : 0.0,
      timestamp: now ?? Date.now() / 1000,
    });
    return this.scheduleReview(state, knowledgeType, evidence, now);
  }

  scheduleReview(
    state: RepetitionState,
    knowledgeType: KnowledgeType,
    evidence: LearningEvidence,
    now?: number,
  ): RepetitionState {
    this.hydrate(state, knowledgeType);
    const eventMoment = now ?? evidence.timestamp;
    const moment =
      state.last_review_at !== null ? Math.max(eventMoment, state.last_review_at) : eventMoment;
    const quality = resolvedQuality(evidence);
    const intervals = this.rounds(knowledgeType);
    const maxIndex = intervals.length - 1;

    const previousStability = Math.max(state.stability, EPS);
    const previousRetrievability = this.retrievability(state, moment);
    const elapsedDays =
      state.last_review_at !== null
        ? Math.max(0.0, moment - state.last_review_at) / this.secondsPerUnit()
        : 0.0;
    const sameSessionDays = Math.min(
      SAME_SESSION_DAYS,
      SpacedRepetitionScheduler.intervalFromStability(
        previousStability,
        DEFAULT_DESIRED_RETENTION,
      ) * 0.5,
    );

    if (state.last_review_at !== null && elapsedDays < sameSessionDays) {
      if (quality >= FAIL_QUALITY) {
        state.review_count += 1;
        state.last_review_at = moment;
        state.retrievability = 1.0;
        state.consecutive_wrong = 0;
        return state;
      }
      if (
        state.scheduled_after_failure &&
        (evidence.result === "partial" || evidence.assessment_type === "qualitative")
      ) {
        state.review_count += 1;
        state.last_review_at = moment;
        state.retrievability = Math.max(quality, 0.2);
        return state;
      }
    }

    const spacingRatio = Math.min(elapsedDays / previousStability, 4.0);
    const outcomeError = 1.0 - quality - state.difficulty;
    const surprise = previousRetrievability - quality;
    state.difficulty = Math.min(
      0.95,
      Math.max(0.05, state.difficulty + 0.12 * outcomeError + 0.08 * surprise),
    );

    if (quality < FAIL_QUALITY) {
      state.consecutive_wrong += 1;
      state.consecutive_correct = 0;
      state.lapse_count += 1;
      const retentionFactor = 0.55 - 0.25 * previousRetrievability;
      const difficultyFactor = 1.0 - 0.25 * state.difficulty;
      state.stability = Math.max(
        MIN_STABILITY_DAYS * 0.1,
        previousStability * retentionFactor * difficultyFactor,
      );
      state.retrievability = Math.max(quality, 0.2);
      if (state.consecutive_wrong >= 2) {
        state.consecutive_wrong = 0;
      }
    } else {
      state.consecutive_wrong = 0;
      state.consecutive_correct += 1;
      const retrievalEffort = 1.0 + (1.0 - previousRetrievability) * 1.5;
      const spacingBonus = 1.0 + spacingRatio * 0.15;
      const learnability = 1.35 - 0.6 * state.difficulty;
      const qualityStrength = Math.max(0.0, (quality - FAIL_QUALITY) / (1.0 - FAIL_QUALITY));
      let growth = 1.0 + qualityStrength * learnability * retrievalEffort * spacingBonus;
      if (quality >= 0.8 && state.consecutive_correct >= 2) {
        growth *= 1.15;
      }
      state.stability = Math.max(MIN_STABILITY_DAYS, previousStability * growth);
      state.retrievability = 1.0;
      if (state.consecutive_correct >= 2) {
        state.consecutive_correct = 0;
      }
    }

    state.review_count += 1;
    state.last_review_at = moment;
    state.last_scheduled_at = moment;
    state.scheduled_after_failure = quality < FAIL_QUALITY;
    const intervalDays = this.scheduledIntervalDays(state, knowledgeType);
    state.next_review_at = moment + intervalDays * this.secondsPerUnit();
    state.interval_index = snapIntervalIndex(intervals, intervalDays, maxIndex);
    return state;
  }

  retrievability(state: RepetitionState, now?: number): number {
    const moment = now ?? Date.now() / 1000;
    const stability = Math.max(state.stability, EPS);
    const anchor = state.last_review_at !== null ? state.last_review_at : state.next_review_at;
    const elapsedDays = Math.max(0.0, (moment - anchor) / this.secondsPerUnit());
    return Math.min(1.0, Math.max(0.0, Math.exp(-elapsedDays / stability)));
  }

  forgettingRisk(
    state: RepetitionState,
    progress: LearningProgress,
    kpId: string,
    now?: number,
  ): number {
    const moment = now ?? Date.now() / 1000;
    const recall = this.retrievability(state, moment);
    let risk = 1.0 - recall;
    if (moment > state.next_review_at) {
      const overdueDays = (moment - state.next_review_at) / this.secondsPerUnit();
      risk += Math.min(overdueDays / 7.0, 0.25);
    }
    if (errorKpIds(progress).has(kpId)) {
      risk += 0.2;
    }
    if (state.lapse_count) {
      risk += Math.min(0.1 * state.lapse_count, 0.2);
    }
    return Math.min(1.0, Math.max(0.0, risk));
  }

  reviewReason(
    state: RepetitionState,
    progress: LearningProgress,
    kpId: string,
    options: { now?: number; latest_evidence?: LearningEvidence | null } = {},
  ): string {
    const moment = options.now ?? Date.now() / 1000;
    const unit = this.secondsPerUnit();
    const recall = this.retrievability(state, moment);
    const parts: string[] = [];
    const delta = moment - state.next_review_at;
    if (delta >= unit) {
      parts.push(`due ${formatSpan(delta / unit)} ago`);
    } else if (delta >= 0) {
      parts.push("due now");
    } else {
      parts.push(`due in ${formatSpan(-delta / unit)}`);
    }
    const desired = state.desired_retention || DEFAULT_DESIRED_RETENTION;
    const recallPct = `${Math.round(recall * 100)}%`;
    const desiredPct = `${Math.round(desired * 100)}%`;
    if (recall + 1e-9 < desired) {
      parts.push(`retrievability ${recallPct} below ${desiredPct} target`);
    } else {
      parts.push(`retrievability ${recallPct}`);
    }
    const failures = state.consecutive_wrong + (errorKpIds(progress).has(kpId) ? 1 : 0);
    if (state.lapse_count) {
      parts.push(`${state.lapse_count} lapse${state.lapse_count !== 1 ? "s" : ""}`);
    } else if (failures) {
      parts.push("recent failure");
    }
    const latest = options.latest_evidence;
    if (latest) {
      const source = EVIDENCE_SOURCE_LABELS[latest.source];
      if (source) {
        parts.push(`latest ${source} assessment: ${latest.result}`);
      }
    }
    return `${parts.join("; ")}.`;
  }

  getDueTasks(progress: LearningProgress, maxTasks = 5, now?: number): ReviewTask[] {
    const moment = now ?? Date.now() / 1000;
    const due = progress.review_queue.filter((t) => t.due_at <= moment);
    due.sort((a, b) => compareReviewTasks(a, b, moment));
    return due.slice(0, maxTasks);
  }

  buildReviewQueue(progress: LearningProgress, now?: number): ReviewTask[] {
    const moment = now ?? Date.now() / 1000;
    const errorKps = errorKpIds(progress);
    const latestEvidence = new Map<string, LearningEvidence>();
    for (const event of progress.learning_evidence) {
      latestEvidence.set(event.knowledge_point_id, event);
    }

    const tasks: ReviewTask[] = [];
    for (const [kpId, state] of Object.entries(progress.repetition_states)) {
      const kpType = progress.knowledge_types[kpId] ?? "memory";
      this.hydrate(state, kpType);
      const priority = errorKps.has(kpId) ? 1 : TYPE_PRIORITY[kpType];
      const risk = this.forgettingRisk(state, progress, kpId, moment);
      const evidence = latestEvidence.get(kpId) ?? null;
      tasks.push({
        id: `review_${kpId}`,
        knowledge_point_id: kpId,
        knowledge_type: kpType,
        due_at: state.next_review_at,
        priority,
        state,
        forgetting_risk: roundTo(risk, 4),
        reason: this.reviewReason(state, progress, kpId, {
          now: moment,
          latest_evidence: evidence,
        }),
        evidence_source: evidence ? evidence.source : "",
        evidence_id: evidence ? evidence.evidence_id : "",
      });
    }
    tasks.sort((a, b) => compareReviewTasks(a, b, moment));
    return tasks;
  }

  setDesiredRetention(progress: LearningProgress, desiredRetention: number, now?: number): void {
    const desired = validateDesiredRetention(desiredRetention);
    const moment = now ?? Date.now() / 1000;
    for (const [kpId, state] of Object.entries(progress.repetition_states)) {
      const kpType = progress.knowledge_types[kpId] ?? "memory";
      this.hydrate(state, kpType);
      const oldDesired = validateDesiredRetention(state.desired_retention);
      const anchor = state.last_scheduled_at;
      state.desired_retention = desired;
      if (anchor !== null) {
        let interval = this.scheduledIntervalDays(state, kpType);
        state.next_review_at = anchor + interval * this.secondsPerUnit();
        interval = (state.next_review_at - anchor) / this.secondsPerUnit();
        const intervals = this.rounds(kpType);
        state.interval_index = snapIntervalIndex(intervals, interval, intervals.length - 1);
      } else if (state.last_review_at !== null) {
        const ratio = -Math.log(desired) / -Math.log(oldDesired);
        state.next_review_at =
          state.last_review_at + (state.next_review_at - state.last_review_at) * ratio;
      } else if (state.next_review_at > moment) {
        const ratio = -Math.log(desired) / -Math.log(oldDesired);
        state.next_review_at = moment + (state.next_review_at - moment) * ratio;
      }
    }
    progress.desired_retention = desired;
    progress.review_queue = this.buildReviewQueue(progress, moment);
  }

  replay(
    knowledgeType: KnowledgeType,
    evidence: readonly LearningEvidence[],
    options: {
      now?: number;
      desired_retention?: number;
      initial_state?: RepetitionState;
    } = {},
  ): RepetitionState {
    if (options.initial_state) {
      if (options.desired_retention !== undefined) {
        throw new Error("initial_state already contains desired_retention");
      }
      const state: RepetitionState = { ...options.initial_state };
      for (const event of evidence) {
        this.scheduleReview(state, knowledgeType, event, event.timestamp);
      }
      return state;
    }
    if (evidence.length === 0) {
      return this.getInitialState(knowledgeType, {
        now: options.now,
        desired_retention: options.desired_retention,
      });
    }
    const state = this.getInitialState(knowledgeType, {
      now: evidence[0]!.timestamp,
      desired_retention: options.desired_retention,
    });
    for (const event of evidence) {
      this.scheduleReview(state, knowledgeType, event, event.timestamp);
    }
    return state;
  }

  rebuildFromEvidence(progress: LearningProgress, now?: number): void {
    const moment = now ?? Date.now() / 1000;
    const desired = validateDesiredRetention(progress.desired_retention);
    const evidenceByKp = new Map<string, LearningEvidence[]>();
    for (const ev of progress.learning_evidence) {
      const list = evidenceByKp.get(ev.knowledge_point_id) ?? [];
      list.push(ev);
      evidenceByKp.set(ev.knowledge_point_id, list);
    }

    for (const kpId of Object.keys(progress.repetition_states)) {
      const kpType = progress.knowledge_types[kpId] ?? "memory";
      const kpEvidence = evidenceByKp.get(kpId) ?? [];
      if (kpEvidence.length > 0) {
        progress.repetition_states[kpId] = this.replay(kpType, kpEvidence, {
          now: moment,
          desired_retention: desired,
        });
      } else {
        const state = this.hydrate(progress.repetition_states[kpId]!, kpType);
        state.desired_retention = desired;
        const anchor = state.last_scheduled_at ?? state.last_review_at;
        if (anchor !== null) {
          const interval = this.scheduledIntervalDays(state, kpType);
          state.next_review_at = anchor + interval * this.secondsPerUnit();
          const rounds = this.rounds(kpType);
          state.interval_index = snapIntervalIndex(rounds, interval, rounds.length - 1);
        }
      }
    }

    progress.review_queue = this.buildReviewQueue(progress, moment);
  }
}
