import {
  applyGrade, createKnowledgePoint, createLearningModule, createLearningProgress, derivePathStatus,
  recordQualitativeAssessment, schedulerForProgress, type KnowledgeType,
} from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type Clock } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, LearningHomeService } from "../index.js";

const path = "path";
const start = 1_700_000_000;
const day = 86_400;
const correct = { result: "correct" as const, confidence: 1, feedback: "符合答案" };
const modelReply = (value = "我会根据复习状态继续。") => completion([text(value)]);
const useTool = (name: string, args: Record<string, unknown>) => completion([toolCall(name, args)], "tool_calls");

class FakeClock implements Clock {
  time = start;
  nowSeconds() { return this.time; }
  advance(seconds: number) { this.time += seconds; }
}

async function prepare(definitions: { id: string; name: string; type: KnowledgeType; mastered: boolean }[]) {
  let serial = 0;
  const clock = new FakeClock();
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => modelReply());
  const app = new AppBootstrapService(store, secrets, { makeId: () => `generated-${++serial}`, fetch });
  await app.saveModelSettings(modelConfig);
  const mastery = app.createMasterySessionService(clock);
  const points = definitions.map(({ id, name, type }) => createKnowledgePoint({ id, name, type, module_id: "mod" }));
  let progress = createLearningProgress({ book_id: path, name: "分数", modules: [createLearningModule({
    id: "mod", order: 0, name: "分数", objective: "用分数解决问题", knowledge_points: points,
  })], knowledge_types: Object.fromEntries(points.map(({ id, type }) => [id, type])) });
  const scheduler = schedulerForProgress(progress);
  for (const { id, type, mastered } of definitions) {
    if (!mastered) continue;
    const base = { knowledge_point_id: id, learner_answer: "已有作答", session_id: "earlier-study", turn_id: `learn-${id}`, verdict: correct };
    if (type === "concept" || type === "design") {
      progress = recordQualitativeAssessment(progress, { ...base, evidence_id: `earlier-${id}`, model_id: "test" }, scheduler, clock.time);
    } else {
      for (let i = 0; i < 3; i++) progress = applyGrade(progress, { ...base,
        question_id: `learn-${id}-${i}`, evidence_id: `earlier-${id}-${i}` }, scheduler, clock.time);
    }
  }
  await store.save(progress, derivePathStatus(progress));
  const send = (session: string, value: string) => mastery.send(path, session, value);
  const push = (...responses: Response[]) => responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  const quiz = (id: string) => useTool("mastery_quiz", { knowledge_point_id: id, question: "把四分之二化到最简",
    question_type: "choice", options: ["1/2", "1/4", "2/3"], expected_answer: "1/2" });
  const post = async (session: string, objective: string) => {
    push(quiz(objective));
    const reply = await send(session, "请对这个知识点出一道题");
    expect(reply.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_quiz", code: "ok" }] });
    return (await store.getOpenInteraction(path))!;
  };
  const answer = async (session: string, objective: string, passes: boolean, assisted = false) => {
    const row = await post(session, objective);
    if (assisted) await store.updateInteraction({ ...row, question: { ...row.question, assistance_used: true } });
    const option = row.question.options.find(({ label }) => (label === row.question.expected_answer) === passes)!;
    await mastery.submitAnswer(path, session, row.interaction_id, { [row.question.question_id]: option.label });
    clock.advance(3);
  };
  const request = (index: number) => JSON.parse(String(fetch.mock.calls.at(index)?.[1]?.body));
  return { clock, store, mastery, send, push, answer, quiz, request, read: async () => (await store.get(path))! };
}

const procedure = { id: "a", name: "约分", type: "procedure", mastered: true } as const;

it("starts a review with the selected path's due objectives when multiple paths have reviews", async () => {
  const { mastery, store, clock, read } = await prepare([
    procedure, { ...procedure, id: "b", name: "通分" }, { ...procedure, id: "c", name: "分数比较" },
  ]);
  const progress = await read();
  const module = progress.modules[0]!;
  await store.save({ ...progress, modules: [{ ...module, knowledge_points: module.knowledge_points.slice(0, 1) }] });
  await store.save({ ...progress, book_id: "other", name: "比较分数",
    modules: [{ ...module, knowledge_points: module.knowledge_points.slice(1) }] });
  clock.time = Math.max(...Object.values(progress.repetition_states).map(({ next_review_at }) => next_review_at)) + 1;
  const topics = await mastery.listTopics();
  expect(topics.map(({ id, dueCount }) => [id, dueCount])).toEqual([["other", 2], [path, 1]]);
  const { session, opening } = await mastery.startReview("other");
  await opening;
  expect(session.path_id).toBe("other");
  expect((await store.listMessages(session.session_id))[0]?.content).toBe("我们来复习今天到期的这几项：通分、分数比较。");
  expect(await store.listSessionsByPath(path)).toEqual([]);
});

it("gates both review tools by mastery, admits self-reports without a due slot, and does not open again on manual switch", async () => {
  const { mastery, store, push, send, quiz, read, request } = await prepare([
    { ...procedure, mastered: false }, { id: "b", name: "等值分数", type: "concept", mastered: false },
  ]);
  const manual = await mastery.createSession(path, "study");
  await mastery.switchMode(path, manual.session_id, "review");
  expect(await store.listMessages(manual.session_id)).toEqual([]);
  push(quiz("a"));
  const refusal = await send(manual.session_id, "请出一道题");
  expect(refusal.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_quiz", code: "rejected" }] });
  expect(request(-1).messages.at(-1).content).toContain("复习只考已经掌握的知识点");
  expect(await store.getOpenInteraction(path)).toBeNull();
  push(useTool("mastery_assess", { knowledge_point_id: "b" }));
  const concept = await send(manual.session_id, "等值分数表示相同的值。");
  expect(concept.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_assess", code: "rejected" }] });
  expect((await read()).learning_evidence).toEqual([]);

  await mastery.setObjectiveMastery(path, "a", true);
  const open = await mastery.startReview(path);
  await open.opening;
  expect((await store.listMessages(open.session.session_id))[0]?.content).toBe("我们来复习一下我已经学过的内容。");
  expect((await mastery.reviewPlan(path)).due).toHaveLength(0);
  push(quiz("a"));
  const accepted = await send(open.session.session_id, "把我掌握过的都考一遍");
  expect(accepted.metadata?.runtime).toMatchObject({ tools: [{ name: "mastery_quiz", code: "ok" }] });
});

it("projects due and upcoming items against the same clock, opens at the due scope, and summarizes only completed review work", async () => {
  const { mastery, store, clock, answer, send, push, request, read } = await prepare([procedure,
    { ...procedure, id: "b", name: "通分" }, { ...procedure, id: "c", name: "比较分数" },
  ]);
  expect((await mastery.reviewPlan(path)).upcoming).toHaveLength(3);
  const upcoming = await mastery.createSession(path, "review");
  expect((await mastery.openSession(path, upcoming.session_id)).status.reviews.upcoming).toHaveLength(3);
  const dueAt = (await mastery.reviewPlan(path)).upcoming[0]!.due_at;
  clock.advance(Math.ceil(dueAt - start) + 1);
  expect((await mastery.listTopics())[0]?.dueReviews).toBe(3);
  const { session, opening } = await mastery.startReview(path);
  expect(session.mode).toBe("review");
  await opening;
  expect((await store.listMessages(session.session_id))[0]?.content).toBe("我们来复习今天到期的这几项：约分、通分、比较分数。");
  const targeted = await mastery.startReview(path, "b");
  await targeted.opening;
  expect((await store.listMessages(targeted.session.session_id))[0]?.content).toBe("我们来复习今天到期的这几项：通分。");

  await answer(session.session_id, "a", true);
  push(modelReply("本次约分复习答对。通分和比较分数留待下次。"));
  await send(session.session_id, "今天先复习到这里，请帮我总结");
  const topic = await mastery.openSession(path, session.session_id);
  expect(topic.status.reviews.due.map(({ knowledge_point_id }) => knowledge_point_id)).toEqual(["b", "c"]);
  expect(topic.status.reviews.reviewed).toMatchObject([{ knowledge_point_id: "a", results: ["correct"],
    next_review_at: (await read()).repetition_states.a!.next_review_at }]);
  expect(request(-1).messages[0].content).toContain("复习告一段落或学习者想结束时");
  expect(request(-1).messages[0].content).toContain('"reviewed":[{"knowledge_point_id":"a"');
});

it("extends a due review once, drops a failed objective and restores it after five independent answers", async () => {
  const { mastery, clock, answer, read, store } = await prepare([procedure]);
  const home = new LearningHomeService(store, clock);
  const before = (await read()).repetition_states.a!;
  clock.advance(Math.ceil(before.next_review_at - start) + 1);
  const review = await mastery.createSession(path, "review");
  async function expectConsistentProgress(mastered: number, dueCount: number) {
    const [homeScreen, list, detail, session] = await Promise.all([
      home.read(), mastery.listTopics(), mastery.readTopic(path), mastery.openSession(path, review.session_id),
    ]);
    const expected = { mastered, total: 1, percentage: mastered * 100, dueCount };
    for (const summary of [homeScreen.records[0], list[0], detail.summary, session.status.summary]) {
      expect(summary).toMatchObject(expected);
    }
    expect(homeScreen.records[0]?.next).toEqual(detail.next);
    expect(list[0]?.next).toEqual(session.status.next);
  }
  await expectConsistentProgress(1, 1);
  await answer(review.session_id, "a", true);
  const first = (await read()).repetition_states.a!;
  expect(first.next_review_at).toBeGreaterThan(before.next_review_at);
  await answer(review.session_id, "a", true);
  expect((await read()).repetition_states.a).toMatchObject({ next_review_at: first.next_review_at, stability: first.stability });

  expect((await mastery.readTopic(path)).status).toBe("completed");
  await answer(review.session_id, "a", false);
  const failed = await read();
  expect(failed.repetition_states.a).toMatchObject({ lapse_count: 1, scheduled_after_failure: true });
  expect(failed.mastery_levels.a).toBeCloseTo(0.75);
  expect(failed.error_records).toMatchObject([{ knowledge_point_id: "a", error_type: "application" }]);
  const next = await mastery.readTopic(path);
  expect(next.status).toBe("active");
  expect(next.next).toMatchObject({ knowledge_point_id: "a", status: "learning" });
  expect(next.reviewPlan.upcoming).toHaveLength(0);
  await expectConsistentProgress(0, 0);

  const study = await mastery.createSession(path, "study");
  for (let i = 0; i < 5; i++) await answer(study.session_id, "a", true);
  const recovered = await read();
  expect(recovered.mastery_levels.a).toBe(1);
  expect(recovered.repetition_states.a!.next_review_at).toBe(failed.repetition_states.a!.next_review_at);
  expect((await mastery.readTopic(path)).status).toBe("completed");
  clock.time = Math.ceil(recovered.repetition_states.a!.next_review_at) + 1;
  expect((await mastery.reviewPlan(path)).due).toMatchObject([{ knowledge_point_id: "a", lapse_count: 1 }]);
});

it("caps assisted success at 0.6 and grows stability less than independent success", async () => {
  const { mastery, clock, answer, read } = await prepare([procedure, { ...procedure, id: "b", name: "通分" }]);
  clock.time = Math.ceil((await read()).repetition_states.a!.next_review_at) + 1;
  const { session_id } = await mastery.createSession(path, "review");
  await answer(session_id, "a", true, true);
  expect((await read()).learning_evidence.at(-1)).toMatchObject({ quality: 0.6 });
  expect((await read()).mastery_levels.a).toBe(1);
  await answer(session_id, "b", true);
  const { a, b } = (await read()).repetition_states;
  expect(a!.stability).toBeLessThan(b!.stability);
});

it("revokes qualitative mastery on a final partial review without adding a lapse", async () => {
  const { mastery, clock, send, push, read } = await prepare([{ id: "b", name: "等值分数", type: "concept", mastered: true }]);
  clock.time = Math.ceil((await read()).repetition_states.b!.next_review_at) + 1;
  const { session_id } = await mastery.createSession(path, "review");
  push(useTool("mastery_assess", { knowledge_point_id: "b" }), modelReply(JSON.stringify({ result: "partial", confidence: 0.95, feedback: "解释还缺少比值不变" })));
  await send(session_id, "等值分数的写法不一样。");
  const progress = await read();
  expect(progress.qualitative_mastery.b).toBe(false);
  expect(progress.repetition_states.b!.lapse_count).toBe(0);
  expect(progress.learning_evidence.at(-1)).toMatchObject({ quality: 0.5, result: "partial" });
  expect((await mastery.readTopic(path)).status).toBe("active");
  expect((await mastery.reviewPlan(path)).due).toHaveLength(0);
});

it("reschedules a review plan when changing retention or binding a strategy", async () => {
  const { mastery } = await prepare([procedure]);
  const first = await mastery.reviewPlan(path);
  await mastery.setDesiredRetention(path, 0.95);
  const raised = await mastery.reviewPlan(path);
  expect(raised.desired_retention).toBe(0.95);
  expect(raised.upcoming[0]!.due_at).toBeLessThan(first.upcoming[0]!.due_at);
  await mastery.setReviewStrategy(path, "preset-science");
  const science = await mastery.reviewPlan(path);
  expect(science).toMatchObject({ strategy_id: "preset-science", desired_retention: 0.85 });
  expect(science.upcoming[0]!.due_at).toBeGreaterThan(raised.upcoming[0]!.due_at);
  await mastery.setReviewStrategy(path, null);
  expect(await mastery.reviewPlan(path)).toMatchObject({ strategy_id: null, desired_retention: 0.85 });
  await expect(mastery.setDesiredRetention(path, 1)).rejects.toThrow("70%–99%");
});
