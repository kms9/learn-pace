import {
  assignOutlineIdentity, createKnowledgePoint, createLearningModule, normalizeRefs, planOutlineRevision,
  resolvePrerequisites, validateObjectiveRelations, withOutline,
  type KnowledgeType, type LearningProgress, type ModuleRevision, type OutlinePointInput,
} from "@learn-pace/domain";

interface BuildInput {
  mode: "replace" | "append";
  path_name?: string;
  modules: { name: string; objective: string; knowledge_points: (OutlinePointInput & {
    type: KnowledgeType; prerequisites?: string[];
  })[] }[];
}

export function buildOutline(progress: LearningProgress, input: BuildInput, makeId: () => string) {
  const offset = input.mode === "append" ? progress.modules.length : 0;
  const newModules = input.modules.map((data, index) => {
    const id = makeId();
    const name = data.name.trim();
    const objective = data.objective.trim();
    if (!name || !objective) throw new Error("模块名称及目标不能为空");
    return createLearningModule({ id, name, objective, order: offset + index,
      knowledge_points: data.knowledge_points.map((point) => {
        const label = point.name.trim();
        if (!label) throw new Error("知识点名称不能为空");
        return createKnowledgePoint({
          id: makeId(), name: label, type: point.type, module_id: id,
          prerequisite_ids: point.prerequisite_ids ?? point.prerequisites ?? [],
          topic_source_ids: normalizeRefs(point.topic_source_ids ?? []),
        });
      }),
    });
  });
  const all = input.mode === "append" ? [...progress.modules, ...newModules] : assignOutlineIdentity(progress, newModules);
  const modules = all.map((module) => ({ ...module, knowledge_points: module.knowledge_points.map((point) => ({
    ...point, prerequisite_ids: resolvePrerequisites(all, point.prerequisite_ids),
  })) }));
  validateObjectiveRelations(modules, progress.topic_sources ?? []);
  return withOutline({ ...progress, name: progress.name.trim() || input.path_name?.trim() || "" }, modules);
}

export interface ReviseInput extends Omit<ModuleRevision, "module_id"> {
  action?: "preview" | "commit";
  module_id?: string;
  modules?: ModuleRevision[];
  module_order?: string[];
  expected_revision?: number;
  preview_id?: string;
}

export function planRevision(progress: LearningProgress, input: ReviseInput, makeId: () => string) {
  const { module_id, modules, rewrite, add, remove, module_order } = input;
  const hasSingleChanges = Boolean(rewrite?.length || add?.length || remove?.length);
  if (input.preview_id) throw new Error("preview_id 只用于提交");
  if (modules?.length && (module_id || hasSingleChanges)) throw new Error("请在单模块或多模块形式中选择一种");
  if (!module_id && hasSingleChanges) throw new Error("请提供 module_id");
  if (module_order && input.action !== "preview") throw new Error("调整模块顺序需要先预览，再提交");
  const edits = modules?.length ? modules : module_id && hasSingleChanges ? [{ module_id, rewrite, add, remove }] : [];
  return planOutlineRevision(progress, edits, module_order, makeId);
}
