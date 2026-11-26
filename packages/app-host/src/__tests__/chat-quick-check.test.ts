import { createHash } from "node:crypto";
import {
  createKnowledgePoint, createLearningModule, createLearningProgress, createPendingQuestion,
  recordQualitativeAssessment, schedulerForProgress,
} from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, SubmissionConflictError } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, publicQuickCheck, RestoreGateError } from "../index.js";

const clock = { nowSeconds: () => 1_700_000_000 };
const choice = { question_type: "choice", question: "哪一项能保留文档中的全部字节？",
  options: ["可逆编码", "像素采样"], expected_answer: "可逆编码", explanation: "可用反向映射找回原文档。" };
const short = { question_type: "short", question: "把 20 字节压缩至 5 字节后，大小是原来的几分之几？",
  expected_answer: "1/4", accepted_answers: ["四分之一"], explanation: "用压缩后的大小除以原始大小。" };
const json = (value: unknown) => completion([text(JSON.stringify(value))]);
const checkResult = (...questions: unknown[]) => json({ intro: "试试这组自测。", questions });
const semantic = (result = "correct", confidence = 0.9) => json({
  result, confidence, feedback: "有明确的计算依据。", reference_answer: "原值的 25%",
});

function harness(label = "source") {
  let serial = 0;
  const store = new MemoryAppStore();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => completion([text("常用编码会缩短重复内容。")]));
  const host = new AppBootstrapService(store, new MemorySecretStore(), { makeId: () => `${label}-${++serial}`, fetch });
  const open = () => host.createLf01ChatService(clock);
  const mastery = host.createMasterySessionService(clock);
  const backup = host.createBackupRestoreService("0.1.0", async (value) => createHash("sha256").update(value).digest("hex"), clock);
  const configure = () => host.saveModelSettings(modelConfig);
  const request = (index: number) => JSON.parse(String(fetch.mock.calls[index]?.[1]?.body));
  return { host, store, chat: open(), open, mastery, backup, configure, fetch, request };
}

async function chatAndReply(env: ReturnType<typeof harness>) {
  await env.configure();
  const { session_id } = await env.chat.createSession();
  const reply = await env.chat.send(session_id, "文件压缩怎样工作？");
  return { session_id, reply };
}

function noPrivateAnswers(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of ["expected_answer", "accepted_answers", "reference_answer", "explanation",
    "四分之一", "1/4", short.explanation, choice.explanation, "原值的 25%"]) {
    expect(serialized).not.toContain(secret);
  }
}

it("generates from either completed-reply entry point and publishes only bounded, public data", async () => {
  const env = harness();
  const { session_id, reply } = await chatAndReply(env);
  await env.chat.send(session_id, "后来谈到的主题是图形采样。");
  const observed = vi.fn();
  const unsubscribe = env.chat.observeMessages(session_id, observed);
  env.fetch.mockResolvedValueOnce(checkResult(choice)).mockResolvedValueOnce(checkResult(choice, short));
  const anchored = await env.chat.createQuickCheck(session_id, reply.message_id);
  const recent = await env.chat.createQuickCheck(session_id);
  unsubscribe();
  expect(publicQuickCheck(anchored)).toMatchObject({ source_message_id: reply.message_id, questions: [{ question_type: "choice" }] });
  expect(publicQuickCheck(recent)?.questions.map(({ question_type }) => question_type)).toEqual(["choice", "short"]);
  const focus = JSON.parse(env.request(2).messages.at(-1).content);
  expect(focus.focus_excerpt).toBe(reply.content);
  expect(JSON.stringify(focus.history)).not.toContain("后来谈到");
  const shortcut = JSON.parse(env.request(3).messages.at(-1).content);
  expect(shortcut.focus_excerpt).toBe("");
  expect(JSON.stringify(shortcut.history)).toContain("后来谈到");
  expect(observed).toHaveBeenCalledTimes(2);
  noPrivateAnswers([observed.mock.calls, await env.open().readConversation(session_id)]);
  expect(JSON.stringify(await env.store.getMessage(recent.message_id))).toContain(short.explanation);
  expect((await env.store.getMessage(recent.message_id))?.content).toBe("试试这组自测。");
  await expect(env.chat.learningGoalSource(session_id, recent.message_id)).rejects.toThrow("先完成自测判分");
  await expect(env.chat.createQuickCheck(session_id, recent.message_id)).rejects.toThrow("从已完成的回复");
  const empty = await env.chat.createSession();
  await expect(env.chat.createQuickCheck(empty.session_id)).rejects.toThrow("先完成一轮问答");
  const ordinary = await env.chat.send(session_id, "聊聊别的主题");
  noPrivateAnswers(env.request(4));
  expect(JSON.stringify(env.request(4))).not.toContain("试试这组自测");
  expect(ordinary.status).toBe("committed");
});

