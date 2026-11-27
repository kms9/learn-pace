import {
  learningStage, mapSummary, pathDisplayName, publicPendingQuestion, type LearningProgress, type SessionMode,
} from "@learn-pace/domain";
import type { StoredInteraction } from "@learn-pace/infra";
import { limitText } from "../chat-turns.js";
import { summarizePath } from "../learning-home.js";
import { reviewPlan, reviewSnapshot } from "./review.js";

export function masteryStatus(progress: LearningProgress, mode: SessionMode, now: number, open?: StoredInteraction | null,
  sessionId?: string, plan = reviewPlan(progress, now)) {
  const map = mapSummary(progress, now);
  const { next, ...summary } = summarizePath(progress, now, open);
  return {
    path_id: progress.book_id,
    path_name: pathDisplayName(progress),
    goal: progress.goal ?? "",
    status: summary.total ? "active" as const : "empty" as const,
    mode,
    sources: (progress.topic_sources ?? []).map(({ id, kind, label, excerpt }) =>
      ({ id, kind, label, summary: limitText(excerpt, 280) })),
    next,
    summary,
    reviews: reviewSnapshot(progress, plan, mode === "review" ? sessionId : undefined),
    map,
    learning_stages: Object.fromEntries(map.modules.flatMap((module) =>
      module.knowledge_points.map(({ id }) => [id, learningStage(progress, id)]))),
    learner_profile: progress.learner_profile,
    intake_needed: !progress.learner_profile?.prior_knowledge || !progress.learner_profile?.target_level,
    pending_interaction: open ? { status: open.status, session_id: open.session_id,
      ...publicPendingQuestion(open.question), grade: open.grade ?? null } : null,
    path_revision: progress.version,
  };
}
