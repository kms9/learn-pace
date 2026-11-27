import type {
  AppStore, Clock, SkillOriginKind, SkillScope, StoredSkill, StoredSkillRevision,
} from "@learn-pace/infra";
import { restoreGateFor } from "../../restore-gate.js";
import { checkCompatibility, skillIsUsable, type SkillCompatibility } from "./compatibility.js";
import { GithubSkillSource, type GithubSkillCandidate } from "./github-source.js";
import {
  decodeSkillText, maxSkillLibraryBytes, skillEntry, SkillPackageError, validateSkillPackage,
  type SkillManifestFile, type SkillPackageFiles, type ValidatedSkillPackage,
} from "./package-validator.js";
import { encodeSkillFiles, readSkillDeclarations, readSkillFileBytes, readSkillManifest } from "./package-storage.js";
import { readRegistryLocator, registryLocator, registrySkillUrl } from "./registry-origin.js";
import { RegistrySkillSource, type RegistrySkill, type RegistryVersion } from "./registry-source.js";
import { readSkillZip } from "./zip-reader.js";

type SkillOrigin = Pick<StoredSkill, "origin_kind" | "origin_locator" | "source_url" | "pinned_ref">;
type Candidate = { pack: ValidatedSkillPackage; origin: SkillOrigin };

export type PackageState = "valid" | "corrupted" | "missing" | "uninstalled";

export interface SkillPreview {
  skillId: string;
  description: string;
  origin: SkillOrigin;
  revision: string;
  expectedActiveRevision: string | null;
  manifest: readonly SkillManifestFile[];
  compatibility: SkillCompatibility;
  rawBytes: number;
  instructionsChars: number;
  changes: { added: string[]; removed: string[]; changed: string[] };
}

export interface SkillSummary {
  skill: StoredSkill;
  state: PackageState;
  scopes: Record<SkillScope, boolean>;
  availability: Record<SkillScope, boolean>;
  compatibility: SkillCompatibility;
}

export interface SkillDetail extends SkillSummary {
  markdown: string | null;
  manifest: readonly SkillManifestFile[];
  rawBytes: number;
  instructionsChars: number;
}

export class SkillConflictError extends Error {
  constructor() {
    super("技能已被更新，请重新预览。");
    this.name = "SkillConflictError";
  }
}

function sameOrigin(left: SkillOrigin, right: SkillOrigin): boolean {
  const kind = (origin: SkillOrigin) => origin.origin_kind === "local_file" || origin.origin_kind === "local_zip" ? "local" : origin.origin_kind;
  return left.origin_locator === right.origin_locator && kind(left) === kind(right);
}

function originConflict() {
  return new SkillPackageError("同名技能来自其他来源。请先在技能详情中卸载已有技能，再重新导入。");
}

function compareFiles(old: readonly SkillManifestFile[], next: readonly SkillManifestFile[]): SkillPreview["changes"] {
  const before = new Map(old.map((file) => [file.path, file.sha256]));
  const after = new Set(next.map(({ path }) => path));
  return {
    added: next.filter(({ path }) => !before.has(path)).map(({ path }) => path),
    changed: next.filter(({ path, sha256 }) => before.has(path) && before.get(path) !== sha256).map(({ path }) => path),
    removed: old.filter(({ path }) => !after.has(path)).map(({ path }) => path),
  };
}

export class SkillService {
  readonly github: GithubSkillSource;
  readonly registry: RegistrySkillSource;
  private readonly previews = new WeakMap<SkillPreview, Candidate>();
  private readonly gate;

  constructor(private readonly store: AppStore, private readonly clock: Clock,
    private readonly hasActiveTurns: () => boolean, fetch?: typeof globalThis.fetch) {
    this.github = new GithubSkillSource(fetch);
    this.registry = new RegistrySkillSource(fetch ?? globalThis.fetch, this.github);
    this.gate = restoreGateFor(store);
  }

