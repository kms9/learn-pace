import { createKnowledgePoint, createLearningModule, createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type StoredMessage } from "@learn-pace/infra";
import { afterEach, expect, it, vi } from "vitest";
import { completion, modelConfig, streamUntilAborted, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, messageHandoffs, messageQuotes, type MasteryHandoff } from "../index.js";

afterEach(() => vi.unstubAllGlobals());

function harness(...responses: Response[]) {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  let id = 0;
  let now = 10;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift() ?? completion([text("回复")]));
  const host = new AppBootstrapService(store, secrets, { makeId: () => String(++id), fetch });
  const open = () => host.createLf01ChatService({ nowSeconds: () => now });
  const configure = (model = modelConfig.model) => host.saveModelSettings({ ...modelConfig, model });
  const request = (index: number) => JSON.parse(String(fetch.mock.calls[index]?.[1]?.body));
  return { store, host, chat: open(), open, configure, fetch, request, advance: () => { now++; } };
}

it("loads local sessions offline, filters other kinds and resolves the configured model for every turn", async () => {
  const { chat, configure, store, fetch, open, request, advance } = harness(
    completion([text("一"), text("二")]), completion([text("三")]),
  );
  const first = await chat.createSession();
  await store.saveSession({ ...first, session_id: "study", kind: "mastery" });
  await store.saveSession({ ...first, session_id: "child", kind: "little_tutor" });
  await expect(chat.send(first.session_id, "未配置")).rejects.toThrow("配置 DeepSeek Flash");
  expect(fetch).not.toHaveBeenCalled();

  await configure();
  const reply = await chat.send(first.session_id, "第一个问题");
  const later = await chat.createSession();
  advance();
  await configure("openai/another-model");
  await chat.send(first.session_id, "第二个问题");
  const reopened = open();
  expect((await reopened.listSessions()).map(({ session_id }) => session_id)).toEqual([first.session_id, later.session_id]);
  const { session, messages } = await reopened.readConversation(first.session_id);
  expect(session).toMatchObject({ title: "第一个问题", model_id: "another-model" });
  expect(messages.map(({ role, content }) => [role, content])).toEqual([
    ["user", "第一个问题"], ["assistant", "一二"], ["user", "第二个问题"], ["assistant", "三"],
  ]);
  expect(reply.metadata?.model_id).toBe("deepseek-v4.1-flash");
  expect(messages[3]?.metadata?.model_id).toBe("another-model");
  expect(request(1).model).toBe("another-model");
  expect(request(1).messages.filter(({ role }: { role: string }) => role !== "system").map(
    ({ content }: { content: string }) => content,
  )).toEqual(["第一个问题", "一二", "第二个问题"]);
  expect(request(1).tools.map(({ function: tool }: { function: { name: string } }) => tool.name)).toEqual([
    "mastery_topics", "mastery_sessions", "mastery_open_session", "mastery_new_session",
  ]);
  expect(await store.listIds()).toEqual([]);
});

