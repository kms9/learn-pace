import type { SkillScope } from "@learn-pace/infra";
import { resolveTrustedTool } from "../tool-catalog/index.js";
import type { SkillManifestFile, ValidatedSkillPackage } from "./package-validator.js";

export type CapabilityReadiness = "ready" | "missing_tools" | "script_non_executable";

export interface SkillCompatibility {
  readiness: CapabilityReadiness;
  compatibility: string | null;
  missingTools: readonly string[];
  scripts: readonly string[];
  binaries: readonly string[];
  requiresScript: boolean;
  platformRequirements: readonly string[];
}

export type SkillDeclarations = Pick<ValidatedSkillPackage, "allowedTools" | "compatibility" | "metadata">;

function platformRequirements(metadata: SkillDeclarations["metadata"]): string[] {
  const raw = metadata.openclaw ?? metadata.clawdbot;
  if (raw === undefined) return [];
  try {
    const config = JSON.parse(raw);
    if (!config || typeof config !== "object" || Array.isArray(config)) return ["无法确认 OpenClaw 平台需求"];
    const requires = config.requires;
    const requirements: string[] = [];
    if (requires && typeof requires === "object") {
      const labels: Record<string, string> = { bins: "命令行程序", anyBins: "命令行程序", env: "环境变量", config: "宿主配置" };
      for (const [kind, names] of Object.entries(requires)) {
        if (Array.isArray(names) && names.length === 0) continue;
        const description = Array.isArray(names) ? names.filter((name) => typeof name === "string").slice(0, 8).join("、") : "";
        requirements.push((labels[kind] ?? "OpenClaw 依赖") + (description ? " · " + description.slice(0, 160) : ""));
      }
    } else if (requires) requirements.push("无法确认 OpenClaw 平台需求");
    if (config.os !== undefined && (!Array.isArray(config.os) || (config.os.length > 0 && !config.os.includes("android")))) {
      requirements.push("移动端系统不在支持范围");
    }
    if (config.install && (!Array.isArray(config.install) || config.install.length > 0)) requirements.push("OpenClaw 依赖安装器");
    if (typeof config.primaryEnv === "string" && !requires?.env?.includes?.(config.primaryEnv)) requirements.push("环境变量 · " + config.primaryEnv.slice(0, 80));
    return [...new Set(requirements)];
  } catch {
    return ["无法确认 OpenClaw 平台需求"];
  }
}

export function checkCompatibility(
  declarations: SkillDeclarations,
  manifest: readonly SkillManifestFile[],
  scope?: SkillScope,
): SkillCompatibility {
  const declarationNames = [...declarations.allowedTools];
  for (const [key, value] of Object.entries(declarations.metadata)) {
    if (/^(?:connector|connector[-_](?:id|name)|provider|capability|allowed[-_]tools|requires[-_]tools)$/i.test(key)) {
      declarationNames.push(...value.split(/[,\s]+/).filter(Boolean));
    }
  }
  const missingTools = [...new Set(declarationNames)].filter((name) => !resolveTrustedTool(name, scope));
  const scripts = manifest.filter(({ kind }) => kind === "script").map(({ path }) => path);
  const binaries = manifest.filter(({ kind }) => kind === "binary").map(({ path }) => path);
  const requiresScript = /\b(?:python(?:3)?|node(?:\.js|js)?|bash|powershell|shell|exec)\b/i.test(declarations.compatibility ?? "");
  const platform = platformRequirements(declarations.metadata);
  return {
    readiness: missingTools.length || platform.length ? "missing_tools" : scripts.length || requiresScript ? "script_non_executable" : "ready",
    compatibility: declarations.compatibility, missingTools, scripts, binaries, requiresScript, platformRequirements: platform,
  };
}

export function skillIsUsable(compatibility: SkillCompatibility): boolean {
  // 包内脚本可以是可选资料。声明的运行环境或工具缺失才阻止加载。
  return compatibility.readiness !== "missing_tools" && !compatibility.requiresScript;
}
