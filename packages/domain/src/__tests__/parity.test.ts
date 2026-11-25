import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeMastery } from "../mastery.js";
import { createLearningEvidence } from "../models.js";
import { SpacedRepetitionScheduler } from "../scheduler.js";

interface ParityFixture {
  upstream_commit: string;
  mastery_cases: Array<{ input: Array<boolean | number>; expected: number }>;
  scheduler_memory_trace: {
    t0: number;
    steps: Array<{
      label: string;
      moment: number;
      quality: number;
      stability: number;
      difficulty: number;
      next_review_at: number;
      review_count: number;
      lapse_count: number;
      scheduled_after_failure: boolean;
    }>;
  };
}

const fixturePath = resolve(
  __dirname,
  "../../../../tools/parity/fixtures/deeptutor-1284116.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as ParityFixture;

describe(`DeepTutor ${fixture.upstream_commit.slice(0, 7)} golden parity`, () => {
  it("matches every compute_mastery case to 1e-12 precision", () => {
    for (const c of fixture.mastery_cases) {
      expect(computeMastery(c.input)).toBeCloseTo(c.expected, 12);
    }
  });

  it("matches every scheduler transition step to 1e-9 precision", () => {
    const scheduler = new SpacedRepetitionScheduler();
    const state = scheduler.getInitialState("memory", {
      now: fixture.scheduler_memory_trace.t0,
    });

    for (const step of fixture.scheduler_memory_trace.steps) {
      scheduler.scheduleReview(
        state,
        "memory",
        createLearningEvidence({
          knowledge_point_id: "kp-mem",
          assessment_type: "review",
          result: step.quality >= 0.5 ? "correct" : "incorrect",
          quality: step.quality,
          timestamp: step.moment,
        }),
        step.moment,
      );

      expect(state.stability, `${step.label}: stability`).toBeCloseTo(step.stability, 9);
      expect(state.difficulty, `${step.label}: difficulty`).toBeCloseTo(step.difficulty, 9);
      expect(state.next_review_at, `${step.label}: next_review_at`).toBeCloseTo(
        step.next_review_at,
        6,
      );
      expect(state.review_count, `${step.label}: review_count`).toBe(step.review_count);
      expect(state.lapse_count, `${step.label}: lapse_count`).toBe(step.lapse_count);
      expect(state.scheduled_after_failure, `${step.label}: scheduled_after_failure`).toBe(
        step.scheduled_after_failure,
      );
    }
  });
});