it("persists validated handoffs on the assistant reply without changing the learning path or session", async () => {
  const opening = { path_id: "fractions", opening_message: "我们从比例的化简开始", reason: "继续练习化简" };
  const tool = (name: string, args: Record<string, unknown>) => completion([toolCall(name, args)], "tool_calls");
  const { chat, store, configure, open, request } = harness(tool("mastery_topics", {}),
    tool("mastery_sessions", { path_id: "fractions" }),
    tool("mastery_open_session", { ...opening, session_id: "elsewhere" }),
    tool("mastery_open_session", { ...opening, session_id: "study" }),
    tool("mastery_new_session", { ...opening, module_id: "mod" }), completion([text("这两次学习都能接着练化简。")]),
    completion([text("小老师回复")]));
  await configure();
  const path = createLearningProgress({ book_id: "fractions", name: "比例", emoji: "📏", modules: [
    createLearningModule({ id: "mod", name: "化简", order: 0, knowledge_points: [
      createKnowledgePoint({ id: "reduce", name: "比例化简", module_id: "mod", type: "procedure" }),
    ] }),
  ] });
  await store.save(path);
  await store.saveSession({ session_id: "study", path_id: path.book_id, kind: "mastery", title: "练习比例", mode: "study",
    model_id: null, created_at: 1, updated_at: 2 });
  await store.insertInteraction({ interaction_id: "question", path_id: path.book_id, session_id: "study", turn_id: "t",
    status: "awaiting_input", question: createPendingQuestion({ question_id: "q", prompt: "怎样化简？", knowledge_point_id: "reduce" }),
    raw_answer: null, submission_id: null, updated_at: 2 });
  const previousSession = await store.getSession("study");
  const previousCard = await store.getInteraction("question");
  const { session_id } = await chat.createSession();
  const reply = await chat.send(session_id, "带我回到之前的比例学习，也给我另开一次的选项");
  expect(reply.status).toBe("committed");
  expect(messageHandoffs(reply)).toMatchObject([
    { ...opening, kind: "open", path_name: "比例", emoji: "📏", total: 1, session_title: "练习比例", session_awaiting: true },
    { ...opening, kind: "new", module_id: "mod", module_name: "化简", percentage: 0, due_count: 0 },
  ]);
  expect(request(1).messages.at(-1).content).toContain('"path_id":"fractions"');
  expect(request(2).messages.at(-1).content).toContain('"has_pending_question":true');
  expect(request(3).messages.at(-1).content).toContain("该路径没有这次会话");
  expect(await store.get(path.book_id)).toEqual(path);
  expect(await store.listSessionsByPath(path.book_id)).toEqual([previousSession]);
  expect(await store.getInteraction("question")).toEqual(previousCard);
  expect(await store.listMessages("study")).toEqual([]);
  const { messages } = await open().readConversation(session_id);
  expect(messageHandoffs(messages.at(-1)!)).toEqual(messageHandoffs(reply));

  const thread = await chat.createThread(session_id, reply.message_id, { text: reply.content, start: 0, end: reply.content.length });
  const side = await chat.send(thread.thread_id, "能解释一下吗？");
  expect(request(6).tools ?? []).toEqual([]);
  expect(messageHandoffs(side)).toEqual([]);
});

it("starts a study session only on acceptance, saves the edited learner message, and validates stale cards", async () => {
  const { host, store, configure } = harness(completion([text("从约分开始。")]), completion([text("继续约分。") ]));
  await configure();
  const mastery = host.createMasterySessionService({ nowSeconds: () => 10 });
  const card = { kind: "new", path_id: "fractions", path_name: "比例", emoji: "📏", mastered: 0, total: 1, percentage: 0,
    due_count: 0, module_id: "mod", module_name: "约分", opening_message: "请开始", reason: "开始学习" } satisfies MasteryHandoff;
  await expect(mastery.followHandoff(card, "请开始")).rejects.toThrow("该精通之路不存在");
  await store.save(createLearningProgress({ book_id: card.path_id, name: card.path_name, modules: [
    createLearningModule({ id: "mod", name: "约分", order: 0, knowledge_points: [
      createKnowledgePoint({ id: "reduce", name: "比例化简", module_id: "mod", type: "procedure" }),
    ] }),
  ] }));
  await expect(mastery.followHandoff({ ...card, module_id: "deleted" }, "请开始")).rejects.toThrow("该模块不存在");
  expect(await store.listSessionsByPath(card.path_id)).toEqual([]);

  function settled() {
    return new Promise<void>((resolve) => {
      const unsubscribe = mastery.observeChanges(() => { unsubscribe(); resolve(); });
    });
  }
  const firstTurn = settled();
  const session = await mastery.followHandoff(card, "我们从比例的化简开始");
  expect(session.mode).toBe("study");
  expect((await store.listMessages(session.session_id))[0]).toMatchObject({
    role: "user", content: "我们从比例的化简开始", metadata: { mastery_module_id: "mod" },
  });
  await firstTurn;
  const open = { ...card, kind: "open" as const, session_id: session.session_id, session_title: session.title, session_awaiting: false };
  await expect(mastery.followHandoff({ ...open, session_id: "deleted" }, "继续")).rejects.toThrow("找不到该精通会话");
  const nextTurn = settled();
  expect((await mastery.followHandoff(open, "请给我一个例子")).session_id).toBe(session.session_id);
  await nextTurn;
  expect((await store.listMessages(session.session_id)).filter(({ role }) => role === "user").map(({ content }) => content))
    .toEqual(["我们从比例的化简开始", "请给我一个例子"]);
  const empty = await mastery.followHandoff(card, "  ");
  expect(await store.listMessages(empty.session_id)).toEqual([]);
});

