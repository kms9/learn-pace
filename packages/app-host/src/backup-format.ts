import { databaseSchemaVersion, type DatabaseSnapshot } from "@learn-pace/infra";
import { decodeModelRecord, isCredentialRef, modelSetting, retiredCredentialSetting } from "./model-settings.js";

export const maxBackupBytes = 20 * 1024 * 1024;

export interface BackupManifest {
  format_version: 1;
  app_version: string;
  schema_version: number;
  exported_at: number;
  counts: { paths: number; sessions: number; messages: number; threads: number; interactions: number; evidence: number };
  includes_credentials: false;
}

export interface BackupEnvelope {
  manifest: BackupManifest;
  payload: DatabaseSnapshot;
  integrity: { algorithm: "sha256"; digest: string };
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export function backupCounts(payload: DatabaseSnapshot): BackupManifest["counts"] {
  return { paths: payload.learning_progress.length, sessions: payload.sessions.length, messages: payload.messages.length,
    threads: payload.session_threads.length, interactions: payload.interactions.length,
    evidence: payload.learning_progress.reduce((count, row) => count + row.progress.learning_evidence.length, 0) };
}

export function canonicalJson(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new BackupError("备份包含无效数值。");
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
}

function checkSize(raw: string): void {
  if (raw.length > maxBackupBytes) throw new BackupError("备份文件超过 20 MiB。");
  let bytes = 0;
  for (const char of raw) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > maxBackupBytes) throw new BackupError("备份文件超过 20 MiB。");
  }
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || isText(value);
const allowed = (value: unknown, options: readonly (string | null)[]) => options.some((option) => option === value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const strings = (row: Row, keys: string[]) => keys.every((key) => isText(row[key]));
const numbers = (row: Row, keys: string[]) => keys.every((key) => finite(row[key]));
const objects = (value: unknown, check: (row: Row) => boolean = () => true) =>
  Array.isArray(value) && value.every((item: unknown) => isRow(item) && check(item));

function question(value: unknown): boolean {
  return isRow(value) && strings(value, ["question_id", "knowledge_point_id", "prompt", "question_type", "expected_answer"]) &&
    objects(value.options, (option) => strings(option, ["label", "body"])) && Array.isArray(value.accepted_answers) &&
    value.accepted_answers.every(isText) && Array.isArray(value.questions) && value.questions.every(question);
}

function learningProgress(value: unknown): value is Row {
  if (!isRow(value) || !strings(value, ["book_id", "name", "current_module_id", "current_stage"]) ||
      !counter(value.version) || !counter(value.current_kp_index) || !numbers(value, ["created_at", "updated_at"]) ||
      typeof value.desired_retention !== "number" || !(value.desired_retention >= 0.7 && value.desired_retention <= 0.99)) return false;
  return objects(value.modules, (module) => strings(module, ["id", "name", "objective"]) && finite(module.order) &&
      objects(module.knowledge_points, (point) => strings(point, ["id", "name", "type", "module_id"]) &&
        [point.prerequisite_ids, point.topic_source_ids, point.required_visual_tasks].every((ids) =>
          Array.isArray(ids) && ids.every(isText)))) &&
    objects(value.learning_evidence, (evidence) => strings(evidence, ["evidence_id", "knowledge_point_id", "result", "learner_answer", "feedback"]) &&
      finite(evidence.timestamp)) && objects(value.quiz_attempts) &&
    objects(value.error_records, (error) => Array.isArray(error.retry_history)) &&
    objects(value.review_queue, (task) => isText(task.knowledge_point_id) && finite(task.due_at) && isRow(task.state)) &&
    [value.mastery_levels, value.qualitative_mastery, value.knowledge_types, value.repetition_states,
      value.learner_mastery_overrides, value.deferred_objectives, value.explained_objectives, value.assessment_evidence].every(isRow) &&
    (value.pending_question === null || question(value.pending_question)) &&
    (value.topic_sources === undefined || objects(value.topic_sources, (source) => strings(source, ["id", "label", "excerpt", "kind"])));
}

function validSetting({ name, value }: Row): boolean {
  if (!isText(name) || !isText(value) || name === retiredCredentialSetting || isCredentialRef(name)) return false;
  if (name !== modelSetting) return true;
  try {
    const model: unknown = JSON.parse(value);
    const exposed = new Set(["baseUrl", "model", "apiType", "reasoning", "contextWindow", "maxTokens", "credentialRef"]);
    return isRow(model) && model.credentialRef === null && Object.keys(model).every((key) => exposed.has(key)) &&
      decodeModelRecord(value) !== null;
  } catch {
    return false;
  }
}

function records(value: unknown, id: (row: Row) => unknown, valid: (row: Row) => boolean): boolean {
  const seen = new Set<string>();
  return objects(value, (row) => {
    if (!valid(row)) return false;
    const key = id(row);
    if (!isText(key) || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validPayload(value: unknown): value is DatabaseSnapshot {
  if (!isRow(value) || Object.keys(value).length !== 7) return false;
  const submissions = new Set<string>();
  return records(value.settings, (row) => row.name, validSetting) &&
    records(value.learning_progress, (row) => (row.progress as Row).book_id, (row) =>
      allowed(row.status, ["draft", "active", "completed", "archived"]) && learningProgress(row.progress)) &&
    records(value.sessions, (row) => row.session_id, (row) => strings(row, ["kind", "title"]) &&
      [row.path_id, row.model_id].every(nullableText) && allowed(row.mode, [null, "outline", "study", "review"]) &&
      numbers(row, ["created_at", "updated_at"])) &&
    records(value.messages, (row) => row.message_id, (row) => strings(row, ["session_id", "role", "content", "status"]) &&
      nullableText(row.turn_id) && (row.metadata === null || isRow(row.metadata)) && finite(row.created_at)) &&
    records(value.session_threads, (row) => row.thread_id, (row) => strings(row, ["parent_session_id", "source_message_id", "selected_text", "title"]) &&
      numbers(row, ["created_at", "updated_at"]) && [row.selection_start, row.selection_end, row.detached_at].every((value) => value === null || finite(value))) &&
    records(value.interactions, (row) => row.interaction_id, (row) => {
      if (!strings(row, ["path_id", "session_id", "turn_id"]) || !allowed(row.status, ["awaiting_input", "answered", "graded", "abandoned"]) ||
          !finite(row.updated_at) || !nullableText(row.raw_answer) || !question(row.question) ||
          (row.grade !== undefined && (!isRow(row.grade) || !isRow(row.grade.questions)))) return false;
      if (row.submission_id === null) return true;
      if (!isText(row.submission_id) || submissions.has(row.submission_id)) return false;
      submissions.add(row.submission_id);
      return true;
    }) && records(value.domain_events, (row) => row.event_id, (row) => isText(row.path_id) && nullableText(row.session_id) &&
      nullableText(row.turn_id) && allowed(row.event_type, ["AnswerRecorded", "AssessmentCommitted", "OutlineCommitted", "AssessmentVoided", "AssessmentCorrected"]) &&
      isRow(row.payload) && finite(row.created_at));
}

export type BackupDigest = (canonical: string) => Promise<string>;

export async function readBackup(raw: string, sha256: BackupDigest): Promise<BackupEnvelope> {
  checkSize(raw);
  let envelope: unknown;
  try { envelope = JSON.parse(raw); }
  catch { throw new BackupError("备份文件的 JSON 已损坏。"); }
  if (!isRow(envelope) || Object.keys(envelope).length !== 3 || !isRow(envelope.manifest) || !isRow(envelope.integrity)) {
    throw new BackupError("备份文件缺少完整的清单、数据或校验信息。");
  }
  const { manifest, payload, integrity } = envelope;
  if (manifest.format_version !== 1) throw new BackupError("此备份格式版本暂不受支持。");
  if (!counter(manifest.schema_version) || manifest.schema_version < 1 || manifest.schema_version > databaseSchemaVersion) {
    throw new BackupError("此备份的数据库版本与当前应用不兼容。");
  }
  if (integrity.algorithm !== "sha256" || !isText(integrity.digest) || !/^[0-9a-f]{64}$/i.test(integrity.digest)) {
    throw new BackupError("备份文件的 SHA-256 校验值无效。");
  }
  let digest: string;
  try { digest = await sha256(canonicalJson({ manifest, payload })); }
  catch { throw new BackupError("无法校验备份文件的完整性。"); }
  if (digest.toLowerCase() !== integrity.digest.toLowerCase()) throw new BackupError("备份完整性校验失败，文件内容可能已损坏或被修改。");
  if (manifest.includes_credentials !== false || !isText(manifest.app_version) || !manifest.app_version ||
      typeof manifest.exported_at !== "number" || !(manifest.exported_at >= 0 && manifest.exported_at <= 8.64e12) ||
      !validPayload(payload) || canonicalJson(manifest.counts) !== canonicalJson(backupCounts(payload))) {
    throw new BackupError("备份清单或数据结构无效。");
  }
  return { manifest: manifest as unknown as BackupManifest, payload, integrity: { algorithm: "sha256", digest: integrity.digest } };
}
