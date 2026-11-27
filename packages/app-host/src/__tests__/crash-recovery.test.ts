import { createKnowledgePoint, createLearningEvidence, createLearningModule, createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type AppStore, type StoredInteraction, type StoredMessage } from "@learn-pace/infra";
import { FaultInjectingAppStore, InjectedCrashError } from "@learn-pace/infra/testing";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, LearningHomeService, RecoveryService } from "../index.js";

const pathId = "fractions";
const quiz = { knowledge_point_id: "point", question: "把 4/8 写成最简分数", question_type: "short", expected_answer: "1/2" };
const call = (name: string, args: Record<string, unknown>) => completion([toolCall(name, args)], "tool_calls");
const verdict = () => completion([text(JSON.stringify({ result: "correct", confidence: 0.98, feedback: "比值相同" }))]);

async function setup() {
  const store = new MemoryAppStore();
  const faults = new FaultInjectingAppStore(store);
  const secrets = new MemorySecretStore();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => completion([text("继续学习。")]));
  let id = 0;
  let time = 100;
  const clock = { nowSeconds: () => ++time };
  const makeId = () => `created-${++id}`;
  const open = (storage: AppStore = store) => new AppBootstrapService(storage, secrets, { makeId, fetch });
  const app = open(faults.store);
  await app.saveModelSettings(modelConfig);
  await store.saveWithCas(createLearningProgress({ book_id: pathId, name: "分数", modules: [createLearningModule({
    id: "module", name: "分数", order: 0, objective: "掌握约分", knowledge_points: [
      createKnowledgePoint({ id: "point", module_id: "module", name: "约分", type: "procedure" }),
      createKnowledgePoint({ id: "keep", module_id: "module", name: "等值", type: "concept" }),
    ],
  })] }), null);
  const mastery = app.createMasterySessionService(clock);
  const { session_id: session } = await mastery.createSession(pathId, "study");
  const answer = (card: StoredInteraction, value = "1/2", submission = "original-submission") =>
    mastery.submitAnswer(pathId, session, card.interaction_id, { [card.question.question_id]: value }, submission);
  const post = async () => {
    fetch.mockResolvedValueOnce(call("mastery_quiz", quiz));
    const message = await mastery.send(pathId, session, "请出一道题");
    expect(message.status).toBe("committed");
    return (await store.getOpenInteraction(pathId))!;
  };
  const reopen = async () => {
    const fresh = open();
    const report = await fresh.recoverOnStartup(clock);
    return { report, mastery: fresh.createMasterySessionService(clock), home: new LearningHomeService(store, clock) };
  };
  const card = (interaction_id: string, overrides: Partial<StoredInteraction> = {}): StoredInteraction => ({
    interaction_id, path_id: pathId, session_id: session, turn_id: "quiz-turn", status: "awaiting_input",
    raw_answer: null, submission_id: null, updated_at: 1,
    question: createPendingQuestion({ question_id: interaction_id, knowledge_point_id: "point", expected_answer: "1/2" }),
    ...overrides,
  });
  const read = async () => (await store.get(pathId))!;
  const lastToolResult = () => {
    const request = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
    return JSON.parse(request.messages.findLast((message: { role: string }) => message.role === "tool").content);
  };
  return { store, faults, mastery, session, fetch, clock, makeId, answer, post, reopen, card, read, lastToolResult };
}

it("reconciles generating and missing replies in every session without replaying the model", async () => {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  const fetch = vi.fn<typeof globalThis.fetch>();
  let id = 0;
  const reopen = () => new AppBootstrapService(store, secrets, { makeId: () => `restored-${++id}`, fetch });
  const kinds = ["lf01", "little_tutor", "mastery"] as const;
  for (const kind of kinds) {
    await store.saveSession({ session_id: kind, kind, path_id: kind === "mastery" ? "path" : null,
      mode: kind === "mastery" ? "study" : null, title: kind, model_id: "saved-model", created_at: 1, updated_at: 1 });
    const user: StoredMessage = { message_id: `${kind}-user`, session_id: kind, role: "user", content: "原问题",
      status: "committed", turn_id: "turn", created_at: 10, metadata: { model_id: "per-turn-model" } };
    await store.saveMessage(user);
    await store.saveMessage({ ...user, message_id: `${kind}-reply`, role: "assistant", status: "generating", content: "已保存片段",
      created_at: 11, metadata: { source_user_message_id: user.message_id, model_id: "per-turn-model" } });
    await store.saveMessage({ ...user, message_id: `${kind}-orphan`, metadata: null, turn_id: "next", created_at: 12 });
  }

  expect(await reopen().recoverOnStartup()).toMatchObject({ interruptedMessages: 6 });
  for (const kind of kinds) {
    const messages = await store.listMessages(kind);
    expect(messages).toHaveLength(4);
    expect(messages[1]).toMatchObject({ status: "interrupted", content: "已保存片段", metadata: { model_id: "per-turn-model" } });
    expect(messages[3]).toMatchObject({ status: "interrupted", content: "", turn_id: "next",
      metadata: { source_user_message_id: `${kind}-orphan`, model_id: "saved-model" } });
  }

  expect(await reopen().recoverOnStartup()).toMatchObject({ interruptedMessages: 0 });
  expect(id).toBe(3);
  expect(fetch).not.toHaveBeenCalled();
});

