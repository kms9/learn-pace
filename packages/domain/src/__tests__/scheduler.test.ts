import { describe, expect, it } from "vitest";
import { createKnowledgePoint, createLearningEvidence, createLearningModule, createLearningProgress } from "../models.js";
import { objectiveReport } from "../policy.js";
import { bindBuiltinReviewStrategy } from "../review-strategy.js";
import {
  INTERVAL_SEQUENCES,
  SpacedRepetitionScheduler,
  validateDesiredRetention,
} from "../scheduler.js";

describe("SpacedRepetitionScheduler (DeepTutor scheduler.py parity)", () => {
  const scheduler = new SpacedRepetitionScheduler();
  const T0 = 1_700_000_000;

  it("matches upstream default interval sequences", () => {
    expect(INTERVAL_SEQUENCES.memory).toEqual([0, 1, 3, 7, 14, 30, 60]);
    expect(INTERVAL_SEQUENCES.concept).toEqual([3, 7, 14, 30]);
    expect(INTERVAL_SEQUENCES.procedure).toEqual([3, 7, 14]);
    expect(INTERVAL_SEQUENCES.design).toEqual([14, 28]);
  });

  it("computes initial state for memory (same-day) and design (14 days)", () => {
    const mem = scheduler.getInitialState("memory", { now: T0 });
    expect(mem.interval_index).toBe(0);
    expect(mem.next_review_at).toBeCloseTo(T0, 6);
    expect(mem.difficulty).toBe(0.3);

    const design = scheduler.getInitialState("design", { now: T0 });
    expect(design.interval_index).toBe(0);
    expect(design.next_review_at).toBeCloseTo(T0 + 14 * 86400, 3);
    expect(design.difficulty).toBe(0.6);
  });

  it("does not inflate stability on immediate same-session repetition", () => {
    const state = scheduler.getInitialState("memory", { now: T0 });
    scheduler.scheduleNext(state, "memory", true, T0);
    const stability1 = state.stability;
    const due1 = state.next_review_at;

    scheduler.scheduleNext(state, "memory", true, T0 + 60);
    expect(state.stability).toBe(stability1);
    expect(state.next_review_at).toBe(due1);
    expect(state.review_count).toBe(2);
    expect(state.lapse_count).toBe(0);
  });

  it("extends interval on due-time success and retreats stability on failure", () => {
    const state = scheduler.getInitialState("memory", { now: T0 });
    scheduler.scheduleReview(
      state,
      "memory",
      createLearningEvidence({
        knowledge_point_id: "kp1",
        assessment_type: "review",
        result: "correct",
        quality: 1.0,
        timestamp: T0,
      }),
    );
    const s1 = state.stability;
    const due1 = state.next_review_at;
    expect(due1).toBeGreaterThan(T0);

    // Succeed when due
    scheduler.scheduleReview(
      state,
      "memory",
      createLearningEvidence({
        knowledge_point_id: "kp1",
        assessment_type: "review",
        result: "correct",
        quality: 1.0,
        timestamp: due1,
      }),
    );
    expect(state.stability).toBeGreaterThan(s1);
    expect(state.next_review_at).toBeGreaterThan(due1);

    // Fail when due again -> lapse + shorter stability & scheduled_after_failure
    const s2 = state.stability;
    const due2 = state.next_review_at;
    scheduler.scheduleReview(
      state,
      "memory",
      createLearningEvidence({
        knowledge_point_id: "kp1",
        assessment_type: "review",
        result: "incorrect",
        quality: 0.0,
        timestamp: due2,
      }),
    );
    expect(state.lapse_count).toBe(1);
    expect(state.scheduled_after_failure).toBe(true);
    expect(state.stability).toBeLessThan(s2);
  });

  it("projects zero risk before the last review without moving stored timestamps", () => {
    const day = 86_400;
    const state = scheduler.getInitialState("procedure", { now: T0 });
    scheduler.scheduleNext(state, "procedure", true, T0);
    state.next_review_at = T0 + 3 * day;
    state.lapse_count = 1;
    const point = createKnowledgePoint({ id: "kp", name: "约分", module_id: "mod", type: "procedure" });
    const module = createLearningModule({ id: "mod", name: "分数", order: 0, knowledge_points: [point] });
    const progress = createLearningProgress({ book_id: "path", modules: [module],
      knowledge_types: { kp: "procedure" }, repetition_states: { kp: state } });
    progress.review_queue = scheduler.buildReviewQueue(progress, T0);
    const before = structuredClone(progress);
    const backwards = T0 - 2 * day;
    expect(scheduler.retrievability(state, backwards)).toBe(1);
    expect(scheduler.forgettingRisk(state, progress, "kp", backwards)).toBe(0);
    expect(progress.review_queue[0]?.forgetting_risk).toBeGreaterThan(0);
    expect(objectiveReport(progress, "kp", backwards)?.review?.forgetting_risk).toBe(0);
    expect(scheduler.getDueTasks(progress, 5, backwards)).toEqual([]);
    expect(scheduler.getDueTasks(progress, 5, T0 + 4 * day)).toMatchObject([{ due_at: T0 + 3 * day }]);
    expect(progress).toEqual(before);
  });

  it("keeps the review anchor after backward time and distinguishes a same-session success from a lapse", () => {
    const state = scheduler.getInitialState("procedure", { now: T0 });
    scheduler.scheduleNext(state, "procedure", true, T0);
    const before = { ...state };
    const backwards = T0 - 2 * 86_400;
    scheduler.scheduleNext(state, "procedure", true, backwards);
    expect(state).toMatchObject({ last_review_at: T0, last_scheduled_at: T0, review_count: before.review_count + 1,
      stability: before.stability, next_review_at: before.next_review_at, lapse_count: before.lapse_count });

    scheduler.scheduleNext(state, "procedure", false, backwards);
    expect(state).toMatchObject({ last_review_at: T0, last_scheduled_at: T0, review_count: before.review_count + 2,
      lapse_count: before.lapse_count + 1, scheduled_after_failure: true });
    expect(state.stability).toBeGreaterThan(0);
    expect(state.stability).toBeLessThan(before.stability);
    expect(state.next_review_at).toBeGreaterThan(T0);
    expect(state.next_review_at).toBeLessThan(before.next_review_at);
    expect(Object.values(state).filter((value) => typeof value === "number").every(Number.isFinite)).toBe(true);
  });

  it("replays evidence deterministically and builds sorted review queue", () => {
    const events = [
      createLearningEvidence({
        evidence_id: "e1",
        knowledge_point_id: "kp1",
        assessment_type: "review",
        result: "correct",
        quality: 1.0,
        timestamp: T0,
      }),
      createLearningEvidence({
        evidence_id: "e2",
        knowledge_point_id: "kp1",
        assessment_type: "review",
        result: "incorrect",
        quality: 0.0,
        timestamp: T0 + 2 * 86400,
      }),
    ];
    const replayed = scheduler.replay("memory", events);
    expect(replayed.review_count).toBe(2);
    expect(replayed.lapse_count).toBe(1);

    const progress = createLearningProgress({
      book_id: "p1",
      knowledge_types: { kp1: "memory" },
      repetition_states: { kp1: replayed },
      learning_evidence: events,
    });
    const queue = scheduler.buildReviewQueue(progress, T0 + 10 * 86400);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.evidence_id).toBe("e2");
    expect(queue[0]!.forgetting_risk).toBeGreaterThan(0.5);
  });

  it("validates desired retention range", () => {
    expect(validateDesiredRetention(0.9)).toBe(0.9);
    expect(() => validateDesiredRetention(0.5)).toThrow(RangeError);
    expect(() => validateDesiredRetention(1.0)).toThrow(RangeError);
  });

  it("binds a built-in strategy, reschedules from the existing anchor, and preserves evidence on reset", () => {
    const state = scheduler.getInitialState("procedure", { now: T0 });
    scheduler.scheduleNext(state, "procedure", true, T0);
    const original = createLearningProgress({ book_id: "path", knowledge_types: { kp: "procedure" }, repetition_states: { kp: state } });
    const before = state.next_review_at;
    const exam = bindBuiltinReviewStrategy(original, "preset-exam-cramming", T0 + 60);
    expect(exam.review_strategy).toMatchObject({ template_id: "preset-exam-cramming", bound_at: T0 + 60 });
    expect(exam.desired_retention).toBe(0.95);
    expect(exam.review_queue[0]!.due_at).toBeLessThan(before);
    expect(exam.repetition_states.kp).toMatchObject({ last_scheduled_at: T0, review_count: 1 });
    expect(original.repetition_states.kp!.next_review_at).toBe(before);

    const unbound = bindBuiltinReviewStrategy(exam, null, T0 + 120);
    expect(unbound.review_strategy).toBeNull();
    expect(unbound.desired_retention).toBe(0.95);
    expect(unbound.review_queue[0]!.due_at).toBeGreaterThan(exam.review_queue[0]!.due_at);
    expect(() => bindBuiltinReviewStrategy(original, "unknown", T0)).toThrow(RangeError);
  });
});
