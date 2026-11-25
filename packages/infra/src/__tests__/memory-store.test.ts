import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { expect, it } from "vitest";
import {
  MemoryAppStore, MemorySecretStore, type StoredMessage, type StoredSession,
} from "../index.js";

const session: StoredSession = {
  session_id: "parent", kind: "chat", path_id: null, mode: null, title: "Ratios",
  model_id: null, created_at: 1, updated_at: 1,
};
const message: StoredMessage = {
  message_id: "a", session_id: "parent", role: "user", content: "Explain ratios",
  status: "completed", turn_id: "turn", metadata: { parts: ["text"] }, created_at: 2,
};

it("keeps settings, credentials and path summaries separate", async () => {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  await secrets.setItem("key", "fixture");
  await store.writeSetting("scene", "free");
  await store.save(createLearningProgress({ book_id: "older", name: "A", updated_at: 2 }));
  const recent = createLearningProgress({ book_id: "recent", name: "B", updated_at: 3 });
  await store.save(recent, "draft");
  await store.save({ ...recent, name: "Updated" });
  recent.name = "Mutation outside the store";

  expect(await store.readSetting("scene")).toBe("free");
  expect(await store.readSetting("key")).toBeNull();
  expect(await secrets.getItem("key")).toBe("fixture");
  await secrets.deleteItem("key");
  expect(await secrets.getItem("key")).toBeNull();
  expect(await store.listPathSummaries()).toEqual([
    { path_id: "recent", name: "Updated", updated_at: 3, status: "draft" },
    { path_id: "older", name: "A", updated_at: 2, status: "active" },
  ]);
});

it("reads back the latest open interaction and its saved answer", async () => {
  const store = new MemoryAppStore();
  const question = createPendingQuestion({ question_id: "q", knowledge_point_id: "kp" });
  await store.insertInteraction({
    interaction_id: "i", path_id: "p", session_id: "s", turn_id: "t", status: "awaiting_input",
    question, raw_answer: null, submission_id: null, updated_at: 1,
  });
  await store.saveAnswer("i", "submission", "A", 3);
  expect(await store.getLatestOpenInteraction()).toMatchObject({
    status: "answered", raw_answer: "A", submission_id: "submission",
  });
  expect(await store.getOpenInteraction("other")).toBeNull();
  await store.markGraded("i", 4);
  expect(await store.getOpenInteraction("p")).toBeNull();
  expect(await store.getInteraction("i")).toMatchObject({ status: "graded", raw_answer: "A" });
});

it("orders messages and preserves the parent message anchor for child sessions", async () => {
  const store = new MemoryAppStore();
  await store.saveSession(session);
  await store.saveSession({ ...session, session_id: "child", kind: "thread", updated_at: 4 });
  await store.saveMessage({ ...message, message_id: "b" });
  await store.saveMessage(message);
  await store.saveMessage({ ...message, message_id: "c", session_id: "child" });
  const thread = {
    thread_id: "child", parent_session_id: "parent", source_message_id: "a",
    selected_text: "ratios", title: "Little Tutor", created_at: 4, updated_at: 4,
    selection_start: 8, selection_end: 14, detached_at: null,
  };
  await store.saveThread(thread);

  expect((await store.listSessions()).map((item) => item.session_id)).toEqual(["child", "parent"]);
  expect((await store.listMessages("parent")).map((item) => item.message_id)).toEqual(["a", "b"]);
  expect(await store.getMessage("a")).toEqual(message);
  expect(await store.listThreads("parent")).toEqual([thread]);
  expect(await store.getSession("child")).toMatchObject({ kind: "thread" });
  const detached = { ...thread, detached_at: 5, updated_at: 5 };
  await store.updateThread(detached);
  await store.deleteMessages(["a", "missing"]);
  expect(await store.getThread("child")).toEqual(detached);
  expect((await store.listMessages("parent")).map((item) => item.message_id)).toEqual(["b"]);
  await store.deleteThread("child");
  await store.updateThread(detached);
  expect(await store.listThreads("parent")).toEqual([]);
  expect(await store.getSession("child")).toBeNull();
  expect(await store.listMessages("child")).toEqual([]);
  expect(await store.getSession("parent")).toEqual(session);
});

it("abandons open cards and deletes only sessions and messages with the specified path and kind", async () => {
  const store = new MemoryAppStore();
  const question = createPendingQuestion({ question_id: "q", knowledge_point_id: "kp" });
  await store.insertInteraction({ interaction_id: "i", path_id: "p", session_id: "s", turn_id: "t",
    status: "answered", question, raw_answer: "raw", submission_id: "sub", updated_at: 1 });
  await store.abandonInteraction("i", 2);
  expect(await store.getOpenInteraction("p")).toBeNull();
  expect(await store.getInteraction("i")).toMatchObject({ status: "abandoned", raw_answer: "raw" });
  await store.deleteInteractionsByPath("p");
  expect(await store.getInteraction("i")).toBeNull();
  const session = { session_id: "s", kind: "mastery", path_id: "p", mode: "outline" as const, title: "t",
    model_id: null, created_at: 1, updated_at: 1 };
  await store.saveSession(session);
  await store.saveSession({ ...session, session_id: "lf01", kind: "lf01" });
  await store.updateSession({ ...session, mode: "study" });
  expect(await store.getSession("s")).toMatchObject({ mode: "study" });
  await store.saveMessage({ message_id: "m", session_id: "s", role: "user", content: "data", status: "committed",
    turn_id: "turn", metadata: null, created_at: 1 });
  await store.deleteSessionsByPath("p", "mastery");
  expect((await store.listSessionsByPath("p")).map(({ session_id }) => session_id)).toEqual(["lf01"]);
  expect(await store.listMessages("s")).toEqual([]);
});
