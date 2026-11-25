// 评分、错因和修正规则移植自 DeepTutor 1284116 的 learning/service.py 与 grading.py，Apache-2.0。
import { computeMastery } from "./mastery.js";
import {
  createLearningEvidence, createQuizAttempt, type AssessmentResultKind, type ErrorRecord,
  type ErrorType, type LearningEvidence, type LearningProgress, type PendingQuestion, type QuizAttempt,
} from "./models.js";
import { findKnowledgePoint, QUALITATIVE_TYPES } from "./policy.js";
import type { SpacedRepetitionScheduler } from "./scheduler.js";

export interface FinalGrade {
  result: AssessmentResultKind;
  confidence: number;
  feedback: string;
  reference_answer?: string;
  criteria_met?: readonly string[];
}

interface GradeInput {
  evidence_id: string;
  knowledge_point_id: string;
  question_id?: string;
  learner_answer: string;
  session_id: string;
  turn_id: string;
  verdict: FinalGrade;
  assistance_used?: boolean;
  visual_context?: Record<string, unknown>;
}

export const classifyError = (answer: string): ErrorType => answer.trim() ? "application" : "metacognitive";
const activeError = ({ status }: ErrorRecord) => status === "active" || status === "retrying";
const credit = (result: AssessmentResultKind) => result === "correct" ? 1 : result === "partial" ? 0.5 : 0;

function sameQuestion(record: Pick<ErrorRecord, "question_id" | "knowledge_point_id">,
  attempt: Pick<QuizAttempt, "question_id" | "knowledge_point_id">) {
  return record.question_id === attempt.question_id && record.knowledge_point_id === attempt.knowledge_point_id;
}

function recordError(records: ErrorRecord[], attempt: QuizAttempt): ErrorRecord[] {
  const found = records.find((record) => sameQuestion(record, attempt) && (!attempt.is_correct || activeError(record)));
  if (!attempt.is_correct && !attempt.error_type) return records;
  if (found) {
    const next: ErrorRecord = { ...found, status: attempt.is_correct ? "graduated" : "retrying",
      retry_history: [...found.retry_history, { timestamp: attempt.timestamp, is_correct: attempt.is_correct,
        attempt_number: found.retry_history.length + 1 }] };
    return records.map((record) => record === found ? next : record);
  }
  if (attempt.is_correct || !attempt.error_type) return records;
  return [...records, { id: `error:${attempt.knowledge_point_id}:${attempt.question_id}`, question_id: attempt.question_id,
    knowledge_point_id: attempt.knowledge_point_id, module_id: attempt.module_id, error_type: attempt.error_type,
    self_attribution: attempt.self_attribution, ai_confirmation: "", retry_history: [], status: "active", created_at: attempt.timestamp }];
}

export function recordQuizAttempt(progress: LearningProgress, attempt: QuizAttempt): LearningProgress {
  return { ...progress, quiz_attempts: [...progress.quiz_attempts, attempt],
    error_records: recordError(progress.error_records, attempt), updated_at: attempt.timestamp };
}

function gradeEvidence(input: GradeInput, now: number, assessment_type: LearningEvidence["assessment_type"],
  quality: number, attempt_count: number) {
  return createLearningEvidence({
    evidence_id: input.evidence_id, question_id: input.question_id ?? "", knowledge_point_id: input.knowledge_point_id,
    timestamp: now, assessment_type, result: input.verdict.result, quality,
    hints_used: Math.max(input.assistance_used ? 1 : 0, Number(input.visual_context?.hints_used) || 0),
    attempt_count, confidence: input.verdict.confidence, learner_answer: input.learner_answer, feedback: input.verdict.feedback,
    reference_answer: input.verdict.reference_answer ?? "", session_id: input.session_id, turn_id: input.turn_id,
    visual_context: input.visual_context ?? {},
  });
}

function without<T>(entries: Record<string, T>, key: string) {
  const { [key]: _removed, ...remaining } = entries;
  return remaining;
}

function quantitativeMastery(attempts: readonly QuizAttempt[], id: string) {
  return computeMastery(attempts.filter((attempt) => attempt.knowledge_point_id === id && !attempt.voided && attempt.independent)
    .map(({ result }) => credit(result)));
}

function appendEvidence(progress: LearningProgress, evidence: LearningEvidence, scheduler: SpacedRepetitionScheduler,
  now: number): LearningProgress {
  const id = evidence.knowledge_point_id;
  const { kp } = findKnowledgePoint(progress, id);
  if (!kp) throw new Error("找不到评分对应的知识点");
  const previous = progress.repetition_states[id];
  const state = previous ? { ...previous } : scheduler.getInitialState(kp.type, { now, desired_retention: progress.desired_retention });
  scheduler.scheduleReview(state, kp.type, evidence, now);
  const next = { ...progress, learning_evidence: [...progress.learning_evidence, evidence],
    repetition_states: { ...progress.repetition_states, [id]: state },
    deferred_objectives: without(progress.deferred_objectives, id), updated_at: now };
  return { ...next, review_queue: scheduler.buildReviewQueue(next, now) };
}

