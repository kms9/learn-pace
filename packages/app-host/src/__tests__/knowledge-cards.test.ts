import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore } from "@learn-pace/infra";
import { expect, it } from "vitest";
import { AppBootstrapService, KnowledgeCardService } from "../index.js";

it("saves verified chat selections, edits and searches notes, and excludes soft-deleted cards", async () => {
  const store = new MemoryAppStore();
  const service = new KnowledgeCardService(store, { nowSeconds: () => 3 }, () => "saved");
  await store.saveSession({ session_id: "chat", kind: "little_tutor", path_id: null, mode: null,
    title: "小老师", model_id: null, created_at: 1, updated_at: 1 });
  await store.saveMessage({ message_id: "message", session_id: "chat", role: "assistant", content: "分数讲解很好",
    status: "committed", turn_id: null, metadata: null, created_at: 2 });
  await expect(service.saveSelection("chat", "message", { text: "用户篡改", start: 0, end: 4 })).rejects.toThrow("选文");
  const card = await service.saveSelection("chat", "message", { text: "分数讲解", start: 0, end: 4 });
  expect(card).toMatchObject({ source_kind: "little_tutor", source_session_id: "chat", source_message_id: "message",
    title: "分数讲解", content: "分数讲解" });
  await service.updateNote(card.card_id, " Revision ");
  expect(await service.list("revision")).toMatchObject([{ note: "Revision" }]);
  await service.remove(card.card_id);
  expect(await service.list()).toEqual([]);
  expect(await store.getKnowledgeCard(card.card_id)).toMatchObject({ deleted_at: 3 });
  await expect(service.updateNote(card.card_id, "new")).rejects.toThrow("已删除");
});

it("saves the option body and explanation, keeps the card when its path is deleted, and uses it as text_note", async () => {
  const store = new MemoryAppStore();
  const clock = { nowSeconds: () => 7 };
  let serial = 0;
  const makeId = () => "id-" + ++serial;
  const service = new KnowledgeCardService(store, clock, makeId);
  const mastery = new AppBootstrapService(store, new MemorySecretStore(), { makeId }).createMasterySessionService(clock);
  await store.save(createLearningProgress({ book_id: "path" }));
  const question = createPendingQuestion({ question_id: "q", knowledge_point_id: "ratios", question_type: "choice", prompt: "约分", expected_answer: "B",
    options: [{ label: "A", body: "1/3" }, { label: "B", body: "1/2" }], explanation: "同时除以二。" });
  await store.insertInteraction({ interaction_id: "interaction", path_id: "path", session_id: "study", turn_id: "turn",
    status: "graded", question, raw_answer: "A", submission_id: null, updated_at: 2, grade: { questions: {
      q: { result: "incorrect", final: true, correct_option: "B", feedback: "请复习", confidence: 1 },
    } } });
  const saved = await service.saveMasteryExplanation("interaction", "q");
  expect(saved).toMatchObject({ path_id: "path", source_interaction_id: "interaction" });
  expect(saved.content).toContain("参考答案：1/2");
  expect(saved.content).toContain("同时除以二");
  await mastery.deleteTopic("path");
  expect(await store.getInteraction("interaction")).toBeNull();
  expect(await service.list()).toMatchObject([{ card_id: saved.card_id, path_id: null }]);
  const { pathId } = await mastery.createTopic({ goal: "掌握化简分数",
    materials: [{ kind: "text_note", label: saved.title, text: saved.content }] });
  expect((await store.get(pathId))?.topic_sources).toContainEqual(expect.objectContaining({
    kind: "text_note", label: "约分", excerpt: saved.content,
  }));
});
