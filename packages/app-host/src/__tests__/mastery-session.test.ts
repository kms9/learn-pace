import { createPendingQuestion, createQuizAttempt } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type StoredMessage } from "@learn-pace/infra";
import { afterEach, expect, it, vi } from "vitest";
import { completion, modelConfig, streamUntilAborted, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService } from "../index.js";

const outline = {
  mode: "replace",
  modules: [
    { name: "约分", objective: "求公因数", knowledge_points: [{ name: "约分步骤", type: "procedure" }] },
    { name: "比例", objective: "比较比例", knowledge_points: [{ name: "比例性质", type: "concept" }] },
  ],
};
const call = (name: string, args: Record<string, unknown>) => completion([toolCall(name, args)], "tool_calls");
const reply = () => completion([text("请告诉我你已经会什么。")]);
type Request = { messages: { role: string; content: string }[]; tools: { function: { name: string } }[]; reasoning_effort?: string };

function harness() {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  let id = 0;
  let now = 10;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => reply());
  const host = () => new AppBootstrapService(store, secrets, { makeId: () => "id-" + ++id, fetch });
  const app = host();
  const open = (value = app) => value.createMasterySessionService({ nowSeconds: () => now });
  const mastery = open();
  const request = (index: number): Request => JSON.parse(String(fetch.mock.calls[index]?.[1]?.body)) as Request;
  const configured = () => app.saveModelSettings(modelConfig);
  const respond = (...responses: Response[]) => responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  const draft = async () => mastery.createTopic({ goal: "学会比例化简" });
  const built = async () => {
    const topic = await draft();
    await topic.opening;
    await configured();
    respond(call("mastery_build", outline));
    await mastery.send(topic.pathId, topic.session.session_id, "建大纲");
    return topic;
  };
  return { store, app, mastery, host, open, configured, fetch, request, respond, draft, built,
    advance: (seconds: number) => { now += seconds; } };
}

afterEach(() => vi.unstubAllGlobals());

it("creates a draft with verified wizard materials and sends the opening only in the original session", async () => {
  const { app, mastery, configured, store, fetch, request } = harness();
  const chat = app.createLf01ChatService();
  const { session_id } = await chat.createSession();
  const message: StoredMessage = { message_id: "reference", role: "assistant", session_id, status: "committed",
    turn_id: "chat-turn", content: "可复制的引文和上下文", created_at: 1, metadata: null };
  await store.saveMessage(message);
  await configured();
  const { pathId, session, opening } = await mastery.createTopic({ goal: "  学会比例  ", emoji: "📐", materials: [
    { kind: "chat", sessionId: session_id, messageId: message.message_id, excerpt: "可复制的引文" },
    { kind: "text_note", label: "课前笔记", text: "要能独立解题" },
  ] });
  expect((await opening)?.status).toBe("committed");
  const opened = await mastery.openSession(pathId, session.session_id);
  expect(opened.messages[0]?.content).toBe("用我选的资料，和我一起制定这个精通目标的大纲。");
  expect(await store.get(pathId)).toMatchObject({ emoji: "📐", goal: "学会比例", topic_sources: [
    { kind: "goal" }, { kind: "chat", source_session_id: session_id, source_message_id: message.message_id, excerpt: "可复制的引文" },
    { kind: "text_note", label: "课前笔记" },
  ] });
  expect(request(0).tools.map(({ function: { name } }) => name)).toEqual(
    ["mastery_status", "mastery_profile", "mastery_mode", "read_source", "mastery_build", "mastery_revise", "mastery_quiz",
      "mastery_grade", "mastery_assess", "mastery_note_explained", "mastery_defer_objective", "mastery_skip_question", "mastery_repair_question"]);
  expect(request(0).messages[0]?.content).toContain('"mode":"outline"');
  expect(request(0).messages[0]?.content).toContain('"status":"empty"');
  await mastery.createSession(pathId, "outline");
  await mastery.switchMode(pathId, session.session_id, "review");
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(mastery.createTopic({ goal: "x", materials: [{ kind: "chat", sessionId: session_id,
    messageId: "reference", excerpt: "伪造的引文" }] })).rejects.toThrow("选文已找不到");
});

