import { createKnowledgePoint, createLearningModule, createLearningProgress } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService } from "../index.js";

const proc = createKnowledgePoint({ id: "proc", name: "约分步骤", module_id: "module", type: "procedure" });
const concept = createKnowledgePoint({ id: "concept", name: "等值分数", module_id: "module", type: "concept" });
const prompt = { knowledge_point_id: "proc", question: "4/8 等于多少？", question_type: "choice",
  options: ["四分之一", "二分之一", "四分之三"], expected_answer: "二分之一", explanation: "分子分母同除以四。" };
const short = { knowledge_point_id: "proc", question: "把 4/8 化到最简", question_type: "short",
  expected_answer: "1/2", accepted_answers: ["0.5"], explanation: "私有解析" };
const call = (name: string, args: Record<string, unknown>, lead?: string) => completion(
  [...(lead ? [text(lead)] : []), toolCall(name, args)], "tool_calls",
);
const modelReply = () => completion([text("我会根据实际结果继续。")]);
const decision = (result: string, confidence: number) => completion([text(JSON.stringify({
  result, confidence, feedback: "依据", criteria_met: ["保持比值"],
}))]);

async function harness() {
  let serial = 0;
  let now = 100;
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => modelReply());
  const open = () => new AppBootstrapService(store, secrets, { makeId: () => "id-" + ++serial, fetch });
  const app = open();
  await app.saveModelSettings(modelConfig);
  const pathId = "path";
  await store.save(createLearningProgress({ book_id: pathId, modules: [createLearningModule({
    id: "module", order: 0, name: "分数", objective: "保持比值不变", knowledge_points: [proc, concept],
  })] }), "active");
  const mastery = app.createMasterySessionService({ nowSeconds: () => now });
  const { session_id: session } = await mastery.createSession(pathId, "study");
  const push = (...responses: Response[]) => responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  const send = (value: string, to = session) => mastery.send(pathId, to, value);
  const post = async (input: Record<string, unknown> = prompt) => {
    push(call("mastery_quiz", input, "先想想什么是最简形式。"));
    const reply = await send("请发一道题");
    expect(reply.status).toBe("committed");
    return (await store.getOpenInteraction(pathId))!;
  };
  const read = async () => (await store.get(pathId))!;
  const request = (i: number) => JSON.parse(String(fetch.mock.calls[i]![1]?.body));
  const submit = async (id: string, answers: Record<string, string>) =>
    mastery.submitAnswer(pathId, session, id, answers, `submission-${++serial}`);
  return { store, fetch, open, mastery, pathId, session, push, send, post, read, request, submit, advance: () => { now += 10; } };
}

