import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { describe, expect, it } from "vitest";
import { SubmissionConflictError, VersionConflictError, type AppStore, type DatabaseSnapshot, type StoredDomainEvent,
  type StoredInteraction, type StoredKnowledgeCard } from "../index.js";

const card: StoredInteraction = {
  interaction_id: "card", path_id: "path", session_id: "study", turn_id: "turn", status: "awaiting_input",
  question: createPendingQuestion({ question_id: "q", knowledge_point_id: "point" }),
  raw_answer: null, submission_id: null, updated_at: 1,
};
const event: StoredDomainEvent = {
  event_id: "event", path_id: "path", session_id: "study", turn_id: "turn", event_type: "AnswerRecorded",
  payload: { interaction_id: "card" }, created_at: 2,
};
const knowledge: StoredKnowledgeCard = {
  card_id: "knowledge", source_kind: "mastery_card", title: "分数", content: "Equivalent fractions", note: "先复习",
  path_id: "path", source_session_id: "study", source_message_id: null, source_interaction_id: "card",
  created_at: 1, updated_at: 2, deleted_at: null,
};

export function testTransactionalStore(open: () => Promise<AppStore>) {
  describe("transactional store", () => {
    it("exports all eight tables and replaces them in one transaction with its callback", async () => {
      const store = await open();
      const session = { session_id: "study", kind: "mastery", path_id: "path", mode: "study" as const,
        title: "分数", model_id: null, created_at: 1, updated_at: 1 };
      const full: DatabaseSnapshot = {
        settings: [{ name: "scene", value: "free" }],
        learning_progress: [{ progress: { ...createLearningProgress({ book_id: "path" }), version: 2 }, status: "active" }],
        interactions: [card], sessions: [session],
        messages: [{ message_id: "reply", session_id: "study", role: "assistant", content: "内容", status: "generating",
          turn_id: "turn", metadata: { model: "flash" }, created_at: 1 }],
        session_threads: [{ thread_id: "thread", parent_session_id: "study", source_message_id: "reply", selected_text: "内容",
          title: "侧聊", selection_start: 0, selection_end: 2, detached_at: null, created_at: 2, updated_at: 2 }],
        domain_events: [event, { ...event, event_id: "earlier-clock", created_at: 1 }],
        knowledge_cards: [knowledge, { ...knowledge, card_id: "removed", deleted_at: 4 }],
      };
      await store.replaceSnapshot(full);
      expect(await store.exportSnapshot()).toEqual(full);
      expect((await store.listDomainEvents("path")).map(({ event_id }) => event_id)).toEqual(["earlier-clock", "event"]);

      const empty: DatabaseSnapshot = { settings: [], learning_progress: [], sessions: [], messages: [],
        session_threads: [], interactions: [], domain_events: [], knowledge_cards: [] };
      await expect(store.replaceSnapshot(empty, async (tx) => {
        expect(await tx.exportSnapshot()).toEqual(empty);
        await tx.writeSetting("during", "callback");
        throw new Error("rollback callback");
      })).rejects.toThrow("rollback callback");
      expect(await store.exportSnapshot()).toEqual(full);
      await expect(store.replaceSnapshot({ ...empty, interactions: [card, card] })).rejects.toThrow();
      expect(await store.exportSnapshot()).toEqual(full);
      await store.replaceSnapshot(empty, (tx) => tx.writeSetting("during", "callback"));
      expect(await store.exportSnapshot()).toEqual({ ...empty, settings: [{ name: "during", value: "callback" }] });
    });

    it("filters graded interactions and manages cards consistently", async () => {
      const store = await open();
      await store.insertInteraction(card);
      const first = { ...card, interaction_id: "gradedA", status: "graded" as const };
      const second = { ...first, interaction_id: "gradedB", path_id: "other" };
      await store.insertInteraction(first);
      await store.insertInteraction(second);
      expect(await store.listGradedInteractions()).toEqual([second, first]);
      expect(await store.listGradedInteractions("path")).toEqual([first]);
      await store.saveKnowledgeCard(knowledge);
      expect(await store.listKnowledgeCards({ query: " FRACTIONS " })).toEqual([knowledge]);
      expect(await store.listKnowledgeCards({ query: "复习" })).toEqual([knowledge]);
      await store.detachKnowledgeCardsByPath("path", 6);
      expect(await store.getKnowledgeCard("knowledge")).toMatchObject({ path_id: null, updated_at: 6 });
      await store.softDeleteKnowledgeCard("knowledge", 7);
      await store.softDeleteKnowledgeCard("knowledge", 8);
      expect(await store.listKnowledgeCards()).toEqual([]);
      expect(await store.listKnowledgeCards({ includeDeleted: true })).toMatchObject([{ deleted_at: 7, updated_at: 7 }]);
    });

    it("exports a consistent view across pending writes", async () => {
      const store = await open();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const transaction = store.runInTransaction(async (tx) => {
        await tx.writeSetting("scene", "free");
        enter();
        await released;
        await tx.insertInteraction(card);
      });
      await entered;
      const snapshot = store.exportSnapshot();
      release();
      expect(await snapshot).toMatchObject({ settings: [{ name: "scene", value: "free" }], interactions: [card] });
      await transaction;
    });

    it("lists open interactions across paths and sessions, excluding graded and abandoned cards", async () => {
      const store = await open();
      const answered = { ...card, interaction_id: "second", path_id: "other", session_id: "other-session",
        status: "answered" as const, raw_answer: "A", submission_id: "submission", updated_at: 2 };
      await store.insertInteraction(card);
      await store.insertInteraction(answered);
      await store.insertInteraction({ ...card, interaction_id: "closed", status: "graded", updated_at: 3 });
      await store.insertInteraction({ ...answered, interaction_id: "skipped", submission_id: null, status: "abandoned" });
      expect(await store.listOpenInteractions()).toEqual([answered, card]);
      expect(await store.runInTransaction((tx) => tx.listOpenInteractions())).toEqual([answered, card]);
    });

    it("inserts and updates progress via CAS and preserves path status", async () => {
      const store = await open();
      const base = createLearningProgress({ book_id: "path", name: "before" });
      await store.saveWithCas(base, null, "draft");
      await expect(store.saveWithCas(base, null)).rejects.toBeInstanceOf(VersionConflictError);
      await expect(store.saveWithCas(base, 0)).rejects.toBeInstanceOf(VersionConflictError);
      const next = { ...base, name: "after", version: 1 };
      await store.runInTransaction((tx) => tx.saveWithCas(next, 0));
      await expect(store.saveWithCas({ ...next, name: "stale" }, 0)).rejects.toBeInstanceOf(VersionConflictError);
      expect(await store.get("path")).toEqual(next);
      expect((await store.listPathSummaries())[0]?.status).toBe("draft");
    });

    it("rolls back nested writes, then commits a later transaction and scopes event deletion", async () => {
      const store = await open();
      const base = createLearningProgress({ book_id: "path" });
      await store.save(base);
      await store.insertInteraction(card);
      const change = async (tx: AppStore) => {
        await tx.saveWithCas({ ...base, version: 1 }, 0);
        await tx.runInTransaction(async (nested) => {
          expect(nested).toBe(tx);
          await nested.saveAnswer("card", "submission", "A", 2);
          await nested.appendDomainEvent(event);
        });
        expect(await tx.findInteractionBySubmission("submission")).toMatchObject({ status: "answered" });
        expect(await tx.listDomainEvents("path")).toEqual([event]);
      };
      await expect(store.runInTransaction(async (tx) => {
        await change(tx);
        throw new Error("rollback");
      })).rejects.toThrow("rollback");
      expect(await store.get("path")).toEqual(base);
      expect(await store.getInteraction("card")).toEqual(card);
      expect(await store.findInteractionBySubmission("submission")).toBeNull();
      expect(await store.listDomainEvents("path")).toEqual([]);

      await store.runInTransaction(change);
      await expect(store.insertInteraction({ ...card, interaction_id: "other", submission_id: "submission" }))
        .rejects.toBeInstanceOf(SubmissionConflictError);
      const newer = { ...event, event_id: "newer", created_at: 1 };
      const other = { ...event, event_id: "other", path_id: "other" };
      await store.appendDomainEvent(newer);
      await store.appendDomainEvent(other);
      expect(await store.listDomainEvents("path")).toEqual([newer, event]);
      expect(await store.listDomainEvents("path", 1)).toEqual([newer]);
      await store.deleteDomainEventsByPath("path");
      expect(await store.listDomainEvents("path")).toEqual([]);
      expect(await store.listDomainEvents("other")).toEqual([other]);
    });

    it("queues main-store writes while allowing reads during a transaction", async () => {
      const store = await open();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const transaction = store.runInTransaction(async (tx) => {
        await tx.writeSetting("grading", "committed");
        enter();
        await released;
      });
      await entered;
      const streamWrite = store.saveMessage({
        message_id: "message", session_id: "chat", role: "assistant", content: "stream text",
        status: "completed", turn_id: "chat-turn", metadata: null, created_at: 3,
      });
      try {
        expect(await store.readSetting("grading")).toBeNull();
        expect(await store.getMessage("message")).toBeNull();
      } finally {
        release();
        await Promise.all([transaction, streamWrite]);
      }
      expect(await store.readSetting("grading")).toBe("committed");
      expect(await store.getMessage("message")).toMatchObject({ status: "completed" });
    });
  });
}
