import type { SkillScope, SkillScopeEntry, SkillStore } from "@learn-pace/infra";
import { checkCompatibility, skillIsUsable } from "../skills/compatibility.js";
import {
  decodeSkillText, maxSkillInstructions, parseSkillEntry, skillEntry, type SkillManifestFile,
} from "../skills/package-validator.js";
import { readSkillDeclarations, readSkillFileBytes, readSkillManifest } from "../skills/package-storage.js";
import type { SkillSelection } from "./receipts.js";

export const autoDiscoveryEnabled = false;
const errorMessages = {
  revision_missing: "该技能版本已不存在或已更新，请在当前会话重新选择。",
  scope_denied: "该技能未授权用于当前场景或不允许手动调用。",
  skill_disabled: "该技能已停用，请先在「我的」中启用。",
  dependency_missing: "该技能依赖的工具或运行环境在当前场景不可用。",
  kb_not_configured: "请先重新连接并授权此知识库。",
  kb_auth_denied: "知识库拒绝授权，请检查凭据后重新连接。",
  kb_binding_missing: "找不到此知识库绑定，请重新授权或改用普通问答。",
};
type PrepareCode = keyof typeof errorMessages;

export class ExtensionPrepareError extends Error {
  constructor(readonly code: PrepareCode, message = errorMessages[code]) {
    super(message);
    this.name = "ExtensionPrepareError";
  }
}

export type PinnedSkill = SkillSelection & {
  name: string;
  description: string;
  manifest: readonly SkillManifestFile[];
};

export interface TurnSkillSnapshot {
  explicit?: { skill: PinnedSkill; instructions: string };
  discoverable: readonly PinnedSkill[];
}

export class TurnSkillBudget {
  private calls = 0;
  private characters = 0;
  private readonly skills = new Set<string>();

  claimCall(): boolean {
    if (this.calls >= 12) return false;
    this.calls++;
    return true;
  }

  reserveLoad(skillId: string, body: string): boolean {
    if (this.skills.has(skillId)) return true;
    if (this.skills.size >= 3 || !this.reserveText(body)) return false;
    this.skills.add(skillId);
    return true;
  }

  reserveText(text: string): boolean {
    const size = Array.from(text).length;
    if (this.characters + size > maxSkillInstructions) return false;
    this.characters += size;
    return true;
  }
}

function available(entry: SkillScopeEntry, scope: SkillScope, knowledgeReady = true): PinnedSkill {
  const { skill, binding, manifest } = entry;
  if (skill.enabled !== 1) throw new ExtensionPrepareError("skill_disabled");
  if (binding !== 1) throw new ExtensionPrepareError("scope_denied");
  if (manifest === null) throw new ExtensionPrepareError("revision_missing");
  try {
    const files = readSkillManifest(manifest);
    const declarations = readSkillDeclarations(skill);
    if (!skillIsUsable(checkCompatibility(declarations, files, scope))) {
      throw new ExtensionPrepareError("dependency_missing");
    }
    if (!knowledgeReady && declarations.allowedTools.some(name => name.startsWith("knowledge_"))) {
      throw new ExtensionPrepareError("dependency_missing", "请先选择一个已绑定的知识库。");
    }
    return Object.freeze({
      skillId: skill.skill_id, revision: skill.active_revision, name: skill.name, description: skill.description,
      manifest: Object.freeze(files.map((file) => Object.freeze(file))),
    });
  } catch (error) {
    if (error instanceof ExtensionPrepareError) throw error;
    throw new ExtensionPrepareError("revision_missing");
  }
}

export async function pinnedSkillInstructions(store: SkillStore, skill: PinnedSkill): Promise<string | null> {
  try {
    const row = await store.getSkillRevision(skill.skillId, skill.revision);
    const bytes = row && readSkillFileBytes(row, skillEntry);
    const text = bytes && decodeSkillText(bytes);
    return text ? parseSkillEntry(text).instructions : null;
  } catch {
    return null;
  }
}

export class TurnExtensionResolver {
  constructor(private readonly store: SkillStore, private readonly discoveryEnabled = autoDiscoveryEnabled) {}

  async selectable(scope: SkillScope): Promise<{ skillId: string; name: string; description: string }[]> {
    const entries = await this.store.scopeSnapshot(scope);
    return entries.flatMap((entry) => {
      if (entry.skill.user_invocable !== 1) return [];
      try {
        const { skillId, name, description } = available(entry, scope);
        return [{ skillId, name, description }];
      } catch {
        return [];
      }
    });
  }

  async resolve(scope: SkillScope, selection?: { skillId: string; revision?: string }, knowledgeReady = false): Promise<TurnSkillSnapshot> {
    if (!selection && !this.discoveryEnabled) return { discoverable: [] };
    const entries = await this.store.scopeSnapshot(scope);
    let explicit: TurnSkillSnapshot["explicit"];
    if (selection) {
      const entry = entries.find(({ skill }) => skill.skill_id === selection.skillId);
      if (!entry || (selection.revision !== undefined && entry.skill.active_revision !== selection.revision)) {
        throw new ExtensionPrepareError("revision_missing");
      }
      if (entry.skill.user_invocable !== 1) throw new ExtensionPrepareError("scope_denied");
      const skill = available(entry, scope, knowledgeReady);
      const instructions = await pinnedSkillInstructions(this.store, skill);
      if (instructions === null) throw new ExtensionPrepareError("revision_missing");
      explicit = Object.freeze({ skill, instructions });
    }
    const discoverable = this.discoveryEnabled ? entries.flatMap((entry) => {
      if (entry.skill.disable_model_invocation === 1) return [];
      try { return [available(entry, scope, knowledgeReady)]; }
      catch { return []; }
    }) : [];
    return Object.freeze({ explicit, discoverable: Object.freeze(discoverable) });
  }
}
