import {
  applyGrade, createKnowledgePoint, createLearningModule, createLearningProgress, createPendingQuestion,
  schedulerForProgress, SpacedRepetitionScheduler,
} from "@learn-pace/domain";
import { MemoryAppStore, type Clock } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { LearningHomeService, MasterySessionService } from "../index.js";

const day = 86_400;
const epoch = Date.parse("2026-03-07T18:00:00-07:00") / 1000;
const pathId = "fraction-review";
const names: Record<string, string> = { a: "约分", b: "通分", c: "比较分数" };

class FakeClock implements Clock {
  private time = epoch;
  nowSeconds() { return this.time; }
  setDay(days: number) { this.time = epoch + days * day; }
  setTime(timestamp: number) { this.time = timestamp; }
}

async function setup(ids: string[], stagger = false) {
  const store = new MemoryAppStore();
  const clock = new FakeClock();
  let id = 0;
  const makeId = () => `id-${++id}`;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => completion([text("本轮结束，按复习计划继续。")]));
  const points = ids.map((id) => createKnowledgePoint({ id, name: names[id]!, module_id: "fractions", type: "procedure" }));
  let progress = createLearningProgress({ book_id: pathId, name: "分数", modules: [createLearningModule({
    id: "fractions", name: "分数", order: 0, knowledge_points: points,
  })], knowledge_types: Object.fromEntries(ids.map((id) => [id, "procedure"])) });
  const scheduler = schedulerForProgress(progress);
  for (const [position, point] of points.entries()) {
    const learned = epoch + (stagger ? 4 * position * day : 0);
    for (let i = 0; i < 3; i++) {
      const evidenceId = `seed-${point.id}-${i}`;
      progress = applyGrade(progress, { question_id: evidenceId, evidence_id: evidenceId, knowledge_point_id: point.id,
        learner_answer: "1/2", session_id: "historical-study", turn_id: evidenceId,
        verdict: { result: "correct", confidence: 1, feedback: "符合答案" },
      }, scheduler, learned);
    }
    if (!stagger) {
      const state = progress.repetition_states[point.id]!;
      state.next_review_at = epoch + 3 * day;
      state.stability = SpacedRepetitionScheduler.stabilityFromInterval(3, 0.9);
    }
  }
  progress.review_queue = scheduler.buildReviewQueue(progress, epoch);
  await store.save(progress, "completed");
  const mastery = new MasterySessionService(store, clock, makeId, async () => modelConfig, fetch);
  const home = new LearningHomeService(store, clock);
  const read = async () => (await store.get(pathId))!;
  const grade = async (session: string, pointId: string, correct: boolean) => {
    const id = makeId();
    await store.insertInteraction({ interaction_id: id, path_id: pathId, session_id: session, turn_id: makeId(),
      status: "awaiting_input", raw_answer: null, submission_id: null, updated_at: clock.nowSeconds(),
      question: createPendingQuestion({ question_id: id, knowledge_point_id: pointId, module_id: "fractions",
        question_type: "choice", expected_answer: "A", options: [{ label: "A", body: "1/2" }, { label: "B", body: "1/4" }] }) });
    const answer = await mastery.submitAnswer(pathId, session, id, { [id]: correct ? "A" : "B" }, makeId());
    expect(answer).toMatchObject({ kind: "turn", message: { status: "committed" } });
  };
  const project = async (session: string, expectedDue: string[], mastered: number) => {
    const [landing, records, details, thread] = await Promise.all([
      home.read(), mastery.listTopics(), mastery.readTopic(pathId), mastery.openSession(pathId, session),
    ]);
    for (const view of [landing.records[0], records[0], details.summary, thread.status.summary]) {
      expect(view).toMatchObject({ dueCount: expectedDue.length, mastered, total: ids.length });
    }
    expect(details.reviewPlan.due.map((task) => task.knowledge_point_id)).toEqual(expectedDue);
    expect(thread.status.reviews.due.map((task) => task.knowledge_point_id)).toEqual(expectedDue);
    return { details, thread };
  };
  return { clock, read, mastery, fetch, grade, project, store };
}

