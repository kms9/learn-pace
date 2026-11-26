import { createKnowledgePoint, createLearningEvidence, createLearningModule, createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type StoredInteraction } from "@learn-pace/infra";
import { expect, it } from "vitest";
import { AppBootstrapService, MistakeReviewService } from "../index.js";

it("joins graded cards with current path evidence and excludes voids, correct work, and reset history", async () => {
  const store = new MemoryAppStore();
  const mastery = new AppBootstrapService(store, new MemorySecretStore(), { makeId: () => 'practice' }).createMasterySessionService({ nowSeconds: () => 8 });
  const mistakes = new MistakeReviewService(store);
  const point = createKnowledgePoint({ id: "ratios", module_id: "module", name: "约分", type: "procedure" });
  const evidence = (id: string, result: "incorrect" | "correct", questionId = id) => createLearningEvidence({
    evidence_id: id, question_id: questionId, knowledge_point_id: point.id, assessment_type: "review",
    timestamp: 5, result, learner_answer: "1/4",
  });
  const progress = createLearningProgress({ book_id: "path", name: "分数",
    modules: [createLearningModule({ id: "module", name: "分数", order: 0, knowledge_points: [point] })],
    learning_evidence: [evidence("group:wrong", "incorrect", "wrong"), evidence("right", "correct"),
      evidence("voided", "incorrect"), evidence("old", "incorrect")] });
  await store.save(progress);
  const question = createPendingQuestion({ question_id: "wrong", knowledge_point_id: point.id, expected_answer: "1/2",
    prompt: "四分之二如何约分？", explanation: "分子分母同除以二。" });
  const incorrect = { result: "incorrect" as const, confidence: 1, final: true, feedback: "忘了同时约分分子。" };
  const row: StoredInteraction = { interaction_id: "group", path_id: "path", session_id: "study", turn_id: "turn",
    status: "graded", question: createPendingQuestion({ question_id: "group", knowledge_point_id: point.id, question_type: "group", questions: [question] }),
    grade: { questions: { wrong: incorrect } }, raw_answer: JSON.stringify({ wrong: "1/4" }), submission_id: null, updated_at: 7 };
  await store.insertInteraction(row);
  await store.insertInteraction({ ...row, interaction_id: "right", question: { ...question, question_id: "right" } });
  await store.insertInteraction({ ...row, interaction_id: "voided", question: { ...question, question_id: "voided" },
    grade: { questions: { voided: { ...incorrect, voided: true } } } });
  expect(await mistakes.listMistakes({ pathId: "path" })).toMatchObject([{
    id: "group:wrong", kind: "mastery", objectiveId: "ratios", objectiveName: "约分",
    learnerAnswer: "1/4", referenceAnswer: "1/2", explanation: "分子分母同除以二。",
  }]);
  const practice = await mastery.startObjectivePractice("path", point.id);
  expect(practice.session).toMatchObject({ mode: "study", path_id: "path" });
  await mastery.resetTopic("path");
  expect(await mistakes.listMistakes({ pathId: "path" })).toEqual([]);
  expect(await store.listGradedInteractions("path")).toHaveLength(3);
});

it("lists completed quick-check mistakes independently and excludes ungraded quick checks", async () => {
  const store = new MemoryAppStore();
  await store.saveSession({ session_id: "chat", kind: "lf01", path_id: null, mode: null, title: "问答",
    model_id: null, created_at: 1, updated_at: 1 });
  const question = createPendingQuestion({ question_id: "short", knowledge_point_id: "chat", prompt: "为什么要通分？" });
  const save = (id: string, status: string) => store.saveMessage({
    message_id: id, session_id: "chat", role: "assistant", status: "committed", content: "问答自测",
    turn_id: null, created_at: 1, metadata: { quick_check: { check_id: id, status, questions: [question],
      answers: { short: "不用" }, submission_id: "submit", grades: { short: {
        result: "incorrect", final: true, reference_answer: "为取得同一计量单位", feedback: "解释不足", confidence: 1,
      } } } },
  });
  await save("graded", "graded");
  await save("pending", "answered");
  const service = new MistakeReviewService(store);
  expect(await service.listMistakes()).toMatchObject([{
    kind: "quick_check", messageId: "graded", sessionId: "chat", referenceAnswer: "为取得同一计量单位",
  }]);
  expect(await service.listMistakes({ includeQuickChecks: false })).toEqual([]);
  expect(await service.listMistakes({ pathId: "other" })).toEqual([]);
  expect(await store.listIds()).toEqual([]);
});
