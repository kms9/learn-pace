/**
 * Customizable review interval strategies — ported from DeepTutor
 * `deeptutor/learning/review_strategy.py` (commit 1284116).
 */

import type { KnowledgeType, LearningProgress, ReviewStrategyTemplate } from "./models.js";
import { INTERVAL_SEQUENCES, SpacedRepetitionScheduler } from "./scheduler.js";

function makePreset(
  templateId: string,
  name: string,
  description: string,
  desiredRetention: number,
  intervals: Record<KnowledgeType, number[]>,
): ReviewStrategyTemplate {
  return {
    template_id: templateId,
    name,
    description,
    builtin: true,
    desired_retention: desiredRetention,
    intervals,
    created_at: 0,
    updated_at: 0,
  };
}

export function builtinReviewTemplates(): Record<string, ReviewStrategyTemplate> {
  const templates: ReviewStrategyTemplate[] = [
    makePreset(
      "preset-daily-long-term",
      "Daily Long-term Learning",
      "Steady long-term learning: expanding intervals from a same-day first round up to two months.",
      0.9,
      {
        memory: [...INTERVAL_SEQUENCES.memory],
        concept: [...INTERVAL_SEQUENCES.concept],
        procedure: [...INTERVAL_SEQUENCES.procedure],
        design: [...INTERVAL_SEQUENCES.design],
      },
    ),
    makePreset(
      "preset-exam-cramming",
      "Exam Cramming",
      "Exam sprint: dense short intervals and a high recall target, front-loading repetition into the days before the exam.",
      0.95,
      {
        memory: [0, 1, 1, 2, 3, 4, 7],
        concept: [1, 2, 3, 5, 7],
        procedure: [1, 2, 3, 5],
        design: [3, 7, 14],
      },
    ),
    makePreset(
      "preset-language",
      "Language Subjects",
      "Language subjects: vocabulary-grade repetition for memory with moderately tight concept rounds.",
      0.9,
      {
        memory: [0, 1, 2, 4, 7, 15, 30],
        concept: [2, 4, 8, 15],
        procedure: [2, 4, 8],
        design: [10, 21],
      },
    ),
    makePreset(
      "preset-science",
      "Science Subjects",
      "Science subjects: longer reasoning-friendly intervals once an objective is understood.",
      0.85,
      {
        memory: [1, 3, 7, 14, 30, 60, 120],
        concept: [5, 12, 25, 50],
        procedure: [5, 12, 25],
        design: [21, 45],
      },
    ),
  ];

  const out: Record<string, ReviewStrategyTemplate> = {};
  for (const t of templates) {
    out[t.template_id] = t;
  }
  return out;
}

export const BUILTIN_TEMPLATE_IDS: readonly string[] = Object.keys(
  builtinReviewTemplates(),
).sort();

export function schedulerForProgress(progress: LearningProgress): SpacedRepetitionScheduler {
  const binding = progress.review_strategy;
  if (!binding) {
    return new SpacedRepetitionScheduler();
  }
  return new SpacedRepetitionScheduler({ interval_sequences: binding.intervals });
}
