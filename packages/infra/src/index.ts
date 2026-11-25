/**
 * Infrastructure ports (SQLite, SecureStore, controllable Clock).
 */

import type { AssessmentResultKind, LearningProgress, PathStatus, PendingQuestion, SessionMode } from "@learn-pace/domain";

export interface Clock {
  /** Unix epoch in seconds (matches DeepTutor timestamp convention). */
  nowSeconds(): number;
}

export const systemClock: Clock = {
  nowSeconds: () => Date.now() / 1000,
};

export interface LearningProgressStore {
  get(pathId: string): Promise<LearningProgress | null>;
  save(progress: LearningProgress): Promise<void>;
  listIds(): Promise<string[]>;
  delete(pathId: string): Promise<void>;
}

export interface SecretStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface StoredInteraction {
  interaction_id: string;
  path_id: string;
  session_id: string;
  turn_id: string;
  status: "awaiting_input" | "answered" | "graded" | "abandoned";
  question: PendingQuestion;
  raw_answer: string | null;
  submission_id: string | null;
  updated_at: number;
  grade?: InteractionGrade;
}

export type QuestionGrade = {
  result: AssessmentResultKind | "ungraded";
  final: boolean;
  feedback: string;
  confidence: number;
  reference_answer?: string;
  correct_option?: string;
  explanation?: string;
  voided?: boolean;
};

export interface InteractionGrade {
  questions: Record<string, QuestionGrade>;
  grading_failed?: boolean;
  elapsed_ms?: number;
}

export interface InteractionStore {
  getOpenInteraction(pathId: string): Promise<StoredInteraction | null>;
  getInteraction(id: string): Promise<StoredInteraction | null>;
  insertInteraction(interaction: StoredInteraction): Promise<void>;
  saveAnswer(id: string, submissionId: string, rawAnswer: string, now: number): Promise<void>;
  markGraded(id: string, now: number): Promise<void>;
  abandonInteraction(id: string, now: number): Promise<void>;
  deleteInteractionsByPath(pathId: string): Promise<void>;
  listInteractionsBySession(sessionId: string): Promise<StoredInteraction[]>;
  updateInteraction(interaction: StoredInteraction): Promise<void>;
}

export interface SettingsStore {
  readSetting(name: string): Promise<string | null>;
  writeSetting(name: string, value: string): Promise<void>;
}

export interface StoredSession {
  session_id: string;
  kind: string;
  path_id: string | null;
  mode: SessionMode | null;
  title: string;
  model_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionStore {
  getSession(id: string): Promise<StoredSession | null>;
  saveSession(session: StoredSession): Promise<void>;
  listSessions(): Promise<StoredSession[]>;
  listSessionsByPath(pathId: string): Promise<StoredSession[]>;
  updateSession(session: StoredSession): Promise<void>;
  deleteSessionsByPath(pathId: string, kind: string): Promise<void>;
}

export interface StoredMessage {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  status: string;
  turn_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface MessageStore {
  getMessage(id: string): Promise<StoredMessage | null>;
  saveMessage(message: StoredMessage): Promise<void>;
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  deleteMessages(ids: readonly string[]): Promise<void>;
}

export interface StoredThread {
  /** Session ID of the child conversation. */
  thread_id: string;
  parent_session_id: string;
  source_message_id: string;
  selected_text: string;
  selection_start: number | null;
  selection_end: number | null;
  detached_at: number | null;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ThreadStore {
  getThread(id: string): Promise<StoredThread | null>;
  saveThread(thread: StoredThread): Promise<void>;
  updateThread(thread: StoredThread): Promise<void>;
  deleteThread(id: string): Promise<void>;
  listThreads(parentSessionId: string): Promise<StoredThread[]>;
}

export interface PathSummaryRecord {
  path_id: string;
  name: string;
  status: PathStatus;
  updated_at: number;
}

export interface AppStore extends SettingsStore, LearningProgressStore, InteractionStore, SessionStore, MessageStore, ThreadStore {
  save(progress: LearningProgress, status?: PathStatus): Promise<void>;
  listPathSummaries(): Promise<PathSummaryRecord[]>;
  getLatestOpenInteraction(): Promise<StoredInteraction | null>;
}

export { MemoryAppStore, MemorySecretStore } from "./memory.js";
