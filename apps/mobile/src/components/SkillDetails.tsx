import { readRegistryLocator, skillRegistries, type SkillCompatibility, type SkillSummary } from "@learn-pace/app-host";
import { Text, View, StyleSheet } from "react-native";
import { spacing } from "../theme";
import { StatusBadge, styles } from "./Shell";

export function skillSourceLabel(kind: SkillSummary["skill"]["origin_kind"], locator?: string): string {
  if (kind === "registry") {
    const ref = locator && readRegistryLocator(locator);
    return ref ? `${skillRegistries[ref.registry].label} · ${ref.publisher}` : "技能市场";
  }
  return ({ local_file: "本地 SKILL.md", local_zip: "本地 ZIP", github: "公开 GitHub" })[kind];
}

export function skillShortVersion(revision: string): string {
  return revision.split(":").at(-1)?.slice(0, 12) ?? revision;
}

export function SkillBadges({ summary }: { summary: SkillSummary }) {
  const { state, skill, availability, compatibility } = summary;
  const scopes = [availability.lf01 && "问答", availability.little_tutor && "Dito"].filter(Boolean).join("、");
  return <View style={local.badges}>
    <StatusBadge label={state === "valid" ? "已安装" : "包缺失或损坏"} tone={state === "valid" ? "primary" : "warning"} />
    <StatusBadge label={skill.enabled ? "已启用" : "已停用"} />
    {!!scopes && <StatusBadge label={`可用于 ${scopes}`} />}
    {compatibility.readiness === "missing_tools" && (compatibility.missingTools.length > 0 || compatibility.platformRequirements.length > 0) &&
      <StatusBadge label="依赖未满足" tone="warning" />}
    {compatibility.readiness === "script_non_executable" && <StatusBadge label="脚本不可执行" tone="warning" />}
  </View>;
}

export function SkillCompatibilityInfo({ compatibility }: { compatibility: SkillCompatibility }) {
  const { missingTools, compatibility: declared, scripts, binaries, requiresScript, platformRequirements } = compatibility;
  return <>
    {!!declared && <Text style={styles.body}>声明的运行环境 · {declared}</Text>}
    {missingTools.length > 0 && <Text style={styles.body}>缺少工具 · {missingTools.join("、")}</Text>}
    {platformRequirements.length > 0 && <Text style={styles.body}>平台依赖未满足 · {platformRequirements.join("；")}</Text>}
    {(requiresScript || scripts.length > 0) && <Text style={styles.body}>移动端不执行包内脚本。
      {scripts.length > 0 && ` ${scripts.length} 个脚本文件会保留在包内。`}</Text>}
    {binaries.length > 0 && <Text style={styles.body}>包内有 {binaries.length} 个二进制资源，模型无法读取。</Text>}
  </>;
}

const local = StyleSheet.create({ badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs } });
