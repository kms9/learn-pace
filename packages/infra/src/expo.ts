import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteBindValue, type SQLiteDatabase } from "expo-sqlite";
import type { LearningProgress, PathStatus, PendingQuestion } from "@learn-pace/domain";
import {
  SubmissionConflictError, VersionConflictError,
  type AppStore, type DatabaseSnapshot, type PathSummaryRecord, type SecretStore, type StoredDomainEvent, type StoredInteraction,
  type KnowledgeCardFilter, type StoredKnowledgeCard, type StoredMessage, type StoredSession, type StoredThread,
  type SkillScope, type SkillScopeEntry, type StoredSkill, type StoredSkillRevision, type StoredSkillBinding,
  type StoredProviderConnection, type StoredSourceBinding,
} from "./index.js";
import { searchKnowledgeCards } from "./knowledge-card-search.js";
import { migrateLearningDatabase } from "./migrations.js";
import { insertSnapshot } from "./snapshot.js";
import { WriteQueue } from "./write-queue.js";

export const expoSecretStore: SecretStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

type InteractionRow = Omit<StoredInteraction, "question"> & { question: string };

function decodeInteraction(row: InteractionRow): StoredInteraction {
  const { _grade, ...question } = JSON.parse(row.question) as PendingQuestion & { _grade?: StoredInteraction["grade"] };
  return { ...row, question, ...(_grade ? { grade: _grade } : {}) };
}

function encodeInteraction({ question, grade }: StoredInteraction): string {
  return JSON.stringify(grade ? { ...question, _grade: grade } : question);
}

type MessageRow = Omit<StoredMessage, "metadata"> & { metadata: string | null };
type DomainEventRow = Omit<StoredDomainEvent, "payload"> & { payload: string };

function decodeDomainEvent(row: DomainEventRow): StoredDomainEvent {
  return { ...row, payload: JSON.parse(row.payload) as StoredDomainEvent["payload"] };
}

function decodeMessage(row: MessageRow): StoredMessage {
  return { ...row, metadata: row.metadata === null ? null : JSON.parse(row.metadata) as StoredMessage["metadata"] };
}

export class ExpoLearningStore implements AppStore {
  private constructor(private readonly db: SQLiteDatabase, private readonly writes: WriteQueue | null = new WriteQueue()) {}

  private write<T>(work: () => Promise<T>): Promise<T> {
    return this.writes ? this.writes.run(work) : work();
  }

  private run(sql: string, ...params: SQLiteBindValue[]) {
    return this.write(() => this.db.runAsync(sql, ...params));
  }

  async runInTransaction<T>(work: (tx: AppStore) => Promise<T>): Promise<T> {
    if (!this.writes) return work(this);
    return this.writes.run(async () => {
      let result!: T;
      await this.db.withExclusiveTransactionAsync(async (txn) => {
        await txn.execAsync("PRAGMA busy_timeout = 5000");
        result = await work(new ExpoLearningStore(txn, null));
      });
      return result;
    });
  }

  async exportSnapshot(): Promise<DatabaseSnapshot> {
    if (this.writes) return this.runInTransaction((tx) => tx.exportSnapshot());
    const settings = await this.db.getAllAsync<DatabaseSnapshot["settings"][number]>("SELECT * FROM settings ORDER BY name");
    const paths = await this.db.getAllAsync<{ progress: string; version: number; status: PathStatus }>(
      "SELECT progress, version, status FROM learning_progress ORDER BY path_id",
    );
    const sessions = await this.db.getAllAsync<StoredSession>("SELECT * FROM sessions ORDER BY session_id");
    const messages = await this.db.getAllAsync<MessageRow>("SELECT * FROM messages ORDER BY message_id");
    const threads = await this.db.getAllAsync<StoredThread>("SELECT * FROM session_threads ORDER BY thread_id");
    const interactions = await this.db.getAllAsync<InteractionRow>("SELECT * FROM interactions ORDER BY interaction_id");
    const events = await this.db.getAllAsync<DomainEventRow>("SELECT * FROM domain_events ORDER BY rowid");
    const cards = await this.db.getAllAsync<StoredKnowledgeCard>("SELECT * FROM knowledge_cards ORDER BY card_id");
    const skills = await this.listSkills();
    const revisions = await this.db.getAllAsync<StoredSkillRevision>("SELECT * FROM skill_revisions ORDER BY skill_id, revision");
    const bindings = await this.db.getAllAsync<StoredSkillBinding>("SELECT * FROM skill_bindings ORDER BY skill_id, scope");
    const connections = await this.listProviderConnections();
    const sourceBindings = await this.db.getAllAsync<StoredSourceBinding>("SELECT * FROM source_bindings ORDER BY binding_id");
    return { settings, learning_progress: paths.map(({ progress, version, status }) => ({
      progress: { ...JSON.parse(progress) as LearningProgress, version }, status,
    })), sessions, messages: messages.map(decodeMessage), session_threads: threads,
    interactions: interactions.map(decodeInteraction), domain_events: events.map(decodeDomainEvent), knowledge_cards: cards,
    skills, skill_revisions: revisions, skill_bindings: bindings, provider_connections: connections, source_bindings: sourceBindings };
  }