  async previewLocal(bytes: Uint8Array, kind: Extract<SkillOriginKind, "local_file" | "local_zip">,
    signal?: AbortSignal): Promise<SkillPreview> {
    const files = kind === "local_zip" ? await readSkillZip(bytes, signal) : new Map([[skillEntry, bytes]]);
    const pack = await validateSkillPackage(files, signal);
    return this.preview({ pack, origin: { origin_kind: kind, origin_locator: "local:" + pack.name, source_url: null, pinned_ref: null } });
  }

  async previewGithub(candidate: GithubSkillCandidate, signal?: AbortSignal): Promise<SkillPreview> {
    const files = await this.github.acquire(candidate, signal);
    const pack = await validateSkillPackage(files, signal);
    return this.preview({ pack, origin: { origin_kind: "github", origin_locator: candidate.originLocator,
      source_url: candidate.sourceUrl, pinned_ref: candidate.pinnedRef } });
  }

  async previewRegistry(skill: Pick<RegistrySkill, "registry" | "slug" | "publisher" | "version">, signal?: AbortSignal): Promise<SkillPreview> {
    return this.previewRegistryVersion(await this.registry.resolve(skill, signal), signal);
  }

  private async previewRegistryVersion(ref: RegistryVersion, signal?: AbortSignal, skillId?: string): Promise<SkillPreview> {
    const pack = await this.registry.acquire(ref, signal);
    if (skillId && pack.name !== skillId) throw new SkillPackageError("上游已改名，请卸载后重新安装。");
    return this.preview({ pack, origin: { origin_kind: "registry", origin_locator: registryLocator(ref),
      source_url: registrySkillUrl(ref), pinned_ref: ref.version } });
  }

  async previewUpdate(skillId: string, signal?: AbortSignal): Promise<SkillPreview> {
    const skill = await this.store.getSkill(skillId);
    if (skill?.origin_kind === "registry") {
      const ref = readRegistryLocator(skill.origin_locator);
      if (!ref) throw new SkillPackageError("保存的市场来源无效。");
      const resolved = await this.registry.resolve({ ...ref, version: null }, signal);
      return this.previewRegistryVersion(resolved, signal, skillId);
    }
    if (!skill?.source_url || skill.origin_kind !== "github") throw new SkillPackageError("请从同一来源导入新版技能文件。");
    const sources = await this.github.candidates(skill.source_url, signal);
    const candidate = sources.find((item) => item.originLocator === skill.origin_locator);
    if (!candidate) throw new SkillPackageError("上游技能文件已移动，请卸载后重新安装。");
    const pack = await validateSkillPackage(await this.github.acquire(candidate, signal), signal);
    if (pack.name !== skillId) throw new SkillPackageError("上游已改名，请卸载后重新安装。");
    return this.preview({ pack, origin: { origin_kind: "github", origin_locator: candidate.originLocator,
      source_url: candidate.sourceUrl, pinned_ref: candidate.pinnedRef } });
  }

  refreshPreview(preview: SkillPreview): Promise<SkillPreview> {
    return this.preview(this.getCandidate(preview));
  }

  private getCandidate(preview: SkillPreview): Candidate {
    const candidate = this.previews.get(preview);
    if (!candidate) throw new SkillConflictError();
    return candidate;
  }

  private async preview(candidate: Candidate): Promise<SkillPreview> {
    const { pack, origin } = candidate;
    const records = await this.store.listSkills();
    const current = records.find(({ skill_id }) => skill_id === pack.name);
    if (current && !sameOrigin(current, origin)) throw originConflict();
    if (current?.origin_kind === "registry" && current.pinned_ref === origin.pinned_ref && current.active_revision !== pack.revision) {
      throw new SkillPackageError("上游固定版本的文件已变化，请选择新的发布版本。");
    }
    if (records.some((item) => item.skill_id !== pack.name && sameOrigin(item, origin))) {
      throw new SkillPackageError("上游已改名，请卸载后重新安装。");
    }
    const old = current && await this.store.getSkillRevision(current.skill_id, current.active_revision);
    const previous = old ? readSkillManifest(old.manifest_json) : [];
    const result: SkillPreview = {
      skillId: pack.name, description: pack.description, origin: { ...origin }, revision: pack.revision,
      expectedActiveRevision: current?.active_revision ?? null, manifest: structuredClone(pack.manifest),
      compatibility: checkCompatibility(pack, pack.manifest), rawBytes: pack.rawBytes,
      instructionsChars: pack.instructionsChars, changes: compareFiles(previous, pack.manifest),
    };
    // 只向界面提供预览，确认时从内部校验结果生成入库内容。
    this.previews.set(result, candidate);
    Object.freeze(result);
    return result;
  }