it("restores the same card after question registration and before saving the terminal reply", async () => {
  const { faults, mastery, session, store, fetch, reopen } = await setup();
  faults.injectNext("saveMessage", "before", ([message]) => {
    const { status, role } = message as StoredMessage;
    return status === "committed" && role === "assistant";
  });
  fetch.mockResolvedValueOnce(call("mastery_quiz", quiz));
  await expect(mastery.send(pathId, session, "出题后模拟中断")).rejects.toBeInstanceOf(InjectedCrashError);
  const original = await store.getOpenInteraction(pathId);
  expect(original).toMatchObject({ status: "awaiting_input", raw_answer: null });
  const restored = await reopen();
  expect(restored.report.interruptedMessages).toBe(1);
  expect((await restored.mastery.openSession(pathId, session)).cards).toMatchObject([
    { interaction_id: original?.interaction_id, status: "awaiting_input" },
  ]);
  expect((await restored.home.read()).attention[0]).toMatchObject({ kind: "question", answered: false, sessionId: session });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains an answer saved before grading starts and retries it explicitly", async () => {
  const { faults, post, answer, read, session, store, fetch, reopen } = await setup();
  const card = await post();
  faults.injectNext("commitTransaction", "after");
  await expect(answer(card)).rejects.toBeInstanceOf(InjectedCrashError);
  expect(await store.getInteraction(card.interaction_id)).toMatchObject({ status: "answered", raw_answer: "1/2",
    submission_id: "original-submission" });
  const restored = await reopen();
  expect(restored.report.pendingRetryCards).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await restored.home.read()).attention[0]).toMatchObject({ kind: "question", answered: true, sessionId: session });
  expect((await restored.mastery.openSession(pathId, session)).cards[0]).toMatchObject({ answers: { [card.question.question_id]: "1/2" } });
  await restored.mastery.retryAnswer(pathId, session, card.interaction_id);
  expect((await read()).quiz_attempts).toHaveLength(1);
  expect(await store.getInteraction(card.interaction_id)).toMatchObject({ status: "graded", submission_id: "original-submission" });
});

