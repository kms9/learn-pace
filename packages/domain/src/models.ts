/**
 * Core domain models for Learn Pace, ported from DeepTutor `deeptutor/learning/models.py`
 * (commit 1284116) and aligned with Learn Pace PRD V0.2 (05-domain-model, 04-lf02-mastery-flow).
 *
 * Pure TypeScript: no React Native, Expo, SQLite, or Pi Runtime dependencies.
 */

export type KnowledgeType = "memory" | "concept" | "procedure" | "design";

export const KNOWLEDGE_TYPES: readonly KnowledgeType[] = [
  "memory",
  "concept",
  "procedure",
  "design",
] as const;

export type ErrorType = "structural" | "deviation" | "application" | "metacognitive";

export type LearningStage =
  | "diagnostic"
  | "explain"
  | "feynman_check"
  | "practice"
  | "error_diagnosis"
  | "review"
  | "completed";

export type PathStatus = "draft" | "active" | "completed" | "archived";

export type SessionMode = "outline" | "study" | "review";

export type ObjectiveStatus = "new" | "learning" | "mastered";

export type InteractionStatus =
  | "registered"
  | "awaiting_input"
  | "answered"
  | "graded"
  | "abandoned";

export type TurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ReviewTaskStatus = "due" | "completed" | "deferred" | "cancelled";

export type CurriculumProfileId =
  | "primary"
  | "middle"
  | "high"
  | "exam_self_study"
  | "free";

export type VisualTaskKind =
  | "identification"
  | "relationship"
  | "table_graph"
  | "comparison";

export interface KnowledgePoint {
  id: string;
  name: string;
  type: KnowledgeType;
  module_id: string;
  prerequisite_ids: string[];
  topic_source_ids: string[];
  required_visual_tasks: VisualTaskKind[];
}

export interface LearningModule {
  id: string;
  name: string;
  order: number;
  pass_threshold: number;
  objective: string;
  knowledge_points: KnowledgePoint[];
}

export interface DiagnosticResult {
  total_questions: number;
  correct_count: number;
  module_mastery: Record<string, number>;
}

export type AssessmentResultKind = "correct" | "partial" | "incorrect";

export interface QuizAttempt {
  evidence_id?: string;
  question_id: string;
  knowledge_point_id: string;
  module_id: string;
  is_correct: boolean;
  result: AssessmentResultKind;
  user_answer: unknown;
  error_type: ErrorType | null;
  self_attribution: string;
  mastery_estimate: number;
  timestamp: number;
  voided: boolean;
  void_reason: string;
  independent: boolean;
  visual_context: Record<string, unknown>;
}

export interface RetryAttempt {
  timestamp: number;
  is_correct: boolean;
  attempt_number: number;
}

export type ErrorRecordStatus = "active" | "retrying" | "review" | "graduated";

export interface ErrorRecord {
  id: string;
  question_id: string;
  knowledge_point_id: string;
  module_id: string;
  error_type: ErrorType;
  self_attribution: string;
  ai_confirmation: string;
  retry_history: RetryAttempt[];
  status: ErrorRecordStatus;
  created_at: number;
}

export interface LearningEvidence {
  evidence_id: string;
  question_id: string;
  knowledge_point_id: string;
  timestamp: number;
  source: string;
  assessment_type: "quiz" | "qualitative" | "review";
  result: AssessmentResultKind;
  quality: number | null;
  hints_used: number;
  attempt_count: number;
  confidence: number | null;
  learner_answer: string;
  feedback: string;
  reference_answer: string;
  response_time: number | null;
  session_id: string;
  turn_id: string;
  visual_context: Record<string, unknown>;
}

export interface RepetitionState {
  interval_index: number;
  consecutive_correct: number;
  consecutive_wrong: number;
  next_review_at: number;
  difficulty: number;
  stability: number;
  retrievability: number;
  desired_retention: number;
  review_count: number;
  lapse_count: number;
  last_review_at: number | null;
  last_scheduled_at: number | null;
  scheduled_after_failure: boolean;
}

export interface ReviewTask {
  id: string;
  knowledge_point_id: string;
  knowledge_type: KnowledgeType;
  due_at: number;
  priority: number;
  state: RepetitionState;
  forgetting_risk: number;
  reason: string;
  evidence_source: string;
  evidence_id: string;
}

export interface ReviewStrategyTemplate {
  template_id: string;
  name: string;
  description: string;
  builtin: boolean;
  desired_retention: number | null;
  intervals: Record<KnowledgeType, number[]>;
  created_at: number;
  updated_at: number;
}

export interface ReviewStrategyBinding {
  template_id: string;
  name: string;
  builtin: boolean;
  desired_retention: number | null;
  intervals: Record<KnowledgeType, number[]>;
  bound_at: number;
}

export interface PendingOption {
  label: string;
  body: string;
}

export interface PendingQuestion {
  question_id: string;
  knowledge_point_id: string;
  module_id: string;
  prompt: string;
  question_type: "choice" | "short" | "open" | "group" | string;
  expected_answer: string;
  options: PendingOption[];
  explanation: string;
  difficulty: string;
  source_evidence: Record<string, unknown>;
  assistance_used: boolean;
  assistance_context: Record<string, string>;
  created_at: number;
  visual_context: Record<string, unknown>;
  accepted_answers: string[];
  questions: PendingQuestion[];
}

export interface LearnerMasteryOverride {
  knowledge_point_id: string;
  note: string;
  created_at: number;
}

