import { expect, it } from "vitest";
import { createPendingQuestion, type LearningProgress } from "@learn-pace/domain";
import type { InteractionStore, LearningProgressStore, StoredInteraction } from "@learn-pace/infra";
import { StudyWorkbench } from "../index.js";

it("restores the public card, saves the answer before grading and resumes an incomplete assessment", async () => {
  const question = createPendingQuestion({
    question_id: "ratio-question",
    knowledge_point_id: "reduce-ratio",
    module_id: "ratios",
    question_type: "choice",
    prompt: "Reduce 4:8",
    options: [{ label: "A", body: "1:2" }, { label: "B", body: "1:4" }],
    expected_answer: "A",
  });
  let interaction: StoredInteraction = {
    interaction_id: "interaction",
    path_id: "m1-ratios",
    session_id: "m1-study",
    turn_id: "turn",
    status: "awaiting_input",
    question,
    raw_answer: null,
    submission_id: null,
    updated_at: 100,
  };
  let progress: LearningProgress | null = null;
  let interrupt = true;
  const writes: string[] = [];
  const store: LearningProgressStore & InteractionStore = {
    async get() { return structuredClone(progress); },
    async save(value) {
      progress = structuredClone(value);
      if (value.learning_evidence.length) writes.push("progress");
    },
    async listIds() { return progress ? [progress.book_id] : []; },
    async getOpenInteraction() { return interaction.status !== "graded" ? interaction : null; },
    async getInteraction() { return interaction; },
    async insertInteraction(value) { interaction = value; },
    async saveAnswer(_id, submission_id, raw_answer, updated_at) {
      interaction = { ...interaction, status: "answered", submission_id, raw_answer, updated_at };
      writes.push("answer");
    },
    async markGraded() {
      if (interrupt) throw new Error("Interrupted after saving progress");
      interaction = { ...interaction, status: "graded" };
      writes.push("graded");
    },
  };
  const open = () => new StudyWorkbench({
    apiType: "openai-completions", model: "deepseek-v4.1-flash", baseUrl: "https://example.com/v1",
    apiKey: "test", contextWindow: 8192, maxTokens: 1024,
  }, store, { nowSeconds: () => 120 }, () => "submission");
  const restored = await open().snapshot();
  expect(restored.pending).toMatchObject({ id: "interaction", status: "awaiting_input", question: { question_id: "ratio-question" } });
  expect(restored.pending?.question).not.toHaveProperty("expected_answer");

  await expect(open().submitAnswer("interaction", "A")).rejects.toThrow("Interrupted");
  expect(writes).toEqual(["answer", "progress"]);
  expect(interaction).toMatchObject({ raw_answer: "A", status: "answered" });
  interrupt = false;
  const resumed = open();
  await resumed.grade("interaction");
  const snapshot = await resumed.snapshot();
  expect(writes).toEqual(["answer", "progress", "graded"]);
  expect(snapshot).toMatchObject({
    pending: null, assessmentCount: 1, mastery: 0.5, objectiveStatus: "learning", lastResult: "correct",
  });
  expect(snapshot.nextReviewAt).toBeGreaterThan(120);
});
