import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { describe, expect, it } from "vitest";
import { SubmissionConflictError, VersionConflictError, type AppStore, type DatabaseSnapshot, type StoredDomainEvent,
  type StoredInteraction, type StoredKnowledgeCard, type StoredSkill, type StoredSkillRevision, type StoredSkillBinding,
  type StoredProviderConnection, type StoredSourceBinding } from "../index.js";

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
const skill: StoredSkill = {
  skill_id: "fraction-coach", name: "fraction-coach", description: "分数练习",
  origin_kind: "local_file", origin_locator: "local:fraction-coach", source_url: null, pinned_ref: null,
  active_revision: "a", enabled: 0, user_invocable: 1, disable_model_invocation: 0,
  compatibility_json: "{}", metadata_json: "{}", created_at: 1, updated_at: 1,
};
const revision: StoredSkillRevision = {
  skill_id: skill.skill_id, revision: "a", manifest_json: '{"version":"a"}',
  files_json_base64: "{}", raw_bytes: 10, instructions_chars: 2, created_at: 1,
};
const binding: StoredSkillBinding = { skill_id: skill.skill_id, scope: "lf01", enabled: 0, updated_at: 1 };
const connection: StoredProviderConnection = { connection_id: "ima-fixture", provider: "ima", display_name: "测试",
  status: "disconnected", credential_ref: null, last_error: null, created_at: 1, updated_at: 1 };
const source: StoredSourceBinding = { binding_id: "library", connection_id: connection.connection_id, provider: "ima",
  remote_kb_id: "remote", name: "测试库", description: "", base_type: "个人知识库", role_type: "创建者",
  writable: 0, enabled: 1, created_at: 1, updated_at: 1 };

export function testTransactionalStore(open: () => Promise<AppStore>) {
  describe("transactional store", () => {
    it("exports all thirteen tables and replaces them in one transaction with its callback", async () => {
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
        skills: [skill], skill_revisions: [revision], skill_bindings: [binding],
        provider_connections: [connection], source_bindings: [source],
      };
      await store.replaceSnapshot(full);
      expect(await store.exportSnapshot()).toEqual(full);
      expect((await store.listDomainEvents("path")).map(({ event_id }) => event_id)).toEqual(["earlier-clock", "event"]);

      const empty: DatabaseSnapshot = { settings: [], learning_progress: [], sessions: [], messages: [],
        session_threads: [], interactions: [], domain_events: [], knowledge_cards: [],
        skills: [], skill_revisions: [], skill_bindings: [], provider_connections: [], source_bindings: [] };
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

    it("enforces source identity and deletes bindings with their connection", async () => {
      const store = await open();
      await expect(store.saveSourceBinding(source)).rejects.toThrow();
      await store.saveProviderConnection(connection);
      await store.saveSourceBinding(source);
      await expect(store.saveSourceBinding({ ...source, binding_id: "duplicate" })).rejects.toThrow();
      await expect(store.saveSourceBinding({ ...source, remote_kb_id: "other" })).rejects.toThrow();
      await store.saveSourceBinding({ ...source, enabled: 0 });
      expect(await store.listSourceBindings(connection.connection_id)).toEqual([{ ...source, enabled: 0 }]);
      await store.runInTransaction(async (tx) => {
        await tx.deleteProviderConnection(connection.connection_id);
        expect(await tx.getSourceBinding(source.binding_id)).toBeNull();
        throw new Error("rollback deletion");
      }).catch((error) => expect(error.message).toBe("rollback deletion"));
      expect(await store.getProviderConnection(connection.connection_id)).toEqual(connection);
      expect(await store.getSourceBinding(source.binding_id)).toMatchObject({ enabled: 0 });
      await store.deleteProviderConnection(connection.connection_id);
      expect(await store.listSourceBindings()).toEqual([]);
    });

    it("reads skill flags, bindings and manifests from a single consistent snapshot", async () => {
      const store = await open();
      await store.runInTransaction(async (tx) => {
        await tx.saveSkill(skill);
        await tx.saveSkillRevision(revision);
        await tx.saveSkillBinding(binding);
      });
      const next: StoredSkill = { ...skill, enabled: 1, active_revision: "b", updated_at: 2 };
      const nextRevision = { ...revision, revision: "b", manifest_json: '{"version":"b"}' };
      const nextBinding: StoredSkillBinding = { ...binding, enabled: 1, updated_at: 2 };
      let halfway!: () => void;
      let finish!: () => void;
      const half = new Promise<void>((resolve) => { halfway = resolve; });
      const untilCommit = new Promise<void>((resolve) => { finish = resolve; });
      const switching = store.runInTransaction(async (tx) => {
        await tx.saveSkill(next);
        halfway();
        await untilCommit;
        await tx.saveSkillRevision(nextRevision);
        await tx.saveSkillBinding(nextBinding);
      });
      await half;
      try {
        expect(await store.scopeSnapshot("lf01")).toEqual([{ skill, binding: 0, manifest: revision.manifest_json }]);
      } finally {
        finish();
        await switching;
      }
      expect(await store.scopeSnapshot("lf01")).toEqual([{ skill: next, binding: 1, manifest: nextRevision.manifest_json }]);
      expect(await store.scopeSnapshot("little_tutor")).toEqual([{ skill: next, binding: null, manifest: nextRevision.manifest_json }]);
      await expect(store.runInTransaction(async (tx) => {
        await tx.deleteSkill(skill.skill_id);
        await tx.deleteInactiveSkillRevisions();
        throw new Error("rollback skill changes");
      })).rejects.toThrow("rollback skill changes");
      expect(await store.listSkillBindings(skill.skill_id)).toEqual([nextBinding]);
      expect(await store.skillLibraryBytes()).toBe(20);
      await store.deleteInactiveSkillRevisions();
      expect(await store.getSkillRevision(skill.skill_id, "a")).toBeNull();
      expect(await store.getSkillRevision(skill.skill_id, "b")).toEqual(nextRevision);
      await store.deleteSkill(skill.skill_id);
      expect(await store.scopeSnapshot("lf01")).toEqual([]);
      expect(await store.listSkillBindings(skill.skill_id)).toEqual([]);
      expect(await store.getSkillRevision(skill.skill_id, "b")).toEqual(nextRevision);
      await store.deleteInactiveSkillRevisions();
      expect(await store.skillLibraryBytes()).toBe(0);
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
