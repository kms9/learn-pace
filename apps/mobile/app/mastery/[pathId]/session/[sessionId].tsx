import {
  MasterySessionError, masteryModeLabels, masteryModeNotes, masteryStarters, masteryToolStatusLabel, type MasterySessionService, type StudyCard,
} from "@learn-pace/app-host";
import type { SessionMode } from "@learn-pace/domain";
import type { StoredMessage, StoredSession } from "@learn-pace/infra";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatAction, ChatSheet, ConversationComposer, ScrollToBottomButton, useConversationScroll } from "../../../../src/components/chat-controls";
import { MasteryOutline } from "../../../../src/components/MasteryOutline";
import { LevelUpCelebration } from "../../../../src/components/mastery/LevelUpCelebration";
import { ObjectiveEvidence } from "../../../../src/components/mastery/ObjectiveEvidence";
import { QuestionCard, type AnswerControls } from "../../../../src/components/mastery/QuestionCard";
import { MessageContent } from "../../../../src/components/MessageContent";
import { Action, Card, LoadingCard, ModelSetup, Page, RetryCard, styles } from "../../../../src/components/Shell";
import { useApp } from "../../../../src/context/AppContext";
import { onForeground, useMasteryProjection } from "../../../../src/context/useMasteryProjection";
import { colors, radius, spacing } from "../../../../src/theme";

type Session = Awaited<ReturnType<MasterySessionService["openSession"]>>;
type SessionSheet = "outline" | { objectiveId: string } | null;
const modes: readonly SessionMode[] = ["outline", "study", "review"];
const modeTitles = { outline: "定下你的大纲", study: "", review: "回头过一遍学过的" };

function messageFor(cause: unknown) {
  return cause instanceof MasterySessionError ? cause.message : "无法完成操作，请重试";
}

export default function MasterySessionRoute() {
  const { pathId, sessionId, mode, objectiveId } = useLocalSearchParams<{
    pathId: string; sessionId: string; mode?: SessionMode; objectiveId?: string;
  }>();
  if (sessionId === "new") return <CreateSession pathId={pathId} mode={mode && modes.includes(mode) ? mode : "study"} objectiveId={objectiveId} />;
  return <SessionScreen key={sessionId} pathId={pathId} sessionId={sessionId} />;
}

function CreateSession({ pathId, mode, objectiveId }: { pathId: string; mode: SessionMode; objectiveId?: string }) {
  const { mastery } = useApp();
  const router = useRouter();
  const created = useRef<Promise<StoredSession> | null>(null);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    created.current ??= mode === "review" ? mastery.startReview(pathId, objectiveId).then(({ session }) => session)
      : mastery.createSession(pathId, mode);
    void created.current.then(({ session_id }) => {
      if (active) router.replace({ pathname: "/mastery/[pathId]/session/[sessionId]", params: { pathId, sessionId: session_id } });
    }).catch((error: unknown) => { if (active) setError(messageFor(error)); });
    return () => { active = false; };
  }, [attempt, mastery, mode, objectiveId, pathId, router]);
  return <Page title="精通会话" secondary>
    {error ? <RetryCard message={error} retry={() => { created.current = null; setError(undefined); setAttempt((value) => value + 1); }} />
      : <LoadingCard label="正在创建会话…" />}
  </Page>;
}

