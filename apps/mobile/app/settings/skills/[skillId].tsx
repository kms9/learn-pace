import type { SkillDetail } from "@learn-pace/app-host";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ChatSheet } from "../../../src/components/chat-controls";
import { Action, Card, LoadingCard, Page, RetryCard, styles } from "../../../src/components/Shell";
import { SkillBadges, SkillCompatibilityInfo, skillShortVersion, skillSourceLabel } from "../../../src/components/SkillDetails";
import { useApp } from "../../../src/context/AppContext";
import { skillErrorMessage } from "../../../src/skill-io";
import { colors, spacing } from "../../../src/theme";

export default function SkillPage() {
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const router = useRouter();
  const { skills } = useApp();
  const [detail, setDetail] = useState<SkillDetail | null>();
  const [reference, setReference] = useState<{ path: string; text: string }>();
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    setFailed(false);
    void skills.detail(skillId).then((value) => { if (active) setDetail(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [skillId, skills, attempt]));

  async function perform(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFeedback("");
    try { await work(); }
    catch (error) { setFeedback(skillErrorMessage(error)); }
    finally {
      running.current = false;
      setBusy(false);
    }
  }

  const refresh = () => setAttempt((value) => value + 1);
  if (!detail) return <Page title="技能详情" secondary>
    {failed ? <RetryCard message="无法读取技能详情" retry={refresh} /> : detail === null ?
      <Card><Text style={styles.body}>技能已卸载。</Text></Card> : <LoadingCard label="正在读取技能…" />}
  </Page>;

  const { skill, manifest } = detail;
  return <Page title={skill.name} secondary>
    {feedback && <Text accessibilityRole="alert" style={local.error}>{feedback}</Text>}
    <Card>
      <Text style={styles.body}>{skill.description}</Text>
      <SkillBadges summary={detail} />
      <Text style={styles.body}>{skillSourceLabel(skill.origin_kind, skill.origin_locator)} · 内容版本 {skillShortVersion(skill.active_revision)}</Text>
      {!!skill.source_url && <Text style={styles.body} selectable>{skill.source_url}</Text>}
      {!!skill.pinned_ref && <Text style={styles.body} selectable>{skill.origin_kind === "registry" ? "发布版本" : "固定提交"} {skill.pinned_ref}</Text>}
      <SkillCompatibilityInfo compatibility={detail.compatibility} />
      {!skill.user_invocable && <Text style={styles.body}>此技能关闭了手动选择。</Text>}
      {!!skill.disable_model_invocation && <Text style={styles.body}>此技能关闭了模型自动调用。</Text>}
      {detail.instructionsChars >= 20_000 && <Text style={styles.body}>正文接近单轮 24,000 字符上限，可读取的参考文本会减少。</Text>}
    </Card>
    <Card title="启用与场景">
      <View style={local.setting}>
        <Text style={styles.body}>启用技能</Text>
        <Switch accessibilityLabel="启用技能" value={skill.enabled === 1} disabled={busy || detail.state !== "valid"} onValueChange={(value) =>
          void perform(async () => { await skills.setEnabled(skillId, value); refresh(); })} />
      </View>
      {([["lf01", "问答（LF01）"], ["little_tutor", "Dito 小老师"]] as const).map(([scope, label]) =>
        <View key={scope} style={local.setting}>
          <Text style={styles.body}>{label}</Text>
          <Switch accessibilityLabel={label} value={detail.scopes[scope]} disabled={busy || detail.state !== "valid"} onValueChange={(value) =>
            void perform(async () => { await skills.setScope(skillId, scope, value); refresh(); })} />
        </View>)}
    </Card>
    {!!detail.markdown && <Card title="原始 SKILL.md"><Text selectable style={local.raw}>{detail.markdown}</Text></Card>}
    {manifest.length > 0 && <Card title="资源文件">
      {manifest.map((file) => file.kind === "text" && file.path !== "SKILL.md"
        ? <Action key={file.path} label={`查看 ${file.path}`} secondary disabled={busy} onPress={() => void perform(async () => {
          const text = await skills.reference(skillId, file.path);
          if (text !== null) setReference({ path: file.path, text });
          else setFeedback("该资源已被移除，请刷新详情。");
        })} />
        : <Text style={styles.body} key={file.path}>{file.path} · {file.bytes} B
          {file.kind !== "text" && (file.kind === "script" ? " · 脚本" : " · 二进制")}</Text>)}
    </Card>}
    <Card>
      <Action label={skill.origin_kind === "github" || skill.origin_kind === "registry" ? "检查更新" : "导入新版"} secondary disabled={busy} onPress={() =>
        router.push({ pathname: "/settings/skills/import", params: { update: skillId,
          source: skill.origin_kind === "github" || skill.origin_kind === "registry" ? skill.origin_kind : "local" } })} />
      <Action label="卸载技能" secondary disabled={busy} onPress={() => Alert.alert("卸载这个技能？", "历史对话和技能收据仍可查看。", [
        { text: "取消", style: "cancel" },
        { text: "卸载", style: "destructive", onPress: () => void perform(async () => {
          await skills.uninstall(skillId);
          router.back();
        }) },
      ])} />
    </Card>
    {reference && <ChatSheet title={reference.path} close={() => setReference(undefined)}>
      <ScrollView><Text selectable style={local.raw}>{reference.text}</Text></ScrollView>
    </ChatSheet>}
  </Page>;
}

const local = StyleSheet.create({
  setting: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  raw: { fontFamily: "monospace", color: colors.text, lineHeight: 20, fontSize: 13 },
  error: { color: colors.danger },
});
