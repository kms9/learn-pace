/** Adapted from DeepTutor learning/service.py (1284116), Apache-2.0. */
import type { KnowledgePoint, LearningModule, LearningProgress, PendingQuestion } from "./models.js";

export const objectiveFingerprint = ({ name, type }: Pick<KnowledgePoint, "name" | "type">) =>
  JSON.stringify([name.trim().toLowerCase(), type]);

function uniquePoints(modules: readonly LearningModule[]) {
  const unique = new Map<string, KnowledgePoint | null>();
  for (const point of modules.flatMap((module) => module.knowledge_points)) {
    const key = objectiveFingerprint(point);
    unique.set(key, unique.has(key) ? null : point);
  }
  return unique;
}

export function assignOutlineIdentity(progress: LearningProgress, modules: readonly LearningModule[]): LearningModule[] {
  const previous = uniquePoints(progress.modules);
  const next = uniquePoints(modules);
  return modules.map((module) => ({ ...module, knowledge_points: module.knowledge_points.map((point) => {
    const key = objectiveFingerprint(point);
    return { ...point, id: next.get(key) ? previous.get(key)?.id ?? point.id : point.id };
  }) }));
}

export function rebindOutlineQuestion(question: PendingQuestion, locations: ReadonlyMap<string, string>): PendingQuestion | null {
  const moduleId = locations.get(question.knowledge_point_id);
  if (!moduleId) return null;
  const children: PendingQuestion[] = [];
  for (const child of question.questions) {
    const rebound = rebindOutlineQuestion(child, locations);
    if (!rebound) return null;
    children.push(rebound);
  }
  return { ...question, module_id: moduleId, questions: children };
}

export function withOutline(progress: LearningProgress, modules: LearningModule[]): LearningProgress {
  const points = modules.flatMap((module) => module.knowledge_points);
  const locations = new Map(points.map(({ id, module_id }) => [id, module_id]));
  const current = progress.modules.find(({ id }) => id === progress.current_module_id)
    ?.knowledge_points[progress.current_kp_index]?.id;
  const currentModule = modules.find((module) => module.knowledge_points.some(({ id }) => id === current)) ?? modules[0];
  const keep = <T>(entries: Record<string, T>) =>
    Object.fromEntries(Object.entries(entries).filter(([id]) => locations.has(id)));
  return {
    ...progress, modules, current_module_id: currentModule?.id ?? "",
    current_kp_index: Math.max(0, currentModule?.knowledge_points.findIndex(({ id }) => id === current) ?? 0),
    knowledge_types: Object.fromEntries(points.map(({ id, type }) => [id, type])),
    mastery_levels: keep(progress.mastery_levels), qualitative_mastery: keep(progress.qualitative_mastery),
    learner_mastery_overrides: keep(progress.learner_mastery_overrides), deferred_objectives: keep(progress.deferred_objectives),
    repetition_states: keep(progress.repetition_states), review_queue: progress.review_queue.filter((item) => locations.has(item.knowledge_point_id)),
    explained_objectives: keep(progress.explained_objectives), feynman_retries: keep(progress.feynman_retries),
    feynman_explanations: keep(progress.feynman_explanations),
    pending_question: progress.pending_question ? rebindOutlineQuestion(progress.pending_question, locations) : null,
  };
}
