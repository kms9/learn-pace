import { databaseSchemaVersion, type DatabaseSnapshot, type StoredSkillRevision } from "@learn-pace/infra";
import { readRegistryLocator, registrySkillUrl, validRegistryVersion } from "./extensions/skills/registry-origin.js";
import { decodeModelRecord, isCredentialRef, modelSetting, retiredCredentialSetting } from "./model-settings.js";
import { checkedSkillPath, maxSkillLibraryBytes, skillNamePattern, skillRevisionPattern, validateSkillPackage } from "./extensions/skills/package-validator.js";
import { decodeSkillFiles, readSkillDeclarations, readSkillManifest } from "./extensions/skills/package-storage.js";
import { imaRetiredCredentialSetting, isImaCredentialRef } from "./extensions/knowledge/ima-credentials.js";

export const maxBackupBytes = 20 * 1024 * 1024;

export interface BackupManifest {
  format_version: 1 | 2;
  app_version: string;
  schema_version: number;
  exported_at: number;
  counts: { paths: number; sessions: number; messages: number; threads: number; interactions: number; evidence: number; knowledge_cards: number;
    skills: number; skill_revisions: number; skill_bindings: number; provider_connections: number; source_bindings: number };
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
    evidence: payload.learning_progress.reduce((count, row) => count + row.progress.learning_evidence.length, 0),
    knowledge_cards: payload.knowledge_cards.filter(({ deleted_at }) => deleted_at === null).length,
    skills: payload.skills.length, skill_revisions: payload.skill_revisions.length, skill_bindings: payload.skill_bindings.length,
    provider_connections: payload.provider_connections.length, source_bindings: payload.source_bindings.length };
}

export function canonicalJson(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new BackupError("备份包含无效数值。");
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
}

