/**
 * Mastery Path policy — pure decisions over a `LearningProgress`.
 * Exact TypeScript port of DeepTutor `deeptutor/learning/policy.py` (commit 1284116).
 */

import type {
  KnowledgePoint,
  KnowledgeType,
  LearningProgress,
  ObjectiveStatus,
  RepetitionState,
  ReviewTask,
} from "./models.js";
import { publicPendingQuestion, type PublicPendingQuestion } from "./pending.js";
import { schedulerForProgress } from "./review-strategy.js";
import { compareReviewTasks } from "./scheduler.js";

export const QUANTITATIVE_GATE: Readonly<Partial<Record<KnowledgeType, number>>> = {
  memory: 0.9,
  procedure: 0.9,
};

export const QUALITATIVE_TYPES: ReadonlySet<KnowledgeType> = new Set<KnowledgeType>([
  "concept",
  "design",
]);

const QUALITATIVE_PASS_DISPLAY = 1.0;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function pathDisplayName(progress: LearningProgress): string {
  const named = String(progress.name ?? "").trim();
  if (named) {
    return named;
  }
  const firstModule = progress.modules[0]?.name.trim() ?? "";
  return firstModule || progress.book_id;
}

export function gateThreshold(kpType: KnowledgeType): number {
  if (QUALITATIVE_TYPES.has(kpType)) {
    return QUALITATIVE_PASS_DISPLAY;
  }
  return QUANTITATIVE_GATE[kpType] ?? 0.9;
}

export function visualAchievements(progress: LearningProgress, kpId: string): string[] {
  const tasks = new Set<string>();
  for (const event of progress.learning_evidence) {
    if (
      event.knowledge_point_id === kpId &&
      event.result === "correct" &&
      typeof event.visual_context["task"] === "string" &&
      event.visual_context["task"] &&
      event.visual_context["key_status"] === "verified" &&
      !event.hints_used
    ) {
      tasks.add(event.visual_context["task"]);
    }
  }
  return [...tasks].sort();
}

export function isAssessedMastered(progress: LearningProgress, kp: KnowledgePoint): boolean {
  if (kp.required_visual_tasks.length > 0) {
    const achieved = new Set(visualAchievements(progress, kp.id));
    for (const req of kp.required_visual_tasks) {
      if (!achieved.has(req)) {
        return false;
      }
    }
  }
  if (QUALITATIVE_TYPES.has(kp.type)) {
    return Boolean(progress.qualitative_mastery[kp.id]);
  }
  return (progress.mastery_levels[kp.id] ?? 0.0) >= gateThreshold(kp.type);
}

export type ObjectiveLearningStage =
  | "independently_demonstrated"
  | "practiced_with_help"
  | "practiced_not_demonstrated"
  | "not_yet_covered"
  | "partially_explained"
  | "teaching_record_unverified";

export function learningStage(progress: LearningProgress, kpId: string): ObjectiveLearningStage {
  const attempts = progress.quiz_attempts.filter(
    (item) => item.knowledge_point_id === kpId && !item.voided,
  );
  const evidence = progress.learning_evidence.filter((item) => item.knowledge_point_id === kpId);

  if (
    attempts.some((item) => item.independent && item.is_correct) ||
    evidence.some(
      (item) =>
        item.assessment_type === "qualitative" && item.result === "correct" && !item.hints_used,
    )
  ) {
    return "independently_demonstrated";
  }
  if (attempts.some((item) => !item.independent) || evidence.some((item) => item.hints_used > 0)) {
    return "practiced_with_help";
  }
  if (attempts.length > 0 || evidence.length > 0) {
    return "practiced_not_demonstrated";
  }
  const explained = progress.explained_objectives[kpId];
  if (!explained) {
    return "not_yet_covered";
  }
  const delivery = explained["delivery"] as Record<string, unknown> | undefined;
  if (
    explained["coverage"] === "partial" &&
    Boolean(explained["explanation_quote"]) &&
    Boolean(delivery?.["turn_id"])
  ) {
    return "partially_explained";
  }
  return "teaching_record_unverified";
}

export type MasterySource = "system" | "learner" | "";

