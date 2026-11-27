import {
  applyGrade, createKnowledgePoint, createLearningModule, createLearningProgress, createPendingQuestion,
  schedulerForProgress, setLearnerMasteryOverride,
} from "@learn-pace/domain";
import { MemoryAppStore, type Clock } from "@learn-pace/infra";
import { expect, it } from "vitest";
import { LearningHomeService } from "../index.js";

class FakeClock implements Clock {
  time = 1_700_000_000;
  nowSeconds() { return this.time; }
}

function path(id: string, updatedAt: number) {
  return createLearningProgress({ book_id: id, name: `路径 ${id}`, updated_at: updatedAt,
    modules: [createLearningModule({ id: "module", name: "分数", order: 0, knowledge_points: [
      createKnowledgePoint({ id: "reduce", module_id: "module", name: "约分", type: "procedure" }),
      createKnowledgePoint({ id: "compare", module_id: "module", name: "比较", type: "procedure" }),
    ] })],
  });
}

function mastered(id: string, now: number) {
  let progress = path(id, now);
  const scheduler = schedulerForProgress(progress);
  for (let i = 0; i < 3; i++) progress = applyGrade(progress, {
    evidence_id: `e${i}`, question_id: `q${i}`, knowledge_point_id: "reduce", learner_answer: "1/2",
    session_id: "study", turn_id: `t${i}`, verdict: { result: "correct", confidence: 1, feedback: "正确" },
  }, scheduler, now);
  return setLearnerMasteryOverride(progress, "compare", true, "已会", now);
}

it("keeps all records in update order and limits attention with waiting sessions before due paths", async () => {
  const store = new MemoryAppStore();
  const clock = new FakeClock();
  const home = new LearningHomeService(store, clock);
  const due = mastered("due", clock.time);
  await store.save(due);
  await store.save({ ...due, book_id: "older-due", updated_at: clock.time - 1 });
  clock.time = due.repetition_states.reduce!.next_review_at + 1;
  for (let i = 0; i < 6; i++) {
    const id = String(i);
    await store.save(path(id, clock.time + i));
    await store.saveSession({ session_id: id, path_id: id, kind: "mastery", mode: "study", title: id,
      model_id: null, created_at: i, updated_at: i });
    await store.insertInteraction({ interaction_id: id, path_id: id, session_id: id, turn_id: id,
      status: i === 0 ? "graded" : i === 5 ? "answered" : "awaiting_input", raw_answer: null, submission_id: null,
      updated_at: i, question: createPendingQuestion({ question_id: id, prompt: `约分 ${id}\n是多少？`, knowledge_point_id: "reduce" }) });
  }
  const full = await home.read();
  expect(full.records.map(({ id }) => id)).toEqual(["5", "4", "3", "2", "1", "0", "due", "older-due"]);
  expect(full.attention.map((item) => item.path.id)).toEqual(["5", "4", "3", "2", "1"]);
  expect(full.attention[0]).toMatchObject({ kind: "question", sessionId: "5", prompt: "约分 5 是多少？", answered: true,
    path: { next: { action: "answer_pending", session_id: "5" } } });
  await store.markGraded("4", clock.time);
  expect((await home.read()).attention.at(-1)).toMatchObject({ kind: "review", path: { id: "due", dueCount: 1 } });
});

it("counts self-reported mastery and reflects a failed review against the same clock", async () => {
  const store = new MemoryAppStore();
  const clock = new FakeClock();
  const home = new LearningHomeService(store, clock);
  const progress = mastered("fractions", clock.time);
  await store.save(progress);
  expect((await home.read()).records[0]).toMatchObject({ mastered: 2, total: 2, percentage: 100, dueCount: 0, status: "completed" });
  clock.time = progress.repetition_states.reduce!.next_review_at + 1;
  expect((await home.read()).records[0]).toMatchObject({ dueCount: 1, next: { action: "review" } });
  const failed = applyGrade(progress, { evidence_id: "lapse", question_id: "review", knowledge_point_id: "reduce",
    learner_answer: "1/3", session_id: "review", turn_id: "review", verdict: { result: "incorrect", confidence: 1, feedback: "再试" },
  }, schedulerForProgress(progress), clock.time);
  await store.save(failed);
  expect(await home.read()).toMatchObject({ attention: [], records: [
    { mastered: 1, total: 2, percentage: 50, dueCount: 0, status: "active", next: { knowledge_point_id: "reduce" } },
  ] });
});

it("projects an empty home when there are no paths", async () => {
  expect(await new LearningHomeService(new MemoryAppStore(), new FakeClock()).read()).toEqual({ attention: [], records: [] });
});