it("keeps a 30-day timeline stable across ordered reviews, repeated grading, remediation and plan changes", async () => {
  const { clock, mastery, read, grade, project, store } = await setup(["a", "b", "c"], true);
  const schedule = async () => Object.fromEntries(Object.entries((await read()).repetition_states).map(([id, state]) => [id, {
    dueInHours: Math.round((state.next_review_at - epoch) / 36) / 100,
    stability: Math.round(state.stability * 10_000) / 10_000,
    lapseCount: state.lapse_count,
  }]));
  const initial = await schedule();
  const { session_id: review } = await mastery.createSession(pathId, "review");
  clock.setDay(8);
  await project(review, ["a"], 3);
  await grade(review, "a", true);
  const first = (await read()).repetition_states.a!;
  clock.setTime(clock.nowSeconds() + 60);
  await grade(review, "a", true);
  expect((await read()).repetition_states.a).toMatchObject({ review_count: first.review_count + 1,
    next_review_at: first.next_review_at, stability: first.stability, lapse_count: 0 });

  clock.setDay(12);
  await project(review, ["b"], 3);
  clock.setDay(16);
  const beforeEnd = await read();
  await mastery.send(pathId, review, "今天先复习到这里，请帮我总结");
  const early = await project(review, ["b", "c"], 3);
  expect(early.thread.status.reviews.reviewed).toMatchObject([{ knowledge_point_id: "a", results: ["correct", "correct"] }]);
  expect(await read()).toEqual(beforeEnd);

  const { session, opening } = await mastery.startReview(pathId);
  await opening;
  expect((await store.listMessages(session.session_id))[0]?.content).toBe("我们来复习今天到期的这几项：通分、比较分数。");
  await grade(session.session_id, "b", false);
  const failed = (await read()).repetition_states.b!;
  expect(failed.lapse_count).toBe(1);
  expect(failed.stability).toBeLessThan(beforeEnd.repetition_states.b!.stability);
  await project(session.session_id, ["c"], 2);

  const { session_id: study } = await mastery.createSession(pathId, "study");
  for (let i = 0; i < 5; i++) await grade(study, "b", true);
  expect((await read()).repetition_states.b).toMatchObject({ next_review_at: failed.next_review_at, lapse_count: 1 });
  await project(study, ["c"], 3);
  const repaired = await schedule();
  await mastery.setReviewStrategy(pathId, "preset-science");
  expect(await mastery.reviewPlan(pathId)).toMatchObject({ strategy_id: "preset-science", desired_retention: 0.85 });
  const strategy = await schedule();
  await mastery.setDesiredRetention(pathId, 0.95);
  expect(await mastery.reviewPlan(pathId)).toMatchObject({ strategy_id: "preset-science", desired_retention: 0.95 });
  const retained = await schedule();

  clock.setTime(Date.parse("2026-03-08T09:00:00+08:00") / 1000 + 30 * day);
  expect(clock.nowSeconds()).toBe(epoch + 30 * day);
  const finalDue = (await mastery.reviewPlan(pathId)).due.map(({ knowledge_point_id }) => knowledge_point_id);
  await project(study, finalDue, 3);
  expect({ initial, repaired, strategy, retained, finalDue }).toMatchInlineSnapshot(`
    {
      "finalDue": [
        "b",
        "c",
        "a",
      ],
      "initial": {
        "a": {
          "dueInHours": 150.19,
          "lapseCount": 0,
          "stability": 59.3961,
        },
        "b": {
          "dueInHours": 246.19,
          "lapseCount": 0,
          "stability": 59.3961,
        },
        "c": {
          "dueInHours": 342.19,
          "lapseCount": 0,
          "stability": 59.3961,
        },
      },
      "repaired": {
        "a": {
          "dueInHours": 600.16,
          "lapseCount": 0,
          "stability": 161.4146,
        },
        "b": {
          "dueInHours": 406.25,
          "lapseCount": 1,
          "stability": 17.5958,
        },
        "c": {
          "dueInHours": 342.19,
          "lapseCount": 0,
          "stability": 59.3961,
        },
      },
      "retained": {
        "a": {
          "dueInHours": 484.1,
          "lapseCount": 0,
          "stability": 161.4146,
        },
        "b": {
          "dueInHours": 394.83,
          "lapseCount": 1,
          "stability": 17.5958,
        },
        "c": {
          "dueInHours": 484.1,
          "lapseCount": 0,
          "stability": 59.3961,
        },
      },
      "strategy": {
        "a": {
          "dueInHours": 1117.5,
          "lapseCount": 0,
          "stability": 161.4146,
        },
        "b": {
          "dueInHours": 418.32,
          "lapseCount": 1,
          "stability": 17.5958,
        },
        "c": {
          "dueInHours": 1117.5,
          "lapseCount": 0,
          "stability": 59.3961,
        },
      },
    }
  `);
});

it.each([true, false])("projects backward time without writes and clamps an actual grade (correct=%s)", async (correct) => {
  const { clock, mastery, read, fetch, grade, project } = await setup(["a", "b"]);
  const { session_id: review } = await mastery.createSession(pathId, "review");
  const baseline = await read();
  const old = baseline.repetition_states.a!;
  clock.setDay(-2);
  const rollback = await project(review, [], 2);
  expect(rollback.details.reviewPlan.upcoming).toMatchObject([
    { knowledge_point_id: "a", forgetting_risk: 0, due_at: epoch + 3 * day, lapse_count: 0 },
    { knowledge_point_id: "b", forgetting_risk: 0, due_at: epoch + 3 * day, lapse_count: 0 },
  ]);
  expect(await read()).toEqual(baseline);
  expect(fetch).not.toHaveBeenCalled();

  await grade(review, "a", correct);
  const persisted = await read();
  const state = persisted.repetition_states.a!;
  expect(state).toMatchObject({ last_review_at: epoch, last_scheduled_at: epoch, review_count: old.review_count + 1 });
  expect(state.next_review_at).toBeGreaterThan(epoch);
  expect(Object.values(state).filter((v) => typeof v === "number").every(Number.isFinite)).toBe(true);
  if (correct) {
    expect(state).toMatchObject({ next_review_at: old.next_review_at, stability: old.stability, lapse_count: 0 });
  } else {
    expect(state).toMatchObject({ lapse_count: 1, scheduled_after_failure: true });
    expect(state.next_review_at).toBeLessThan(old.next_review_at);
    expect(state.stability).toBeLessThan(old.stability);
  }
  expect(persisted.repetition_states.b).toEqual(baseline.repetition_states.b);

  clock.setDay(4);
  await project(review, correct ? ["a", "b"] : ["b"], correct ? 2 : 1);
  expect(await read()).toEqual(persisted);
});