it("keeps generation, exact and semantic grades isolated from existing mastery data and can hand off a graded excerpt", async () => {
  const env = harness();
  const { session_id } = await chatAndReply(env);
  const point = createKnowledgePoint({ id: "point", module_id: "module", name: "约分", type: "concept" });
  const initial = createLearningProgress({ book_id: "existing", name: "分数", modules: [createLearningModule({
    id: "module", order: 0, name: "认识分数", knowledge_points: [point],
  })], knowledge_types: { point: "concept" } });
  const before = recordQualitativeAssessment(initial, { knowledge_point_id: "point", evidence_id: "existing-evidence",
    session_id: "study", turn_id: "old-turn", learner_answer: "已有作答", model_id: "test",
    verdict: { result: "correct", confidence: 1, feedback: "通过" } }, schedulerForProgress(initial), clock.nowSeconds());
  await env.store.save(before);
  await env.store.saveSession({ session_id: "study", kind: "mastery", title: "分数", path_id: "existing", mode: "study",
    model_id: null, created_at: 1, updated_at: 1 });
  await env.store.insertInteraction({ interaction_id: "existing-card", path_id: "existing", session_id: "study", turn_id: "old-turn",
    status: "graded", question: createPendingQuestion({ question_id: "old-q", knowledge_point_id: "point", prompt: "请作答" }),
    raw_answer: "已有作答", submission_id: "old-submission", updated_at: 1 });
  await env.store.appendDomainEvent({ event_id: "existing-event", path_id: "existing", session_id: "study", turn_id: "old-turn",
    event_type: "AssessmentCommitted", payload: { interaction_id: "existing-card" }, created_at: 1 });
  const existing = await env.store.exportSnapshot();
  const review = await env.mastery.reviewPlan("existing");
  expect([...review.due, ...review.upcoming]).toHaveLength(1);
  env.fetch.mockResolvedValueOnce(checkResult(choice, short)).mockResolvedValueOnce(semantic());
  const card = await env.chat.createQuickCheck(session_id);
  const [a, b] = publicQuickCheck(card)!.questions;
  const wrong = a!.options.find(({ body }) => body === "像素采样")!.label;
  const result = publicQuickCheck(await env.chat.submitQuickCheck(session_id, card.message_id,
    { [a!.question_id]: wrong, [b!.question_id]: "原值的百分之二十五" }, "submit"))!;
  expect(result).toMatchObject({ status: "graded", grades: {
    [a!.question_id]: { result: "incorrect", confidence: 1, explanation: choice.explanation },
    [b!.question_id]: { result: "correct", reference_answer: "原值的 25%", explanation: short.explanation },
  } });
  expect(env.fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(env.request(2).messages.at(-1).content).learner_answer).toBe("原值的百分之二十五");
  const latest = await env.store.exportSnapshot();
  expect(latest.learning_progress).toEqual(existing.learning_progress);
  expect(latest.interactions).toEqual(existing.interactions);
  expect(latest.domain_events).toEqual(existing.domain_events);
  expect(await env.mastery.reviewPlan("existing")).toEqual(review);
  expect(latest.sessions).toEqual(existing.sessions);

  const goal = await env.chat.learningGoalSource(session_id, card.message_id);
  expect(goal).toEqual({ sourceSessionId: session_id, sourceMessageId: card.message_id,
    sourceExcerpt: `需巩固的自测题：${choice.question}\n自测题：${short.question}` });
  noPrivateAnswers(await env.mastery.listMaterialMessages(session_id));
  const created = await env.mastery.createTopic({ goal: "掌握无损数据压缩", materials: [
    { kind: "chat", sessionId: goal.sourceSessionId, messageId: goal.sourceMessageId, excerpt: goal.sourceExcerpt },
  ] });
  await created.opening;
  expect((await env.store.get(created.pathId))?.topic_sources?.at(-1)).toMatchObject({
    source_session_id: session_id, source_message_id: card.message_id, excerpt: goal.sourceExcerpt,
  });
});

