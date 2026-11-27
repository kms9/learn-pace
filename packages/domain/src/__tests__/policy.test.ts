import { describe, expect, it } from "vitest";
import {
  createKnowledgePoint,
  createLearningModule,
  createLearningProgress,
  createPendingQuestion,
  createQuizAttempt,
} from "../models.js";
import {
  isAssessedMastered,
  isMastered,
  mapSummary,
  masterySource,
  nextObjective,
  objectiveStatus,
} from "../policy.js";

function makeProgress(...kps: ReturnType<typeof createKnowledgePoint>[]) {
  const knowledge_types: Record<string, (typeof kps)[number]["type"]> = {};
  for (const kp of kps) {
    knowledge_types[kp.id] = kp.type;
  }
  return createLearningProgress({
    book_id: "b1",
    current_module_id: "m1",
    modules: [createLearningModule({ id: "m1", name: "M1", order: 0, knowledge_points: kps })],
    knowledge_types,
  });
}

describe("Mastery Path policy (DeepTutor policy.py parity)", () => {
  it("enforces quantitative 0.9 gate for memory/procedure and qualitative gate for concept/design", () => {
    const mem = createKnowledgePoint({ id: "kp1", name: "KP1", type: "memory", module_id: "m1" });
    const concept = createKnowledgePoint({
      id: "kp2",
      name: "KP2",
      type: "concept",
      module_id: "m1",
    });
    const progress = makeProgress(mem, concept);

    progress.mastery_levels["kp1"] = 0.89;
    expect(isMastered(progress, mem)).toBe(false);
    progress.mastery_levels["kp1"] = 0.9;
    expect(isMastered(progress, mem)).toBe(true);
    expect(masterySource(progress, mem)).toBe("system");

    // High numeric score does not clear qualitative gate
    progress.mastery_levels["kp2"] = 1.0;
    expect(isAssessedMastered(progress, concept)).toBe(false);
    progress.qualitative_mastery["kp2"] = true;
    expect(isAssessedMastered(progress, concept)).toBe(true);
  });

  it("tracks objective_status transitions new -> learning -> mastered", () => {
    const kp = createKnowledgePoint({ id: "kp1", name: "KP1", type: "memory", module_id: "m1" });
    const progress = makeProgress(kp);
    expect(objectiveStatus(progress, kp)).toBe("new");

    progress.quiz_attempts.push(
      createQuizAttempt({ question_id: "q1", knowledge_point_id: "kp1", is_correct: false }),
    );
    expect(objectiveStatus(progress, kp)).toBe("learning");

    progress.mastery_levels["kp1"] = 0.95;
    expect(objectiveStatus(progress, kp)).toBe("mastered");
  });

  it("prioritizes pending_question > due review > open non-deferred objective > deferred > complete", () => {
    const kp1 = createKnowledgePoint({ id: "kp1", name: "KP1", type: "memory", module_id: "m1" });
    const kp2 = createKnowledgePoint({ id: "kp2", name: "KP2", type: "procedure", module_id: "m1" });
    const progress = makeProgress(kp1, kp2);

    // 1. Pending question wins
    progress.pending_question = createPendingQuestion({
      question_id: "q-pending",
      knowledge_point_id: "kp1",
      prompt: "What is 2+2?",
      expected_answer: "4",
    });
    expect(nextObjective(progress).action).toBe("answer_pending");

    // Clear pending -> probe kp1
    progress.pending_question = null;
    expect(nextObjective(progress)).toMatchObject({
      action: "probe",
      knowledge_point_id: "kp1",
    });

    // Defer kp1 -> moves to kp2
    progress.deferred_objectives["kp1"] = {
      knowledge_point_id: "kp1",
      note: "later",
      created_at: 1,
    };
    expect(nextObjective(progress)).toMatchObject({
      action: "probe",
      knowledge_point_id: "kp2",
    });

    // Master kp2 -> falls back to deferred kp1 (never falsely returns complete)
    progress.mastery_levels["kp2"] = 0.95;
    expect(nextObjective(progress)).toMatchObject({
      action: "probe",
      knowledge_point_id: "kp1",
    });

    // Master kp1 -> complete
    progress.mastery_levels["kp1"] = 0.95;
    expect(nextObjective(progress).action).toBe("complete");
    expect(mapSummary(progress).complete).toBe(true);
  });

  it("respects teach_first learner profile on untouched objectives", () => {
    const kp = createKnowledgePoint({ id: "kp1", name: "KP1", type: "procedure", module_id: "m1" });
    const progress = makeProgress(kp);
    progress.learner_profile = {
      prior_knowledge: "",
      target_level: "",
      time_budget: "",
      preferences: "",
      teaching_strategy: "teach_first",
      notes: "",
      updated_at: 0,
    };
    expect(nextObjective(progress).action).toBe("teach");
  });
});