it.each([
  { size: 1, retainedPairs: 6 },
  { size: 2_001, retainedPairs: 2 },
])("limits context and retains full local history (message size $size)", async ({ size, retainedPairs }) => {
  const { chat, configure, store, request } = harness();
  await configure();
  const { session_id } = await chat.createSession();
  const body = "😀".repeat(size);
  for (let index = 0; index < 8; index++) {
    const user = `u${index}`;
    const common = { session_id, turn_id: user, status: "committed" };
    await store.saveMessage({
      ...common, message_id: user, role: "user", content: `${index}${body}`, created_at: index * 2,
      metadata: null,
    });
    await store.saveMessage({
      ...common, message_id: `a${index}`, role: "assistant", content: `${index}${body}`, created_at: index * 2 + 1,
      metadata: { source_user_message_id: user }, status: index === 7 ? "failed" : "committed",
    });
  }
  await chat.send(session_id, "current");
  const history = request(0).messages.filter(({ role }: { role: string }) => role !== "system").slice(0, -1);
  expect(history).toHaveLength(retainedPairs * 2);
  expect(history[0].content).toBe(`${7 - retainedPairs}${body}`);
  expect(history.at(-1).content).toBe(`6${body}`);
  expect((await chat.readConversation(session_id)).messages).toHaveLength(18);
});

it("saves the first chunk, throttles later checkpoints, and commits the full final reply", async () => {
  const { chat, configure, store, advance } = harness(completion([text("a"), text("b"), text("c"), text("d")]));
  await configure();
  const { session_id } = await chat.createSession();
  const writes = vi.spyOn(store, "saveMessage");
  await chat.send(session_id, "question", [], ({ content }) => {
    if (content === "abc") advance();
  });
  expect(writes.mock.calls.map(([message]) => [message.role, message.status, message.content])).toEqual([
    ["user", "committed", "question"], ["assistant", "generating", ""], ["assistant", "generating", "a"],
    ["assistant", "generating", "abcd"], ["assistant", "committed", "abcd"],
  ]);
});

it("stops a streamed reply and prevents overlapping turns in the same session", async () => {
  const aborted = vi.fn();
  const stream = streamUntilAborted(aborted);
  const { chat, configure, fetch } = harness();
  fetch.mockImplementationOnce(stream);
  await configure();
  const { session_id } = await chat.createSession();
  const sending = chat.send(session_id, "question", [], (message) => {
    if (message.role === "assistant" && message.content) chat.stop(session_id);
  });
  await expect(chat.send(session_id, "another question")).rejects.toThrow("正在处理");
  const interrupted = await sending;
  expect(aborted).toHaveBeenCalledOnce();
  expect(interrupted).toMatchObject({ content: "first", status: "interrupted", metadata: { model_id: "deepseek-v4.1-flash" } });
  expect((await chat.readConversation(session_id)).messages).toHaveLength(2);
});

it("retries and regenerates in place, keeps following messages and sanitizes network failures", async () => {
  const { chat, configure, request } = harness(
    completion([text("prior")]), new Response("fixture-key with private data", { status: 403 }),
    completion([text("later")]), completion([text("recovered")]), completion([text("updated")]),
  );
  await configure();
  const { session_id } = await chat.createSession();
  const prior = await chat.send(session_id, "first");
  const failed = await chat.send(session_id, "retry me");
  expect(failed).toMatchObject({ status: "failed", metadata: { error: "模型请求失败（HTTP 403）" } });
  expect(JSON.stringify(failed)).not.toContain("fixture-key");
  const later = await chat.send(session_id, "last");
  await expect(chat.regenerate(session_id, prior.message_id)).rejects.toThrow();
  const restored = await chat.retry(session_id, failed.message_id);
  expect(restored).toMatchObject({ message_id: failed.message_id, created_at: failed.created_at, content: "recovered" });
  expect(restored.turn_id).not.toBe(failed.turn_id);
  const retriedMessages = request(3).messages.filter(({ role }: { role: string }) => role !== "system");
  expect(retriedMessages.map(({ content }: { content: string }) => content)).toEqual(["first", "prior", "retry me"]);
  const regenerated = await chat.regenerate(session_id, later.message_id);
  expect(regenerated).toMatchObject({ message_id: later.message_id, created_at: later.created_at, content: "updated" });
  const { messages } = await chat.readConversation(session_id);
  expect(messages.map(({ content }) => content)).toEqual(["first", "prior", "retry me", "recovered", "last", "updated"]);
  await chat.deleteTurn(session_id, restored.message_id);
  expect((await chat.readConversation(session_id)).messages.map(({ content }) => content))
    .toEqual(["first", "prior", "last", "updated"]);
});