it("reopens unanswered and graded cards and preserves both through the backup workflow", async () => {
  const env = harness();
  const { session_id } = await chatAndReply(env);
  env.fetch.mockResolvedValueOnce(checkResult(choice)).mockResolvedValueOnce(checkResult(short));
  const forGrade = await env.chat.createQuickCheck(session_id);
  const unanswered = await env.chat.createQuickCheck(session_id);
  const question = publicQuickCheck(forGrade)!.questions[0]!;
  const answers = { [question.question_id]: question.options.find(({ body }) => body === choice.expected_answer)!.label };
  await env.host.recoverOnStartup(clock);
  const reopened = env.open();
  expect((await reopened.readConversation(session_id)).messages.slice(-2)).toEqual([forGrade, unanswered]);
  const graded = await reopened.submitQuickCheck(session_id, forGrade.message_id, answers, "stable");
  expect(publicQuickCheck(graded)?.status).toBe("graded");
  await env.host.recoverOnStartup(clock);
  expect((await env.open().readConversation(session_id)).messages.slice(-2)).toEqual([graded, unanswered]);
  expect(await env.open().submitQuickCheck(session_id, forGrade.message_id, answers, "stable")).toEqual(graded);
  await expect(env.open().submitQuickCheck(session_id, forGrade.message_id, { [question.question_id]: "changed" }, "stable"))
    .rejects.toBeInstanceOf(SubmissionConflictError);
  await expect(env.open().submitQuickCheck(session_id, forGrade.message_id, answers, "another")).rejects.toThrow("已完成判分");
  expect(env.fetch).toHaveBeenCalledTimes(3);

  const target = harness("target");
  const envelope = await env.backup.exportBackup();
  await target.backup.restoreBackup(JSON.stringify(envelope));
  const restored = (await target.chat.readConversation(session_id)).messages.slice(-2);
  expect(restored.map(publicQuickCheck)).toEqual([publicQuickCheck(graded), publicQuickCheck(unanswered)]);
  expect(await target.store.getMessage(unanswered.message_id)).toEqual(
    JSON.parse(JSON.stringify(await env.store.getMessage(unanswered.message_id))),
  );
  const unbound = publicQuickCheck(unanswered)!.questions[0]!;
  expect(publicQuickCheck(await target.chat.submitQuickCheck(
    session_id, unanswered.message_id, { [unbound.question_id]: "四分之一" }, "device-offline",
  ))?.status).toBe("graded");
  expect(target.fetch).not.toHaveBeenCalled();
});

