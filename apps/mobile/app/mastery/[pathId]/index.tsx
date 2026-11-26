import { MasterySessionError, RestoreGateError, masteryModeLabels, masteryNextLabels } from "@learn-pace/app-host";
import type { SessionMode } from "@learn-pace/domain";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState, type ComponentRef } from "react";
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MasteryOutline, MasteryProgress } from "../../../src/components/MasteryOutline";
import { ChatAction, ChatSheet } from "../../../src/components/chat-controls";
import { LearnerProfileCard, ObjectiveEvidence, type Evidence } from "../../../src/components/mastery/ObjectiveEvidence";
import { ReviewPlan } from "../../../src/components/mastery/ReviewPlan";
import { Action, Card, LoadingCard, ModelSetup, Page, RetryCard, StatusBadge, styles } from "../../../src/components/Shell";
import { useApp } from "../../../src/context/AppContext";
import { useMasteryProjection } from "../../../src/context/useMasteryProjection";
import { colors, radius, spacing, typography } from "../../../src/theme";
import { formatRelativeTime } from "../../../src/utils/time";

export default function MasteryPath() {
  const { pathId } = useLocalSearchParams<{ pathId: string }>();
  const { mastery, reload } = useApp();
  const router = useRouter();
  const [name, setName] = useState<string>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [objective, setObjective] = useState<string>();
  const [evidence, setEvidence] = useState<Evidence>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const evidenceRequest = useRef(0);
  const running = useRef(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const pendingLocation = useRef<string | undefined>(undefined);
  const [highlighted, setHighlighted] = useState<{ id: string }>();

  const read = useCallback(() => mastery.readTopic(pathId), [pathId, mastery]);
  const observe = useCallback((refresh: () => void) => mastery.observePath(pathId, refresh), [pathId, mastery]);
  const { data: topic, error: readError, retry } = useMasteryProjection(read, observe);

  function openSession(sessionId: string, mode?: SessionMode) {
    router.push({ pathname: "/mastery/[pathId]/session/[sessionId]", params: { pathId, sessionId, ...(mode && { mode }) } });
  }

  function startReview(objectiveId?: string) {
    router.push({ pathname: "/mastery/[pathId]/session/[sessionId]",
      params: { pathId, sessionId: "new", mode: "review", ...(objectiveId && { objectiveId }) } });
  }

  function locateObjective(id: string) {
    pendingLocation.current = id;
    setHighlighted({ id });
  }

  function attachObjective(id: string, point: ComponentRef<typeof View> | null) {
    if (!point || pendingLocation.current !== id) return;
    requestAnimationFrame(() => {
      const container = scroll.current?.getInnerViewRef();
      if (!container || pendingLocation.current !== id) return;
      point.measureLayout(container, (_x, y) => {
        if (pendingLocation.current !== id) return;
        pendingLocation.current = undefined;
        scroll.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
      });
    });
  }

  function closeMenu() {
    Keyboard.dismiss();
    setMore(false);
    setName(undefined);
    setError(undefined);
  }

  function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    void work().catch((cause: unknown) => {
      setError(cause instanceof MasterySessionError || cause instanceof RestoreGateError ? cause.message : "无法完成操作，请重试");
    }).finally(() => { running.current = false; setBusy(false); });
  }

  function openObjective(id: string) {
    const request = ++evidenceRequest.current;
    setEvidence(undefined);
    setEvidenceError(undefined);
    setObjective(id);
    void mastery.objectiveEvidence(pathId, id).then((data) => {
      if (request === evidenceRequest.current) setEvidence(data);
    }).catch(() => { if (request === evidenceRequest.current) setEvidenceError("无法读取知识点证据"); });
  }

  function confirm(action: "reset" | "delete") {
    const reset = action === "reset";
    Alert.alert(reset ? "重置进度？" : "删除主题？",
      reset ? "清除学习进度并放弃待答题卡，大纲、资料和会话会保留。" : "将移除该主题、大纲、会话、消息和题卡。", [
        { text: "取消", style: "cancel" },
        { text: reset ? "重置进度" : "删除主题", style: "destructive", onPress: () => run(async () => {
          if (reset) {
            await mastery.resetTopic(pathId);
            setMore(false);
          } else {
            await mastery.deleteTopic(pathId);
            router.replace("/paths");
          }
          await reload();
        }) },
      ]);
  }

  if (!topic) return <Page title="精通之路" secondary>
    {readError === undefined ? <LoadingCard label="正在读取目标…" />
      : <RetryCard message={readError instanceof MasterySessionError ? readError.message : "无法读取精通目标"} retry={retry} />}
  </Page>;
  const { map, next, summary } = topic;
  const hasOutline = summary.total > 0;
  const material = topic.sources.filter(({ kind }) => kind !== "goal");
  return <Page title={topic.emoji + " " + topic.name} secondary keyboard scrollRef={scroll}>
    <Stack.Screen options={{ headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="更多操作"
      onPress={() => { setError(undefined); setMore(true); }} style={local.more}>
      <Text style={local.moreLabel}>···</Text>
    </Pressable> }} />
    {readError !== undefined && <RetryCard message="无法刷新精通目标" retry={retry} />}
    <Card>
      <Text style={styles.body}>{!hasOutline ? "去定大纲" : topic.status === "completed" ? "已完成" : "学习中"}</Text>
      <MasteryProgress {...summary} />
      {hasOutline && <>
        <Text accessibilityRole="header" style={styles.heading}>下一个</Text>
        {!!next.knowledge_point_name && <Text style={styles.heading}>{next.knowledge_point_name}</Text>}
        <Text style={styles.body}>{masteryNextLabels[next.action]}</Text>
      </>}
      <Action label={!hasOutline ? "和导师一起定大纲" : next.action === "complete" ? "继续自由探索" : next.action === "answer_pending" ? "回到原会话作答" : next.action === "review" ? "开始本次复习" : "继续学习"}
        onPress={() => {
          if (next.action === "review") { startReview(next.knowledge_point_id); return; }
          const existing = !hasOutline ? topic.sessions.find((session) => session.mode === "outline")
            : topic.sessions.find((session) => session.session_id === next.session_id) ?? topic.sessions.find(({ mode }) => mode === "study");
          openSession(existing?.session_id ?? "new", hasOutline ? "study" : "outline");
        }} />
    </Card>
    <ModelSetup />
    <Card title="大纲"><MasteryOutline map={map} current={highlighted?.id ?? next.knowledge_point_id} onObjective={openObjective}
      collapsible revealObjective={highlighted} objectiveRef={attachObjective} /></Card>
    {hasOutline && <ReviewPlan plan={topic.reviewPlan} busy={busy} locate={locateObjective} start={startReview}
      chooseStrategy={(id) => run(() => mastery.setReviewStrategy(pathId, id))}
      setRetention={(target) => run(() => mastery.setDesiredRetention(pathId, target))} />}
    {(topic.goal && topic.goal !== topic.name || material.length > 0) && <Card title="目标与资料">
      {topic.goal !== topic.name && !!topic.goal && <Text style={styles.body}>{topic.goal}</Text>}
      {material.length > 0 && <View style={local.chips}>
        {material.slice(0, 5).map(({ id, label }) => <Text key={id} style={local.chip}>{label}</Text>)}
      </View>}
    </Card>}
    {topic.learnerProfile && <LearnerProfileCard profile={topic.learnerProfile} />}
    <Card title="学习会话">
      {topic.sessions.length === 0 && <Text style={styles.body}>暂无学习会话。</Text>}
      {topic.sessions.map((session) => <Pressable style={local.session} key={session.session_id} accessibilityRole="button"
        onPress={() => openSession(session.session_id)}>
        <View style={local.summary}>
          <StatusBadge label={session.mode ? masteryModeLabels[session.mode] : "精通会话"} />
          <Text style={styles.body} numberOfLines={1}>{session.lastMessage || "还没有消息"}</Text>
        </View>
        <Text style={local.sessionTime}>{formatRelativeTime(session.updated_at)}</Text>
        <Text style={local.chevron}>›</Text>
      </Pressable>)}
      <Action label="＋ 新建学习会话" onPress={() => openSession("new", "study")} disabled={!hasOutline} secondary />
    </Card>
    {more && <ChatSheet title="管理精通之路" close={closeMenu} keyboard>
      {name === undefined ? <ChatAction label="改名" onPress={() => setName(topic.name)} /> : <>
        <TextInput accessibilityLabel="主题名称" value={name} onChangeText={setName} style={local.input} maxLength={240} />
        <ChatAction label="保存名称" primary disabled={busy} onPress={() => run(async () => {
          await mastery.renameTopic(pathId, name);
          closeMenu();
          await reload();
        })} />
        <ChatAction label="取消改名" onPress={() => { Keyboard.dismiss(); setName(undefined); setError(undefined); }} />
      </>}
      <ChatAction label="重置进度" onPress={() => confirm("reset")} disabled={busy} />
      <ChatAction label="删除主题" onPress={() => confirm("delete")} disabled={busy} danger />
      {error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
    </ChatSheet>}
    {error && !objective && !more && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
    {objective && <ObjectiveEvidence key={objective} evidence={evidence} loadingError={evidenceError || error} busy={busy}
      close={() => { evidenceRequest.current++; setObjective(undefined); setError(undefined); }}
      setMastery={(mastered, note) => run(async () => {
        const request = evidenceRequest.current;
        await mastery.setObjectiveMastery(pathId, objective, mastered, note);
        const refreshed = await mastery.objectiveEvidence(pathId, objective);
        if (request === evidenceRequest.current) setEvidence(refreshed);
        await reload();
      })} />}
  </Page>;
}

const local = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { color: colors.text, backgroundColor: colors.soft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md },
  session: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm, minHeight: 48 },
  summary: { flex: 1, minWidth: 0, gap: spacing.xs },
  sessionTime: { color: colors.muted, fontSize: typography.caption },
  chevron: { color: colors.muted, fontSize: 22 },
  more: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  moreLabel: { color: colors.text, fontSize: 25, fontWeight: "700" },
  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, fontSize: 16 },
  error: { color: colors.danger },
});
