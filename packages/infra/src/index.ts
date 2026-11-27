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
  listOpenInteractions(): Promise<StoredInteraction[]>;
  listGradedInteractions(pathId?: string): Promise<StoredInteraction[]>;
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

export class VersionConflictError extends Error {
  constructor() {
    super("学习进度已更新，请刷新后重试。若在修改大纲，请重新生成预览。");
    this.name = "VersionConflictError";
  }
}

export class SubmissionConflictError extends Error {
  constructor() {
    super("这次提交已用于另一份作答，请刷新题卡后重试。");
    this.name = "SubmissionConflictError";
  }
}

export interface StoredDomainEvent {
  event_id: string;
  path_id: string;
  session_id: string | null;
  turn_id: string | null;
  event_type: "AnswerRecorded" | "AssessmentCommitted" | "OutlineCommitted" | "AssessmentVoided" | "AssessmentCorrected";
  payload: Record<string, unknown>;
  created_at: number;
}

export interface StoredKnowledgeCard {
  card_id: string;
  source_kind: "chat" | "little_tutor" | "mastery_card";
  title: string;
  content: string;
  note: string;
  path_id: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  source_interaction_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface KnowledgeCardFilter {
  includeDeleted?: boolean;
  query?: string;
}

export interface KnowledgeCardStore {
  saveKnowledgeCard(card: StoredKnowledgeCard): Promise<void>;
  getKnowledgeCard(id: string): Promise<StoredKnowledgeCard | null>;
  listKnowledgeCards(options?: KnowledgeCardFilter): Promise<StoredKnowledgeCard[]>;
  softDeleteKnowledgeCard(id: string, now: number): Promise<void>;
  detachKnowledgeCardsByPath(pathId: string, now: number): Promise<void>;
}

export type SkillScope = "lf01" | "little_tutor";
export type SkillOriginKind = "local_file" | "local_zip" | "github" | "registry";
export type StoredFlag = 0 | 1;

export interface StoredSkill {
  skill_id: string;
  name: string;
  description: string;
  origin_kind: SkillOriginKind;
  origin_locator: string;
  source_url: string | null;
  pinned_ref: string | null;
  active_revision: string;
  enabled: StoredFlag;
  user_invocable: StoredFlag;
  disable_model_invocation: StoredFlag;
  compatibility_json: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

export interface StoredSkillRevision {
  skill_id: string;
  revision: string;
  manifest_json: string;
  files_json_base64: string;
  raw_bytes: number;
  instructions_chars: number;
  created_at: number;
}

export interface StoredSkillBinding {
  skill_id: string;
  scope: SkillScope;
  enabled: StoredFlag;
  updated_at: number;
}

export interface SkillScopeEntry {
  skill: StoredSkill;
  binding: StoredFlag | null;
  manifest: string | null;
}

export interface SkillStore {
  getSkill(skillId: string): Promise<StoredSkill | null>;
  listSkills(): Promise<StoredSkill[]>;
  saveSkill(skill: StoredSkill): Promise<void>;
  deleteSkill(skillId: string): Promise<void>;
  getSkillRevision(skillId: string, revision: string): Promise<StoredSkillRevision | null>;
  saveSkillRevision(revision: StoredSkillRevision): Promise<void>;
  skillLibraryBytes(): Promise<number>;
  deleteInactiveSkillRevisions(): Promise<void>;
  listSkillBindings(skillId: string): Promise<StoredSkillBinding[]>;
  saveSkillBinding(binding: StoredSkillBinding): Promise<void>;
  scopeSnapshot(scope: SkillScope): Promise<SkillScopeEntry[]>;
}

export interface StoredProviderConnection {
  connection_id: string;
  provider: "ima";
  display_name: string;
  status: "disconnected" | "ready" | "auth_denied" | "error";
  credential_ref: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface StoredSourceBinding {
  binding_id: string;
  connection_id: string;
  provider: StoredProviderConnection["provider"];
  remote_kb_id: string;
  name: string;
  description: string;
  base_type: string;
  role_type: string;
  writable: StoredFlag;
  enabled: StoredFlag;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeStore {
  getProviderConnection(id: string): Promise<StoredProviderConnection | null>;
  listProviderConnections(): Promise<StoredProviderConnection[]>;
  saveProviderConnection(connection: StoredProviderConnection): Promise<void>;
  deleteProviderConnection(id: string): Promise<void>;
  getSourceBinding(id: string): Promise<StoredSourceBinding | null>;
  listSourceBindings(connectionId?: string): Promise<StoredSourceBinding[]>;
  saveSourceBinding(binding: StoredSourceBinding): Promise<void>;
  deleteSourceBinding(id: string): Promise<void>;
}

export interface DatabaseSnapshot {
  settings: { name: string; value: string }[];
  learning_progress: { progress: LearningProgress; status: PathStatus }[];
  interactions: StoredInteraction[];
  sessions: StoredSession[];
  messages: StoredMessage[];
  session_threads: StoredThread[];
  domain_events: StoredDomainEvent[];
  knowledge_cards: StoredKnowledgeCard[];
  skills: StoredSkill[];
  skill_revisions: StoredSkillRevision[];
  skill_bindings: StoredSkillBinding[];
  provider_connections: StoredProviderConnection[];
  source_bindings: StoredSourceBinding[];
}

export interface AppStore extends SettingsStore, LearningProgressStore, InteractionStore, SessionStore, MessageStore,
  ThreadStore, KnowledgeCardStore, SkillStore, KnowledgeStore {
  /** 所有事务内读写都使用 tx。嵌套事务复用 tx，随外层事务一起提交或回滚。 */
  runInTransaction<T>(work: (tx: AppStore) => Promise<T>): Promise<T>;
  exportSnapshot(): Promise<DatabaseSnapshot>;
  replaceSnapshot(snapshot: DatabaseSnapshot, afterReplace?: (tx: AppStore) => Promise<void>): Promise<void>;
  save(progress: LearningProgress, status?: PathStatus): Promise<void>;
  saveWithCas(progress: LearningProgress, expectedVersion: number | null, status?: PathStatus): Promise<void>;
  listPathSummaries(): Promise<PathSummaryRecord[]>;
  getLatestOpenInteraction(): Promise<StoredInteraction | null>;
  listOpenInteractionsByPath(pathId: string): Promise<StoredInteraction[]>;
  findInteractionBySubmission(submissionId: string): Promise<StoredInteraction | null>;
  appendDomainEvent(event: StoredDomainEvent): Promise<void>;
  /** 按提交顺序倒序读取路径的领域事件。 */
  listDomainEvents(pathId: string, limit?: number): Promise<StoredDomainEvent[]>;
  deleteDomainEventsByPath(pathId: string): Promise<void>;
}

export { MemoryAppStore, MemorySecretStore } from "./memory.js";
export { databaseSchemaVersion } from "./migrations.js";