  async confirm(preview: SkillPreview): Promise<StoredSkill> {
    const { pack, origin } = this.getCandidate(preview);
    const encoded = encodeSkillFiles(pack.files);
    const manifest = JSON.stringify(pack.manifest);
    const now = this.clock.nowSeconds();
    const revision: StoredSkillRevision = {
      skill_id: pack.name, revision: pack.revision, raw_bytes: pack.rawBytes,
      instructions_chars: pack.instructionsChars, manifest_json: manifest, files_json_base64: encoded, created_at: now,
    };
    return this.gate.write(async () => {
      const installed = await this.store.runInTransaction(async (tx) => {
        const current = await tx.getSkill(pack.name);
        if ((current?.active_revision ?? null) !== preview.expectedActiveRevision) throw new SkillConflictError();
        if (current && !sameOrigin(current, origin)) throw originConflict();
        if ((await tx.listSkills()).some((item) => item.skill_id !== pack.name && sameOrigin(item, origin))) {
          throw new SkillPackageError("上游已改名，请卸载后重新安装。");
        }
        if (!this.hasActiveTurns()) await tx.deleteInactiveSkillRevisions();
        if (!await tx.getSkillRevision(pack.name, pack.revision)) {
          if (await tx.skillLibraryBytes() + pack.rawBytes > maxSkillLibraryBytes) {
            throw new SkillPackageError("技能库超过 4 MiB。请卸载不需要的技能，或在聊天结束后重试。");
          }
          await tx.saveSkillRevision(revision);
        }
        const skill: StoredSkill = {
          ...origin, skill_id: pack.name, name: pack.name, description: pack.description, active_revision: pack.revision,
          enabled: current?.enabled ?? 0, user_invocable: pack.userInvocable ? 1 : 0, disable_model_invocation: pack.modelInvocable ? 0 : 1,
          compatibility_json: JSON.stringify({ compatibility: pack.compatibility, allowedTools: pack.allowedTools }),
          metadata_json: JSON.stringify(pack.metadata), created_at: current?.created_at ?? now, updated_at: now,
        };
        await tx.saveSkill(skill);
        return skill;
      });
      this.previews.delete(preview);
      await this.reclaimIdleRevisions().catch(() => { /* 下次库变更或冷启动会重试回收。 */ });
      return installed;
    });
  }

  async list(query = ""): Promise<SkillSummary[]> {
    const queryText = query.trim().normalize("NFC").toLowerCase();
    const [main, tutor] = await Promise.all([this.store.scopeSnapshot("lf01"), this.store.scopeSnapshot("little_tutor")]);
    const tutorBindings = new Map(tutor.map(({ skill, binding }) => [skill.skill_id, binding]));
    return main.filter(({ skill }) => [skill.name, skill.description, skill.origin_locator]
      .some((text) => text.normalize("NFC").toLowerCase().includes(queryText)))
      .map(({ skill, binding, manifest }) => summary(skill, manifest, binding === 1, tutorBindings.get(skill.skill_id) === 1));
  }