export interface DeferredObjective {
  knowledge_point_id: string;
  note: string;
  created_at: number;
}

export interface LearnerProfile {
  prior_knowledge: string;
  target_level: string;
  time_budget: string;
  preferences: string;
  teaching_strategy: "probe_first" | "teach_first";
  notes: string;
  updated_at: number;
}

export interface TopicSource {
  id: string;
  kind: "goal" | "chat" | "text_note";
  label: string;
  excerpt: string;
  source_session_id?: string;
  source_message_id?: string;
  created_at: number;
}

export interface LearningProgress {
  book_id: string;
  learner_profile: LearnerProfile | null;
  name: string;
  goal?: string;
  emoji?: string;
  topic_sources?: TopicSource[];
  diagnostic: DiagnosticResult | null;
  modules: LearningModule[];
  current_module_id: string;
  current_stage: LearningStage;
  current_kp_index: number;
  mastery_levels: Record<string, number>;
  qualitative_mastery: Record<string, boolean>;
  knowledge_types: Record<string, KnowledgeType>;
  lesson_evidence: Record<string, Record<string, unknown>>;
  assessment_evidence: Record<string, Record<string, unknown>>;
  source_grounded: boolean;
  source_exposures: Record<string, unknown>[];
  quiz_attempts: QuizAttempt[];
  error_records: ErrorRecord[];
  learning_evidence: LearningEvidence[];
  desired_retention: number;
  review_strategy: ReviewStrategyBinding | null;
  repetition_states: Record<string, RepetitionState>;
  review_queue: ReviewTask[];
  learner_mastery_overrides: Record<string, LearnerMasteryOverride>;
  deferred_objectives: Record<string, DeferredObjective>;
  explained_objectives: Record<string, Record<string, unknown>>;
  pending_question: PendingQuestion | null;
  feynman_retries: Record<string, number>;
  feynman_explanations: Record<string, string>;
  stage_failure_counts: Record<string, number>;
  stage_failure_notes: Record<string, string>;
  version: number;
  created_at: number;
  updated_at: number;
}

export function createLearningProgress(
  overrides: Partial<LearningProgress> & { book_id: string },
): LearningProgress {
  const now = Date.now() / 1000;
  return {
    learner_profile: null,
    name: "",
    goal: "",
    emoji: "🧭",
    topic_sources: [],
    diagnostic: null,
    modules: [],
    current_module_id: "",
    current_stage: "diagnostic",
    current_kp_index: 0,
    mastery_levels: {},
    qualitative_mastery: {},
    knowledge_types: {},
    lesson_evidence: {},
    assessment_evidence: {},
    source_grounded: false,
    source_exposures: [],
    quiz_attempts: [],
    error_records: [],
    learning_evidence: [],
    desired_retention: 0.9,
    review_strategy: null,
    repetition_states: {},
    review_queue: [],
    learner_mastery_overrides: {},
    deferred_objectives: {},
    explained_objectives: {},
    pending_question: null,
    feynman_retries: {},
    feynman_explanations: {},
    stage_failure_counts: {},
    stage_failure_notes: {},
    version: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createKnowledgePoint(
  overrides: Partial<KnowledgePoint> &
    Pick<KnowledgePoint, "id" | "name" | "type" | "module_id">,
): KnowledgePoint {
  return {
    prerequisite_ids: [],
    topic_source_ids: [],
    required_visual_tasks: [],
    ...overrides,
  };
}

export function createLearningModule(
  overrides: Partial<LearningModule> & Pick<LearningModule, "id" | "name" | "order">,
): LearningModule {
  return {
    pass_threshold: 0.7,
    objective: "",
    knowledge_points: [],
    ...overrides,
  };
}

export function createLearningEvidence(
  overrides: Partial<LearningEvidence> & Pick<LearningEvidence, "knowledge_point_id">,
): LearningEvidence {
  return {
    evidence_id: "",
    question_id: "",
    timestamp: Date.now() / 1000,
    source: "mastery_path",
    assessment_type: "quiz",
    result: "incorrect",
    quality: null,
    hints_used: 0,
    attempt_count: 1,
    confidence: null,
    learner_answer: "",
    feedback: "",
    reference_answer: "",
    response_time: null,
    session_id: "",
    turn_id: "",
    visual_context: {},
    ...overrides,
  };
}

export function createQuizAttempt(
  overrides: Partial<QuizAttempt> &
    Pick<QuizAttempt, "question_id" | "knowledge_point_id" | "is_correct">,
): QuizAttempt {
  return {
    module_id: "",
    result: overrides.result ?? (overrides.is_correct ? "correct" : "incorrect"),
    user_answer: null,
    error_type: null,
    self_attribution: "",
    mastery_estimate: 0.0,
    timestamp: Date.now() / 1000,
    voided: false,
    void_reason: "",
    independent: true,
    visual_context: {},
    ...overrides,
  };
}

export function createPendingQuestion(
  overrides: Partial<PendingQuestion> &
    Pick<PendingQuestion, "question_id" | "knowledge_point_id">,
): PendingQuestion {
  return {
    module_id: "",
    prompt: "",
    question_type: "short",
    expected_answer: "",
    options: [],
    explanation: "",
    difficulty: "",
    source_evidence: {},
    assistance_used: false,
    assistance_context: {},
    created_at: Date.now() / 1000,
    visual_context: {},
    accepted_answers: [],
    questions: [],
    ...overrides,
  };
}
