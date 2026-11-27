import { createKnowledgePoint, createLearningModule, createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import {
  MemoryAppStore, SubmissionConflictError, VersionConflictError,
  type AppStore, type StoredDomainEvent, type StoredInteraction, type StoredMessage,
} from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { MasterySessionService, StaleInteractionError } from "../index.js";
import { StudyInteractions } from "../mastery/study.js";

const pathId = "path";
const question = createPendingQuestion({ question_id: "fraction", knowledge_point_id: "point", module_id: "module",
  question_type: "short", expected_answer: "1/2" });
const point = createKnowledgePoint({ id: "point", name: "约分", module_id: "module", type: "procedure" });
const concept = createKnowledgePoint({ id: "concept", name: "等值分数", module_id: "module", type: "concept" });
const reply = () => completion([text("继续学习。")]);
const verdict = () => completion([text(JSON.stringify({ result: "correct", confidence: 0.95, feedback: "比值相同" }))]);
const tool = (name: string, args: Record<string, unknown>) => completion([toolCall(name, args)], "tool_calls");

async function setup() {
  const store = new MemoryAppStore();
  const progress = createLearningProgress({ book_id: pathId, name: "分数", modules: [createLearningModule({
    id: "module", name: "分数", objective: "约分与等值", order: 0, knowledge_points: [point, concept],
  })] });
  await store.saveWithCas(progress, null);
  let id = 0;
  let time = 100;
  let active = false;
  let failOn: StoredDomainEvent["event_type"] | undefined;
  const callsInTransaction: boolean[] = [];
  const serve = vi.fn<typeof fetch>(async () => reply());
  const fetchModel: typeof fetch = (...args) => {
    callsInTransaction.push(active);
    return serve(...args);
  };
  const now = () => ++time;
  const makeId = () => `id-${++id}`;
  const run = store.runInTransaction.bind(store);
  store.runInTransaction = <T>(work: (tx: AppStore) => Promise<T>) => run(async (tx) => {
    active = true;
    const append = tx.appendDomainEvent.bind(tx);
    tx.appendDomainEvent = async (event) => {
      if (event.event_type === failOn) throw new Error("audit write failed");
      await append(event);
    };
    try { return await work(tx); } finally { active = false; }
  });
  const read = async () => (await store.get(pathId))!;
  const mastery = new MasterySessionService(store, { nowSeconds: now }, makeId, async () => modelConfig, fetchModel);
  const { session_id: sessionId } = await mastery.createSession(pathId, "study");
  const cards = new StudyInteractions(store, now, makeId, read, () => { throw new Error("unexpected progress save"); }, fetchModel);
  const row: StoredInteraction = { path_id: pathId, session_id: sessionId, interaction_id: "card", turn_id: "question-turn",
    status: "awaiting_input", raw_answer: null, submission_id: null, question, updated_at: now() };
  const answers = { fraction: "1/2" };
  const submit = (submissionId = "client-id", input = answers, card = row.interaction_id) =>
    mastery.submitAnswer(pathId, sessionId, card, input, submissionId);
  const firstSubmission = async (input = answers) => cards.submit({ pathId, sessionId }, row.interaction_id, input, "client-id");
  const scope = (stored?: StoredMessage) => ({ pathId, sessionId, config: modelConfig, mode: () => "study" as const,
    turn: { turnId: "grading-turn", signal: new AbortController().signal, deliveredText: () => "", user: stored ?? {
      message_id: "answer-message", session_id: sessionId, role: "user", content: "我的作答", status: "committed",
      turn_id: "grading-turn", created_at: now(), metadata: { mastery_answer: { interaction_id: row.interaction_id,
        submission_id: "client-id", answers } },
    } },
  });
  const events = async () => (await store.listDomainEvents(pathId)).map(({ event_type }) => event_type);
  await store.insertInteraction(row);
  return { store, mastery, cards, row, sessionId, scope, read, submit, firstSubmission, serve, callsInTransaction, events,
    failAudit: (eventType?: StoredDomainEvent["event_type"]) => { failOn = eventType; } };
}

it("returns a receipt on finalized replays before writing messages or calling the tutor", async () => {
  const { store, row, submit, read, serve, events, sessionId } = await setup();
  expect((await submit()).kind).toBe("turn");
  const before = await store.listMessages(sessionId);
  expect(await submit()).toMatchObject({ kind: "receipt", card: { status: "graded", interaction_id: row.interaction_id } });
  expect(await store.listMessages(sessionId)).toEqual(before);
  expect(serve).toHaveBeenCalledTimes(1);
  expect((await read()).quiz_attempts).toHaveLength(1);
  expect(await events()).toEqual(["AssessmentCommitted", "AnswerRecorded"]);
});

it("returns the existing grading for a finalized group answer while another question remains open", async () => {
  const { mastery, store, row, sessionId, serve, events } = await setup();
  const group = createPendingQuestion({ ...row.question, question_id: "group", question_type: "group", questions: [
    row.question, { ...row.question, question_id: "another" },
  ] });
  await store.updateInteraction({ ...row, question: group, submission_id: "client-id", raw_answer: '{"fraction":"1/2"}',
    grade: { questions: { fraction: { result: "correct", final: true, confidence: 1, feedback: "比值相同" } } } });
  const result = await mastery.submitAnswer(pathId, sessionId, row.interaction_id, { fraction: "1/2" }, "client-id");
  expect(result).toMatchObject({ kind: "receipt", card: { status: "awaiting_input", answers: { fraction: "1/2" } } });
  expect(await store.listMessages(sessionId)).toEqual([]);
  expect(await events()).toEqual([]);
  expect(serve).not.toHaveBeenCalled();
});

it("resumes a pending replay and reuses evidence already recorded for the submission", async () => {
  const { store, row, submit, read, serve, firstSubmission, events } = await setup();
  const pending = await firstSubmission();
  if (pending.kind !== "staged") throw new Error("missing pending card");
  await submit();
  const committed = await read();
  expect(committed.quiz_attempts).toHaveLength(1);
  // 模拟旧版本已写进度但尚未更新题卡便中断。
  await store.updateInteraction(pending.row);
  expect((await submit()).kind).toBe("turn");
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({ status: "graded" });
  expect((await read()).quiz_attempts).toEqual(committed.quiz_attempts);
  expect((await read()).learning_evidence).toEqual(committed.learning_evidence);
  expect(serve).toHaveBeenCalledTimes(2);
  expect((await events()).filter((event) => event === "AnswerRecorded")).toHaveLength(1);
});

it("refuses cross-card IDs, changed answers, and new IDs on closed or abandoned cards", async () => {
  const { store, row, submit, firstSubmission, read, sessionId, serve } = await setup();
  await firstSubmission();
  await expect(submit("client-id", { fraction: "1/3" })).rejects.toBeInstanceOf(SubmissionConflictError);
  await store.insertInteraction({ ...row, interaction_id: "second" });
  await expect(submit("client-id", undefined, "second")).rejects.toBeInstanceOf(SubmissionConflictError);
  await store.abandonInteraction("second", 200);
  await expect(submit("second-id", undefined, "second")).rejects.toBeInstanceOf(StaleInteractionError);
  expect(await store.listMessages(sessionId)).toEqual([]);
  expect(serve).not.toHaveBeenCalled();
  await submit();
  await expect(submit("client-id", { fraction: "1/3" })).rejects.toBeInstanceOf(SubmissionConflictError);
  await expect(submit("new-id")).rejects.toBeInstanceOf(StaleInteractionError);
  expect((await read()).quiz_attempts).toHaveLength(1);
});

it.each(["new submission succeeds", "new submission fails", "abandoned succeeds", "abandoned fails"])(
  "discards a late grading callback when %s", async (change) => {
    const { store, cards, scope, row, serve, firstSubmission, read, callsInTransaction, events } = await setup();
    await firstSubmission({ fraction: "二分之一" });
    serve.mockImplementationOnce(async () => {
      if (change.startsWith("new submission")) await store.saveAnswer(row.interaction_id, "new-id", "新作答", 200);
      else await store.abandonInteraction(row.interaction_id, 200);
      return change.endsWith("fails") ? new Response("fixture", { status: 500 }) : verdict();
    });
    expect(await cards.pregrade(scope())).toBeUndefined();
    expect(callsInTransaction).toEqual([false]);
    expect((await read()).learning_evidence).toEqual([]);
    expect(await store.getInteraction(row.interaction_id)).toMatchObject(change.startsWith("new submission")
      ? { status: "answered", submission_id: "new-id", raw_answer: "新作答" } : { status: "abandoned" });
    expect((await store.getInteraction(row.interaction_id))?.grade).toBeUndefined();
    expect(await events()).toEqual(["AnswerRecorded"]);
  });

it("reports a stale grading version through the public submission and retains the saved answer", async () => {
  const { store, row, serve, read, submit, events, sessionId, callsInTransaction } = await setup();
  serve.mockImplementationOnce(async () => {
    const base = await read();
    await store.saveWithCas({ ...base, name: "较新进度", version: base.version + 1 }, base.version);
    return verdict();
  });
  await expect(submit("client-id", { fraction: "二分之一" })).rejects.toBeInstanceOf(VersionConflictError);
  expect(callsInTransaction).toEqual([false]);
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({ status: "answered", raw_answer: "二分之一" });
  expect(await read()).toMatchObject({ name: "较新进度", version: 1, learning_evidence: [] });
  expect((await store.listMessages(sessionId)).at(-1)).toMatchObject({ status: "failed", metadata: {
    error: expect.stringContaining("学习进度已更新"),
  } });
  expect(await events()).toEqual(["AnswerRecorded"]);
});

it("rolls back staging or grading when the matching event cannot be written", async () => {
  const { store, row, firstSubmission, cards, scope, read, failAudit, events } = await setup();
  failAudit("AnswerRecorded");
  await expect(firstSubmission()).rejects.toThrow("audit write failed");
  expect(await store.getInteraction(row.interaction_id)).toEqual(row);
  failAudit(undefined);
  await firstSubmission();
  const before = await store.getInteraction(row.interaction_id);
  failAudit("AssessmentCommitted");
  await expect(cards.pregrade(scope())).rejects.toThrow("audit write failed");
  expect(await store.getInteraction(row.interaction_id)).toEqual(before);
  expect(await read()).toMatchObject({ version: 0, learning_evidence: [] });
  expect(await events()).toEqual(["AnswerRecorded"]);
});

it.each(["correct", "void"] as const)("commits or rolls back mastery_repair_question (%s) as a unit", async (action) => {
  const { mastery, row, store, submit, read, serve, events, sessionId, failAudit, callsInTransaction } = await setup();
  await submit();
  const event = action === "correct" ? "AssessmentCorrected" : "AssessmentVoided";
  const trigger = () => tool("mastery_repair_question", { action, reason: "修订题目", expected_answer: "0.5" });
  const repair = () => mastery.challengeQuestion(pathId, sessionId, row.interaction_id, "请复核");
  const before = await read();
  const previousCard = await store.getInteraction(row.interaction_id);
  failAudit(event);
  serve.mockResolvedValueOnce(trigger());
  if (action === "correct") serve.mockResolvedValueOnce(verdict());
  expect((await repair()).metadata?.runtime).toMatchObject({ tools: [{ code: "unavailable" }] });
  expect(await read()).toEqual(before);
  expect(await store.getInteraction(row.interaction_id)).toEqual(previousCard);
  expect(await events()).toEqual(["AssessmentCommitted", "AnswerRecorded"]);

  failAudit(undefined);
  serve.mockResolvedValueOnce(trigger());
  if (action === "correct") serve.mockResolvedValueOnce(verdict());
  expect((await repair()).metadata?.runtime).toMatchObject({ tools: [{ code: "ok" }] });
  expect(await store.getInteraction(row.interaction_id)).toMatchObject(action === "correct"
    ? { status: "graded", question: { expected_answer: "0.5" } } : { status: "abandoned" });
  expect(await read()).toMatchObject({ version: before.version + 1,
    quiz_attempts: [action === "void" ? { voided: true } : { result: "correct" }] });
  expect(await events()).toEqual([event, "AssessmentCommitted", "AnswerRecorded"]);
  expect(callsInTransaction).not.toContain(true);
});

it("commits qualitative assessment and pending-message metadata together", async () => {
  const { cards, scope, store, read, events, sessionId, failAudit, serve, callsInTransaction } = await setup();
  const user: StoredMessage = { message_id: "explanation", session_id: sessionId, role: "user", content: "它们表示相同的量",
    status: "committed", turn_id: "grading-turn", metadata: { mastery_assessment_pending: { concept: "原解释" } }, created_at: 100 };
  await store.saveMessage(user);
  failAudit("AssessmentCommitted");
  serve.mockResolvedValueOnce(verdict());
  await expect(cards.assess(scope(user), "concept")).rejects.toThrow("audit write failed");
  expect(await store.getMessage(user.message_id)).toEqual(user);
  expect((await read()).learning_evidence).toEqual([]);
  failAudit(undefined);
  serve.mockResolvedValueOnce(verdict());
  await cards.assess(scope(user), "concept");
  expect((await read()).learning_evidence).toHaveLength(1);
  expect((await store.getMessage(user.message_id))?.metadata).toMatchObject({ mastery_assessment_pending: { concept: null } });
  expect(await events()).toEqual(["AssessmentCommitted"]);
  expect(callsInTransaction).toEqual([false, false]);
});

it("rejects an outdated outline preview and commits a new preview with card abandonment and its event", async () => {
  const { mastery, store, row, serve, read, events } = await setup();
  const { session_id: outline } = await mastery.createSession(pathId, "outline");
  const preview = async () => {
    serve.mockResolvedValueOnce(tool("mastery_revise", { action: "preview", expected_revision: (await read()).version,
      module_id: "module", remove: ["point"] }));
    await mastery.send(pathId, outline, "预览移除约分");
    const payload = JSON.parse(String(serve.mock.calls.at(-1)?.[1]?.body));
    return JSON.parse(payload.messages.at(-1).content).preview_id as string;
  };
  const commit = (previewId: string) => {
    serve.mockResolvedValueOnce(tool("mastery_revise", { action: "commit", preview_id: previewId }));
    return mastery.send(pathId, outline, "提交预览");
  };
  const stale = await preview();
  await mastery.renameTopic(pathId, "更名");
  const before = await read();
  expect((await commit(stale)).metadata?.runtime).toMatchObject({ tools: [{ code: "version_conflict" }] });
  expect(await read()).toEqual(before);
  expect(await store.getInteraction(row.interaction_id)).toEqual(row);
  expect(await events()).toEqual([]);

  expect((await commit(await preview())).metadata?.runtime).toMatchObject({ tools: [{ code: "ok" }] });
  expect((await read()).modules[0]?.knowledge_points).toEqual([concept]);
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({ status: "abandoned" });
  expect(await events()).toEqual(["OutlineCommitted"]);
});

it("resets unfinished cards, rolls back failed deletion, and removes only the deleted topic's records", async () => {
  const { mastery, store, row, submit, sessionId, events } = await setup();
  await submit();
  await store.insertInteraction({ ...row, interaction_id: "open" });
  await store.insertInteraction({ ...row, interaction_id: "legacy-open", session_id: "legacy-missing-session" });
  await mastery.resetTopic(pathId);
  expect(await store.listOpenInteractionsByPath(pathId)).toEqual([]);
  expect(await events()).toEqual(["AssessmentCommitted", "AnswerRecorded"]);
  const other = createLearningProgress({ book_id: "other" });
  await store.saveWithCas(other, null);
  const otherEvent = { ...(await store.listDomainEvents(pathId))[0]!, event_id: "other-event", path_id: "other" };
  await store.appendDomainEvent(otherEvent);
  const run = store.runInTransaction.bind(store);
  store.runInTransaction = <T>(work: (tx: AppStore) => Promise<T>) => run(async (tx) => {
    tx.deleteDomainEventsByPath = async () => { throw new Error("delete failed"); };
    return work(tx);
  });
  await expect(mastery.deleteTopic(pathId)).rejects.toThrow("delete failed");
  expect(await store.get(pathId)).not.toBeNull();
  expect(await store.getSession(sessionId)).not.toBeNull();
  expect(await store.listMessages(sessionId)).toHaveLength(2);
  expect(await store.getInteraction("legacy-open")).not.toBeNull();
  expect(await events()).toEqual(["AssessmentCommitted", "AnswerRecorded"]);

  store.runInTransaction = run;
  await mastery.deleteTopic(pathId);
  expect(await store.get(pathId)).toBeNull();
  expect(await store.getSession(sessionId)).toBeNull();
  expect(await store.listMessages(sessionId)).toEqual([]);
  expect(await store.getInteraction(row.interaction_id)).toBeNull();
  expect(await store.getInteraction("legacy-open")).toBeNull();
  expect(await events()).toEqual([]);
  expect(await store.get("other")).toEqual(other);
  expect(await store.listDomainEvents("other")).toEqual([otherEvent]);
});