  async detail(skillId: string): Promise<SkillDetail | null> {
    return this.store.runInTransaction(async (tx) => {
      const skill = await tx.getSkill(skillId);
      if (!skill) return null;
      const revision = await tx.getSkillRevision(skillId, skill.active_revision);
      const bindings = await tx.listSkillBindings(skillId);
      const details = summary(skill, revision?.manifest_json ?? null, bindings.some((row) => row.scope === "lf01" && row.enabled === 1),
        bindings.some((row) => row.scope === "little_tutor" && row.enabled === 1));
      let markdown: string | null = null;
      let manifest: SkillManifestFile[] = [];
      if (revision && details.state === "valid") {
        try {
          const bytes = readSkillFileBytes(revision, skillEntry);
          markdown = bytes && decodeSkillText(bytes);
          manifest = readSkillManifest(revision.manifest_json);
          if (markdown === null) details.state = "corrupted";
        } catch { details.state = "corrupted"; }
        if (details.state === "corrupted") details.availability = { lf01: false, little_tutor: false };
      }
      return { ...details, markdown, manifest, rawBytes: revision?.raw_bytes ?? 0, instructionsChars: revision?.instructions_chars ?? 0 };
    });
  }

  async reference(skillId: string, path: string): Promise<string | null> {
    return this.store.runInTransaction(async (tx) => {
      const skill = await tx.getSkill(skillId);
      const revision = skill && await tx.getSkillRevision(skillId, skill.active_revision);
      if (!revision || !readSkillManifest(revision.manifest_json).some((file) => file.path === path && file.kind === "text")) return null;
      const bytes = readSkillFileBytes(revision, path);
      return bytes && decodeSkillText(bytes);
    });
  }

  setEnabled(skillId: string, enabled: boolean): Promise<void> {
    return this.change(async (tx) => {
      const skill = await tx.getSkill(skillId);
      if (!skill) throw new SkillPackageError("技能已卸载。");
      await tx.saveSkill({ ...skill, enabled: enabled ? 1 : 0, updated_at: this.clock.nowSeconds() });
    });
  }

  setScope(skillId: string, scope: SkillScope, enabled: boolean): Promise<void> {
    return this.change(async (tx) => {
      if (scope !== "lf01" && scope !== "little_tutor") throw new SkillPackageError("不支持该技能场景。");
      if (!await tx.getSkill(skillId)) throw new SkillPackageError("技能已卸载。");
      await tx.saveSkillBinding({ skill_id: skillId, scope, enabled: enabled ? 1 : 0, updated_at: this.clock.nowSeconds() });
    });
  }

  uninstall(skillId: string): Promise<void> {
    return this.change((tx) => tx.deleteSkill(skillId));
  }

  private change(action: (tx: AppStore) => Promise<void>): Promise<void> {
    return this.gate.write(async () => {
      await this.store.runInTransaction(action);
      await this.reclaimIdleRevisions().catch(() => { /* 下次库变更或冷启动会重试回收。 */ });
    });
  }

  private async reclaimIdleRevisions(): Promise<void> {
    if (!this.hasActiveTurns()) await this.store.runInTransaction(async (tx) => {
      if (!this.hasActiveTurns()) await tx.deleteInactiveSkillRevisions();
    });
  }
}

function summary(skill: StoredSkill, raw: string | null, lf01: boolean, littleTutor: boolean): SkillSummary {
  const scopes = { lf01, little_tutor: littleTutor };
  const availability = { lf01: false, little_tutor: false };
  const defaultCompatibility: SkillCompatibility = { readiness: "missing_tools", compatibility: null, missingTools: [],
    scripts: [], binaries: [], requiresScript: false, platformRequirements: [] };
  if (raw === null) return { skill, scopes, availability, state: "missing", compatibility: defaultCompatibility };
  try {
    const manifest = readSkillManifest(raw);
    const declarations = readSkillDeclarations(skill);
    for (const scope of ["lf01", "little_tutor"] as const) {
      availability[scope] = skill.enabled === 1 && scopes[scope] && skillIsUsable(checkCompatibility(declarations, manifest, scope));
    }
    return { skill, scopes, availability, state: "valid", compatibility: checkCompatibility(declarations, manifest) };
  } catch {
    return { skill, scopes, availability, state: "corrupted", compatibility: defaultCompatibility };
  }
}
