import { KNOWLEDGE_TYPES, stateDigest, type LearnerProfile, type LearningProgress, type SessionMode } from "@learn-pace/domain";
import { VersionConflictError } from "@learn-pace/infra";
import type { PiDurableRuntime, RuntimeTool } from "@learn-pace/runtime";
import { ChatTurnError } from "../../chat-turns.js";
import { masteryModeInstructions } from "../prompts.js";
import type { masteryStatus } from "../status.js";
import { buildOutline, planRevision, type ReviseInput } from "./outline.js";
import { registerStudyTools, type StudyToolContext } from "./study.js";

const modes: SessionMode[] = ["outline", "study", "review"];
const str = { type: "string", minLength: 1 };
const enumeration = (values: readonly string[]) => ({ type: "string", enum: values });
const integer = (minimum: number, maximum?: number) => ({ type: "integer", minimum, ...(maximum === undefined ? {} : { maximum }) });
const arr = (items: object, minItems = 0) => ({ type: "array", items, minItems });
const obj = (properties: Record<string, object>, required: string[] = []) =>
  ({ type: "object", properties, required, additionalProperties: false });

const pointFields = { name: str, type: enumeration(KNOWLEDGE_TYPES), prerequisite_ids: arr(str), topic_source_ids: arr(str) };
const editFields = {
  rewrite: arr(obj({ ...pointFields, knowledge_point_id: str }, ["knowledge_point_id", "name"])),
  add: arr(obj(pointFields, ["name"])), remove: arr(str),
};
type RevisionPlan = ReturnType<typeof planRevision>;
export interface OutlinePreview {
  session_id: string;
  path_id: string;
  base_revision: number;
  before_digest: string;
  plan: RevisionPlan;
  expires_at: number;
}
type ToolContext = {
  pathId: string;
  sessionId: string;
  mode: () => SessionMode;
  switchMode: (mode: SessionMode) => Promise<void>;
  read: () => Promise<LearningProgress>;
  status: () => Promise<ReturnType<typeof masteryStatus>>;
  save: (progress: LearningProgress, outline?: boolean) => Promise<void>;
  now: () => number;
  makeId: () => string;
  previews: Map<string, OutlinePreview>;
  study: StudyToolContext;
};

export type RegisterMasteryTool = (name: string, description: string, schema: object,
  execute: (args: Record<string, unknown>) => Promise<unknown>, gate?: "outline" | "practice",
  termination?: RuntimeTool["termination"]) => void;

function mergedProfile(progress: LearningProgress, patch: Partial<LearnerProfile>, now: number): LearnerProfile {
  const saved = progress.learner_profile ?? {
    prior_knowledge: "", target_level: "", time_budget: "", preferences: "", teaching_strategy: "probe_first", notes: "",
  };
  return { ...saved, ...patch, updated_at: now };
}

