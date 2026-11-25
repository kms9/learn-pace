import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { LearningProgress, PendingQuestion } from "@learn-pace/domain";
import type { InteractionStore, LearningProgressStore, SecretStore, StoredInteraction } from "./index.js";

export const expoSecretStore: SecretStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

type InteractionRow = Omit<StoredInteraction, "question"> & { question: string };

export class ExpoLearningStore implements LearningProgressStore, InteractionStore {
  private constructor(private readonly db: SQLiteDatabase) {}

  static async open(): Promise<ExpoLearningStore> {
    const db = await openDatabaseAsync("learn-pace.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS learning_progress (
        path_id TEXT PRIMARY KEY NOT NULL,
        progress TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interactions (
        interaction_id TEXT PRIMARY KEY NOT NULL,
        path_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('awaiting_input', 'answered', 'graded')),
        question TEXT NOT NULL,
        raw_answer TEXT,
        submission_id TEXT,
        updated_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS interactions_by_path ON interactions (path_id, updated_at);
      CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
    return new ExpoLearningStore(db);
  }

  async get(pathId: string): Promise<LearningProgress | null> {
    const row = await this.db.getFirstAsync<{ progress: string }>(
      "SELECT progress FROM learning_progress WHERE path_id = ?", pathId,
    );
    return row ? JSON.parse(row.progress) as LearningProgress : null;
  }

  async save(progress: LearningProgress): Promise<void> {
    await this.db.runAsync(`
      INSERT INTO learning_progress (path_id, progress) VALUES (?, ?)
      ON CONFLICT (path_id) DO UPDATE SET progress = excluded.progress
    `, progress.book_id, JSON.stringify(progress));
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
      ORDER BY updated_at DESC LIMIT 1
    `, pathId);
  }

  async getInteraction(id: string): Promise<StoredInteraction | null> {
    return this.readInteraction("SELECT * FROM interactions WHERE interaction_id = ?", id);
  }

  private async readInteraction(query: string, value: string): Promise<StoredInteraction | null> {
    const row = await this.db.getFirstAsync<InteractionRow>(query, value);
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