it("recovers partial and missing replies locally without automatic retries", async () => {
  const { chat, open, store, fetch } = harness();
  const { session_id } = await chat.createSession();
  const user: StoredMessage = {
    message_id: "u", session_id, role: "user", content: "old question", status: "committed",
    turn_id: "turn", created_at: 10, metadata: { model_id: "saved-model" },
  };
  await store.saveMessage(user);
  await store.saveMessage({
    ...user, message_id: "a", role: "assistant", status: "generating", content: "saved part",
    created_at: 11, metadata: { source_user_message_id: "u", model_id: "saved-model" },
  });
  await store.saveMessage({ ...user, message_id: "orphan", turn_id: "next", created_at: 12 });
  const reopened = open();
  await reopened.recoverInterruptedTurns();
  await reopened.recoverInterruptedTurns();
  const { messages } = await reopened.readConversation(session_id);
  expect(messages).toHaveLength(4);
  expect(messages[1]).toMatchObject({ status: "interrupted", content: "saved part", metadata: { model_id: "saved-model" } });
  expect(messages[3]).toMatchObject({
    status: "interrupted", content: "", turn_id: "next", metadata: { source_user_message_id: "orphan", model_id: "saved-model" },
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("limits quoted excerpts and sends numbered references without storing them in the user's text", async () => {
  const { chat, configure, request } = harness(completion([text("🍊".repeat(2_001))]));
  await configure();
  const { session_id } = await chat.createSession();
  const reply = await chat.send(session_id, "fruit");
  const quote = await chat.quoteSelection(session_id, reply.message_id);
  expect(quote.text).toBe("🍊".repeat(2_000));
  expect((await chat.readConversation(session_id)).messages).toHaveLength(2);
  await expect(chat.send(session_id, "question", [quote, quote, quote, quote])).rejects.toThrow("最多添加 3 条");
  await chat.send(session_id, "question", [quote, { ...quote, text: "🍇" }]);
  expect(request(1).messages.at(-1).content).toBe(`引用 1：${quote.text}\n\n引用 2：🍇\n\nquestion`);
  const { messages } = await chat.readConversation(session_id);
  expect(messages[2]?.content).toBe("question");
  expect(messageQuotes(messages[2]!)).toEqual([quote, { ...quote, text: "🍇" }]);
});

it("validates the exact repeated selection, including Unicode edges, before creating threads or a goal payload", async () => {
  const { chat, configure, fetch } = harness(completion([text("a😀b a😀b")]));
  await configure();
  const { session_id } = await chat.createSession();
  const reply = await chat.send(session_id, "emoji");
  const selection = { text: "😀", start: 6, end: 8 };
  await expect(chat.createThread(session_id, reply.message_id, { ...selection, start: 5 })).rejects.toThrow("重新选择");
  await expect(chat.quoteSelection(session_id, reply.message_id, {
    start: 6, end: 7, text: reply.content.slice(6, 7),
  })).rejects.toThrow("重新选择");
  const thread = await chat.createThread(session_id, reply.message_id, selection);
  expect(thread).toMatchObject({ selection_start: 6, selection_end: 8, detached_at: null, selected_text: "😀" });
  expect(await chat.readThread(thread.thread_id)).toMatchObject({ thread, messages: [] });
  expect(fetch).toHaveBeenCalledOnce();
  expect(await chat.learningGoalSource(session_id, reply.message_id, selection)).toEqual({
    sourceSessionId: session_id, sourceMessageId: reply.message_id, sourceExcerpt: "😀",
  });
  const long = await chat.send(session_id, "😀".repeat(601));
  const conversation = await chat.readConversation(session_id);
  const user = conversation.messages.find(({ message_id }) => message_id === long.metadata?.source_user_message_id)!;
  expect((await chat.learningGoalSource(session_id, user.message_id)).sourceExcerpt).toBe("😀".repeat(600));
});

it("includes the newest bounded parent transcript as data and refreshes it each side turn", async () => {
  const { chat, configure, store, request } = harness();
  await configure();
  const { session_id } = await chat.createSession();
  const anchor = await chat.send(session_id, "anchor");
  const thread = await chat.createThread(session_id, anchor.message_id, { start: 0, end: 2, text: "回复" });
  for (let index = 1; index <= 6; index++) {
    await store.saveMessage({
      session_id, message_id: `parent-${index}`, role: index % 2 ? "user" : "assistant",
      status: "committed", turn_id: null, content: `${index}${"😀".repeat(6_001)}`, metadata: null, created_at: 20 + index,
    });
  }
  await store.saveMessage({
    session_id, message_id: "failed-parent", role: "assistant", status: "failed", turn_id: null,
    content: "private partial", metadata: null, created_at: 30,
  });
  const before = await chat.readConversation(session_id);
  await chat.send(thread.thread_id, "side question");
  expect(await chat.readConversation(session_id)).toEqual(before);
  const first = request(1).messages;
  const parseTranscript = (messages: { role: string; content: string }[]) =>
    JSON.parse(messages[0]!.content.split("父会话记录：")[1]!.split("\n")[0]!);
  const transcript = parseTranscript(first);
  expect(transcript).toEqual([3, 4, 5, 6].map((index) => ({
    role: index % 2 ? "user" : "assistant", content: `${index}${"😀".repeat(5_999)}`,
  })));
  expect(first.slice(1)).toEqual([{ role: "user", content: "side question" }]);
  await store.saveMessage({
    session_id, message_id: "latest", role: "user", status: "committed", turn_id: null,
    content: "new parent note", metadata: null, created_at: 31,
  });
  await chat.send(thread.thread_id, "follow up");
  expect(parseTranscript(request(2).messages).at(-1)).toEqual({ role: "user", content: "new parent note" });
  expect(request(2).messages.slice(1).map(({ content }: { content: string }) => content))
    .toEqual(["side question", "回复", "follow up"]);
});

it("reopens a side chat after interruption, detaches its anchor and deletes only its own records", async () => {
  const { chat, configure, fetch, open, store } = harness();
  await configure();
  const { session_id } = await chat.createSession();
  const anchor = await chat.send(session_id, "main");
  const thread = await chat.createThread(session_id, anchor.message_id, { start: 0, end: 2, text: "回复" });
  const reply = await chat.send(thread.thread_id, "side");
  await store.saveMessage({ ...reply, status: "generating", content: "side checkpoint" });
  const reopened = open();
  await reopened.recoverInterruptedTurns();
  expect(await reopened.listThreads(session_id, anchor.message_id)).toEqual([thread]);
  expect((await reopened.readThread(thread.thread_id)).messages[1]).toMatchObject({
    status: "interrupted", content: "side checkpoint",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  await reopened.detachThread(thread.thread_id);
  expect(await reopened.listThreads(session_id, anchor.message_id)).toEqual([]);
  expect(await reopened.listThreads(session_id)).toMatchObject([{ detached_at: expect.any(Number) }]);
  const second = await reopened.createThread(session_id, anchor.message_id, { start: 0, end: 2, text: "回复" });
  await reopened.deleteTurn(session_id, anchor.message_id);
  expect(await reopened.listThreads(session_id, anchor.message_id)).toEqual([]);
  expect((await reopened.readThread(second.thread_id)).thread.detached_at).not.toBeNull();
  await reopened.deleteThread(thread.thread_id);
  expect(await reopened.listThreads(session_id)).toMatchObject([{ thread_id: second.thread_id }]);
  expect(await store.listMessages(thread.thread_id)).toEqual([]);
  expect(await reopened.readConversation(session_id)).toMatchObject({ messages: [] });
});