it("keeps the saved answer when interrupted during the assessment request", async () => {
  const { mastery, post, answer, fetch, reopen, read, session, store } = await setup();
  const card = await post();
  let entered!: () => void;
  let release!: (response: Response) => void;
  const assessing = new Promise<void>((resolve) => { entered = resolve; });
  const delayed = new Promise<Response>((resolve) => { release = resolve; });
  fetch.mockImplementationOnce(async () => { entered(); return delayed; });
  const sending = answer(card, "二分之一");
  try {
    await assessing;
    const restored = await reopen();
    expect(restored.report).toMatchObject({ interruptedMessages: 1, pendingRetryCards: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await store.getInteraction(card.interaction_id)).toMatchObject({ raw_answer: "二分之一", status: "answered" });
    expect((await read()).quiz_attempts).toEqual([]);
    fetch.mockResolvedValueOnce(verdict());
    await restored.mastery.retryAnswer(pathId, session, card.interaction_id);
    expect((await read()).quiz_attempts).toHaveLength(1);
  } finally {
    mastery.stop(pathId, session);
    release(verdict());
    await sending;
  }
  expect((await read()).quiz_attempts).toHaveLength(1);
  expect(await store.getInteraction(card.interaction_id)).toMatchObject({ status: "graded" });
});

it("reopens a committed assessment even if the grading call fails before returning to the UI", async () => {
  const { faults, post, answer, fetch, reopen, read, session, store } = await setup();
  const card = await post();
  fetch.mockImplementationOnce(async () => {
    faults.injectNext("commitTransaction", "after");
    return verdict();
  });
  const result = await answer(card, "二分之一");
  expect(result).toMatchObject({ kind: "turn", message: { status: "failed" } });
  const committed = await read();
  expect(committed.quiz_attempts).toHaveLength(1);
  const restored = await reopen();
  expect(restored.report.pendingRetryCards).toBe(0);
  expect(await restored.mastery.submitAnswer(pathId, session, card.interaction_id,
    { [card.question.question_id]: "二分之一" }, "original-submission")).toMatchObject({ kind: "receipt", card: { status: "graded" } });
  expect(await read()).toEqual(committed);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((await store.listDomainEvents(pathId)).map(({ event_type }) => event_type)).toEqual(["AssessmentCommitted", "AnswerRecorded"]);
});

it("repairs legacy single and group cards per question while keeping evidence and progress unchanged", async () => {
  const { card, read, store, reopen, session, fetch } = await setup();
  const group = createPendingQuestion({ question_id: "group", knowledge_point_id: "point", question_type: "group",
    questions: ["one", "two", "three"].map((question_id) => createPendingQuestion({ question_id, knowledge_point_id: "point",
      expected_answer: "1/2", explanation: "用公因数约分" })) });
  const restoredEvidence = ["single", "group:one"].map((evidence_id) => createLearningEvidence({ evidence_id,
    knowledge_point_id: "point", result: "correct", feedback: "已判对", confidence: 0.92 }));
  await store.save({ ...await read(), learning_evidence: restoredEvidence });
  const before = await read();
  await store.insertInteraction(card("single", { status: "answered", raw_answer: "1/2", submission_id: "single-id",
    updated_at: 50, grade: { questions: {}, grading_failed: true } }));
  await store.insertInteraction(card("group", { question: group, status: "answered", raw_answer: '{"one":"1/2"}', submission_id: "group-id" }));
  await store.insertInteraction(card("blank", { updated_at: 99 }));

  const restored = await reopen();
  expect(restored.report).toMatchObject({ reconciledGradedCards: 1, reconciledPartialCards: 1, abandonedDuplicateCards: 1 });
  const single = await store.getInteraction("single");
  expect(single).toMatchObject({ status: "graded", submission_id: "single-id", updated_at: 50,
    grade: { questions: { single: { final: true, feedback: "已判对", reference_answer: "1/2" } } } });
  expect(single?.grade).not.toHaveProperty("grading_failed");
  expect((await restored.mastery.openSession(pathId, session)).cards.find(({ interaction_id }) => interaction_id === "group"))
    .toMatchObject({ status: "awaiting_input", answers: { one: "1/2" },
      grade: { questions: { one: { final: true, explanation: "用公因数约分" } } } });
  expect(await store.getInteraction("blank")).toMatchObject({ status: "abandoned" });
  expect((await store.listOpenInteractions()).map(({ interaction_id }) => interaction_id)).toEqual(["group"]);
  expect(await read()).toEqual(before);
  expect(await store.listDomainEvents(pathId)).toEqual([]);
  expect((await reopen()).report).toEqual({ interruptedMessages: 0, reconciledGradedCards: 0, reconciledPartialCards: 0,
    abandonedDuplicateCards: 0, pendingRetryCards: 0 });
  expect(fetch).not.toHaveBeenCalled();
});

it("prioritizes saved answers over newer blank cards and uses descending IDs on a timestamp tie", async () => {
  const { store, card, reopen, session, fetch, read } = await setup();
  const saved = { status: "answered", raw_answer: "1/2", updated_at: 5 } as const;
  await store.insertInteraction(card("saved-a", saved));
  await store.insertInteraction(card("saved-z", saved));
  await store.insertInteraction(card("blank-newer", { updated_at: 25 }));
  const restored = await reopen();
  expect(restored.report).toMatchObject({ pendingRetryCards: 1, abandonedDuplicateCards: 2 });
  expect(await store.getOpenInteraction(pathId)).toMatchObject({ interaction_id: "saved-z", raw_answer: "1/2", submission_id: null });
  expect(await store.getInteraction("saved-a")).toMatchObject({ status: "abandoned", raw_answer: "1/2" });
  expect(await store.getInteraction("blank-newer")).toMatchObject({ status: "abandoned" });
  expect((await reopen()).report).toMatchObject({ pendingRetryCards: 1, abandonedDuplicateCards: 0 });
  expect(fetch).not.toHaveBeenCalled();
  await restored.mastery.retryAnswer(pathId, session, "saved-z");
  expect((await read()).quiz_attempts).toHaveLength(1);
});

it("accepts remaining group answers when a restored grade has no stored answer text", async () => {
  const { store, card, read, reopen, session } = await setup();
  const questions = ["one", "two"].map((question_id) => createPendingQuestion({ question_id, knowledge_point_id: "point",
    expected_answer: "1/2" }));
  await store.insertInteraction(card("group", {
    question: createPendingQuestion({ question_id: "group", knowledge_point_id: "point", question_type: "group", questions }),
  }));
  await store.save({ ...await read(), learning_evidence: [createLearningEvidence({ evidence_id: "group:one", knowledge_point_id: "point" })] });
  const restored = await reopen();
  await restored.mastery.submitAnswer(pathId, session, "group", { two: "1/2" }, "remaining");
  expect(await store.getInteraction("group")).toMatchObject({ status: "graded", raw_answer: '{"two":"1/2"}' });
  expect((await read()).learning_evidence.map(({ evidence_id }) => evidence_id)).toEqual(["group:one", "group:two"]);
});

it("discards a draft outline preview on restart and preserves the path and its evidence", async () => {
  const { mastery, read, post, answer, fetch, reopen, lastToolResult } = await setup();
  await answer(await post());
  const before = await read();
  const { session_id: outline } = await mastery.createSession(pathId, "outline");
  fetch.mockResolvedValueOnce(call("mastery_revise", { action: "preview", expected_revision: before.version,
    module_id: "module", add: [{ name: "分数比较", type: "procedure" }] }));
  await mastery.send(pathId, outline, "先预览新知识点");
  const preview = lastToolResult();
  expect(preview).toMatchObject({ ok: true, preview_id: expect.any(String) });
  const restored = await reopen();
  fetch.mockResolvedValueOnce(call("mastery_revise", { action: "commit", preview_id: preview.preview_id }));
  await restored.mastery.send(pathId, outline, "提交之前的预览");
  expect(lastToolResult()).toMatchObject({ ok: false, message: expect.stringContaining("重新预览") });
  expect(await read()).toEqual(before);
});

it("keeps the original grade when a repair crashes before commit", async () => {
  const { mastery, post, answer, read, fetch, reopen, faults, store, session, lastToolResult } = await setup();
  const row = await post();
  await answer(row);
  const before = await read();
  const scored = await store.getInteraction(row.interaction_id);
  const audit = await store.listDomainEvents(pathId);
  faults.injectNext("commitTransaction", "before");
  fetch.mockResolvedValueOnce(call("mastery_repair_question", { action: "void", reason: "题干错误" }));
  await mastery.challengeQuestion(pathId, session, row.interaction_id, "复核题目");
  expect(lastToolResult()).toMatchObject({ ok: false, code: "unavailable" });
  await reopen();
  expect(await read()).toEqual(before);
  expect(await store.getInteraction(row.interaction_id)).toEqual(scored);
  expect(await store.listDomainEvents(pathId)).toEqual(audit);
});

it("reuses the caller's transaction and rolls reconciliation back with it", async () => {
  const { store, faults, session, clock, makeId } = await setup();
  const user: StoredMessage = { message_id: "orphan", session_id: session, role: "user", content: "还没有回复", status: "committed",
    turn_id: "orphan-turn", metadata: null, created_at: 2 };
  await store.saveMessage(user);
  const service = new RecoveryService(faults.store, clock, makeId);
  faults.injectNext("commitTransaction", "before");
  await expect(faults.store.runInTransaction(async (tx) => {
    await tx.runInTransaction((nested) => nested.writeSetting("nested", "pending"));
    expect((await service.reconcileInTransaction(tx)).interruptedMessages).toBe(1);
    expect(await tx.listMessages(session)).toHaveLength(2);
  })).rejects.toBeInstanceOf(InjectedCrashError);
  expect(await store.readSetting("nested")).toBeNull();
  expect(await store.listMessages(session)).toEqual([user]);
  expect((await service.reconcileAll()).interruptedMessages).toBe(1);
});

it("reclaims orphan skill bytes on restart and marks only pending receipts unknown", async () => {
  const { store, reopen } = await setup();
  const app = new AppBootstrapService(store, new MemorySecretStore(), { makeId: () => "restart-fixture" });
  const service = app.createSkillService();
  const source = (body: string) => new TextEncoder().encode(`---\nname: restore-coach\ndescription: Teach fractions\n---\n${body}`);
  const old = await service.confirm(await service.previewLocal(source("old"), "local_file"));
  const active = await service.confirm(await service.previewLocal(source("active"), "local_file"));
  const current = await store.getSkillRevision(active.skill_id, active.active_revision);
  await store.saveSkillRevision({ ...current!, revision: old.active_revision });
  await store.saveSkillRevision({ ...current!, skill_id: "removed" });
  const chat = app.createLf01ChatService();
  const session = await chat.createSession();
  const receipt = { turnId: "restart-turn", skillId: old.skill_id, name: old.name, revision: old.active_revision, mode: "automatic" };
  const receipts = [{ ...receipt, status: "loaded" }, { ...receipt, status: "started", tool: "read_skill_file" }];
  await store.saveMessage({ message_id: "progressing", session_id: session.session_id, role: "assistant", status: "generating",
    turn_id: "restart-turn", content: "部分回答", created_at: 12, metadata: { skill_receipts: receipts } });

  await reopen();
  expect((await store.exportSnapshot()).skill_revisions).toEqual([current]);
  expect(await store.getSkill(active.skill_id)).toEqual(active);
  expect(await store.getMessage("progressing")).toMatchObject({ status: "interrupted", content: "部分回答",
    metadata: { skill_receipts: [receipts[0], { ...receipts[1], status: "unknown" }] } });
});