export function masterySource(progress: LearningProgress, kp: KnowledgePoint): MasterySource {
  if (isAssessedMastered(progress, kp)) {
    return "system";
  }
  if (Object.prototype.hasOwnProperty.call(progress.learner_mastery_overrides, kp.id)) {
    return "learner";
  }
  return "";
}

export function isMastered(progress: LearningProgress, kp: KnowledgePoint): boolean {
  return Boolean(masterySource(progress, kp));
}

export function displayMastery(progress: LearningProgress, kp: KnowledgePoint): number {
  if (QUALITATIVE_TYPES.has(kp.type) && progress.qualitative_mastery[kp.id]) {
    return QUALITATIVE_PASS_DISPLAY;
  }
  return Number(progress.mastery_levels[kp.id] ?? 0.0);
}

export function objectiveStatus(progress: LearningProgress, kp: KnowledgePoint): ObjectiveStatus {
  if (isMastered(progress, kp)) {
    return "mastered";
  }
  const seen =
    progress.quiz_attempts.some((a) => a.knowledge_point_id === kp.id) ||
    Object.prototype.hasOwnProperty.call(progress.qualitative_mastery, kp.id);
  return seen ? "learning" : "new";
}

export function reviewableTasks(progress: LearningProgress): ReviewTask[] {
  const masteredIds = new Set<string>();
  for (const mod of progress.modules) {
    for (const kp of mod.knowledge_points) {
      if (isMastered(progress, kp)) {
        masteredIds.add(kp.id);
      }
    }
  }
  return progress.review_queue.filter((task) => masteredIds.has(task.knowledge_point_id));
}

export function dueReviews(progress: LearningProgress, now?: number): ReviewTask[] {
  const moment = now ?? Date.now() / 1000;
  const due = reviewableTasks(progress).filter((task) => task.due_at <= moment);
  due.sort((a, b) => compareReviewTasks(a, b, moment));
  return due;
}

export type NextAction =
  | "answer_pending"
  | "review"
  | "probe"
  | "teach"
  | "practice"
  | "assess"
  | "complete";

export interface NextStep {
  action: NextAction;
  module_id: string;
  module_name: string;
  knowledge_point_id: string;
  knowledge_point_name: string;
  knowledge_point_type: KnowledgeType | "";
  status: ObjectiveStatus | "";
  gate: "qualitative" | "quantitative" | "";
  mastery: number;
  threshold: number;
  reason: string;
  forgetting_risk: number;
  pending_prompt: string;
  pending_question: PublicPendingQuestion | null;
  session_id: string;
}

export function findKnowledgePoint(
  progress: LearningProgress,
  kpId: string,
): { kp: KnowledgePoint | null; module_id: string; module_name: string } {
  for (const mod of progress.modules) {
    for (const kp of mod.knowledge_points) {
      if (kp.id === kpId) {
        return { kp, module_id: mod.id, module_name: mod.name };
      }
    }
  }
  return { kp: null, module_id: "", module_name: "" };
}

export function gateKind(kp: KnowledgePoint): "qualitative" | "quantitative" {
  return QUALITATIVE_TYPES.has(kp.type) ? "qualitative" : "quantitative";
}