it("finishes after saving a private quiz, holds the current card, and restores it from storage", async () => {
  const { store, open, mastery, post, pathId, session, fetch, push, send, request } = await harness();
  const first = await post(short);
  expect(fetch).toHaveBeenCalledTimes(1);
  const original = await mastery.openSession(pathId, session);
  expect(original.messages.at(-1)?.content).toBe("先想想什么是最简形式。");
  expect(original.status.next).toMatchObject({ action: "answer_pending", session_id: session });
  expect(original.cards[0]).toMatchObject({ status: "awaiting_input", question: { question_id: first.question.question_id } });
  expect(JSON.stringify(original)).not.toMatch(/expected_answer|accepted_answers|私有解析/);
  expect(JSON.stringify(original.cards)).not.toContain("1/2");

  push(call("mastery_quiz", prompt));
  const refused = await send("请再出一题");
  expect(refused.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_quiz", code: "rejected" }] });
  expect((await store.listInteractionsBySession(session))).toHaveLength(1);
  expect(request(2).messages.at(-1).content).toContain("已有未完成的题卡");

  const restored = open().createMasterySessionService();
  const count = fetch.mock.calls.length;
  expect((await restored.openSession(pathId, session)).cards).toEqual(original.cards);
  expect(fetch).toHaveBeenCalledTimes(count);
});

it("refuses study tools in outline, and retains ordinary questions as questions", async () => {
  const { mastery, pathId, post, push, send, store } = await harness();
  const outline = await mastery.createSession(pathId, "outline");
  push(call("mastery_quiz", prompt));
  const refused = await send("出题", outline.session_id);
  expect(refused.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_quiz", code: "wrong_mode" }] });
  expect(await store.getOpenInteraction(pathId)).toBeNull();
  const question = await post();
  push(call("mastery_grade", { answer: "B" }));
  const follow = await send("等等，为什么是 B？");
  expect(follow.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_grade", code: "rejected" }] });
  expect(await store.getInteraction(question.interaction_id)).toMatchObject({ status: "awaiting_input", raw_answer: null });
});

it("stores a choice grade and publishes its receipt before any tutor request", async () => {
  const { store, mastery, pathId, session, post, fetch, submit, read, request, open } = await harness();
  const row = await post();
  const q = row.question;
  let toolFetchObserved = false;
  fetch.mockImplementationOnce(async () => {
    const current = await store.getInteraction(row.interaction_id);
    expect(current).toMatchObject({ status: "graded", raw_answer: q.expected_answer,
      grade: { questions: { [q.question_id]: { result: "correct", final: true } } } });
    expect((await read()).mastery_levels.proc).toBe(0.5);
    toolFetchObserved = true;
    return modelReply();
  });
  await submit(row.interaction_id, { [q.question_id]: q.expected_answer });
  expect(toolFetchObserved).toBe(true);
  expect(request(1).messages[0].content).toContain("引擎的批改结果");
  const loaded = await mastery.openSession(pathId, session);
  expect(loaded.messages.find(({ metadata }) => metadata?.mastery_answer)?.content).toBe(q.expected_answer + ". 二分之一");
  expect(loaded.cards[0]?.grade).toMatchObject({ questions: { [q.question_id]: { explanation: prompt.explanation } } });
  expect((await open().createMasterySessionService().openSession(pathId, session)).cards).toEqual(loaded.cards);
});

it("retains low-confidence text for editing and failed text for regrading", async () => {
  const { mastery, pathId, session, store, post, push, read, submit, fetch } = await harness();
  const row = await post(short);
  const id = row.interaction_id;
  const key = row.question.question_id;
  let sawSaved = false;
  fetch.mockImplementationOnce(async () => {
    expect(await store.getInteraction(id)).toMatchObject({ status: "answered", raw_answer: "一半" });
    sawSaved = true;
    return decision("partial", 0.62);
  });
  await submit(id, { [key]: "一半" });
  expect(sawSaved).toBe(true);
  expect(await store.getInteraction(id)).toMatchObject({ status: "awaiting_input", raw_answer: "一半",
    grade: { questions: { [key]: { result: "ungraded", final: false } } } });
  expect((await read()).quiz_attempts).toEqual([]);

  push(new Response("fixture", { status: 500 }), modelReply());
  await submit(id, { [key]: "分成两份取一份" });
  expect(await store.getInteraction(id)).toMatchObject({ status: "answered", raw_answer: "分成两份取一份",
    grade: { grading_failed: true } });
  expect((await read()).learning_evidence).toEqual([]);
  push(decision("correct", 0.95), modelReply());
  await mastery.retryAnswer(pathId, session, id);
  expect(await store.getInteraction(id)).toMatchObject({ status: "graded",
    grade: { questions: { [key]: { final: true, result: "correct" } } } });
  expect((await read()).learning_evidence).toHaveLength(1);
});

it("supports partial in-chat group answers and scores only remaining leaves on card submission", async () => {
  const { store, post, push, send, read, submit } = await harness();
  const { knowledge_point_id: _point, ...leaf } = short;
  const row = await post({ knowledge_point_id: "proc", question: "请解两小题", question_type: "group", questions: [
    leaf, { ...leaf, question: "6/12 约分", expected_answer: "1/2" },
  ] });
  const [first, second] = row.question.questions.map(({ question_id }) => question_id);
  push(call("mastery_grade", { answers: { [first!]: "1/2" } }));
  await send("第一小题是 1/2");
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({ status: "awaiting_input",
    raw_answer: JSON.stringify({ [first!]: "1/2" }), grade: { questions: { [first!]: { result: "correct", final: true } } } });
  expect((await read()).learning_evidence).toHaveLength(1);
  await submit(row.interaction_id, { [second!]: "1/2" });
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({ status: "graded" });
  expect((await read()).learning_evidence.map(({ evidence_id }) => evidence_id))
    .toEqual([row.interaction_id + ":" + first, row.interaction_id + ":" + second]);
});

it("assesses the learner's original explanation, merges undecided context and ignores passed", async () => {
  const { mastery, pathId, push, send, read, request } = await harness();
  push(call("mastery_assess", { knowledge_point_id: "concept", passed: true }), decision("partial", 0.6), modelReply());
  await send("两个分数表示同一个数");
  expect((await read()).qualitative_mastery).toEqual({});
  expect((await read()).learning_evidence).toHaveLength(0);
  push(call("mastery_assess", { knowledge_point_id: "concept", passed: false }), decision("correct", 0.95), modelReply());
  await send("分子分母同乘非零数时，比值保持不变");
  const combined = "两个分数表示同一个数\n分子分母同乘非零数时，比值保持不变";
  expect(JSON.parse(request(4).messages.at(-1).content)).toMatchObject({ learner_answer: combined });
  expect((await read()).qualitative_mastery).toEqual({ concept: true });
  const evidence = await mastery.objectiveEvidence(pathId, "concept");
  expect(evidence.qualitative).toMatchObject([{ answer: combined, criteria: ["保持比值"], model: "deepseek-v4.1-flash", result: "correct" }]);
});

it("reports the unchanged mastery gate for a correct assisted explanation", async () => {
  const { store, post, push, submit, read, request } = await harness();
  const row = await post({ ...short, knowledge_point_id: "concept" });
  await store.updateInteraction({ ...row, question: { ...row.question, assistance_used: true } });
  push(call("mastery_assess", { knowledge_point_id: "concept" }), decision("correct", 0.95), modelReply());
  await submit(row.interaction_id, { [row.question.question_id]: "1/2" });
  expect((await read()).qualitative_mastery).toEqual({});
  expect((await read()).learning_evidence.at(-1)).toMatchObject({ assessment_type: "qualitative", quality: 0.6 });
  expect(JSON.parse(request(3).messages.at(-1).content)).toMatchObject({ result: "correct", mastered: false });
});

it("validates delivered quotes and defers objectives with a next-objective fallback", async () => {
  const { mastery, session, pathId, push, send, read } = await harness();
  const quote = "分子和分母同除以同一个数。";
  push(call("mastery_note_explained", { knowledge_point_id: "proc", summary: "约分", explanation_quote: "未展示" }, quote),
    call("mastery_note_explained", { knowledge_point_id: "proc", summary: "约分", explanation_quote: quote }));
  const note = await send("讲讲约分");
  expect(note.metadata?.runtime).toMatchObject({ tools: [{ code: "rejected" }, { code: "ok" }] });
  expect(await read()).toMatchObject({ explained_objectives: { proc: { explanation_quote: quote, coverage: "partial" } }, mastery_levels: {} });
  push(call("mastery_defer_objective", { knowledge_point_id: "proc" }));
  await send("先略过约分知识点");
  expect((await mastery.openSession(pathId, session)).status.next.knowledge_point_id).toBe("concept");
  push(call("mastery_defer_objective", { knowledge_point_id: "concept" }));
  await send("也暂时略过等值分数");
  expect((await mastery.openSession(pathId, session)).status.next).toMatchObject({ knowledge_point_id: "proc", action: "probe" });
  expect((await mastery.readTopic(pathId)).status).toBe("active");
});

it("abandons a skipped card, regrades a challenged answer, and voids the resulting evidence", async () => {
  const { mastery, pathId, session, store, push, post, submit, read } = await harness();
  const skipped = await post();
  await mastery.skipQuestion(pathId, session, skipped.interaction_id);
  expect(await store.getInteraction(skipped.interaction_id)).toMatchObject({ status: "abandoned", raw_answer: null });
  expect((await store.listMessages(session)).at(-2)?.content).toBe("跳过这道题吧。");
  expect((await read()).quiz_attempts).toEqual([]);

  const row = await post();
  const { question_id, expected_answer, options } = row.question;
  const choice = options.find(({ label }) => label !== expected_answer)!;
  await submit(row.interaction_id, { [question_id]: choice.label });
  expect((await mastery.objectiveEvidence(pathId, "proc")).errors[0]).toMatchObject({ error_type: "application", status: "active" });
  push(call("mastery_repair_question", { action: "correct", reason: "题目应以修改后的条件为准", expected_answer: choice.body }));
  await mastery.challengeQuestion(pathId, session, row.interaction_id, "请复核这道题");
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({
    question: { expected_answer: choice.label }, grade: { questions: { [question_id]: { result: "correct" } } },
  });
  expect((await read()).quiz_attempts).toMatchObject([{ result: "correct", user_answer: choice.label }]);

  push(call("mastery_repair_question", { action: "void", reason: "题干有误" }));
  await mastery.challengeQuestion(pathId, session, row.interaction_id, "请复核题干");
  expect((await read()).learning_evidence).toEqual([]);
  expect((await read()).quiz_attempts[0]).toMatchObject({ voided: true, void_reason: "题干有误" });
  expect(await store.getInteraction(row.interaction_id)).toMatchObject({ status: "abandoned" });
});

it("reflects reversible self-reported mastery in path status and next objective", async () => {
  const { mastery, pathId, session, read } = await harness();
  await mastery.setObjectiveMastery(pathId, "proc", true, "已会");
  expect((await mastery.openSession(pathId, session)).status.next.knowledge_point_id).toBe("concept");
  await mastery.setObjectiveMastery(pathId, "concept", true);
  expect((await mastery.readTopic(pathId)).status).toBe("completed");
  expect((await mastery.objectiveEvidence(pathId, "concept")).mastery_source).toBe("learner");
  expect((await read()).learning_evidence).toEqual([]);
  await mastery.setObjectiveMastery(pathId, "proc", false);
  expect((await mastery.readTopic(pathId)).status).toBe("active");
  expect((await mastery.objectiveEvidence(pathId, "proc")).mastery_source).toBe("");
});
