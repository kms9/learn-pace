import type { LearningProgress, PathStatus } from "@learn-pace/domain";
import {
  SubmissionConflictError, VersionConflictError,
  type AppStore, type DatabaseSnapshot, type PathSummaryRecord, type SecretStore, type StoredDomainEvent, type StoredInteraction,
  type KnowledgeCardFilter, type StoredKnowledgeCard, type StoredMessage, type StoredSession, type StoredThread,
  type SkillScope, type SkillScopeEntry, type StoredSkill, type StoredSkillRevision, type StoredSkillBinding,
  type StoredProviderConnection, type StoredSourceBinding,
} from "./index.js";
import { searchKnowledgeCards } from "./knowledge-card-search.js";
import { WriteQueue } from "./write-queue.js";
import { insertSnapshot } from "./snapshot.js";

function byId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MemoryAppStore implements AppStore {
  private state = {
    settings: new Map<string, string>(),
    paths: new Map<string, { progress: LearningProgress; status: PathStatus }>(),
    interactions: new Map<string, StoredInteraction>(),
    sessions: new Map<string, StoredSession>(),
    messages: new Map<string, StoredMessage>(),
    threads: new Map<string, StoredThread>(),
    events: new Map<string, StoredDomainEvent>(),
    cards: new Map<string, StoredKnowledgeCard>(),
    skills: new Map<string, StoredSkill>(),
    revisions: new Map<string, StoredSkillRevision>(),
    bindings: new Map<string, StoredSkillBinding>(),
    providerConnections: new Map<string, StoredProviderConnection>(),
    sourceBindings: new Map<string, StoredSourceBinding>(),
  };
  private writes: WriteQueue | null = new WriteQueue();

  async runInTransaction<T>(work: (tx: AppStore) => Promise<T>): Promise<T> {
    if (!this.writes) return work(this);
    return this.writes.run(async () => {
      const tx = new MemoryAppStore();
      tx.writes = null;
      tx.state = structuredClone(this.state);
      const result = await work(tx);
      this.state = tx.state;
      return result;
    });
  }

  async exportSnapshot(): Promise<DatabaseSnapshot> {
    const read = () => {
      const { settings, paths, sessions, messages, threads, interactions, events, cards, skills, revisions, bindings,
        providerConnections, sourceBindings } = this.state;
      return structuredClone({
        settings: [...settings].sort(([a], [b]) => byId(a, b)).map(([name, value]) => ({ name, value })),
        learning_progress: [...paths.values()].sort((a, b) => byId(a.progress.book_id, b.progress.book_id)),
        sessions: [...sessions.values()].sort((a, b) => byId(a.session_id, b.session_id)),
        messages: [...messages.values()].sort((a, b) => byId(a.message_id, b.message_id)),
        session_threads: [...threads.values()].sort((a, b) => byId(a.thread_id, b.thread_id)),
        interactions: [...interactions.values()].sort((a, b) => byId(a.interaction_id, b.interaction_id)),
        domain_events: [...events.values()],
        knowledge_cards: [...cards.values()].sort((a, b) => byId(a.card_id, b.card_id)),
        skills: [...skills.values()].sort((a, b) => byId(a.skill_id, b.skill_id)),
        skill_revisions: [...revisions.values()].sort((a, b) => byId(a.skill_id, b.skill_id) || byId(a.revision, b.revision)),
        skill_bindings: [...bindings.values()].sort((a, b) => byId(a.skill_id, b.skill_id) || byId(a.scope, b.scope)),
        provider_connections: [...providerConnections.values()].sort((a, b) => byId(a.connection_id, b.connection_id)),
        source_bindings: [...sourceBindings.values()].sort((a, b) => byId(a.binding_id, b.binding_id)),
      });
    };
    return this.writes ? this.writes.run(read) : read();
  }

  async replaceSnapshot(snapshot: DatabaseSnapshot, afterReplace?: (tx: AppStore) => Promise<void>): Promise<void> {
    if (this.writes) return this.runInTransaction((tx) => tx.replaceSnapshot(snapshot, afterReplace));
    for (const table of Object.values(this.state)) table.clear();
    await insertSnapshot(this, snapshot);
    await afterReplace?.(this);
  }

  private async write(work: () => void): Promise<void> {
    if (this.writes) return this.writes.run(work);
    work();
  }

  async getProviderConnection(id: string): Promise<StoredProviderConnection | null> {
    return structuredClone(this.state.providerConnections.get(id) ?? null);
  }

  async listProviderConnections(): Promise<StoredProviderConnection[]> {
    return structuredClone([...this.state.providerConnections.values()].sort((a, b) => byId(a.connection_id, b.connection_id)));
  }

  async saveProviderConnection(connection: StoredProviderConnection): Promise<void> {
    await this.write(() => this.state.providerConnections.set(connection.connection_id, { ...connection }));
  }

  async deleteProviderConnection(id: string): Promise<void> {
    await this.write(() => {
      for (const [bindingId, binding] of this.state.sourceBindings) {
        if (binding.connection_id === id) this.state.sourceBindings.delete(bindingId);
      }
      this.state.providerConnections.delete(id);
    });
  }

  async getSourceBinding(id: string): Promise<StoredSourceBinding | null> {
    return structuredClone(this.state.sourceBindings.get(id) ?? null);
  }

  async listSourceBindings(connectionId?: string): Promise<StoredSourceBinding[]> {
    return structuredClone([...this.state.sourceBindings.values()]
      .filter((item) => connectionId === undefined || item.connection_id === connectionId)
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.binding_id, b.binding_id)));
  }

  async saveSourceBinding(binding: StoredSourceBinding): Promise<void> {
    await this.write(() => {
      const connection = this.state.providerConnections.get(binding.connection_id);
      if (connection?.provider !== binding.provider) throw new Error("知识库连接不存在或不匹配");
      for (const item of this.state.sourceBindings.values()) {
        const sameLibrary = item.connection_id === binding.connection_id && item.remote_kb_id === binding.remote_kb_id;
        if ((item.binding_id === binding.binding_id) !== sameLibrary) throw new Error("知识库绑定身份冲突");
      }
      this.state.sourceBindings.set(binding.binding_id, { ...binding });
    });
  }

  async deleteSourceBinding(id: string): Promise<void> {
    await this.write(() => this.state.sourceBindings.delete(id));
  }

  async readSetting(name: string): Promise<string | null> {
    return this.state.settings.get(name) ?? null;
  }

  async getSkill(skillId: string): Promise<StoredSkill | null> {
    return structuredClone(this.state.skills.get(skillId) ?? null);
  }

  async listSkills(): Promise<StoredSkill[]> {
    return structuredClone([...this.state.skills.values()].sort((a, b) => byId(a.skill_id, b.skill_id)));
  }

  async saveSkill(skill: StoredSkill): Promise<void> {
    await this.write(() => {
      for (const item of this.state.skills.values()) {
        if (item.skill_id !== skill.skill_id && item.origin_kind === skill.origin_kind && item.origin_locator === skill.origin_locator) {
          throw new Error("技能来源已被占用");
        }
      }
      this.state.skills.set(skill.skill_id, { ...skill });
    });
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.write(() => {
      this.state.skills.delete(skillId);
      for (const [key, binding] of this.state.bindings) {
        if (binding.skill_id === skillId) this.state.bindings.delete(key);
      }
    });
  }

  async getSkillRevision(skillId: string, revision: string): Promise<StoredSkillRevision | null> {
    return structuredClone(this.state.revisions.get(JSON.stringify([skillId, revision])) ?? null);
  }

  async saveSkillRevision(revision: StoredSkillRevision): Promise<void> {
    await this.write(() => this.state.revisions.set(JSON.stringify([revision.skill_id, revision.revision]), { ...revision }));
  }

  async skillLibraryBytes(): Promise<number> {
    let total = 0;
    for (const row of this.state.revisions.values()) total += row.raw_bytes;
    return total;
  }

  async deleteInactiveSkillRevisions(): Promise<void> {
    await this.write(() => {
      for (const [key, row] of this.state.revisions) {
        if (this.state.skills.get(row.skill_id)?.active_revision !== row.revision) this.state.revisions.delete(key);
      }
    });
  }

  async listSkillBindings(skillId: string): Promise<StoredSkillBinding[]> {
    return structuredClone([...this.state.bindings.values()].filter((row) => row.skill_id === skillId)
      .sort((a, b) => byId(a.scope, b.scope)));
  }

  async saveSkillBinding(binding: StoredSkillBinding): Promise<void> {
    await this.write(() => this.state.bindings.set(JSON.stringify([binding.skill_id, binding.scope]), { ...binding }));
  }

  async scopeSnapshot(scope: SkillScope): Promise<SkillScopeEntry[]> {
    const { skills, revisions, bindings } = this.state;
    return [...skills.values()].sort((a, b) => byId(a.skill_id, b.skill_id)).map((skill) => ({
      skill: { ...skill },
      binding: bindings.get(JSON.stringify([skill.skill_id, scope]))?.enabled ?? null,
      manifest: revisions.get(JSON.stringify([skill.skill_id, skill.active_revision]))?.manifest_json ?? null,
    }));
  }

  async writeSetting(name: string, value: string): Promise<void> {
    await this.write(() => {
      this.state.settings.set(name, value);
    });
  }

  async get(pathId: string): Promise<LearningProgress | null> {
    return structuredClone(this.state.paths.get(pathId)?.progress ?? null);
  }

  async save(progress: LearningProgress, status?: PathStatus): Promise<void> {
    await this.write(() => this.setProgress(progress, status));
  }

  private setProgress(progress: LearningProgress, status?: PathStatus): void {
    this.state.paths.set(progress.book_id, {
      progress: structuredClone(progress),
      status: status ?? this.state.paths.get(progress.book_id)?.status ?? "active",
    });
  }

  async saveWithCas(progress: LearningProgress, expectedVersion: number | null, status?: PathStatus): Promise<void> {
    await this.write(() => {
      const current = this.state.paths.get(progress.book_id);
      if ((current?.progress.version ?? null) !== expectedVersion ||
          (expectedVersion !== null && progress.version !== expectedVersion + 1)) {
        throw new VersionConflictError();
      }
      this.setProgress(progress, status);
    });
  }

  async listIds(): Promise<string[]> {
    return [...this.state.paths.keys()].sort(byId);
  }

  async delete(pathId: string): Promise<void> {
    await this.write(() => {
      this.state.paths.delete(pathId);
    });
  }

  async listPathSummaries(): Promise<PathSummaryRecord[]> {
    return [...this.state.paths.values()]
      .map(({ progress, status }) => ({
        path_id: progress.book_id,
        name: progress.name,
        status,
        updated_at: progress.updated_at,
      }))
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.path_id, b.path_id));
  }

  async getOpenInteraction(pathId: string): Promise<StoredInteraction | null> {
    return this.latestOpenInteraction(pathId);
  }

  async getLatestOpenInteraction(): Promise<StoredInteraction | null> {
    return this.latestOpenInteraction();
  }

  private latestOpenInteraction(pathId?: string): StoredInteraction | null {
    return structuredClone(this.openInteractions(pathId)[0] ?? null);
  }

  async listOpenInteractions(): Promise<StoredInteraction[]> {
    return structuredClone(this.openInteractions());
  }

  async listGradedInteractions(pathId?: string): Promise<StoredInteraction[]> {
    return structuredClone([...this.state.interactions.values()]
      .filter((item) => item.status === "graded" && (pathId === undefined || item.path_id === pathId))
      .sort((a, b) => b.updated_at - a.updated_at || byId(b.interaction_id, a.interaction_id)));
  }

  async saveKnowledgeCard(card: StoredKnowledgeCard): Promise<void> {
    await this.write(() => { this.state.cards.set(card.card_id, structuredClone(card)); });
  }

  async getKnowledgeCard(id: string): Promise<StoredKnowledgeCard | null> {
    return structuredClone(this.state.cards.get(id) ?? null);
  }

  async listKnowledgeCards({ includeDeleted, query }: KnowledgeCardFilter = {}): Promise<StoredKnowledgeCard[]> {
    const cards = [...this.state.cards.values()].filter(({ deleted_at }) => includeDeleted || deleted_at === null)
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.card_id, b.card_id));
    return structuredClone(searchKnowledgeCards(cards, query));
  }

  async softDeleteKnowledgeCard(id: string, now: number): Promise<void> {
    await this.write(() => {
      const card = this.state.cards.get(id);
      if (card?.deleted_at === null) Object.assign(card, { deleted_at: now, updated_at: now });
    });
  }

  async detachKnowledgeCardsByPath(pathId: string, now: number): Promise<void> {
    await this.write(() => {
      for (const card of this.state.cards.values()) {
        if (card.path_id === pathId) Object.assign(card, { path_id: null, updated_at: now });
      }
    });
  }

  async listOpenInteractionsByPath(pathId: string): Promise<StoredInteraction[]> {
    return structuredClone(this.openInteractions(pathId));
  }

  private openInteractions(pathId?: string): StoredInteraction[] {
    return [...this.state.interactions.values()]
      .filter((item) => (item.status === "awaiting_input" || item.status === "answered") &&
        (pathId === undefined || item.path_id === pathId))
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.interaction_id, b.interaction_id));
  }

  async getInteraction(id: string): Promise<StoredInteraction | null> {
    return structuredClone(this.state.interactions.get(id) ?? null);
  }

  private submission(submissionId: string): StoredInteraction | undefined {
    return [...this.state.interactions.values()].find((item) => item.submission_id === submissionId);
  }

  async findInteractionBySubmission(submissionId: string): Promise<StoredInteraction | null> {
    return structuredClone(this.submission(submissionId) ?? null);
  }

  private checkSubmission(id: string, submissionId: string | null): void {
    if (submissionId === null) return;
    const existing = this.submission(submissionId);
    if (existing && existing.interaction_id !== id) throw new SubmissionConflictError();
  }

  async insertInteraction(interaction: StoredInteraction): Promise<void> {
    await this.write(() => {
      if (this.state.interactions.has(interaction.interaction_id)) {
        throw new Error("Interaction already exists");
      }
      this.checkSubmission(interaction.interaction_id, interaction.submission_id);
      this.state.interactions.set(interaction.interaction_id, structuredClone(interaction));
    });
  }

  async saveAnswer(id: string, submissionId: string, rawAnswer: string, now: number): Promise<void> {
    await this.write(() => {
      const item = this.state.interactions.get(id);
      if (!item || item.status === "abandoned") return;
      this.checkSubmission(id, submissionId);
      Object.assign(item, { raw_answer: rawAnswer, submission_id: submissionId, status: "answered", updated_at: now });
    });
  }

  async markGraded(id: string, now: number): Promise<void> {
    await this.write(() => {
      const item = this.state.interactions.get(id);
      if (item && item.status !== "abandoned") Object.assign(item, { status: "graded", updated_at: now });
    });
  }

  async abandonInteraction(id: string, now: number): Promise<void> {
    await this.write(() => {
      const item = this.state.interactions.get(id);
      if (item?.status === "awaiting_input" || item?.status === "answered") {
        Object.assign(item, { status: "abandoned", updated_at: now });
      }
    });
  }

  async deleteInteractionsByPath(pathId: string): Promise<void> {
    await this.write(() => {
      for (const [id, item] of this.state.interactions) if (item.path_id === pathId) this.state.interactions.delete(id);
    });
  }

  async listInteractionsBySession(sessionId: string): Promise<StoredInteraction[]> {
    return structuredClone([...this.state.interactions.values()].filter((item) => item.session_id === sessionId)
      .sort((a, b) => a.updated_at - b.updated_at || byId(a.interaction_id, b.interaction_id)));
  }

  async updateInteraction(interaction: StoredInteraction): Promise<void> {
    await this.write(() => {
      const current = this.state.interactions.get(interaction.interaction_id);
      if (current?.path_id !== interaction.path_id || current.session_id !== interaction.session_id) return;
      this.checkSubmission(interaction.interaction_id, interaction.submission_id);
      this.state.interactions.set(interaction.interaction_id, structuredClone({ ...interaction, turn_id: current.turn_id }));
    });
  }

  async getSession(id: string): Promise<StoredSession | null> {
    return structuredClone(this.state.sessions.get(id) ?? null);
  }

  async saveSession(session: StoredSession): Promise<void> {
    await this.write(() => {
      this.state.sessions.set(session.session_id, structuredClone(session));
    });
  }

  async listSessions(): Promise<StoredSession[]> {
    return structuredClone([...this.state.sessions.values()]
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.session_id, b.session_id)));
  }

  async listSessionsByPath(pathId: string): Promise<StoredSession[]> {
    return (await this.listSessions()).filter(({ path_id }) => path_id === pathId);
  }

  async updateSession(session: StoredSession): Promise<void> {
    await this.write(() => {
      if (this.state.sessions.has(session.session_id)) this.state.sessions.set(session.session_id, structuredClone(session));
    });
  }

  async deleteSessionsByPath(pathId: string, kind: string): Promise<void> {
    await this.write(() => {
      const ids = new Set([...this.state.sessions.values()].filter((item) => item.path_id === pathId && item.kind === kind)
        .map(({ session_id }) => session_id));
      for (const message of this.state.messages.values()) {
        if (ids.has(message.session_id)) this.state.messages.delete(message.message_id);
      }
      for (const id of ids) this.state.sessions.delete(id);
    });
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    return structuredClone(this.state.messages.get(id) ?? null);
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    await this.write(() => {
      this.state.messages.set(message.message_id, structuredClone(message));
    });
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    return structuredClone([...this.state.messages.values()]
      .filter((item) => item.session_id === sessionId)
      .sort((a, b) => a.created_at - b.created_at || byId(a.message_id, b.message_id)));
  }

  async deleteMessages(ids: readonly string[]): Promise<void> {
    await this.write(() => {
      for (const id of ids) this.state.messages.delete(id);
    });
  }

  async getThread(id: string): Promise<StoredThread | null> {
    return structuredClone(this.state.threads.get(id) ?? null);
  }

  async saveThread(thread: StoredThread): Promise<void> {
    await this.write(() => {
      this.state.threads.set(thread.thread_id, structuredClone(thread));
    });
  }

  async updateThread(thread: StoredThread): Promise<void> {
    await this.write(() => {
      if (this.state.threads.has(thread.thread_id)) this.state.threads.set(thread.thread_id, structuredClone(thread));
    });
  }

  async deleteThread(id: string): Promise<void> {
    await this.write(() => {
      if (!this.state.threads.has(id)) return;
      for (const message of this.state.messages.values()) {
        if (message.session_id === id) this.state.messages.delete(message.message_id);
      }
      this.state.sessions.delete(id);
      this.state.threads.delete(id);
    });
  }

  async listThreads(parentSessionId: string): Promise<StoredThread[]> {
    return structuredClone([...this.state.threads.values()]
      .filter((item) => item.parent_session_id === parentSessionId)
      .sort((a, b) => a.created_at - b.created_at || byId(a.thread_id, b.thread_id)));
  }

  async appendDomainEvent(event: StoredDomainEvent): Promise<void> {
    await this.write(() => {
      if (this.state.events.has(event.event_id)) throw new Error("领域事件已存在");
      this.state.events.set(event.event_id, structuredClone(event));
    });
  }

  async listDomainEvents(pathId: string, limit = -1): Promise<StoredDomainEvent[]> {
    const events = [...this.state.events.values()].filter((event) => event.path_id === pathId).reverse();
    return structuredClone(limit < 0 ? events : events.slice(0, limit));
  }

  async deleteDomainEventsByPath(pathId: string): Promise<void> {
    await this.write(() => {
      for (const [id, event] of this.state.events) if (event.path_id === pathId) this.state.events.delete(id);
    });
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly entries = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
