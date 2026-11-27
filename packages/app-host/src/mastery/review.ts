import {
  compareReviewTasks, isMastered, reviewableTasks, schedulerForProgress, type LearningProgress,
} from "@learn-pace/domain";

const day = 86_400;

export function reviewPlan(progress: LearningProgress, now: number) {
  const names = new Map(progress.modules.flatMap(({ knowledge_points }) => knowledge_points.map(({ id, name }) => [id, name])));
  const evidence = new Map(progress.learning_evidence.map((entry) => [entry.knowledge_point_id, entry]));
  const scheduler = schedulerForProgress(progress);
  const tasks = reviewableTasks(progress).map((task) => ({ ...task,
    forgetting_risk: scheduler.forgettingRisk(task.state, progress, task.knowledge_point_id, now),
    reason: scheduler.reviewReason(task.state, progress, task.knowledge_point_id,
      { now, latest_evidence: evidence.get(task.knowledge_point_id) }),
  }));
  const due = tasks.filter(({ due_at }) => due_at <= now).sort((a, b) => compareReviewTasks(a, b, now));
  const upcoming = tasks.filter(({ due_at }) => due_at > now).sort((a, b) => a.due_at - b.due_at);
  const item = ({ knowledge_point_id, due_at, forgetting_risk, reason, state }: typeof tasks[number]) => ({
    knowledge_point_id, knowledge_point_name: names.get(knowledge_point_id) ?? "", due_at,
    forgetting_risk, reason, lapse_count: state.lapse_count,
  });
  return { now, due: due.map(item), upcoming: upcoming.map(item),
    strategy_id: progress.review_strategy?.template_id ?? null, desired_retention: progress.desired_retention };
}

export function reviewSnapshot(progress: LearningProgress, plan: ReturnType<typeof reviewPlan>, sessionId?: string) {
  const objectives = new Map(progress.modules.flatMap(({ knowledge_points }) => knowledge_points.map((point) => [point.id, point])));
  const reviewed = new Map<string, { knowledge_point_id: string; knowledge_point_name: string; results: string[]; next_review_at: number | null }>();
  if (sessionId) for (const evidence of progress.learning_evidence) {
    if (evidence.session_id !== sessionId || evidence.visual_context?.session_mode !== "review") continue;
    const id = evidence.knowledge_point_id;
    const objective = objectives.get(id);
    if (!objective) continue;
    const prior = reviewed.get(id);
    if (prior) prior.results.push(evidence.result);
    else reviewed.set(id, { knowledge_point_id: id, knowledge_point_name: objective.name, results: [evidence.result],
      next_review_at: isMastered(progress, objective) ? progress.repetition_states[id]?.next_review_at ?? null : null });
  }
  return { due: plan.due, upcoming: plan.upcoming.filter(({ due_at }) => due_at <= plan.now + 7 * day),
    ...(sessionId && { reviewed: [...reviewed.values()].map((item) => ({ ...item,
      next_review_time: item.next_review_at === null ? null : new Date(item.next_review_at * 1000).toISOString(),
    })) }) };
}
