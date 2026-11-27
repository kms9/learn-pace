/** Adapted from DeepTutor outline_revision.py and mastery/tools.py (1284116), Apache-2.0. */
import { createKnowledgePoint, type KnowledgePoint, type KnowledgeType, type LearningModule, type LearningProgress } from "./models.js";
import { normalizeRefs, resolvePrerequisites, validateObjectiveRelations } from "./objective-relations.js";
import { objectiveFingerprint, withOutline } from "./outline-identity.js";
import { isMastered } from "./policy.js";

export type OutlinePointInput = {
  name: string;
  type?: KnowledgeType;
  prerequisite_ids?: string[];
  topic_source_ids?: string[];
};

export interface ModuleRevision {
  module_id: string;
  rewrite?: (OutlinePointInput & { knowledge_point_id: string })[];
  add?: OutlinePointInput[];
  remove?: string[];
}

export function reorderModules(modules: readonly LearningModule[], order: readonly string[]): LearningModule[] {
  const known = new Map(modules.map((module) => [module.id, module]));
  if (order.length !== modules.length || known.size !== modules.length ||
    new Set(order).size !== order.length || order.some((id) => !known.has(id))) {
    throw new Error("module_order 必须列出每个现有模块 ID 各一次");
  }
  return order.map((id, index) => ({ ...known.get(id)!, order: index }));
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

/** Canonical state for preview equality, independent of timestamps and property insertion order. */
export function stateDigest({ version: _version, updated_at: _updated, ...state }: LearningProgress): string {
  return canonical(state);
}

export interface OutlineChange { path: string; before_exists: boolean; after_exists: boolean; before: unknown; after: unknown }
function diff(before: unknown, after: unknown, path: string): OutlineChange[] {
  if (canonical(before) === canonical(after)) return [];
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, i) => diff(item, after[i], path + "/" + i));
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const left = Object.fromEntries(Object.entries(before));
    const right = Object.fromEntries(Object.entries(after));
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => {
      const pointer = path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1");
      const inLeft = Object.hasOwn(left, key);
      const inRight = Object.hasOwn(right, key);
      if (inLeft && inRight) return diff(left[key], right[key], pointer);
      return [{ path: pointer, before_exists: inLeft, after_exists: inRight,
        before: inLeft ? left[key] : null, after: inRight ? right[key] : null }];
    });
  }
  return [{ path, before_exists: true, after_exists: true, before, after }];
}

export function planOutlineRevision(progress: LearningProgress, edits: readonly ModuleRevision[],
  order: readonly string[] | undefined, makeId: () => string) {
  const byModule = new Map(edits.map((edit) => [edit.module_id, edit]));
  if (!edits.length && !order) throw new Error("请提供要修改的模块或大纲顺序");
  if (byModule.size !== edits.length) throw new Error("同一模块只能出现一次");
  const known = new Set(progress.modules.map(({ id }) => id));
  if (edits.some(({ module_id }) => !known.has(module_id))) throw new Error("该路径中没有指定模块，请先用 mastery_status 查询");

  const rewrites = new Map<string, string>();
  const removed = new Set<string>();
  const added: string[] = [];
  const modules = [...progress.modules].sort((a, b) => a.order - b.order).map((module) => {
    const edit = byModule.get(module.id);
    if (!edit) return module;
    const rewrite = new Map((edit.rewrite ?? []).map((point) => [point.knowledge_point_id, point]));
    const remove = new Set(edit.remove ?? []);
    const ids = new Set(module.knowledge_points.map(({ id }) => id));
    if (rewrite.size !== (edit.rewrite?.length ?? 0) || remove.size !== (edit.remove?.length ?? 0) ||
      [...rewrite.keys()].some((id) => !ids.has(id) || remove.has(id)) || [...remove].some((id) => !ids.has(id))) {
      throw new Error("知识点必须属于指定模块，每个知识点只能修改一次");
    }
    function applyPoint(input: OutlinePointInput, previous?: KnowledgePoint): KnowledgePoint {
      const name = input.name.trim();
      if (!name) throw new Error("知识点名称不能为空");
      const type = input.type ?? previous?.type ?? "concept";
      const same = previous && objectiveFingerprint(previous) === objectiveFingerprint({ name, type });
      const id = same ? previous.id : makeId();
      if (!same && previous) rewrites.set(previous.id, id);
      if (!same && !previous) added.push(id);
      return createKnowledgePoint({
        ...previous, id, name, type, module_id: module.id,
        prerequisite_ids: input.prerequisite_ids ?? previous?.prerequisite_ids ?? [],
        topic_source_ids: input.topic_source_ids ?? previous?.topic_source_ids ?? [],
      });
    }
    const points = module.knowledge_points.flatMap((point) => {
      const patch = rewrite.get(point.id);
      if ((patch || remove.has(point.id)) && isMastered(progress, point)) {
        throw new Error(`「${point.name}」已经掌握，不能删除或重写`);
      }
      if (remove.has(point.id)) { removed.add(point.id); return []; }
      return [patch ? applyPoint(patch, point) : point];
    });
    points.push(...(edit.add ?? []).map((point) => applyPoint(point)));
    if (!points.length) throw new Error("修改后的模块必须保留知识点");
    return { ...module, knowledge_points: points };
  });
  const related = modules.map((module) => ({ ...module, knowledge_points: module.knowledge_points.map((point) => ({
    ...point,
    prerequisite_ids: resolvePrerequisites(modules, point.prerequisite_ids.map((id) => rewrites.get(id) ?? id)),
    topic_source_ids: normalizeRefs(point.topic_source_ids),
  })) }));
  const proposed = order ? reorderModules(related, order) : related;
  validateObjectiveRelations(proposed, progress.topic_sources ?? []);
  const next = withOutline(progress, proposed);
  return {
    progress: next,
    changes: diff(progress.modules, proposed, "/modules"),
    effects: { rewritten: [...rewrites].map(([previous_id, new_id]) => ({ previous_id, new_id })),
      removed: [...removed], added, reordered: Boolean(order && order.some((id, index) =>
        id !== [...progress.modules].sort((a, b) => a.order - b.order)[index]?.id)),
      pending_removed: Boolean(progress.pending_question && !next.pending_question) },
  };
}
