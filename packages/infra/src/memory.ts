import type { LearningProgress, PathStatus } from "@learn-pace/domain";
import type {
  AppStore, PathSummaryRecord, SecretStore, StoredInteraction, StoredMessage, StoredSession, StoredThread,
} from "./index.js";

function byId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class MemoryAppStore implements AppStore {
  private readonly settings = new Map<string, string>();
  private readonly paths = new Map<string, { progress: LearningProgress; status: PathStatus }>();
  private readonly interactions = new Map<string, StoredInteraction>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly messages = new Map<string, StoredMessage>();
  private readonly threads = new Map<string, StoredThread>();

  async readSetting(name: string): Promise<string | null> {
    return this.settings.get(name) ?? null;
  }

  async writeSetting(name: string, value: string): Promise<void> {
    this.settings.set(name, value);
  }

  async get(pathId: string): Promise<LearningProgress | null> {
    return structuredClone(this.paths.get(pathId)?.progress ?? null);
  }

  async save(progress: LearningProgress, status?: PathStatus): Promise<void> {
    this.paths.set(progress.book_id, {
      progress: structuredClone(progress),
      status: status ?? this.paths.get(progress.book_id)?.status ?? "active",
    });
  }

  async listIds(): Promise<string[]> {
    return [...this.paths.keys()].sort(byId);
  }

  async delete(pathId: string): Promise<void> {
    this.paths.delete(pathId);
  }

  async listPathSummaries(): Promise<PathSummaryRecord[]> {
    return [...this.paths.values()]
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
    const latest = [...this.interactions.values()]
      .filter((item) => (item.status === "awaiting_input" || item.status === "answered") &&
        (pathId === undefined || item.path_id === pathId))
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.interaction_id, b.interaction_id))[0];
    return structuredClone(latest ?? null);
  }

  async getInteraction(id: string): Promise<StoredInteraction | null> {
    return structuredClone(this.interactions.get(id) ?? null);
  }

  async insertInteraction(interaction: StoredInteraction): Promise<void> {
    if (this.interactions.has(interaction.interaction_id)) {
      throw new Error("Interaction already exists");
    }
    this.interactions.set(interaction.interaction_id, structuredClone(interaction));
  }

  async saveAnswer(id: string, submissionId: string, rawAnswer: string, now: number): Promise<void> {
    const item = this.interactions.get(id);
    if (item && item.status !== "abandoned") Object.assign(item, {
      raw_answer: rawAnswer, submission_id: submissionId, status: "answered", updated_at: now,
    });
  }

  async markGraded(id: string, now: number): Promise<void> {
    const item = this.interactions.get(id);
    if (item && item.status !== "abandoned") Object.assign(item, { status: "graded", updated_at: now });
  }

  async abandonInteraction(id: string, now: number): Promise<void> {
    const item = this.interactions.get(id);
    if (item?.status === "awaiting_input" || item?.status === "answered") {
      Object.assign(item, { status: "abandoned", updated_at: now });
    }
  }

  async deleteInteractionsByPath(pathId: string): Promise<void> {
    for (const [id, item] of this.interactions) if (item.path_id === pathId) this.interactions.delete(id);
  }

  async listInteractionsBySession(sessionId: string): Promise<StoredInteraction[]> {
    return structuredClone([...this.interactions.values()].filter((item) => item.session_id === sessionId)
      .sort((a, b) => a.updated_at - b.updated_at || byId(a.interaction_id, b.interaction_id)));
  }

  async updateInteraction(interaction: StoredInteraction): Promise<void> {
    const current = this.interactions.get(interaction.interaction_id);
    if (current?.path_id !== interaction.path_id || current.session_id !== interaction.session_id) return;
    this.interactions.set(interaction.interaction_id, structuredClone({ ...interaction, turn_id: current.turn_id }));
  }

  async getSession(id: string): Promise<StoredSession | null> {
    return structuredClone(this.sessions.get(id) ?? null);
  }

  async saveSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.session_id, structuredClone(session));
  }

  async listSessions(): Promise<StoredSession[]> {
    return structuredClone([...this.sessions.values()]
      .sort((a, b) => b.updated_at - a.updated_at || byId(a.session_id, b.session_id)));
  }

  async listSessionsByPath(pathId: string): Promise<StoredSession[]> {
    return (await this.listSessions()).filter(({ path_id }) => path_id === pathId);
  }

  async updateSession(session: StoredSession): Promise<void> {
    if (this.sessions.has(session.session_id)) await this.saveSession(session);
  }

  async deleteSessionsByPath(pathId: string, kind: string): Promise<void> {
    const ids = new Set((await this.listSessionsByPath(pathId)).filter((item) => item.kind === kind)
      .map(({ session_id }) => session_id));
    for (const message of this.messages.values()) {
      if (ids.has(message.session_id)) this.messages.delete(message.message_id);
    }
    for (const id of ids) this.sessions.delete(id);
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    return structuredClone(this.messages.get(id) ?? null);
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    this.messages.set(message.message_id, structuredClone(message));
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    return structuredClone([...this.messages.values()]
      .filter((item) => item.session_id === sessionId)
      .sort((a, b) => a.created_at - b.created_at || byId(a.message_id, b.message_id)));
  }

  async deleteMessages(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.messages.delete(id);
  }

  async getThread(id: string): Promise<StoredThread | null> {
    return structuredClone(this.threads.get(id) ?? null);
  }

  async saveThread(thread: StoredThread): Promise<void> {
    this.threads.set(thread.thread_id, structuredClone(thread));
  }

  async updateThread(thread: StoredThread): Promise<void> {
    if (this.threads.has(thread.thread_id)) await this.saveThread(thread);
  }

  async deleteThread(id: string): Promise<void> {
    if (!this.threads.has(id)) return;
    for (const message of this.messages.values()) {
      if (message.session_id === id) this.messages.delete(message.message_id);
    }
    this.sessions.delete(id);
    this.threads.delete(id);
  }

  async listThreads(parentSessionId: string): Promise<StoredThread[]> {
    return structuredClone([...this.threads.values()]
      .filter((item) => item.parent_session_id === parentSessionId)
      .sort((a, b) => a.created_at - b.created_at || byId(a.thread_id, b.thread_id)));
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
