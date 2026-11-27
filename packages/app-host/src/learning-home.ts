import { derivePathStatus, dueReviews, nextObjective, objectiveStatus, pathDisplayName, type LearningProgress } from "@learn-pace/domain";
import type { AppStore, Clock, StoredInteraction, StoredSession } from "@learn-pace/infra";
import { limitText } from "./chat-turns.js";

export function summarizePath(progress: LearningProgress, now: number, open?: StoredInteraction | null) {
  const points = progress.modules.flatMap(({ knowledge_points }) => knowledge_points);
  const total = points.length;
  const counts = { mastered: 0, learning: 0, new: 0, total };
  for (const point of points) counts[objectiveStatus(progress, point)]++;
  const { mastered } = counts;
  return {
    counts, mastered, total, percentage: total ? Math.round(mastered / total * 100) : 0,
    dueCount: dueReviews(progress, now).length,
    status: derivePathStatus(progress),
    next: nextObjective(open ? { ...progress, pending_question: open.question } : progress,
      { now, pending_session_id: open?.session_id }),
  };
}

export async function latestSessionQuestion(store: AppStore, session: StoredSession) {
  const cards = await store.listInteractionsBySession(session.session_id);
  return cards.filter((card) => card.path_id === session.path_id &&
    (card.status === "awaiting_input" || card.status === "answered")).at(-1);
}

export function projectLearningRecord(progress: LearningProgress, now: number, open?: StoredInteraction | null) {
  return {
    id: progress.book_id, name: pathDisplayName(progress), emoji: progress.emoji ?? "🧭",
    ...summarizePath(progress, now, open),
  };
}

export type LearningRecord = ReturnType<typeof projectLearningRecord>;
export type LearningAttention =
  | { kind: "question"; path: LearningRecord; sessionId: string; prompt: string; answered: boolean }
  | { kind: "review"; path: LearningRecord };

export async function readLearningRecords(store: AppStore, now: number): Promise<LearningRecord[]> {
  const paths = await store.listPathSummaries();
  const records = await Promise.all(paths.map(async ({ path_id }) => {
    const [progress, open] = await Promise.all([store.get(path_id), store.getOpenInteraction(path_id)]);
    return progress && projectLearningRecord(progress, now, open);
  }));
  return records.filter((path) => path !== null);
}

export class LearningHomeService {
  constructor(private readonly store: AppStore, private readonly clock: Clock) {}

  async read(): Promise<{ attention: LearningAttention[]; records: LearningRecord[] }> {
    const now = this.clock.nowSeconds();
    const [records, sessions] = await Promise.all([readLearningRecords(this.store, now), this.store.listSessions()]);
    const byId = new Map(records.map((record) => [record.id, record]));
    const questions = (await Promise.all(sessions.flatMap((session) => {
      const path = session.kind === "mastery" && session.mode && session.path_id ? byId.get(session.path_id) : undefined;
      if (!path) return [];
      return [latestSessionQuestion(this.store, session).then((card): LearningAttention | null => card ? {
        kind: "question", path, sessionId: session.session_id,
        prompt: limitText(card.question.prompt.trim().replace(/\s+/g, " "), 120), answered: card.status === "answered",
      } : null)];
    }))).filter((item) => item !== null);
    const reviews = records.filter(({ dueCount }) => dueCount > 0).map((path): LearningAttention => ({ kind: "review", path }));
    return { attention: [...questions, ...reviews].slice(0, 5), records };
  }
}
