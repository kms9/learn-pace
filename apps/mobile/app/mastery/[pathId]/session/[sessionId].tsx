import {
  MasterySessionError, masteryModeLabels, masteryModeNotes, masteryStarters, type MasterySessionService, type StudyCard,
} from "@learn-pace/app-host";
import type { SessionMode } from "@learn-pace/domain";
import type { StoredMessage, StoredSession } from "@learn-pace/infra";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatAction, ChatSheet } from "../../../../src/components/chat-controls";
import { MasteryOutline } from "../../../../src/components/MasteryOutline";
import { LevelUpCelebration } from "../../../../src/components/mastery/LevelUpCelebration";
import { QuestionCard } from "../../../../src/components/mastery/QuestionCard";
import { MessageContent } from "../../../../src/components/MessageContent";
import { Action, Card, LoadingCard, ModelSetup, Page, RetryCard, styles } from "../../../../src/components/Shell";
import { useApp } from "../../../../src/context/AppContext";
import { onForeground } from "../../../../src/context/useMasteryProjection";
import { colors, spacing } from "../../../../src/theme";

type Session = Awaited<ReturnType<MasterySessionService["openSession"]>>;
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
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<string[]>([]);
  const active = useRef(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const follow = useRef(true);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    let latest = 0;
    let messageEvents = 0;
    let settled: Set<string> | undefined;
    let followedTurn = false;
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
    return () => { mounted = false; unobserveMessages(); unobservePath(); stopForeground(); };
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
      submit={(answers) => {
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
            <View accessibilityRole="tablist" style={local.modes}>
              {modes.map((key) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={masteryModeLabels[key]}
                accessibilityState={{ selected: key === mode, disabled }} disabled={disabled}
                onPress={() => perform(() => mastery.switchMode(pathId, sessionId, key))}
                style={[local.mode, key === mode && local.activeMode]}>
                <Text style={local.modeLabel}>{masteryModeLabels[key]}</Text>
              </Pressable>)}
            </View>
            <ProgressRing {...summary} />
            <ChatAction label="大纲" onPress={() => setSheet(true)} />
          </View>
          <Text style={styles.body}>{`已掌握 ${summary.mastered} / 共 ${summary.total}（${summary.percentage}%） · ${summary.dueCount} 项复习已到期`}</Text>
          {!!masteryModeNotes[mode] && <Text style={styles.body}>{masteryModeNotes[mode]}</Text>}
        </View>
        <ScrollView style={local.scroll} contentContainerStyle={local.messages} ref={scroll} keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => { follow.current = false; }}
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
              {message.status === "generating" && <Text style={styles.body}>正在生成…</Text>}
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
        <LevelUpCelebration names={celebration} dismiss={() => setCelebration([])} />
        <View style={local.bottom}>
          {mode === "outline" && summary.total > 0 && <View style={local.ready}>
            <Text style={local.readyLabel}>{`大纲已就绪——共 ${summary.total} 个知识点`}</Text>
            <ChatAction label="开始学习" primary disabled={disabled} onPress={newStudy} />
          </View>}
          {waiting && <Text accessibilityRole="alert" style={styles.body}>同一精通目标的另一会话正在进行，请等它结束再发送。</Text>}
          {error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
          <View style={local.composer}>
            <TextInput accessibilityLabel="给导师发消息" testID="mastery-composer" placeholder="给导师发消息"
              placeholderTextColor={colors.muted} multiline value={draft} onChangeText={setDraft} style={local.input} />
            {generating || runningId === sessionId && !busy ? <ChatAction label="停止" onPress={() => mastery.stop(pathId, sessionId)} /> :
              <ChatAction label="发送" primary disabled={disabled || !configured || !draft.trim()} onPress={() => send(draft)} />}
          </View>
        </View>
        {sheet && <ChatSheet title="大纲" close={() => setSheet(false)}>
          <ScrollView style={local.sheet} contentContainerStyle={local.sheetContents}>
            <MasteryOutline map={map} current={next.knowledge_point_id} />
          </ScrollView>
        </ChatSheet>}
    </SafeAreaView>
  </KeyboardAvoidingView>;
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
  top: { borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: spacing.xs },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  modes: { flex: 1, flexDirection: "row", gap: 3 },
  mode: { minHeight: 44, flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderRadius: 9 },
  activeMode: { backgroundColor: colors.soft },
  modeLabel: { fontSize: 14, color: colors.text, fontWeight: "600" },
  ring: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  ringDot: { width: 4, height: 4, borderRadius: 2, position: "absolute" },
  ratio: { color: colors.text, fontSize: 10, fontWeight: "700" },
  scroll: { flex: 1 },
  messages: { padding: spacing.md, gap: spacing.md },
  message: { gap: spacing.xs },
  user: { alignSelf: "flex-end", backgroundColor: colors.soft, padding: spacing.sm, borderRadius: 14, maxWidth: "90%" },
  userText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  author: { color: colors.primary, fontWeight: "700" },
  bottom: { borderTopWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: spacing.xs },
  ready: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  readyLabel: { color: colors.text, flex: 1, fontWeight: "600" },
  composer: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-end" },
  input: { flex: 1, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 12,
    minHeight: 44, maxHeight: 110, paddingHorizontal: spacing.sm, fontSize: 16 },
  error: { color: colors.danger },
  sheet: { flexGrow: 0, maxHeight: 470 },
  sheetContents: { paddingBottom: spacing.md },
});