export function applyGrade(progress: LearningProgress, input: GradeInput & { question_id: string },
  scheduler: SpacedRepetitionScheduler, now: number): LearningProgress {
  if (progress.learning_evidence.some(({ evidence_id }) => evidence_id === input.evidence_id)) return progress;
  const id = input.knowledge_point_id;
  const { kp, module_id } = findKnowledgePoint(progress, id);
  if (!kp) throw new Error("找不到评分对应的知识点");
  const result = input.verdict.result;
  const retrying = progress.error_records.some((error) => sameQuestion(error, input) && activeError(error));
  const assisted = !!input.assistance_used || !!Number(input.visual_context?.hints_used);
  const attempt = createQuizAttempt({
    evidence_id: input.evidence_id, question_id: input.question_id, knowledge_point_id: id, module_id,
    is_correct: result === "correct", result, user_answer: input.learner_answer,
    error_type: result === "incorrect" ? classifyError(input.learner_answer) : null,
    independent: !assisted, timestamp: now, visual_context: input.visual_context ?? {},
  });
  const next = recordQuizAttempt(progress, attempt);
  if (!assisted) next.mastery_levels = { ...progress.mastery_levels, [id]: quantitativeMastery(next.quiz_attempts, id) };
  const quality = result === "correct" && (retrying || assisted) ? 0.6 : credit(result);
  const evidence = gradeEvidence(input, now, progress.repetition_states[id] ? "review" : "quiz", quality,
    next.quiz_attempts.filter((item) => !item.voided && item.knowledge_point_id === id).length);
  return appendEvidence(next, evidence, scheduler, now);
}

export function qualitativeEvidenceId(sessionId: string, turnId: string, objectiveId: string) {
  return `qualitative:${sessionId}:${turnId}:${objectiveId}`;
}

export function recordQualitativeAssessment(progress: LearningProgress, input: GradeInput & { model_id: string },
  scheduler: SpacedRepetitionScheduler, now: number): LearningProgress {
  if (progress.learning_evidence.some(({ evidence_id }) => evidence_id === input.evidence_id)) return progress;
  const id = input.knowledge_point_id;
  const { kp } = findKnowledgePoint(progress, id);
  if (!kp || !QUALITATIVE_TYPES.has(kp.type)) throw new Error("只有概念和设计知识点可进行定性评估");
  const { result, criteria_met, confidence } = input.verdict;
  const assisted = !!input.assistance_used || !!Number(input.visual_context?.hints_used);
  const passed = result === "correct";
  const next = { ...progress, assessment_evidence: { ...progress.assessment_evidence, [input.evidence_id]: {
    knowledge_point_id: id, criteria_met: [...(criteria_met ?? [])], model_id: input.model_id, confidence, assistance_used: assisted,
  } } };
  if (!assisted) {
    const current = progress.mastery_levels[id] ?? 0;
    next.mastery_levels = { ...progress.mastery_levels, [id]: passed ? Math.max(current, 1) : Math.min(current, 0.4) };
    next.qualitative_mastery = { ...progress.qualitative_mastery, [id]: passed };
    if (passed) next.feynman_explanations = { ...progress.feynman_explanations, [id]: input.learner_answer };
  }
  return appendEvidence(next, gradeEvidence(input, now, "qualitative", assisted && passed ? 0.6 : credit(result), 1), scheduler, now);
}

function replayObjective(progress: LearningProgress, id: string, scheduler: SpacedRepetitionScheduler, now: number) {
  const { kp } = findKnowledgePoint(progress, id);
  if (!kp) return progress;
  const retained = progress.learning_evidence.filter((evidence) => evidence.knowledge_point_id === id);
  const independentQualitative = retained.filter((item) => item.assessment_type === "qualitative" && !item.hints_used);
  const latest = independentQualitative.at(-1);
  const latestPass = independentQualitative.filter(({ result }) => result === "correct").at(-1);
  const legacy = progress.quiz_attempts.filter((item) => item.knowledge_point_id === id && !item.voided)
    .sort((a, b) => a.timestamp - b.timestamp);
  const chronological = retained.length ? retained : legacy.map((attempt, index) => createLearningEvidence({
    timestamp: attempt.timestamp, question_id: attempt.question_id, knowledge_point_id: id, result: attempt.result,
    quality: attempt.result === "correct" && !attempt.independent ? 0.6 : credit(attempt.result), attempt_count: index + 1,
  }));
  const quantitative = quantitativeMastery(progress.quiz_attempts, id);
  const next = { ...progress, mastery_levels: { ...progress.mastery_levels, [id]: latest
    ? latest.result === "correct" ? 1 : Math.min(latestPass ? 1 : quantitative, 0.4) : quantitative },
    repetition_states: chronological.length ? { ...progress.repetition_states, [id]: scheduler.replay(kp.type, chronological,
      { now, desired_retention: progress.desired_retention }) } : without(progress.repetition_states, id),
    updated_at: now };
  if (QUALITATIVE_TYPES.has(kp.type)) {
    next.qualitative_mastery = latest ? { ...progress.qualitative_mastery, [id]: latest.result === "correct" }
      : without(progress.qualitative_mastery, id);
    next.feynman_explanations = latestPass ? { ...progress.feynman_explanations, [id]: latestPass.learner_answer }
      : without(progress.feynman_explanations, id);
  }
  return { ...next, review_queue: scheduler.buildReviewQueue(next, now) };
}