export function registerMasteryTools(runtime: PiDurableRuntime, host: ToolContext): string[] {
  const names: string[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const register: RegisterMasteryTool = (name, description, schema, execute, gate, termination) => {
    names.push(name);
    runtime.registerTool({
      name, description, parameters: { ...schema }, privateArgs: true, termination,
      async execute(args, { signal }) {
        const result = queue.then(async () => {
          signal.throwIfAborted();
          if (gate === "outline" && host.mode() !== "outline" || gate === "practice" && host.mode() === "outline") {
            return { ok: false, code: "wrong_mode", message: gate === "outline"
              ? "该工具只在编辑大纲模式可用。可用 mastery_mode 切到 outline。"
              : "该工具只在学习或复习模式可用。可用 mastery_mode 切换模式。" };
          }
          try {
            return JSON.parse(JSON.stringify(await execute(args))) as Awaited<ReturnType<RuntimeTool["execute"]>>;
          } catch (error) {
            if (error instanceof VersionConflictError) return { ok: false, code: "version_conflict", message: error.message };
            if (error instanceof ToolRefusal || error instanceof ChatTurnError) return { ok: false, code: "rejected", message: error.message };
            return { ok: false, code: "unavailable", message: "无法完成工具操作，请重新读取状态再试。" };
          }
        });
        queue = result.catch(() => {});
        return result;
      },
    });
  };
  register("mastery_status", "读取现有大纲、最新模式与学习状态。", obj({}), host.status);
  register("mastery_profile", "合并保存学习者已说明的基础、目标、时间和偏好。", obj({
    prior_knowledge: str, target_level: str, time_budget: str, preferences: str, notes: str,
    teaching_strategy: enumeration(["probe_first", "teach_first"]),
  }), async (args) => {
    const progress = await host.read();
    const profile = mergedProfile(progress, args, host.now());
    await host.save({ ...progress, learner_profile: profile });
    return { ok: true, learner_profile: profile };
  });
  register("mastery_mode", "切换本会话模式，读返回指令后继续。", obj({ mode: enumeration(modes), reason: str }, ["mode"]),
    async ({ mode }) => {
      const next = mode as SessionMode;
      await host.switchMode(next);
      return { ok: true, mode: next, instructions: masteryModeInstructions[next] };
    });
  register("read_source", "按资料 ID 读取本路径的选文、会话或笔记。offset 和 limit 以 Unicode 码点计算。", obj({
    source_id: str, offset: integer(0), limit: integer(1, 8000),
  }, ["source_id"]), async ({ source_id, offset, limit }) => {
    const source = (await host.read()).topic_sources?.find(({ id }) => id === source_id);
    if (!source) throw new ToolRefusal("找不到该资料，请使用 mastery_status 返回的资料 ID");
    const chars = [...source.excerpt];
    const start = (offset as number | undefined) ?? 0;
    const end = Math.min(chars.length, start + ((limit as number | undefined) ?? 8000));
    return { ok: true, source_id, label: source.label, excerpt: chars.slice(start, end).join(""),
      offset: start, next_offset: end < chars.length ? end : null, total_chars: chars.length };
  });
  register("mastery_build", "保存新大纲。替换时保留同名同类型知识点身份；也可追加模块。", obj({
    mode: enumeration(["replace", "append"]), path_name: str, modules: arr(obj({
      name: str, objective: str, knowledge_points: arr(obj({ ...pointFields, prerequisites: arr(str) }, ["name", "type"]), 1),
    }, ["name", "objective", "knowledge_points"]), 1),
  }, ["mode", "modules"]), async (args) => {
    const previous = await host.read();
    const next = plan(() => buildOutline(previous, args as unknown as Parameters<typeof buildOutline>[1], host.makeId));
    await host.save(next, true);
    const result = await host.status();
    return { ok: true, path_revision: result.path_revision, map: result.map };
  }, "outline");
  register("mastery_revise", "修订模块内的知识点。重排必须使用 preview 和完整 module_order，再用 commit 提交 preview_id。", obj({
    action: enumeration(["preview", "commit"]), preview_id: str, expected_revision: integer(0),
    module_id: str, modules: arr(obj({ module_id: str, ...editFields }, ["module_id"]), 1),
    module_order: arr(str, 1), ...editFields,
  }), async (args) => {
    const input = args as ReviseInput;
    const previous = await host.read();
    const now = host.now();
    if (input.action === "commit") {
      if (!input.preview_id || Object.keys(args).some((key) => key !== "action" && key !== "preview_id")) {
        throw new ToolRefusal("提交只接受 action=commit 与 preview_id");
      }
      const preview = host.previews.get(input.preview_id);
      if (preview?.session_id !== host.sessionId || preview.path_id !== host.pathId ||
          preview.expires_at <= now) {
        throw new ToolRefusal("预览已过期或不属于本会话，请重新预览");
      }
      if (preview.base_revision !== previous.version || preview.before_digest !== stateDigest(previous)) {
        throw new VersionConflictError();
      }
      await host.save(preview.plan.progress, true);
      host.previews.delete(input.preview_id);
      return { ok: true, action: "commit", path_revision: (await host.status()).path_revision, effects: preview.plan.effects };
    }
    if ((input.action === "preview" || input.expected_revision !== undefined) && input.expected_revision !== previous.version) {
      throw new VersionConflictError();
    }
    const proposal = plan(() => planRevision(previous, input, host.makeId));
    if (input.action === "preview") {
      for (const [id, entry] of host.previews) if (entry.expires_at <= now) host.previews.delete(id);
      const preview_id = host.makeId();
      const expires_at = now + 3600;
      host.previews.set(preview_id, { path_id: host.pathId, session_id: host.sessionId, base_revision: previous.version,
        before_digest: stateDigest(previous), plan: proposal, expires_at });
      return { ok: true, action: "preview", preview_id, expires_at, base_revision: previous.version,
        changes: proposal.changes, effects: proposal.effects, proposed_modules: proposal.progress.modules };
    }
    await host.save(proposal.progress, true);
    return { ok: true, path_revision: (await host.status()).path_revision, effects: proposal.effects };
  }, "outline");
  registerStudyTools(register, host.study);
  return names;
}

export class ToolRefusal extends Error {}

function plan<T>(calculate: () => T): T {
  try { return calculate(); }
  catch (error) { throw new ToolRefusal(error instanceof Error ? error.message : "大纲参数无效"); }
}