it("refuses empty study and reads live mode on each tool execution", async () => {
  const { mastery, store, draft, configured, respond, request } = harness();
  const { pathId, session, opening } = await draft();
  expect(await opening).toBeNull();
  await expect(mastery.switchMode(pathId, session.session_id, "study")).rejects.toThrow("先和导师定下大纲");
  await expect(mastery.createSession(pathId, "study")).rejects.toThrow("先和导师定下大纲");
  await configured();
  respond(call("mastery_mode", { mode: "study" }), call("mastery_build", outline),
    call("mastery_mode", { mode: "study" }), call("mastery_build", { ...outline, mode: "append" }),
    call("mastery_status", {}));
  const generated = await mastery.send(pathId, session.session_id, "试着跳过大纲，然后按规则操作");
  expect(generated.metadata?.runtime).toMatchObject({ tools: [
    { name: "mastery_mode", code: "rejected" },
    { name: "mastery_build", code: "ok" },
    { name: "mastery_mode", code: "ok" },
    { name: "mastery_build", code: "wrong_mode" },
    { name: "mastery_status", code: "ok" },
  ] });
  expect((await mastery.readTopic(pathId)).status).toBe("active");
  expect((await store.get(pathId))?.modules).toHaveLength(2);
  expect(await store.getSession(session.session_id)).toMatchObject({ mode: "study" });
  expect(request(5).messages.filter(({ role }) => role === "tool").at(-1)?.content).toContain('"mode":"study"');
  await mastery.send(pathId, session.session_id, "从直觉讲起");
  expect(request(6).messages[0]?.content).toMatch(/"mode":"study".*"path_revision":1/);
  expect(request(6).messages[0]?.content).toContain("这个模式是用来学的");
});

it("publishes tool activity for the current session and clears it on result or cancellation", async () => {
  const { mastery, draft, configured, respond } = harness();
  const { pathId, session, opening } = await draft();
  await opening;
  await configured();
  const listener = vi.fn<(tool: string | null) => void>();
  const other = vi.fn<(tool: string | null) => void>();
  const unsubscribe = mastery.observeActivity(session.session_id, listener);
  const unsubscribeOther = mastery.observeActivity("another-session", other);
  respond(call("mastery_status", {}), call("mastery_build", outline), reply());
  await mastery.send(pathId, session.session_id, "查看进度并制定大纲");
  expect(listener.mock.calls.flat()).toEqual([null, "mastery_status", null, "mastery_build", null]);
  expect(other.mock.calls.flat()).toEqual([null]);

  const stop = mastery.observeActivity(session.session_id, (tool) => {
    if (tool === "mastery_status") mastery.stop(pathId, session.session_id);
  });
  respond(call("mastery_status", {}));
  await expect(mastery.send(pathId, session.session_id, "查看进度")).resolves.toMatchObject({ status: "interrupted" });
  expect(listener.mock.calls.slice(-2).flat()).toEqual(["mastery_status", null]);
  stop();
  unsubscribe();
  unsubscribeOther();
  const reopened = vi.fn<(tool: string | null) => void>();
  mastery.observeActivity(session.session_id, reopened)();
  expect(reopened.mock.calls.flat()).toEqual([null]);
});

it("merges the profile, keeps unique objective IDs on replace and rejects cycles", async () => {
  const { built, store, mastery, respond } = harness();
  const { pathId, session } = await built();
  const first = (await store.get(pathId))!;
  const id = first.modules[0]!.knowledge_points[0]!.id;
  await store.save({ ...first, mastery_levels: { [id]: 0.5 },
    quiz_attempts: [createQuizAttempt({ question_id: "q", knowledge_point_id: id, is_correct: true })] });
  respond(call("mastery_profile", { prior_knowledge: "学过约分" }), call("mastery_profile", { target_level: "竞赛" }),
    call("mastery_build", outline));
  await mastery.send(pathId, session.session_id, "更新资料后替换大纲");
  const saved = (await store.get(pathId))!;
  expect(saved.learner_profile).toMatchObject({ prior_knowledge: "学过约分", target_level: "竞赛" });
  expect(saved.modules[0]?.knowledge_points[0]?.id).toBe(id);
  expect(saved.mastery_levels[id]).toBe(0.5);
  expect(saved.quiz_attempts[0]?.knowledge_point_id).toBe(id);

  respond(call("mastery_build", { ...outline, modules: [{
    name: "有环", objective: "边界检查", knowledge_points: [
      { name: "A", type: "concept", prerequisites: ["B"] }, { name: "B", type: "concept", prerequisites: ["A"] },
    ],
  }] }));
  const result = await mastery.send(pathId, session.session_id, "尝试环路");
  expect(result.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_build", code: "rejected" }] });
  expect(await store.get(pathId)).toEqual(saved);
});

it("commits a prepared rewrite and reorder; refuses a foreign, changed or expired preview", async () => {
  const { mastery, built, store, respond, fetch, request, advance } = harness();
  const { pathId, session } = await built();
  const other = await mastery.createSession(pathId, "outline");
  const before = (await store.get(pathId))!;
  const [a, b] = before.modules;
  const preview = async () => {
    const index = fetch.mock.calls.length;
    respond(call("mastery_revise", { action: "preview", expected_revision: (await store.get(pathId))!.version,
      module_id: a!.id, add: [{ name: "比值辨析", type: "concept" }], module_order: [b!.id, a!.id] }));
    await mastery.send(pathId, session.session_id, "先预览");
    const output = request(index + 1).messages.filter(({ role }) => role === "tool").at(-1)?.content;
    return JSON.parse(output!).preview_id as string;
  };
  const commit = async (id: string, to = session.session_id) => {
    respond(call("mastery_revise", { action: "commit", preview_id: id }));
    return mastery.send(pathId, to, "确认提交");
  };
  const fresh = await preview();
  expect(await store.get(pathId)).toEqual(before);
  expect((await commit(fresh, other.session_id)).metadata?.runtime).toMatchObject({ tools: [{ code: "rejected" }] });
  const beforeCommit = fetch.mock.calls.length;
  expect((await commit(fresh)).metadata?.runtime).toMatchObject({ tools: [{ action: "commit", code: "ok" }] });
  expect(request(beforeCommit).messages[0]?.content).toContain('"outline_preview":{"preview_id":"' + fresh + '"');
  const saved = (await store.get(pathId))!;
  expect(saved.version).toBe(before.version + 1);
  expect(saved.modules.map(({ id }) => id)).toEqual([b!.id, a!.id]);
  expect(saved.modules[1]?.knowledge_points[0]?.id).toBe(a!.knowledge_points[0]!.id);
  const changed = await preview();
  await mastery.renameTopic(pathId, "新标题");
  expect((await commit(changed)).metadata?.runtime).toMatchObject({ tools: [{ code: "rejected" }] });
  const expired = await preview();
  advance(3600);
  expect((await commit(expired)).metadata?.runtime).toMatchObject({ tools: [{ code: "rejected" }] });
});

it("coordinates path locks across sessions and restores interrupted turns across Hosts", async () => {
  const { mastery, built, store, fetch, host, open } = harness();
  const { pathId, session } = await built();
  const other = await mastery.createSession(pathId, "study");
  fetch.mockImplementationOnce(streamUntilAborted(() => {}));
  const sending = mastery.send(pathId, session.session_id, "生成");
  expect(mastery.runningSession(pathId)).toBe(session.session_id);
  await expect(mastery.send(pathId, other.session_id, "不能同时发")).rejects.toThrow("另一会话正在进行");
  await expect(mastery.switchMode(pathId, session.session_id, "study")).rejects.toThrow("正在进行");
  await vi.waitFor(async () => expect((await store.listMessages(session.session_id)).at(-1)?.content).toBe("first"));
  mastery.stop(pathId, session.session_id);
  const partial = await sending;
  await store.saveMessage({ ...partial, status: "generating" });
  const reopened = open(host());
  const previous = fetch.mock.calls.length;
  await reopened.recoverInterruptedTurns();
  expect((await reopened.openSession(pathId, session.session_id)).messages.at(-1))
    .toMatchObject({ content: "first", status: "interrupted" });
  expect(fetch).toHaveBeenCalledTimes(previous);
  expect(await reopened.retry(pathId, session.session_id, partial.message_id)).toMatchObject({ status: "committed" });
});

it("resets evidence and abandons all open cards, then deletes only the target topic", async () => {
  const { app, built, draft, mastery, store } = harness();
  const { pathId, session } = await built();
  const other = await draft();
  await other.opening;
  const chat = await app.createLf01ChatService().createSession();
  const path = (await store.get(pathId))!;
  const id = path.modules[0]!.knowledge_points[0]!.id;
  await store.save({ ...path, mastery_levels: { [id]: 1 }, learner_profile: {
    prior_knowledge: "基础", target_level: "熟练", time_budget: "", preferences: "", teaching_strategy: "teach_first", notes: "", updated_at: 1,
  } });
  for (const [interaction_id, status] of [["waiting", "awaiting_input"], ["received", "answered"]] as const) {
    await store.insertInteraction({ interaction_id, status, path_id: pathId, session_id: session.session_id, turn_id: "t",
      question: createPendingQuestion({ question_id: interaction_id, knowledge_point_id: id }),
      raw_answer: null, submission_id: null, updated_at: 1 });
  }
  await mastery.resetTopic(pathId);
  expect(await store.get(pathId)).toMatchObject({ modules: path.modules, topic_sources: path.topic_sources,
    mastery_levels: {}, learner_profile: { target_level: "熟练" } });
  expect(await store.getOpenInteraction(pathId)).toBeNull();
  expect(await store.getInteraction("received")).toMatchObject({ status: "abandoned" });
  expect(await store.getInteraction("waiting")).toMatchObject({ status: "abandoned" });
  expect(await store.getSession(session.session_id)).not.toBeNull();
  await mastery.deleteTopic(pathId);
  expect(await store.get(pathId)).toBeNull();
  expect(await store.listMessages(session.session_id)).toEqual([]);
  expect(await store.getSession(session.session_id)).toBeNull();
  expect(await store.getInteraction("received")).toBeNull();
  expect(await store.get(other.pathId)).not.toBeNull();
  expect(await store.getSession(chat.session_id)).not.toBeNull();
});