  async replaceSnapshot(snapshot: DatabaseSnapshot, afterReplace?: (tx: AppStore) => Promise<void>): Promise<void> {
    if (this.writes) return this.runInTransaction((tx) => tx.replaceSnapshot(snapshot, afterReplace));
    await this.db.execAsync(`
      DELETE FROM source_bindings;
      DELETE FROM provider_connections;
      DELETE FROM skill_bindings;
      DELETE FROM skill_revisions;
      DELETE FROM skills;
      DELETE FROM knowledge_cards;
      DELETE FROM domain_events;
      DELETE FROM interactions;
      DELETE FROM session_threads;
      DELETE FROM messages;
      DELETE FROM sessions;
      DELETE FROM learning_progress;
      DELETE FROM settings;
    `);
    await insertSnapshot(this, snapshot);
    await afterReplace?.(this);
  }

  getProviderConnection(id: string): Promise<StoredProviderConnection | null> {
    return this.db.getFirstAsync<StoredProviderConnection>("SELECT * FROM provider_connections WHERE connection_id = ?", id);
  }

  listProviderConnections(): Promise<StoredProviderConnection[]> {
    return this.db.getAllAsync<StoredProviderConnection>("SELECT * FROM provider_connections ORDER BY connection_id");
  }

  async saveProviderConnection(row: StoredProviderConnection): Promise<void> {
    await this.run(`INSERT INTO provider_connections
      (connection_id, provider, display_name, status, credential_ref, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (connection_id) DO UPDATE SET
      display_name = excluded.display_name, status = excluded.status, credential_ref = excluded.credential_ref,
      last_error = excluded.last_error, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    row.connection_id, row.provider, row.display_name, row.status, row.credential_ref, row.last_error, row.created_at, row.updated_at);
  }

  async deleteProviderConnection(id: string): Promise<void> {
    if (this.writes) return this.runInTransaction((tx) => tx.deleteProviderConnection(id));
    await this.run("DELETE FROM source_bindings WHERE connection_id = ?", id);
    await this.run("DELETE FROM provider_connections WHERE connection_id = ?", id);
  }

  getSourceBinding(id: string): Promise<StoredSourceBinding | null> {
    return this.db.getFirstAsync<StoredSourceBinding>("SELECT * FROM source_bindings WHERE binding_id = ?", id);
  }

  listSourceBindings(connectionId?: string): Promise<StoredSourceBinding[]> {
    const order = " ORDER BY updated_at DESC, binding_id";
    return connectionId === undefined
      ? this.db.getAllAsync<StoredSourceBinding>("SELECT * FROM source_bindings" + order)
      : this.db.getAllAsync<StoredSourceBinding>("SELECT * FROM source_bindings WHERE connection_id = ?" + order, connectionId);
  }

  async saveSourceBinding(row: StoredSourceBinding): Promise<void> {
    const result = await this.run(`INSERT INTO source_bindings
      (binding_id, connection_id, provider, remote_kb_id, name, description, base_type, role_type,
        writable, enabled, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM provider_connections WHERE connection_id = ? AND provider = ?)
      ON CONFLICT (binding_id) DO UPDATE SET name = excluded.name, description = excluded.description,
        base_type = excluded.base_type, role_type = excluded.role_type, writable = excluded.writable,
        enabled = excluded.enabled, created_at = excluded.created_at, updated_at = excluded.updated_at
      WHERE source_bindings.connection_id = excluded.connection_id AND source_bindings.remote_kb_id = excluded.remote_kb_id`,
    row.binding_id, row.connection_id, row.provider, row.remote_kb_id, row.name, row.description, row.base_type,
    row.role_type, row.writable, row.enabled, row.created_at, row.updated_at, row.connection_id, row.provider);
    if (!result.changes) throw new Error("知识库连接不存在或绑定身份冲突");
  }

  async deleteSourceBinding(id: string): Promise<void> {
    await this.run("DELETE FROM source_bindings WHERE binding_id = ?", id);
  }

  getSkill(skillId: string): Promise<StoredSkill | null> {
    return this.db.getFirstAsync<StoredSkill>("SELECT * FROM skills WHERE skill_id = ?", skillId);
  }

  listSkills(): Promise<StoredSkill[]> {
    return this.db.getAllAsync<StoredSkill>("SELECT * FROM skills ORDER BY skill_id");
  }

  async saveSkill(s: StoredSkill): Promise<void> {
    await this.run(`
      INSERT INTO skills (skill_id, name, description, origin_kind, origin_locator, source_url, pinned_ref,
        active_revision, enabled, user_invocable, disable_model_invocation, compatibility_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (skill_id) DO UPDATE SET name = excluded.name, description = excluded.description,
        origin_kind = excluded.origin_kind, origin_locator = excluded.origin_locator, source_url = excluded.source_url,
        pinned_ref = excluded.pinned_ref, active_revision = excluded.active_revision, enabled = excluded.enabled,
        user_invocable = excluded.user_invocable, disable_model_invocation = excluded.disable_model_invocation,
        compatibility_json = excluded.compatibility_json, metadata_json = excluded.metadata_json,
        created_at = excluded.created_at, updated_at = excluded.updated_at
    `, s.skill_id, s.name, s.description, s.origin_kind, s.origin_locator, s.source_url, s.pinned_ref,
    s.active_revision, s.enabled, s.user_invocable, s.disable_model_invocation, s.compatibility_json, s.metadata_json,
    s.created_at, s.updated_at);
  }

  async deleteSkill(skillId: string): Promise<void> {
    if (this.writes) return this.runInTransaction((tx) => tx.deleteSkill(skillId));
    await this.run("DELETE FROM skill_bindings WHERE skill_id = ?", skillId);
    await this.run("DELETE FROM skills WHERE skill_id = ?", skillId);
  }

  getSkillRevision(skillId: string, revision: string): Promise<StoredSkillRevision | null> {
    return this.db.getFirstAsync<StoredSkillRevision>("SELECT * FROM skill_revisions WHERE skill_id = ? AND revision = ?", skillId, revision);
  }

  async saveSkillRevision(row: StoredSkillRevision): Promise<void> {
    await this.run(`
      INSERT INTO skill_revisions (skill_id, revision, manifest_json, files_json_base64, raw_bytes, instructions_chars, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (skill_id, revision) DO UPDATE SET
        manifest_json = excluded.manifest_json, files_json_base64 = excluded.files_json_base64,
        raw_bytes = excluded.raw_bytes, instructions_chars = excluded.instructions_chars, created_at = excluded.created_at
    `, row.skill_id, row.revision, row.manifest_json, row.files_json_base64, row.raw_bytes, row.instructions_chars, row.created_at);
  }

  async skillLibraryBytes(): Promise<number> {
    const row = await this.db.getFirstAsync<{ bytes: number }>("SELECT COALESCE(SUM(raw_bytes), 0) AS bytes FROM skill_revisions");
    return row?.bytes ?? 0;
  }

  async deleteInactiveSkillRevisions(): Promise<void> {
    await this.run(`DELETE FROM skill_revisions AS r WHERE NOT EXISTS
      (SELECT 1 FROM skills AS s WHERE s.skill_id = r.skill_id AND s.active_revision = r.revision)`);
  }

  listSkillBindings(skillId: string): Promise<StoredSkillBinding[]> {
    return this.db.getAllAsync<StoredSkillBinding>("SELECT * FROM skill_bindings WHERE skill_id = ? ORDER BY scope", skillId);
  }

  async saveSkillBinding(row: StoredSkillBinding): Promise<void> {
    await this.run(`
      INSERT INTO skill_bindings (skill_id, scope, enabled, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (skill_id, scope) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `, row.skill_id, row.scope, row.enabled, row.updated_at);
  }

  async scopeSnapshot(scope: SkillScope): Promise<SkillScopeEntry[]> {
    // A single SQLite statement reads all three tables from the same read snapshot.
    const rows = await this.db.getAllAsync<StoredSkill & Pick<SkillScopeEntry, "binding" | "manifest">>(`
      SELECT s.*, b.enabled AS binding, r.manifest_json AS manifest FROM skills AS s
      LEFT JOIN skill_bindings AS b ON b.skill_id = s.skill_id AND b.scope = ?
      LEFT JOIN skill_revisions AS r ON r.skill_id = s.skill_id AND r.revision = s.active_revision
      ORDER BY s.skill_id
    `, scope);
    return rows.map(({ binding, manifest, ...skill }) => ({ skill, binding, manifest }));
  }

  static async open(): Promise<ExpoLearningStore> {
    const db = await openDatabaseAsync("learn-pace.db");
    try {
      await db.execAsync("PRAGMA busy_timeout = 5000");
      await migrateLearningDatabase(db);
    } catch (error) {
      await db.closeAsync().catch(() => {});
      throw error;
    }
    return new ExpoLearningStore(db);
  }

  async get(pathId: string): Promise<LearningProgress | null> {
    const row = await this.db.getFirstAsync<{ progress: string; version: number }>(
      "SELECT progress, version FROM learning_progress WHERE path_id = ?", pathId,
    );
    return row ? { ...JSON.parse(row.progress) as LearningProgress, version: row.version } : null;
  }

  async save(progress: LearningProgress, status?: PathStatus): Promise<void> {
    const changedStatus = status ?? null;
    await this.run(`
      INSERT INTO learning_progress (path_id, progress, name, updated_at, version, status)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, 'active'))
      ON CONFLICT (path_id) DO UPDATE SET
        progress = excluded.progress, name = excluded.name, updated_at = excluded.updated_at,
        version = excluded.version, status = COALESCE(?, learning_progress.status)
    `, progress.book_id, JSON.stringify(progress), progress.name, progress.updated_at, progress.version,
    changedStatus, changedStatus);
  }

  async saveWithCas(progress: LearningProgress, expectedVersion: number | null, status?: PathStatus): Promise<void> {
    if (expectedVersion !== null && progress.version !== expectedVersion + 1) throw new VersionConflictError();
    const json = JSON.stringify(progress);
    const result = expectedVersion === null
      ? await this.run(`
        INSERT INTO learning_progress (path_id, progress, name, updated_at, version, status)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (path_id) DO NOTHING
      `, progress.book_id, json, progress.name, progress.updated_at, progress.version, status ?? "active")
      : await this.run(`
        UPDATE learning_progress SET progress = ?, name = ?, updated_at = ?, version = ?, status = COALESCE(?, status)
        WHERE path_id = ? AND version = ?
      `, json, progress.name, progress.updated_at, progress.version, status ?? null, progress.book_id, expectedVersion);
    if (result.changes !== 1) throw new VersionConflictError();
  }

  async listPathSummaries(): Promise<PathSummaryRecord[]> {
    return this.db.getAllAsync<PathSummaryRecord>(`
      SELECT path_id, name, status, updated_at FROM learning_progress
      ORDER BY updated_at DESC, path_id
    `);
  }

  async listIds(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ path_id: string }>(
      "SELECT path_id FROM learning_progress ORDER BY path_id",
    );
    return rows.map(({ path_id }) => path_id);
  }

  async delete(pathId: string): Promise<void> {
    await this.run("DELETE FROM learning_progress WHERE path_id = ?", pathId);
  }

  async getOpenInteraction(pathId: string): Promise<StoredInteraction | null> {
    return this.readInteraction(`
      SELECT * FROM interactions WHERE path_id = ? AND status IN ('awaiting_input', 'answered')
      ORDER BY updated_at DESC, interaction_id LIMIT 1
    `, pathId);
  }

  async getLatestOpenInteraction(): Promise<StoredInteraction | null> {
    return this.readInteraction(`
      SELECT * FROM interactions WHERE status IN ('awaiting_input', 'answered')
      ORDER BY updated_at DESC, interaction_id LIMIT 1
    `);
  }

  async listOpenInteractions(): Promise<StoredInteraction[]> {
    const rows = await this.db.getAllAsync<InteractionRow>(`
      SELECT * FROM interactions WHERE status IN ('awaiting_input', 'answered')
      ORDER BY updated_at DESC, interaction_id
    `);
    return rows.map(decodeInteraction);
  }

  async listGradedInteractions(pathId?: string): Promise<StoredInteraction[]> {
    const order = "ORDER BY updated_at DESC, interaction_id DESC";
    const rows = pathId === undefined
      ? await this.db.getAllAsync<InteractionRow>(`SELECT * FROM interactions WHERE status = 'graded' ${order}`)
      : await this.db.getAllAsync<InteractionRow>(`SELECT * FROM interactions WHERE path_id = ? AND status = 'graded' ${order}`, pathId);
    return rows.map(decodeInteraction);
  }

  async saveKnowledgeCard(card: StoredKnowledgeCard): Promise<void> {
    await this.run(`
      INSERT INTO knowledge_cards (card_id, source_kind, title, content, note, path_id, source_session_id,
        source_message_id, source_interaction_id, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (card_id) DO UPDATE SET source_kind = excluded.source_kind, title = excluded.title,
        content = excluded.content, note = excluded.note, path_id = excluded.path_id,
        source_session_id = excluded.source_session_id, source_message_id = excluded.source_message_id,
        source_interaction_id = excluded.source_interaction_id, created_at = excluded.created_at,
        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    `, card.card_id, card.source_kind, card.title, card.content, card.note, card.path_id, card.source_session_id,
    card.source_message_id, card.source_interaction_id, card.created_at, card.updated_at, card.deleted_at);
  }

  getKnowledgeCard(id: string): Promise<StoredKnowledgeCard | null> {
    return this.db.getFirstAsync<StoredKnowledgeCard>("SELECT * FROM knowledge_cards WHERE card_id = ?", id);
  }

  async listKnowledgeCards({ includeDeleted, query }: KnowledgeCardFilter = {}): Promise<StoredKnowledgeCard[]> {
    const where = includeDeleted ? "" : "WHERE deleted_at IS NULL";
    const cards = await this.db.getAllAsync<StoredKnowledgeCard>(`SELECT * FROM knowledge_cards ${where} ORDER BY updated_at DESC, card_id`);
    return searchKnowledgeCards(cards, query);
  }

  async softDeleteKnowledgeCard(id: string, now: number): Promise<void> {
    await this.run("UPDATE knowledge_cards SET deleted_at = ?, updated_at = ? WHERE card_id = ? AND deleted_at IS NULL", now, now, id);
  }

  async detachKnowledgeCardsByPath(pathId: string, now: number): Promise<void> {
    await this.run("UPDATE knowledge_cards SET path_id = NULL, updated_at = ? WHERE path_id = ?", now, pathId);
  }

  async listOpenInteractionsByPath(pathId: string): Promise<StoredInteraction[]> {
    const rows = await this.db.getAllAsync<InteractionRow>(`
      SELECT * FROM interactions WHERE path_id = ? AND status IN ('awaiting_input', 'answered')
      ORDER BY updated_at DESC, interaction_id
    `, pathId);
    return rows.map(decodeInteraction);
  }

  async getInteraction(id: string): Promise<StoredInteraction | null> {
    return this.readInteraction("SELECT * FROM interactions WHERE interaction_id = ?", id);
  }

  async findInteractionBySubmission(submissionId: string): Promise<StoredInteraction | null> {
    return this.readInteraction("SELECT * FROM interactions WHERE submission_id = ?", submissionId);
  }

  private async writeInteraction(sql: string, ...params: SQLiteBindValue[]): Promise<void> {
    try {
      await this.run(sql, ...params);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: interactions.submission_id")) {
        throw new SubmissionConflictError();
      }
      throw error;
    }
  }

  private async readInteraction(query: string, ...params: string[]): Promise<StoredInteraction | null> {
    const row = await this.db.getFirstAsync<InteractionRow>(query, ...params);
    return row ? decodeInteraction(row) : null;
  }

  async insertInteraction(interaction: StoredInteraction): Promise<void> {
    await this.writeInteraction(`
      INSERT INTO interactions (
        interaction_id, path_id, session_id, turn_id, status, question, raw_answer, submission_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, interaction.interaction_id, interaction.path_id, interaction.session_id, interaction.turn_id,
    interaction.status, encodeInteraction(interaction), interaction.raw_answer,
    interaction.submission_id, interaction.updated_at);
  }

  async saveAnswer(id: string, submissionId: string, rawAnswer: string, now: number): Promise<void> {
    await this.writeInteraction(`
      UPDATE interactions SET raw_answer = ?, submission_id = ?, status = 'answered', updated_at = ?
      WHERE interaction_id = ? AND status != 'abandoned'
    `, rawAnswer, submissionId, now, id);
  }

  async markGraded(id: string, now: number): Promise<void> {
    await this.run(
      "UPDATE interactions SET status = 'graded', updated_at = ? WHERE interaction_id = ? AND status != 'abandoned'", now, id,
    );
  }

  async abandonInteraction(id: string, now: number): Promise<void> {
    await this.run(`UPDATE interactions SET status = 'abandoned', updated_at = ?
      WHERE interaction_id = ? AND status IN ('awaiting_input', 'answered')`, now, id);
  }

  async deleteInteractionsByPath(pathId: string): Promise<void> {
    await this.run("DELETE FROM interactions WHERE path_id = ?", pathId);
  }

  async listInteractionsBySession(sessionId: string): Promise<StoredInteraction[]> {
    const rows = await this.db.getAllAsync<InteractionRow>(
      "SELECT * FROM interactions WHERE session_id = ? ORDER BY updated_at, interaction_id", sessionId,
    );
    return rows.map(decodeInteraction);
  }

  async updateInteraction(interaction: StoredInteraction): Promise<void> {
    await this.writeInteraction(`UPDATE interactions SET status = ?, question = ?, raw_answer = ?, submission_id = ?, updated_at = ?
      WHERE interaction_id = ? AND path_id = ? AND session_id = ?`, interaction.status, encodeInteraction(interaction),
    interaction.raw_answer, interaction.submission_id, interaction.updated_at,
    interaction.interaction_id, interaction.path_id, interaction.session_id);
  }

  async readSetting(name: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE name = ?", name);
    return row?.value ?? null;
  }

  async writeSetting(name: string, value: string): Promise<void> {
    await this.run(`
      INSERT INTO settings (name, value) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value
    `, name, value);
  }

  async getSession(id: string): Promise<StoredSession | null> {
    return this.db.getFirstAsync<StoredSession>("SELECT * FROM sessions WHERE session_id = ?", id);
  }

  async saveSession(session: StoredSession): Promise<void> {
    await this.run(`
      INSERT INTO sessions (session_id, kind, path_id, mode, title, model_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET
        kind = excluded.kind, path_id = excluded.path_id, mode = excluded.mode, title = excluded.title,
        model_id = excluded.model_id, created_at = excluded.created_at, updated_at = excluded.updated_at
    `, session.session_id, session.kind, session.path_id, session.mode, session.title, session.model_id,
    session.created_at, session.updated_at);
  }

  async listSessions(): Promise<StoredSession[]> {
    return this.db.getAllAsync<StoredSession>("SELECT * FROM sessions ORDER BY updated_at DESC, session_id");
  }

  async listSessionsByPath(pathId: string): Promise<StoredSession[]> {
    return this.db.getAllAsync<StoredSession>(
      "SELECT * FROM sessions WHERE path_id = ? ORDER BY updated_at DESC, session_id", pathId,
    );
  }

  async updateSession(session: StoredSession): Promise<void> {
    await this.run(`UPDATE sessions SET kind = ?, path_id = ?, mode = ?, title = ?, model_id = ?,
      created_at = ?, updated_at = ? WHERE session_id = ?`, session.kind, session.path_id, session.mode, session.title,
    session.model_id, session.created_at, session.updated_at, session.session_id);
  }

  async deleteSessionsByPath(pathId: string, kind: string): Promise<void> {
    await this.write(async () => {
      await this.db.runAsync(`DELETE FROM messages WHERE session_id IN
        (SELECT session_id FROM sessions WHERE path_id = ? AND kind = ?)`, pathId, kind);
      await this.db.runAsync("DELETE FROM sessions WHERE path_id = ? AND kind = ?", pathId, kind);
    });
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    const row = await this.db.getFirstAsync<MessageRow>("SELECT * FROM messages WHERE message_id = ?", id);
    return row ? decodeMessage(row) : null;
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    await this.run(`
      INSERT INTO messages (message_id, session_id, role, content, status, turn_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (message_id) DO UPDATE SET
        session_id = excluded.session_id, role = excluded.role, content = excluded.content,
        status = excluded.status, turn_id = excluded.turn_id, metadata = excluded.metadata, created_at = excluded.created_at
    `, message.message_id, message.session_id, message.role, message.content, message.status,
    message.turn_id, message.metadata === null ? null : JSON.stringify(message.metadata), message.created_at);
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    const rows = await this.db.getAllAsync<MessageRow>(`
      SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, message_id
    `, sessionId);
    return rows.map(decodeMessage);
  }

  async deleteMessages(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    await this.run("DELETE FROM messages WHERE message_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  }

  async getThread(id: string): Promise<StoredThread | null> {
    return this.db.getFirstAsync<StoredThread>("SELECT * FROM session_threads WHERE thread_id = ?", id);
  }

  async saveThread(thread: StoredThread): Promise<void> {
    await this.run(`
      INSERT INTO session_threads (
        thread_id, parent_session_id, source_message_id, selected_text, title, created_at, updated_at,
        selection_start, selection_end, detached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET
        parent_session_id = excluded.parent_session_id, source_message_id = excluded.source_message_id,
        selected_text = excluded.selected_text, title = excluded.title, created_at = excluded.created_at,
        updated_at = excluded.updated_at, selection_start = excluded.selection_start,
        selection_end = excluded.selection_end, detached_at = excluded.detached_at
    `, thread.thread_id, thread.parent_session_id, thread.source_message_id, thread.selected_text, thread.title,
    thread.created_at, thread.updated_at, thread.selection_start, thread.selection_end, thread.detached_at);
  }

  async updateThread(thread: StoredThread): Promise<void> {
    await this.run(`
      UPDATE session_threads SET parent_session_id = ?, source_message_id = ?, selected_text = ?, title = ?,
        created_at = ?, updated_at = ?, selection_start = ?, selection_end = ?, detached_at = ?
      WHERE thread_id = ?
    `, thread.parent_session_id, thread.source_message_id, thread.selected_text, thread.title, thread.created_at,
    thread.updated_at, thread.selection_start, thread.selection_end, thread.detached_at, thread.thread_id);
  }

  async deleteThread(id: string): Promise<void> {
    await this.write(async () => {
      await this.db.runAsync(`
        DELETE FROM messages WHERE session_id = (SELECT thread_id FROM session_threads WHERE thread_id = ?)
      `, id);
      await this.db.runAsync(`
        DELETE FROM sessions WHERE session_id = (SELECT thread_id FROM session_threads WHERE thread_id = ?)
      `, id);
      await this.db.runAsync("DELETE FROM session_threads WHERE thread_id = ?", id);
    });
  }

  async listThreads(parentSessionId: string): Promise<StoredThread[]> {
    return this.db.getAllAsync<StoredThread>(`
      SELECT * FROM session_threads WHERE parent_session_id = ? ORDER BY created_at, thread_id
    `, parentSessionId);
  }

  async appendDomainEvent(event: StoredDomainEvent): Promise<void> {
    await this.run(`
      INSERT INTO domain_events (event_id, path_id, session_id, turn_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, event.event_id, event.path_id, event.session_id, event.turn_id, event.event_type, JSON.stringify(event.payload), event.created_at);
  }

  async listDomainEvents(pathId: string, limit = -1): Promise<StoredDomainEvent[]> {
    const rows = await this.db.getAllAsync<DomainEventRow>(`
      SELECT * FROM domain_events WHERE path_id = ? ORDER BY rowid DESC LIMIT ?
    `, pathId, limit);
    return rows.map(decodeDomainEvent);
  }

  async deleteDomainEventsByPath(pathId: string): Promise<void> {
    await this.run("DELETE FROM domain_events WHERE path_id = ?", pathId);
  }

  async inspect() {
    const mode = await this.db.getFirstAsync<{ journal_mode: string }>("PRAGMA journal_mode");
    const counts = await this.db.getFirstAsync<{ paths: number; questions: number; answers: number; graded: number }>(`
      SELECT (SELECT COUNT(*) FROM learning_progress) AS paths,
             COUNT(*) AS questions, COUNT(raw_answer) AS answers,
             COUNT(CASE WHEN status = 'graded' THEN 1 END) AS graded
      FROM interactions
    `);
    return { journalMode: mode?.journal_mode, ...counts };
  }
}
