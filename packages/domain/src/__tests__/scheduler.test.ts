import { describe, expect, it } from "vitest";
import { createLearningEvidence, createLearningProgress } from "../models.js";
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
});