export function nextObjective(
  progress: LearningProgress,
  options: { now?: number; pending_session_id?: string } = {},
): NextStep {
  const pending = progress.pending_question;
  if (pending) {
    const { kp, module_id, module_name } = findKnowledgePoint(
      progress,
      pending.knowledge_point_id,
    );
    return {
      action: "answer_pending",
      module_id: module_id || pending.module_id,
      module_name,
      knowledge_point_id: pending.knowledge_point_id,
      knowledge_point_name: kp ? kp.name : "",
      knowledge_point_type: kp ? kp.type : "",
      status: kp ? objectiveStatus(progress, kp) : "learning",
      gate: kp ? gateKind(kp) : "",
      mastery: kp ? round3(displayMastery(progress, kp)) : 0.0,
      threshold: kp ? round3(gateThreshold(kp.type)) : 0.0,
      reason: "A posed question is awaiting the learner's answer; grade it with mastery_grade.",
      forgetting_risk: 0.0,
      pending_prompt: pending.prompt,
      pending_question: publicPendingQuestion(pending),
      session_id: String(options.pending_session_id ?? ""),
    };
  }

  const deferredIds = new Set(Object.keys(progress.deferred_objectives));
  const due = dueReviews(progress, options.now).filter(
    (task) => !deferredIds.has(task.knowledge_point_id),
  );
  if (due.length > 0) {
    const task = due[0]!;
    const { kp, module_id, module_name } = findKnowledgePoint(progress, task.knowledge_point_id);
    if (kp) {
      return {
        action: "review",
        module_id,
        module_name,
        knowledge_point_id: kp.id,
        knowledge_point_name: kp.name,
        knowledge_point_type: kp.type,
        status: objectiveStatus(progress, kp),
        gate: gateKind(kp),
        mastery: round3(displayMastery(progress, kp)),
        threshold: round3(gateThreshold(kp.type)),
        reason: task.reason || "This objective is due for spaced-repetition review.",
        forgetting_risk: round3(task.forgetting_risk),
        pending_prompt: "",
        pending_question: null,
        session_id: "",
      };
    }
  }

  let deferredFallback: NextStep | null = null;
  const sortedModules = [...progress.modules].sort((a, b) => a.order - b.order);
  for (const mod of sortedModules) {
    for (const kp of mod.knowledge_points) {
      if (isMastered(progress, kp)) {
        continue;
      }
      const status = objectiveStatus(progress, kp);
      const gate = gateKind(kp);
      let action: NextAction;
      if (status === "new") {
        action =
          progress.learner_profile?.teaching_strategy === "teach_first" ? "teach" : "probe";
      } else if (gate === "qualitative") {
        action = "assess";
      } else {
        action = "practice";
      }
      const step: NextStep = {
        action,
        module_id: mod.id,
        module_name: mod.name,
        knowledge_point_id: kp.id,
        knowledge_point_name: kp.name,
        knowledge_point_type: kp.type,
        status,
        gate,
        mastery: round3(displayMastery(progress, kp)),
        threshold: round3(gateThreshold(kp.type)),
        reason:
          status === "new"
            ? action === "teach"
              ? "Untouched objective — teach before assessing, as the learner requested."
              : "Untouched objective — probe first to let the learner test out."
            : "Objective is below its mastery gate; keep working it until it clears.",
        forgetting_risk: 0.0,
        pending_prompt: "",
        pending_question: null,
        session_id: "",
      };
      if (deferredIds.has(kp.id)) {
        if (!deferredFallback) {
          deferredFallback = step;
        }
        continue;
      }
      return step;
    }
  }

  if (deferredFallback) {
    return deferredFallback;
  }

  return {
    action: "complete",
    module_id: "",
    module_name: "",
    knowledge_point_id: "",
    knowledge_point_name: "",
    knowledge_point_type: "",
    status: "",
    gate: "",
    mastery: 0.0,
    threshold: 0.0,
    reason: "All objectives are mastered and no reviews are due.",
    forgetting_risk: 0.0,
    pending_prompt: "",
    pending_question: null,
    session_id: "",
  };
}

export interface MapSummary {
  name: string;
  counts: { mastered: number; learning: number; new: number; total: number };
  due_reviews: number;
  complete: boolean;
  modules: Array<{
    id: string;
    name: string;
    objective: string;
    order: number;
    mastered: number;
    total: number;
    knowledge_points: Array<{
      id: string;
      name: string;
      type: KnowledgeType;
      prerequisite_ids: string[];
      topic_source_ids: string[];
      status: ObjectiveStatus;
      mastery: number;
      mastery_source: MasterySource;
      override_note: string;
      deferred: boolean;
    }>;
  }>;
}