function SessionScreen({ pathId, sessionId }: { pathId: string; sessionId: string }) {
  const { mastery, snapshot } = useApp();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const [data, setData] = useState<Session>();
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [runningId, setRunningId] = useState(() => mastery.runningSession(pathId));
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState("");
  const [sheet, setSheet] = useState<SessionSheet>(null);
  const [toolName, setToolName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<string[]>([]);
  const [answerBar, setAnswerBar] = useState<{ interactionId: string; controls: AnswerControls }>();
  const active = useRef(false);
  const { scroll, follow, showBottom, scrollEvents, scrollToBottom } = useConversationScroll();
  const onAnswerControls = useCallback((interactionId: string, controls: AnswerControls | null) => {
    if (controls) follow.current = false;
    setAnswerBar((current) => controls ? { interactionId, controls }
      : current?.interactionId === interactionId ? undefined : current);
  }, [follow]);

  useEffect(() => {
    if (!answerBar) return;
    const subscription = Keyboard.addListener("keyboardDidHide", answerBar.controls.finishEditing);
    return () => subscription.remove();
  }, [answerBar]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    let latest = 0;
    let messageEvents = 0;
    let settled: Set<string> | undefined;
    let followedTurn = false;
    const unobserveActivity = mastery.observeActivity(sessionId, setToolName);
    const unobserveMessages = mastery.observeMessages(sessionId, (message) => {
      messageEvents++;
      setMessages((items) => {
        if (items.some(({ message_id }) => message_id === message.message_id)) {
          return items.map((item) => item.message_id === message.message_id ? message : item);
        }
        return [...items, message];
      });
    });
    function refresh() {
      const activeSession = mastery.runningSession(pathId);
      setRunningId(activeSession);
      if (activeSession === sessionId) followedTurn = true;
      const request = ++latest;
      void mastery.openSession(pathId, sessionId).then((session) => {
        if (!mounted || request !== latest) return;
        setData(session);
        setReadError(undefined);
        if (activeSession === undefined) {
          const mastered = session.status.map.modules.flatMap(({ knowledge_points }) => knowledge_points)
            .filter(({ status }) => status === "mastered");
          if (followedTurn && settled) {
            const newlyMastered = mastered.filter(({ id }) => !settled?.has(id)).map(({ name }) => name);
            if (newlyMastered.length) setCelebration(newlyMastered);
          }
          settled = new Set(mastered.map(({ id }) => id));
          followedTurn = false;
        }
        if (!messageEvents) setMessages(session.messages);
        else setMessages((items) => {
          const observed = new Map(items.map((item) => [item.message_id, item]));
          for (const item of session.messages) if (!observed.has(item.message_id)) observed.set(item.message_id, item);
          return [...observed.values()].sort((a, b) => a.created_at - b.created_at);
        });
      }).catch((cause: unknown) => { if (mounted && request === latest) setReadError(messageFor(cause)); });
    }
    const unobservePath = mastery.observePath(pathId, refresh);
    const stopForeground = onForeground(refresh);
    refresh();
    return () => { mounted = false; unobserveActivity(); unobserveMessages(); unobservePath(); stopForeground(); };
  }, [attempt, mastery, pathId, sessionId]));

  function perform(run: () => Promise<unknown>) {
    if (active.current) return;
    active.current = true;
    setError(undefined);
    setBusy(true);
    void run().catch((cause: unknown) => setError(messageFor(cause)))
      .finally(() => { active.current = false; setBusy(false); });
  }

  const waiting = runningId !== undefined && runningId !== sessionId;
  const generating = runningId === sessionId && (messages.some(({ status }) => status === "generating") || busy);
  const disabled = busy || runningId !== undefined;
  const configured = snapshot.model.configured;
  const model = configured ? snapshot.model.settings?.model.replace(/^openai\//, "") : undefined;
  const mode = data?.session.mode ?? "outline";

  function send(value: string) {
    if (!value.trim() || disabled || !configured) return;
    Keyboard.dismiss();
    follow.current = true;
    perform(() => mastery.send(pathId, sessionId, value, (message) => {
      if (message.role === "user") setDraft("");
    }));
  }

  function newStudy() {
    if (disabled) return;
    router.push({ pathname: "/mastery/[pathId]/session/[sessionId]", params: { pathId, sessionId: "new", mode: "study" } });
  }

  const retryRead = () => { setReadError(undefined); setAttempt((value) => value + 1); };
  if (!data) return <Page title="精通会话" secondary>
    {readError ? <RetryCard message={readError} retry={retryRead} /> : <LoadingCard label="正在读取会话…" />}
  </Page>;
  const { map, next, summary } = data.status;
  const assignedTurns = new Set(messages.filter(({ role }) => role === "assistant").map(({ turn_id }) => turn_id));
  function cardView(card: StudyCard) {
    return <QuestionCard key={card.interaction_id} card={card} submitting={generating}
      disabled={disabled || !configured || mode === "outline"}
      onAnswerControls={onAnswerControls}
      submit={(answers) => {
        follow.current = true;
        Keyboard.dismiss();
        perform(() => mastery.submitAnswer(pathId, sessionId, card.interaction_id, answers));
      }}
      retry={() => perform(() => mastery.retryAnswer(pathId, sessionId, card.interaction_id))}
      skip={() => perform(() => mastery.skipQuestion(pathId, sessionId, card.interaction_id))}
      challenge={() => perform(() => mastery.challengeQuestion(pathId, sessionId, card.interaction_id, ""))} />;
  }


  return <KeyboardAvoidingView style={local.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
    <SafeAreaView style={local.screen} edges={["left", "right", "bottom"]}>
        <View style={local.top}>
          <View style={local.topRow}>
            <ProgressRing {...summary} />
            <View style={local.topic}>
              <Text accessibilityRole="header" numberOfLines={1} style={local.topicName}>{data.status.path_name}</Text>
              {!!next.knowledge_point_name && <Text numberOfLines={1} style={styles.body}>当前 · {next.knowledge_point_name}</Text>}
              {summary.dueCount > 0 && <Text style={styles.body}>{`${summary.dueCount} 项复习已到期`}</Text>}
            </View>
            <ChatAction label="大纲" onPress={() => { Keyboard.dismiss(); setSheet("outline"); }} />
          </View>
          <View accessibilityRole="tablist" style={local.modes}>
            {modes.map((key) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={masteryModeLabels[key]}
              accessibilityState={{ selected: key === mode, disabled }} disabled={disabled}
              onPress={() => perform(() => mastery.switchMode(pathId, sessionId, key))}
              style={[local.mode, key === mode && local.activeMode]}>
              <Text style={[local.modeLabel, key === mode && local.activeModeLabel]}>{masteryModeLabels[key]}</Text>
            </Pressable>)}
          </View>
          {messages.length === 0 && !!masteryModeNotes[mode] && <Text style={styles.body}>{masteryModeNotes[mode]}</Text>}
        </View>
        <View style={local.scroll}>
        <ScrollView style={local.scroll} contentContainerStyle={local.messages} ref={scroll} keyboardShouldPersistTaps="handled"
          {...scrollEvents}
          onContentSizeChange={() => { if (follow.current && messages.length) scroll.current?.scrollToEnd({ animated: false }); }}>
          {!configured && <ModelSetup />}
          {readError && <RetryCard message={readError} retry={retryRead} />}
          {messages.length === 0 && <Card title={modeTitles[mode] || data.status.goal || data.status.path_name}>
            {masteryStarters[mode].map((starter) =>
              <Action key={starter} label={starter} disabled={disabled || !configured} onPress={() => send(starter)} secondary />)}
          </Card>}
          {messages.map((message) => <View key={message.message_id}
            style={[local.message, message.role === "user" && local.user]}>
            {message.role === "user" ? <Text selectable style={local.userText}>{message.content}</Text> : <>
              <Text style={local.author}>Dito</Text>
              <MessageContent content={message.content} streaming={message.status === "generating"} />
              {message.status === "generating" && (toolName || !message.content) && (
                <View style={local.toolActivity}>
                  <ActivityIndicator size="small" color={colors.muted} />
                  <Text accessibilityLiveRegion="polite" style={styles.body}>
                    {toolName ? masteryToolStatusLabel(toolName) : "正在生成…"}
                  </Text>
                </View>
              )}
              {(message.status === "failed" || message.status === "interrupted") && <>
                <Text style={styles.body}>{message.status === "interrupted" ? "回复已中断" : String(message.metadata?.error ?? "未完成回复")}</Text>
                <ChatAction label="重试" disabled={disabled || !configured} onPress={() => {
                  follow.current = true;
                  perform(() => mastery.retry(pathId, sessionId, message.message_id));
                }} />
              </>}
              {data.cards.filter((card) => card.turn_id === message.turn_id).map(cardView)}
            </>}
          </View>)}
          {data.cards.filter((card) => !assignedTurns.has(card.turn_id)).map(cardView)}
        </ScrollView>
        {showBottom && !answerBar && <ScrollToBottomButton onPress={scrollToBottom} />}
        </View>
        <LevelUpCelebration names={celebration} dismiss={() => setCelebration([])} />
        <View style={local.bottom}>
          {mode === "outline" && summary.total > 0 && <View style={local.ready}>
            <Text style={local.readyLabel}>{`大纲已就绪——共 ${summary.total} 个知识点`}</Text>
            <ChatAction label="开始学习" primary disabled={disabled} onPress={newStudy} />
          </View>}
          {waiting && <Text accessibilityRole="alert" style={styles.body}>同一精通目标的另一会话正在进行，请等它结束再发送。</Text>}
          {error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
          {answerBar ? <View style={local.answerActions} testID="mastery-answer-actions">
            <ChatAction label="收起键盘" onPress={() => { answerBar.controls.finishEditing(); Keyboard.dismiss(); }} />
            {answerBar.controls.next && <ChatAction label="下一题" onPress={answerBar.controls.next} />}
            <ChatAction label={answerBar.controls.submitLabel} primary disabled={!answerBar.controls.canSubmit}
              onPress={answerBar.controls.submit} />
          </View> : <ConversationComposer label="给导师发消息" testID="mastery-composer" placeholder="给导师发消息" draft={draft}
            onChangeText={setDraft} send={() => send(draft)} sendDisabled={disabled || !configured || !draft.trim()}
            stop={generating || runningId === sessionId && !busy ? () => mastery.stop(pathId, sessionId) : undefined} model={model} />}
        </View>
        {sheet === "outline" && <ChatSheet title="大纲" close={() => setSheet(null)}>
          <ScrollView style={local.sheet} contentContainerStyle={local.sheetContents}>
            <MasteryOutline map={map} current={next.knowledge_point_id} onObjective={(objectiveId) => setSheet({ objectiveId })} />
          </ScrollView>
        </ChatSheet>}
        {sheet && sheet !== "outline" && <SessionEvidence key={sheet.objectiveId} pathId={pathId}
          objectiveId={sheet.objectiveId} disabled={disabled} close={() => setSheet(null)} />}
    </SafeAreaView>
  </KeyboardAvoidingView>;
}

function SessionEvidence({ pathId, objectiveId, disabled, close }: {
  pathId: string; objectiveId: string; disabled: boolean; close: () => void;
}) {
  const { mastery } = useApp();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const read = useCallback(() => mastery.objectiveEvidence(pathId, objectiveId), [mastery, objectiveId, pathId]);
  const observe = useCallback((refresh: () => void) => mastery.observePath(pathId, refresh), [mastery, pathId]);
  const { data, error } = useMasteryProjection(read, observe);

  return <ObjectiveEvidence evidence={data} close={close} busy={disabled || saving}
    loadingError={saveError ?? (error === undefined ? undefined : messageFor(error))}
    setMastery={(mastered, note) => {
      setSaving(true);
      setSaveError(undefined);
      void mastery.setObjectiveMastery(pathId, objectiveId, mastered, note)
        .catch((cause: unknown) => setSaveError(messageFor(cause)))
        .finally(() => setSaving(false));
    }} />;
}

function ProgressRing({ mastered, total, percentage }: { mastered: number; total: number; percentage: number }) {
  const lit = Math.round(percentage * 12 / 100);
  return <View accessibilityRole="progressbar" accessibilityLabel={`已掌握 ${mastered} / 共 ${total}`}
    accessibilityValue={{ min: 0, max: total || 1, now: mastered }} style={local.ring}>
    {Array.from({ length: 12 }, (_, index) => {
      const angle = Math.PI * index / 6;
      return <View key={index} style={[local.ringDot, {
        left: 19 + Math.sin(angle) * 17, top: 19 - Math.cos(angle) * 17,
        backgroundColor: index < lit ? colors.primary : colors.border,
      }]} />;
    })}
    <Text style={local.ratio}>{mastered}/{total}</Text>
  </View>;
}

const local = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm, gap: spacing.xs },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  topic: { flex: 1, minWidth: 0 },
  topicName: { fontSize: 16, color: colors.text, fontWeight: "700" },
  modes: { flexDirection: "row", gap: 3, padding: 3, backgroundColor: colors.soft, borderRadius: 12 },
  mode: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderRadius: 9 },
  activeMode: { backgroundColor: colors.surface },
  modeLabel: { fontSize: 14, color: colors.muted, fontWeight: "600", textAlign: "center" },
  activeModeLabel: { color: colors.primary },
  ring: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  ringDot: { width: 4, height: 4, borderRadius: 2, position: "absolute" },
  ratio: { color: colors.text, fontSize: 10, fontWeight: "700" },
  scroll: { flex: 1 },
  messages: { padding: spacing.md, gap: spacing.md },
  message: { gap: spacing.xs },
  toolActivity: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  user: { alignSelf: "flex-end", backgroundColor: colors.soft, padding: spacing.sm,
    borderRadius: radius.large, borderBottomRightRadius: 6, maxWidth: "90%" },
  userText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  author: { color: colors.primary, fontWeight: "700" },
  bottom: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  answerActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  ready: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radius.card,
    padding: spacing.sm, backgroundColor: colors.soft },
  readyLabel: { color: colors.text, flex: 1, fontWeight: "600" },
  error: { color: colors.danger },
  sheet: { flexGrow: 0, maxHeight: 470 },
  sheetContents: { paddingBottom: spacing.md },
});
