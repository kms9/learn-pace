import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExpoLearningStore } from "../expo.js";

let db: DatabaseSync;
let dir: string;

vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    execAsync: async (sql: string) => db.exec(sql),
    getFirstAsync: async (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params),
    runAsync: async (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params),
    closeAsync: async () => {},
  }),
}));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "learn-pace-migration-"));
  db = new DatabaseSync(join(dir, "learn-pace.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

it("opens a new WAL database and round-trips the v2 repositories", async () => {
  const store = await ExpoLearningStore.open();
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
  expect(await store.inspect()).toMatchObject({ journalMode: "wal", paths: 0 });
  const session = {
    session_id: "s", kind: "chat", path_id: null, mode: null, title: "Ratios",
    model_id: null, created_at: 1, updated_at: 1,
  };
  await store.saveSession(session);
  await store.saveSession({ ...session, session_id: "child", kind: "thread", updated_at: 3 });
  const message = {
    message_id: "message", session_id: "s", role: "user", content: "Ratios", status: "completed",
    metadata: { quote: null }, turn_id: null, created_at: 2,
  };
  await store.saveMessage({ ...message, message_id: "z", metadata: null });
  await store.saveMessage(message);
  const thread = {
    thread_id: "child", parent_session_id: "s", source_message_id: "message", selected_text: "Ratios",
    title: "Follow-up", created_at: 3, updated_at: 3,
  };
  await store.saveThread(thread);

  const reopened = await ExpoLearningStore.open();
  expect(await reopened.getSession("s")).toEqual(session);
  expect((await reopened.listSessions()).map((item) => item.session_id)).toEqual(["child", "s"]);
  expect(await reopened.getMessage("message")).toEqual(message);
  expect(await reopened.listMessages("s")).toEqual([message, { ...message, message_id: "z", metadata: null }]);
  expect(await reopened.getThread("child")).toEqual(thread);
  expect(await reopened.listThreads("s")).toEqual([thread]);
});

it.each([0, 1])("migrates populated v%s data and resumes a partial migration", async (version) => {
  db.exec(`
    PRAGMA user_version = ${version};
    CREATE TABLE learning_progress (path_id TEXT PRIMARY KEY NOT NULL, progress TEXT NOT NULL);
    CREATE TABLE interactions (interaction_id TEXT PRIMARY KEY NOT NULL, path_id TEXT NOT NULL,
      session_id TEXT NOT NULL, turn_id TEXT NOT NULL, status TEXT NOT NULL, question TEXT NOT NULL,
      raw_answer TEXT, submission_id TEXT, updated_at REAL NOT NULL);
    CREATE TABLE settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('legacy', 'setting');
  `);
  if (version === 1) db.exec("ALTER TABLE learning_progress ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  const progress = createLearningProgress({ book_id: "old", name: "Saved ratio", updated_at: 123.5 });
  db.prepare("INSERT INTO learning_progress (path_id, progress) VALUES (?, ?)").run("old", JSON.stringify(progress));
  const question = createPendingQuestion({ question_id: "q", knowledge_point_id: "kp", expected_answer: "A" });
  db.prepare("INSERT INTO interactions VALUES ('i', 'old', 's', 't', 'answered', ?, 'B', 'original', 124)")
    .run(JSON.stringify(question));

  const store = await ExpoLearningStore.open();
  expect(await store.get("old")).toEqual(progress);
  expect(await store.readSetting("legacy")).toBe("setting");
  expect(await store.getLatestOpenInteraction()).toMatchObject({
    status: "answered", raw_answer: "B", submission_id: "original", question,
  });
  expect(await store.listPathSummaries()).toEqual([
    { path_id: "old", name: "Saved ratio", status: "active", updated_at: 123.5 },
  ]);
  await store.save(progress, "draft");
  await store.save({ ...progress, name: "Renamed", updated_at: 200 });
  const reopened = await ExpoLearningStore.open();
  expect(await reopened.listPathSummaries()).toEqual([
    { path_id: "old", name: "Renamed", status: "draft", updated_at: 200 },
  ]);
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
});