it("coalesces concurrent replays and retries, keeps restore gated in flight, and releases the chat turn lock", async () => {
  const env = harness();
  const { session_id } = await chatAndReply(env);
  env.fetch.mockResolvedValueOnce(checkResult(short));
  const card = await env.chat.createQuickCheck(session_id);
  const questionId = publicQuickCheck(card)!.questions[0]!.question_id;
  const answers = { [questionId]: "等于原来大小的百分之二十五" };
  const envelope = await env.backup.exportBackup();
  let release!: (response: Response) => void;
  env.fetch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const pending = env.chat.submitQuickCheck(session_id, card.message_id, answers, "stable");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  try {
    const retry = env.chat.retryQuickCheck(session_id, card.message_id);
    const replay = env.open().submitQuickCheck(session_id, card.message_id, answers, "stable");
    const current = (await env.open().readConversation(session_id)).messages.at(-1)!;
    expect(publicQuickCheck(current)).toMatchObject({ status: "answered", submission_id: "stable", answers });
    noPrivateAnswers(current);
    await expect(env.chat.submitQuickCheck(session_id, card.message_id, { [questionId]: "later" }, "stable"))
      .rejects.toBeInstanceOf(SubmissionConflictError);
    await expect(env.backup.restoreBackup(JSON.stringify(envelope))).rejects.toBeInstanceOf(RestoreGateError);
    expect(await env.chat.send(session_id, "还能继续问吗？")).toMatchObject({ status: "committed" });
    expect(env.fetch).toHaveBeenCalledTimes(4);
    release(semantic());
    const results = await Promise.all([pending, retry, replay]);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(publicQuickCheck(results[0])?.status).toBe("graded");
  } finally {
    release(semantic());
    await pending;
  }
  await env.backup.restoreBackup(JSON.stringify(envelope));
  expect(publicQuickCheck((await env.open().readConversation(session_id)).messages.at(-1)!)?.status).toBe("awaiting_input");
});

it("keeps the original answer for recovery after request failure and withholds low-confidence solutions", async () => {
  const env = harness();
  const { session_id } = await chatAndReply(env);
  env.fetch.mockResolvedValueOnce(checkResult(choice, short)).mockRejectedValueOnce(new Error("transport failed"));
  const card = await env.chat.createQuickCheck(session_id);
  const [a, b] = publicQuickCheck(card)!.questions;
  const answers = { [a!.question_id]: a!.options[0]!.label, [b!.question_id]: "大约二成多一些" };
  const failed = await env.chat.submitQuickCheck(session_id, card.message_id, answers, "same");
  expect(publicQuickCheck(failed)).toMatchObject({ status: "answered", grading_failed: true, submission_id: "same", answers, grades: {} });
  noPrivateAnswers(failed);
  await env.host.recoverOnStartup(clock);
  const reopened = env.open();
  env.fetch.mockResolvedValueOnce(semantic("partial", 0.6)).mockResolvedValueOnce(semantic());
  const uncertain = await reopened.retryQuickCheck(session_id, card.message_id);
  expect(publicQuickCheck(uncertain)).toMatchObject({ status: "awaiting_input", answers, grades: {} });
  noPrivateAnswers(uncertain);
  expect(publicQuickCheck(await reopened.retryQuickCheck(session_id, card.message_id))?.status).toBe("graded");
  expect(env.fetch).toHaveBeenCalledTimes(5);
});

it("revalidates the persisted submission before committing an in-flight semantic result", async () => {
  const env = harness();
  const { session_id } = await chatAndReply(env);
  env.fetch.mockResolvedValueOnce(checkResult(short));
  const card = await env.chat.createQuickCheck(session_id);
  const key = publicQuickCheck(card)!.questions[0]!.question_id;
  let release!: (response: Response) => void;
  env.fetch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const grading = env.chat.submitQuickCheck(session_id, card.message_id, { [key]: "25%" }, "original");
  const rejected = expect(grading).rejects.toThrow("自测作答已更新");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  try {
    const row = (await env.store.getMessage(card.message_id))!;
    await env.store.saveMessage({ ...row, metadata: { quick_check: {
      ...row.metadata!.quick_check as object, answers: { [key]: "新的作答" },
    } } });
  } finally {
    release(semantic());
    await rejected;
  }
  const current = (await env.chat.readConversation(session_id)).messages.at(-1)!;
  expect(publicQuickCheck(current)).toMatchObject({ status: "answered", grades: {}, answers: { [key]: "新的作答" } });
});
