import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { LearningProgress, PathStatus, PendingQuestion } from "@learn-pace/domain";
import type {
  AppStore, PathSummaryRecord, SecretStore, StoredInteraction, StoredMessage, StoredSession, StoredThread,
} from "./index.js";
import { migrateLearningDatabase } from "./migrations.js";

export const expoSecretStore: SecretStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

type InteractionRow = Omit<StoredInteraction, "question"> & { question: string };

type MessageRow = Omit<StoredMessage, "metadata"> & { metadata: string | null };

function decodeMessage(row: MessageRow): StoredMessage {
  return { ...row, metadata: row.metadata === null ? null : JSON.parse(row.metadata) as StoredMessage["metadata"] };
}

export class ExpoLearningStore implements AppStore {
  private constructor(private readonly db: SQLiteDatabase) {}

  static async open(): Promise<ExpoLearningStore> {
    const db = await openDatabaseAsync("learn-pace.db");
    try {
      await migrateLearningDatabase(db);
    } catch (error) {
      await db.closeAsync().catch(() => {});
      throw error;
    }
    return new ExpoLearningStore(db);
  }

  async get(pathId: string): Promise<LearningProgress | null> {
    const row = await this.db.getFirstAsync<{ progress: string }>(
      "SELECT progress FROM learning_progress WHERE path_id = ?", pathId,
    );
    return row ? JSON.parse(row.progress) as LearningProgress : null;
  }

  async save(progress: LearningProgress, status?: PathStatus): Promise<void> {
    await this.db.runAsync(`
      INSERT INTO learning_progress (path_id, progress, name, updated_at, status)
      VALUES (?, ?, ?, ?, COALESCE(?, 'active'))
      ON CONFLICT (path_id) DO UPDATE SET
        progress = excluded.progress, name = excluded.name, updated_at = excluded.updated_at,
        status = COALESCE(?, learning_progress.status)
    `, progress.book_id, JSON.stringify(progress), progress.name, progress.updated_at, status ?? null, status ?? null);
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

  async getInteraction(id: string): Promise<StoredInteraction | null> {
    return this.readInteraction("SELECT * FROM interactions WHERE interaction_id = ?", id);
  }

  private async readInteraction(query: string, ...params: string[]): Promise<StoredInteraction | null> {
    const row = await this.db.getFirstAsync<InteractionRow>(query, ...params);
    return row ? { ...row, question: JSON.parse(row.question) as PendingQuestion } : null;
  }

  async insertInteraction(interaction: StoredInteraction): Promise<void> {
    await this.db.runAsync(`
      INSERT INTO interactions (
        interaction_id, path_id, session_id, turn_id, status, question, raw_answer, submission_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, interaction.interaction_id, interaction.path_id, interaction.session_id, interaction.turn_id,
    interaction.status, JSON.stringify(interaction.question), interaction.raw_answer,
    interaction.submission_id, interaction.updated_at);
  }

  async saveAnswer(id: string, submissionId: string, rawAnswer: string, now: number): Promise<void> {
    await this.db.runAsync(`
      UPDATE interactions SET raw_answer = ?, submission_id = ?, status = 'answered', updated_at = ?
      WHERE interaction_id = ?
    `, rawAnswer, submissionId, now, id);
  }

  async markGraded(id: string, now: number): Promise<void> {
    await this.db.runAsync(
      "UPDATE interactions SET status = 'graded', updated_at = ? WHERE interaction_id = ?", now, id,
    );
  }

  async readSetting(name: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE name = ?", name);
    return row?.value ?? null;
  }

  async writeSetting(name: string, value: string): Promise<void> {
    await this.db.runAsync(`
      INSERT INTO settings (name, value) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value
    `, name, value);
  }

  async getSession(id: string): Promise<StoredSession | null> {
    return this.db.getFirstAsync<StoredSession>("SELECT * FROM sessions WHERE session_id = ?", id);
  }

  async saveSession(session: StoredSession): Promise<void> {
    await this.db.runAsync(`
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

  async getMessage(id: string): Promise<StoredMessage | null> {
    const row = await this.db.getFirstAsync<MessageRow>("SELECT * FROM messages WHERE message_id = ?", id);
    return row ? decodeMessage(row) : null;
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    await this.db.runAsync(`
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

  async getThread(id: string): Promise<StoredThread | null> {
    return this.db.getFirstAsync<StoredThread>("SELECT * FROM session_threads WHERE thread_id = ?", id);
  }

  async saveThread(thread: StoredThread): Promise<void> {
    await this.db.runAsync(`
      INSERT INTO session_threads (thread_id, parent_session_id, source_message_id, selected_text, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET
        parent_session_id = excluded.parent_session_id, source_message_id = excluded.source_message_id,
        selected_text = excluded.selected_text, title = excluded.title, created_at = excluded.created_at, updated_at = excluded.updated_at
    `, thread.thread_id, thread.parent_session_id, thread.source_message_id, thread.selected_text, thread.title,
    thread.created_at, thread.updated_at);
  }

  async listThreads(parentSessionId: string): Promise<StoredThread[]> {
    return this.db.getAllAsync<StoredThread>(`
      SELECT * FROM session_threads WHERE parent_session_id = ? ORDER BY created_at, thread_id
    `, parentSessionId);
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
