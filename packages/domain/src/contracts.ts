/**
 * Application Command / Query / Event contracts from Learn Pace PRD V0.2
 * (`docs/prd/07-data-flow.md` & `docs/prd/02-page-layout-interaction.md`).
 *
 * Notice D3: during M2-A rapid delivery these commands execute via straightforward
 * sequential persistence; M2-B hardening wraps key commands with SQLite transactions,
 * revision CAS, and submission_id idempotency without changing these signatures.
 */

import type {
  AssessmentResultKind,
  CurriculumProfileId,
  InteractionStatus,
  LearningModule,
  PathStatus,
  PendingQuestion,
  ReviewTask,
  SessionMode,
  TurnStatus,
} from "./models.js";
import type { PublicPendingQuestion } from "./pending.js";

// ── Commands ─────────────────────────────────────────────────────────────────

export interface SubmitMessageCommand {
  type: "SubmitMessage";
  session_id: string;
  submission_id: string;
  text: string;
  quote_ref?: {
    source_message_id: string;
    selected_text: string;
  };
}

export interface CreateThreadCommand {
  type: "CreateThread";
  parent_session_id: string;
  source_message_id: string;
  selected_text: string;
  prompt?: string;
}

export interface CreateLearningPathCommand {
  type: "CreateLearningPath";
  goal: string;
  name?: string;
  curriculum_profile?: CurriculumProfileId;
  source_session_id?: string;
  source_message_id?: string;
  source_excerpt?: string;
}

export interface CommitOutlineCommand {
  type: "CommitOutline";
  path_id: string;
  expected_revision?: number;
  modules: LearningModule[];
}

export interface ReviseOutlineCommand {
  type: "ReviseOutline";
  path_id: string;
  expected_revision?: number;
  modules: LearningModule[];
  reason?: string;
}

export interface ChangeLearningModeCommand {
  type: "ChangeLearningMode";
  session_id: string;
  path_id: string;
  mode: SessionMode;
}

export interface RegisterQuestionCommand {
  type: "RegisterQuestion";
  path_id: string;
  session_id: string;
  turn_id: string;
  question: PendingQuestion;
}

export interface RecordHintCommand {
  type: "RecordHint";
  path_id: string;
  interaction_id: string;
  hint_kind: "hint_button" | "little_tutor" | "reference_material";
}

export interface SubmitAnswerCommand {
  type: "SubmitAnswer";
  path_id: string;
  interaction_id: string;
  submission_id: string;
  raw_answer: string;
}

export interface CommitAssessmentCommand {
  type: "CommitAssessment";
  path_id: string;
  interaction_id: string;
  submission_id: string;
  assessment_type: "quiz" | "qualitative" | "review";
  result: AssessmentResultKind;
  score?: number;
  rationale: string;
  model_id?: string;
  expected_revision?: number;
}

export interface VoidAssessmentCommand {
  type: "VoidAssessment";
  path_id: string;
  question_id: string;
  reason: string;
}

export type ApplicationCommand =
  | SubmitMessageCommand
  | CreateThreadCommand
  | CreateLearningPathCommand
  | CommitOutlineCommand
  | ReviseOutlineCommand
  | ChangeLearningModeCommand
  | RegisterQuestionCommand
  | RecordHintCommand
  | SubmitAnswerCommand
  | CommitAssessmentCommand
  | VoidAssessmentCommand;

// ── Domain Events ────────────────────────────────────────────────────────────

export type DomainEventType =
  | "TurnStarted"
  | "MessageCommitted"
  | "ThreadCreated"
  | "PathCreated"
  | "OutlineCommitted"
  | "ModeChanged"
  | "QuestionPresented"
  | "HintRecorded"
  | "AnswerRecorded"
  | "AssessmentCommitted"
  | "AssessmentVoided"
  | "ReviewScheduled"
  | "ReviewCompleted";

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  path_id?: string;
  session_id?: string;
  turn_id?: string;
  revision?: number;
  event_type: DomainEventType;
  payload: TPayload;
  created_at: number;
}

// ── Query Projections ────────────────────────────────────────────────────────

export interface HomeSnapshot {
  curriculum_profile: CurriculumProfileId;
  due_review_count: number;
  active_path_count: number;
  mastered_objective_count: number;
  pending_interaction: PendingInteractionView | null;
}

export interface PathSummaryView {
  path_id: string;
  name: string;
  status: PathStatus;
  revision: number;
  mastered_count: number;
  total_count: number;
  due_review_count: number;
  updated_at: number;
}

export interface PendingInteractionView {
  interaction_id: string;
  path_id: string;
  session_id: string;
  status: InteractionStatus;
  question: PublicPendingQuestion;
  updated_at: number;
}

export interface SessionTurnSummary {
  turn_id: string;
  session_id: string;
  status: TurnStatus;
  created_at: number;
}

export interface ReviewQueueView {
  path_id: string;
  tasks: ReviewTask[];
  generated_at: number;
}
