import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryAppStore } from "../index.js";
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

it("opens a new WAL database and round-trips the v4 repositories", async () => {
  const store = await ExpoLearningStore.open();
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 4 });
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
  await store.saveMessage({ ...message, message_id: "child-message", session_id: "child" });
  const thread = {
    thread_id: "child", parent_session_id: "s", source_message_id: "message", selected_text: "Ratios",
    title: "Follow-up", created_at: 3, updated_at: 3,
    selection_start: 0, selection_end: 6, detached_at: null,
  };
  await store.saveThread(thread);

  const reopened = await ExpoLearningStore.open();
  expect(await reopened.getSession("s")).toEqual(session);
  expect((await reopened.listSessions()).map((item) => item.session_id)).toEqual(["child", "s"]);
  expect(await reopened.getMessage("message")).toEqual(message);
  expect(await reopened.listMessages("s")).toEqual([message, { ...message, message_id: "z", metadata: null }]);
  expect(await reopened.getThread("child")).toEqual(thread);
  expect(await reopened.listThreads("s")).toEqual([thread]);
  const detached = { ...thread, detached_at: 4, updated_at: 4 };
  await reopened.updateThread(detached);
  await reopened.deleteMessages(["message", "missing"]);
  expect(await reopened.getThread("child")).toEqual(detached);
  expect(await reopened.listMessages("s")).toHaveLength(1);
  await reopened.deleteThread("child");
  await reopened.updateThread(detached);
  expect(await reopened.listThreads("s")).toEqual([]);
  expect(await reopened.listMessages("child")).toEqual([]);
  expect(await reopened.getSession("child")).toBeNull();
  expect(await reopened.getSession("s")).toEqual(session);
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
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 4 });
});

it.each([false, true])("preserves v2 threads during v4 upgrade (partial=%s)", async (partial) => {
  db.exec(`
    PRAGMA user_version = 2;
    CREATE TABLE session_threads (
      thread_id TEXT PRIMARY KEY NOT NULL, parent_session_id TEXT NOT NULL, source_message_id TEXT NOT NULL,
      selected_text TEXT NOT NULL, title TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
    );
    INSERT INTO session_threads VALUES ('child', 'parent', 'message', 'old selection', 'Follow-up', 1, 2);
  `);
  if (partial) db.exec(`
    ALTER TABLE session_threads ADD COLUMN selection_start INTEGER;
    UPDATE session_threads SET selection_start = 3;
  `);
  const store = await ExpoLearningStore.open();
  expect(await store.getThread("child")).toEqual({
    thread_id: "child", parent_session_id: "parent", source_message_id: "message",
    selected_text: "old selection", title: "Follow-up", created_at: 1, updated_at: 2,
    selection_start: partial ? 3 : null, selection_end: null, detached_at: null,
  });
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 4 });
});

it("migrates a populated v3 interaction table to v4", async () => {
  db.exec(`
    PRAGMA user_version = 3;
    CREATE TABLE interactions (interaction_id TEXT PRIMARY KEY NOT NULL, path_id TEXT NOT NULL,
      session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('awaiting_input', 'answered', 'graded')), question TEXT NOT NULL,
      raw_answer TEXT, submission_id TEXT, updated_at REAL NOT NULL);
    CREATE INDEX interactions_by_path ON interactions(path_id, updated_at);
  `);
  const question = createPendingQuestion({ question_id: "q", knowledge_point_id: "kp" });
  for (const status of ["awaiting_input", "answered", "graded"]) {
    db.prepare("INSERT INTO interactions VALUES (?, 'p', 's', 't', ?, ?, 'raw', 'sub', 12)")
      .run(status, status, JSON.stringify(question));
  }
  const store = await ExpoLearningStore.open();
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 4 });
  for (const status of ["awaiting_input", "answered", "graded"]) {
    expect(await store.getInteraction(status)).toMatchObject({ status, question, raw_answer: "raw", submission_id: "sub" });
    await store.abandonInteraction(status, 13);
  }
  expect(await store.getOpenInteraction("p")).toBeNull();
  expect(await store.getInteraction("answered")).toMatchObject({ status: "abandoned", raw_answer: "raw" });
  expect(await store.getInteraction("graded")).toMatchObject({ status: "graded" });
  await store.deleteInteractionsByPath("p");
  expect(await store.getInteraction("graded")).toBeNull();
});

it.each(["expo", "memory"])("round-trips staged group answers and grades with %s storage", async (backend) => {
  const store = backend === "expo" ? await ExpoLearningStore.open() : new MemoryAppStore();
  const question = createPendingQuestion({ question_id: "group", knowledge_point_id: "point", question_type: "group",
    questions: [createPendingQuestion({ question_id: "leaf", knowledge_point_id: "point", expected_answer: "secret" })] });
  const first = { path_id: "path", interaction_id: "i", session_id: "session", turn_id: "turn",
    status: "answered" as const, raw_answer: JSON.stringify({ leaf: "原答案" }), submission_id: "submission", updated_at: 2, question };
  await store.insertInteraction(first);
  await store.insertInteraction({ ...first, interaction_id: "another", session_id: "foreign" });
  const reopened = backend === "expo" ? await ExpoLearningStore.open() : store;
  expect(await reopened.listInteractionsBySession("session")).toEqual([first]);

  const next = { ...first, updated_at: 3, status: "awaiting_input" as const, grade: { questions: {
    leaf: { final: false, result: "ungraded" as const, feedback: "请补充", confidence: 0.6 },
  } } };
  await reopened.updateInteraction(next);
  expect(await reopened.getOpenInteraction("path")).toEqual(next);
  expect((await reopened.getInteraction("i"))?.question).not.toHaveProperty("_grade");
  await reopened.updateInteraction({ ...next, status: "graded", question: { ...question, questions: [
    { ...question.questions[0]!, expected_answer: "新答案" },
  ] } });
  expect((await reopened.listInteractionsBySession("session"))[0]).toMatchObject({
    status: "graded", question: { questions: [{ expected_answer: "新答案" }] }, raw_answer: first.raw_answer, grade: next.grade,
  });
});
