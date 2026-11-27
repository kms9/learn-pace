/** Adapted from DeepTutor objective_relations.py (1284116), Apache-2.0. */
import type { LearningModule, TopicSource } from "./models.js";

export class ObjectiveRelationError extends Error {}

export function normalizeRefs(refs: readonly string[]): string[] {
  return [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
}

export function validateObjectiveRelations(modules: readonly LearningModule[], sources: readonly TopicSource[]): void {
  const points = modules.flatMap((module) => module.knowledge_points);
  const graph = new Map(points.map((point) => [point.id, normalizeRefs(point.prerequisite_ids)]));
  if (graph.size !== points.length) throw new ObjectiveRelationError("知识点 ID 必须唯一");
  if (new Set(modules.map(({ id }) => id)).size !== modules.length) throw new ObjectiveRelationError("模块 ID 必须唯一");
  const sourceIds = new Set(sources.filter(({ kind }) => kind !== "goal").map(({ id }) => id));
  for (const point of points) {
    for (const source of point.topic_source_ids) {
      if (!sourceIds.has(source)) throw new ObjectiveRelationError(`「${point.name}」引用了未知或目标资料「${source}」`);
    }
    for (const prerequisite of graph.get(point.id)!) {
      if (prerequisite === point.id) throw new ObjectiveRelationError(`「${point.name}」不能依赖自身`);
      if (!graph.has(prerequisite)) throw new ObjectiveRelationError(`「${point.name}」有未知先修「${prerequisite}」`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const names = new Map(points.map(({ id, name }) => [id, name]));
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id].map((key) => names.get(key));
      throw new ObjectiveRelationError("先修环路：" + cycle.join(" → "));
    }
    visiting.add(id);
    path.push(id);
    for (const prerequisite of graph.get(id)!) visit(prerequisite);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id);
}

export function resolvePrerequisites(modules: readonly LearningModule[], refs: readonly string[]): string[] {
  const points = modules.flatMap((module) => module.knowledge_points);
  return normalizeRefs(normalizeRefs(refs).map((ref) => {
    if (points.some(({ id }) => id === ref)) return ref;
    const matches = points.filter(({ name }) => name.trim().toLowerCase() === ref.toLowerCase());
    if (matches.length > 1) throw new ObjectiveRelationError(`先修名称「${ref}」不唯一，请改用知识点 ID`);
    return matches[0]?.id ?? ref;
  }));
}