export function mapSummary(progress: LearningProgress, now?: number): MapSummary {
  const counts = { mastered: 0, learning: 0, new: 0, total: 0 };
  const modulesOut: MapSummary["modules"] = [];
  const sortedModules = [...progress.modules].sort((a, b) => a.order - b.order);

  for (const mod of sortedModules) {
    const kpsOut: MapSummary["modules"][number]["knowledge_points"] = [];
    let mastered = 0;
    for (const kp of mod.knowledge_points) {
      const status = objectiveStatus(progress, kp);
      counts[status] += 1;
      counts.total += 1;
      if (status === "mastered") {
        mastered += 1;
      }
      const override = progress.learner_mastery_overrides[kp.id];
      kpsOut.push({
        id: kp.id,
        name: kp.name,
        type: kp.type,
        prerequisite_ids: [...kp.prerequisite_ids],
        topic_source_ids: [...kp.topic_source_ids],
        status,
        mastery: round3(displayMastery(progress, kp)),
        mastery_source: masterySource(progress, kp),
        override_note: override ? override.note : "",
        deferred: Object.prototype.hasOwnProperty.call(progress.deferred_objectives, kp.id),
      });
    }
    modulesOut.push({
      id: mod.id,
      name: mod.name,
      objective: mod.objective,
      order: mod.order,
      mastered,
      total: mod.knowledge_points.length,
      knowledge_points: kpsOut,
    });
  }

  return {
    name: pathDisplayName(progress),
    counts,
    due_reviews: dueReviews(progress, now).length,
    complete: counts.total > 0 && counts.mastered === counts.total,
    modules: modulesOut,
  };
}

function buildReviewReport(
  progress: LearningProgress,
  kpId: string,
  state: RepetitionState | undefined,
  dueAt: number | null,
  now: number,
) {
  if (!state) {
    return null;
  }
  const task = progress.review_queue.find((item) => item.knowledge_point_id === kpId) ?? null;
  const scheduler = schedulerForProgress(progress);
  const recall = scheduler.retrievability(state, now);
  const risk = task ? task.forgetting_risk : scheduler.forgettingRisk(state, progress, kpId, now);
  const reason = task
    ? task.reason
    : scheduler.reviewReason(state, progress, kpId, { now });

  return {
    due_at: dueAt,
    interval_index: state.interval_index,
    consecutive_correct: state.consecutive_correct,
    consecutive_wrong: state.consecutive_wrong,
    stability: round3(state.stability),
    retrievability: round3(recall),
    desired_retention: state.desired_retention,
    lapse_count: state.lapse_count,
    forgetting_risk: round3(risk),
    reason,
    recent_failure: Boolean(
      state.consecutive_wrong ||
        progress.error_records.some(
          (rec) =>
            rec.knowledge_point_id === kpId &&
            (rec.status === "active" || rec.status === "retrying"),
        ),
    ),
  };
}

export function objectiveReport(progress: LearningProgress, kpId: string, now?: number) {
  const { kp, module_id, module_name } = findKnowledgePoint(progress, kpId);
  if (!kp) {
    return null;
  }
  const attempts = progress.quiz_attempts
    .filter((a) => a.knowledge_point_id === kpId)
    .map((a) => ({
      question_id: a.question_id,
      is_correct: a.is_correct,
      independent: a.independent,
      answer: String(a.user_answer ?? ""),
      error_type: a.error_type ?? "",
      at: a.timestamp,
    }));

  const state = progress.repetition_states[kpId];
  const dueAt =
    progress.review_queue.find((task) => task.knowledge_point_id === kpId)?.due_at ?? null;
  const moment = now ?? Date.now() / 1000;
  const override = progress.learner_mastery_overrides[kpId];

  return {
    id: kp.id,
    name: kp.name,
    type: kp.type,
    module_id,
    module_name,
    status: objectiveStatus(progress, kp),
    gate: gateKind(kp),
    mastered: isMastered(progress, kp),
    assessed_mastered: isAssessedMastered(progress, kp),
    mastery_source: masterySource(progress, kp),
    override_note: override ? override.note : "",
    mastery: round3(displayMastery(progress, kp)),
    threshold: round3(gateThreshold(kp.type)),
    attempts,
    correct_count: attempts.filter((a) => a.is_correct).length,
    explanation: progress.feynman_explanations[kpId] ?? "",
    explained: progress.explained_objectives[kpId] ?? null,
    required_visual_tasks: kp.required_visual_tasks,
    demonstrated_visual_tasks: visualAchievements(progress, kpId),
    review: buildReviewReport(progress, kpId, state, dueAt, moment),
    errors: progress.error_records
      .filter((r) => r.knowledge_point_id === kpId)
      .map((r) => ({
        id: r.id,
        error_type: r.error_type,
        status: r.status,
        self_attribution: r.self_attribution,
        retries: r.retry_history.length,
        created_at: r.created_at,
      })),
  };
}