export function checkBackupSize(raw: string): void {
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
  if (!isText(name) || !isText(value) || name === retiredCredentialSetting || name === imaRetiredCredentialSetting ||
      isCredentialRef(name) || isImaCredentialRef(name)) return false;
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

type LaterTable = "knowledge_cards" | "skills" | "skill_revisions" | "skill_bindings" | "provider_connections" | "source_bindings";
type SnapshotInput = Omit<DatabaseSnapshot, LaterTable> & Partial<Pick<DatabaseSnapshot, LaterTable>>;
const tableCounts: Record<number, number> = { 5: 7, 6: 8, 7: 11, 8: 13, 9: 13 };

function validPayload(value: unknown, schema: number): value is SnapshotInput {
  if (!isRow(value) || Object.keys(value).length !== tableCounts[schema]) return false;
  const legacy = schema === 5;
  if (legacy ? Object.hasOwn(value, "knowledge_cards") : !records(value.knowledge_cards, (card) => card.card_id, (card) =>
    allowed(card.source_kind, ["chat", "little_tutor", "mastery_card"]) &&
    strings(card, ["title", "content", "note"]) && numbers(card, ["created_at", "updated_at"]) &&
    (card.deleted_at === null || finite(card.deleted_at)) &&
    [card.path_id, card.source_session_id, card.source_message_id, card.source_interaction_id].every(nullableText))) return false;
  if (schema >= 7 && !validSkillRows(value, schema)) return false;
  if (schema >= 8 && !validKnowledgeRows(value)) return false;
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

function validKnowledgeRows(value: Row): boolean {
  const connections = new Set<string>();
  if (!records(value.provider_connections, row => row.connection_id, row => {
    if (Object.keys(row).length !== 8 || !isText(row.connection_id) || !isText(row.display_name) ||
        row.provider !== "ima" || row.status !== "disconnected" || row.credential_ref !== null || row.last_error !== null ||
        !numbers(row, ["created_at", "updated_at"])) return false;
    connections.add(row.connection_id);
    return true;
  })) return false;
  const libraries = new Set<string>();
  return records(value.source_bindings, row => row.binding_id, row => {
    if (Object.keys(row).length !== 12 || !isText(row.connection_id) || !connections.has(row.connection_id) || row.provider !== "ima" ||
        !isText(row.remote_kb_id) || !row.remote_kb_id || !strings(row, ["name", "description", "base_type", "role_type"]) ||
        row.writable !== 0 || (row.enabled !== 0 && row.enabled !== 1) || !numbers(row, ["created_at", "updated_at"])) return false;
    const identity = JSON.stringify([row.connection_id, row.remote_kb_id]);
    if (libraries.has(identity)) return false;
    libraries.add(identity);
    return true;
  });
}

function validSkillRows(value: Row, schema: number): boolean {
  const flag = (value: unknown) => value === 0 || value === 1;
  const origins = schema >= 9 ? ["local_file", "local_zip", "github", "registry"] : ["local_file", "local_zip", "github"];
  return records(value.skills, (row) => row.skill_id, (row) =>
    Object.keys(row).length === 15 && strings(row, ["name", "description", "origin_locator", "active_revision",
      "compatibility_json", "metadata_json"]) && row.skill_id === row.name && isText(row.name) &&
    row.name.length <= 64 && skillNamePattern.test(row.name) && skillRevisionPattern.test(row.active_revision as string) &&
    allowed(row.origin_kind, origins) && nullableText(row.pinned_ref) && nullableText(row.source_url) &&
    [row.enabled, row.user_invocable, row.disable_model_invocation].every(flag) && numbers(row, ["created_at", "updated_at"])) &&
    records(value.skill_revisions, (row) => row.skill_id, (row) => Object.keys(row).length === 7 &&
      strings(row, ["revision", "manifest_json", "files_json_base64"]) && skillRevisionPattern.test(row.revision as string) &&
      counter(row.raw_bytes) && counter(row.instructions_chars) && finite(row.created_at)) &&
    records(value.skill_bindings, (row) => JSON.stringify([row.skill_id, row.scope]), (row) => Object.keys(row).length === 4 &&
      isText(row.skill_id) && allowed(row.scope, ["lf01", "little_tutor"]) && flag(row.enabled) && finite(row.updated_at));
}

async function validateSkillLibrary(snapshot: DatabaseSnapshot): Promise<void> {
  const invalid = () => new BackupError("备份中的技能来源、版本、路径或清单无法通过完整性校验。");
  if (snapshot.skills.length !== snapshot.skill_revisions.length) throw invalid();
  const revisions = new Map<string, StoredSkillRevision>(snapshot.skill_revisions.map((item) => [item.skill_id, item]));
  const ids = new Set(snapshot.skills.map(({ skill_id }) => skill_id));
  const origins = new Set<string>();
  let totalBytes = 0;
  for (const skill of snapshot.skills) {
    if (origins.has(skill.origin_locator)) throw invalid();
    origins.add(skill.origin_locator);
    const revision = revisions.get(skill.skill_id);
    if (!revision || revision.revision !== skill.active_revision) throw invalid();
    try {
      if (skill.origin_kind === "github") {
        const origin = /^github:([a-z0-9-]+)\/([a-z0-9_.-]+)\/(.*)$/.exec(skill.origin_locator);
        if (!origin || origin[2] === "." || origin[2] === ".." || !/^[a-f0-9]{40}$/.test(skill.pinned_ref ?? "")) throw invalid();
        const directory = origin[3]!;
        if (directory) checkedSkillPath(directory);
        const source = skill.source_url?.split("/");
        if (!source || source[0] !== "https:" || source[1] !== "" || source[2] !== "github.com" ||
            source[3] !== origin[1] || source[4] !== origin[2] || source[5] !== "blob" || !source[6] ||
            source.slice(7).map(decodeURIComponent).join("/") !== (directory ? directory + "/" : "") + "SKILL.md" ||
            /[\\?#\u0000-\u001f\u007f]/.test(decodeURIComponent(source[6]))) throw invalid();
      } else if (skill.origin_kind === "registry") {
        const ref = readRegistryLocator(skill.origin_locator);
        if (!ref || skill.source_url !== registrySkillUrl(ref) || !validRegistryVersion(skill.pinned_ref)) throw invalid();
      } else if (skill.origin_locator !== "local:" + skill.skill_id || skill.source_url !== null || skill.pinned_ref !== null) {
        throw invalid();
      }
      const pack = await validateSkillPackage(decodeSkillFiles(revision));
      totalBytes += pack.rawBytes;
      if (totalBytes > maxSkillLibraryBytes || pack.name !== skill.skill_id || pack.description !== skill.description ||
          pack.revision !== revision.revision || pack.rawBytes !== revision.raw_bytes || pack.instructionsChars !== revision.instructions_chars ||
          pack.userInvocable !== (skill.user_invocable === 1) || pack.modelInvocable !== (skill.disable_model_invocation === 0) ||
          canonicalJson(pack.manifest) !== canonicalJson(readSkillManifest(revision.manifest_json))) throw invalid();
      const declarations = readSkillDeclarations(skill);
      if (declarations.compatibility !== pack.compatibility || canonicalJson(declarations.allowedTools) !== canonicalJson(pack.allowedTools) ||
          canonicalJson(declarations.metadata) !== canonicalJson(pack.metadata) ||
          Object.keys(JSON.parse(skill.compatibility_json)).length !== 2) throw invalid();
    } catch {
      throw invalid();
    }
  }
  if (snapshot.skill_bindings.some(({ skill_id }) => !ids.has(skill_id))) throw invalid();
}

export type BackupDigest = (canonical: string) => Promise<string>;

export async function readBackup(raw: string, sha256: BackupDigest): Promise<BackupEnvelope> {
  checkBackupSize(raw);
  let envelope: unknown;
  try { envelope = JSON.parse(raw); }
  catch { throw new BackupError("备份文件的 JSON 已损坏。"); }
  if (!isRow(envelope) || Object.keys(envelope).length !== 3 || !isRow(envelope.manifest) || !isRow(envelope.integrity)) {
    throw new BackupError("备份文件缺少完整的清单、数据或校验信息。");
  }
  const { manifest, payload, integrity } = envelope;
  if (manifest.format_version !== 1 && manifest.format_version !== 2) throw new BackupError("此备份格式版本暂不受支持。");
  if (manifest.format_version === 1 ? manifest.schema_version !== 5 && manifest.schema_version !== 6
    : manifest.schema_version !== 7 && manifest.schema_version !== 8 && manifest.schema_version !== databaseSchemaVersion) {
    throw new BackupError("此备份的数据库版本与当前应用不兼容。");
  }
  if (integrity.algorithm !== "sha256" || !isText(integrity.digest) || !/^[0-9a-f]{64}$/i.test(integrity.digest)) {
    throw new BackupError("备份文件的 SHA-256 校验值无效。");
  }
  let digest: string;
  try { digest = await sha256(canonicalJson({ manifest, payload })); }
  catch { throw new BackupError("无法校验备份文件的完整性。"); }
  if (digest.toLowerCase() !== integrity.digest.toLowerCase()) throw new BackupError("备份完整性校验失败，文件内容可能已损坏或被修改。");
  const schema = manifest.schema_version as number;
  if (manifest.includes_credentials !== false || !isText(manifest.app_version) || !manifest.app_version ||
      typeof manifest.exported_at !== "number" || !(manifest.exported_at >= 0 && manifest.exported_at <= 8.64e12) ||
      !validPayload(payload, schema)) {
    throw new BackupError("备份清单或数据结构无效。");
  }
  const normalized: DatabaseSnapshot = { ...payload, knowledge_cards: payload.knowledge_cards ?? [],
    skills: payload.skills ?? [], skill_revisions: payload.skill_revisions ?? [], skill_bindings: payload.skill_bindings ?? [],
    provider_connections: payload.provider_connections ?? [], source_bindings: payload.source_bindings ?? [] };
  if (manifest.format_version === 2) await validateSkillLibrary(normalized);
  const counts = backupCounts(normalized);
  const { provider_connections: _connections, source_bindings: _sources, ...v7Counts } = counts;
  const { skills: _skills, skill_revisions: _revisions, skill_bindings: _bindings, knowledge_cards: knowledgeCards, ...legacyCounts } = v7Counts;
  const expected = schema === 5 ? legacyCounts : schema === 6 ? { ...legacyCounts, knowledge_cards: knowledgeCards } :
    schema === 7 ? v7Counts : counts;
  if (canonicalJson(manifest.counts) !== canonicalJson(expected)) {
    throw new BackupError("备份清单或数据结构无效。");
  }
  return { manifest: { format_version: manifest.format_version, app_version: manifest.app_version, schema_version: schema,
    exported_at: manifest.exported_at, includes_credentials: false, counts },
  payload: normalized, integrity: { algorithm: "sha256", digest: integrity.digest } };
}
