import { describe, expect, it } from "vitest";
import { computeMastery, CONFIDENCE_CAP, RECENCY_WEIGHTS } from "../mastery.js";

describe("computeMastery (DeepTutor mastery.py parity)", () => {
  it("matches upstream constants", () => {
    expect(RECENCY_WEIGHTS).toEqual([0.5, 0.7, 0.85, 0.95, 1.0]);
    expect(CONFIDENCE_CAP).toEqual({ 1: 0.5, 2: 0.8 });
  });

  it("returns 0 for empty history", () => {
    expect(computeMastery([])).toBe(0);
  });

  it("applies confidence caps for 1 and 2 attempts", () => {
    expect(computeMastery([true])).toBe(0.5);
    expect(computeMastery([true, true])).toBe(0.8);
    expect(computeMastery([true, true, true])).toBe(1.0);
  });

  it("uses recency weights over the most recent 5 attempts", () => {
    // [false, true, true] -> weights [0.85, 0.95, 1.0] => (0.95 + 1.0) / 2.8
    expect(computeMastery([false, true, true])).toBeCloseTo((0.95 + 1.0) / (0.85 + 0.95 + 1.0), 12);

    // Older mistakes beyond window of 5 are dropped
    expect(computeMastery([false, false, true, true, true, true, true])).toBe(1.0);

    // [false, false, true, true, true] -> weights [0.5, 0.7, 0.85, 0.95, 1.0]
    expect(computeMastery([false, false, true, true, true])).toBeCloseTo(
      (0.85 + 0.95 + 1.0) / 4.0,
      12,
    );
  });

  it("clamps bounded partial credit floats into [0, 1]", () => {
    expect(computeMastery([1.5, -0.4, 0.5])).toBeCloseTo(
      (0.85 * 1.0 + 0.95 * 0.0 + 1.0 * 0.5) / 2.8,
      12,
    );
  });
});