export function voidAttempt(progress: LearningProgress, question: Pick<PendingQuestion, "question_id" | "knowledge_point_id">,
  reason: string, scheduler: SpacedRepetitionScheduler, now: number): LearningProgress {
  const match = (item: Pick<QuizAttempt, "question_id" | "knowledge_point_id">) => sameQuestion(item, question);
  const removedIds = new Set(progress.learning_evidence.filter(match).map(({ evidence_id }) => evidence_id));
  return replayObjective({ ...progress, quiz_attempts: progress.quiz_attempts.map((attempt) =>
    match(attempt) && !attempt.voided ? { ...attempt, voided: true, void_reason: reason } : attempt),
    learning_evidence: progress.learning_evidence.filter((evidence) => !match(evidence)),
    assessment_evidence: Object.fromEntries(Object.entries(progress.assessment_evidence).filter(([id]) => !removedIds.has(id))),
    error_records: progress.error_records.filter((error) => !match(error)),
  }, question.knowledge_point_id, scheduler, now);
}

export function questionWithAnswerKey(question: PendingQuestion, answer: string, reason: string): PendingQuestion {
  const value = answer.trim();
  if (!value || question.questions.length) throw new Error("请提供单题的新答案");
  const label = question.question_type === "choice" ? question.options.find(({ body }) => body === value)?.label : value;
  if (!label) throw new Error("更正选择题时，请填写一个现有选项的完整正文");
  return { ...question, expected_answer: label, accepted_answers: [], explanation: reason };
}

export function correctAnswerKey(progress: LearningProgress, question: PendingQuestion,
  verdicts: readonly FinalGrade[], scheduler: SpacedRepetitionScheduler, now: number): LearningProgress {
  const match = (item: Pick<QuizAttempt, "question_id" | "knowledge_point_id">) => sameQuestion(item, question);
  const attempts = progress.quiz_attempts.filter((attempt) => match(attempt) && !attempt.voided);
  if (attempts.length !== verdicts.length) throw new Error("更正必须重新评分所有有效作答");
  const target = new Map(attempts.map((attempt, i) => [attempt, verdicts[i]!]));
  let errors = progress.error_records.filter((error) => !match(error));
  const updates = new Map<string, { verdict: FinalGrade; quality: number }>();
  const legacyEvidence = progress.learning_evidence.filter((value) => match(value) && value.assessment_type !== "qualitative");
  const evidenceUpdates = new Map<LearningEvidence, { verdict: FinalGrade; quality: number }>();
  const quiz_attempts = progress.quiz_attempts.map((attempt) => {
    const verdict = target.get(attempt);
    if (!verdict) return attempt;
    const retrying = errors.some((error) => match(error) && activeError(error));
    const quality = verdict.result === "correct" && (retrying || !attempt.independent) ? 0.6 : credit(verdict.result);
    const corrected = { ...attempt, is_correct: verdict.result === "correct", result: verdict.result,
      error_type: verdict.result === "incorrect" ? classifyError(String(attempt.user_answer ?? "")) : null };
    errors = recordError(errors, corrected);
    if (attempt.evidence_id) updates.set(attempt.evidence_id, { verdict, quality });
    else {
      const evidence = legacyEvidence.find((item) => !evidenceUpdates.has(item) &&
        (!item.learner_answer || item.learner_answer === String(attempt.user_answer ?? "")));
      if (evidence) evidenceUpdates.set(evidence, { verdict, quality });
    }
    return corrected;
  });
  const learning_evidence = progress.learning_evidence.map((evidence) => {
    const update = updates.get(evidence.evidence_id) ?? evidenceUpdates.get(evidence);
    return update ? { ...evidence, result: update.verdict.result, quality: update.quality,
      confidence: update.verdict.confidence, feedback: update.verdict.feedback,
      reference_answer: update.verdict.reference_answer ?? question.expected_answer } : evidence;
  });
  return replayObjective({ ...progress, quiz_attempts, learning_evidence, error_records: errors },
    question.knowledge_point_id, scheduler, now);
}

export function setLearnerMasteryOverride(progress: LearningProgress, id: string, mastered: boolean,
  note: string, now: number): LearningProgress {
  if (!findKnowledgePoint(progress, id).kp) throw new Error("找不到该知识点");
  const overrides = mastered
    ? { ...progress.learner_mastery_overrides, [id]: { knowledge_point_id: id, note: [...note.trim()].slice(0, 500).join(""), created_at: now } }
    : without(progress.learner_mastery_overrides, id);
  return { ...progress, learner_mastery_overrides: overrides, updated_at: now,
    deferred_objectives: mastered ? without(progress.deferred_objectives, id) : progress.deferred_objectives };
}
