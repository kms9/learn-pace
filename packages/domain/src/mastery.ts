/**
 * Mastery scoring policy — exact TypeScript port of DeepTutor `deeptutor/learning/mastery.py`
 * (commit 1284116).
 */

export const RECENCY_WEIGHTS: readonly number[] = [0.5, 0.7, 0.85, 0.95, 1.0] as const;

export const CONFIDENCE_CAP: Readonly<Record<number, number>> = {
  1: 0.5,
  2: 0.8,
} as const;

/**
 * Return a 0..1 mastery score from a knowledge point's attempt outcomes
 * (chronological booleans or bounded partial-credit floats).
 */
export function computeMastery(correctness: readonly (boolean | number)[]): number {
  if (correctness.length === 0) {
    return 0.0;
  }
  const recent = correctness.slice(-RECENCY_WEIGHTS.length);
  const weights = RECENCY_WEIGHTS.slice(-recent.length);
  let weightedSum = 0.0;
  let totalWeight = 0.0;
  for (let i = 0; i < recent.length; i++) {
    const raw = recent[i]!;
    const w = weights[i]!;
    const numeric = typeof raw === "boolean" ? (raw ? 1.0 : 0.0) : Number(raw);
    const bounded = Math.max(0.0, Math.min(1.0, numeric));
    weightedSum += w * bounded;
    totalWeight += w;
  }
  const score = weightedSum / totalWeight;
  const cap = CONFIDENCE_CAP[recent.length] ?? 1.0;
  return Math.min(score, cap);
}
