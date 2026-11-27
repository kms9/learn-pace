import { MasterySessionError, RestoreGateError, type TopicMaterial } from "@learn-pace/app-host";
import type { StoredKnowledgeCard, StoredMessage, StoredSession } from "@learn-pace/infra";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Action, Card, LoadingCard, ModelSetup, Page, RetryCard, styles } from "../../src/components/Shell";
import { ChatSearch } from "../../src/components/chat-controls";
import { MessageContent } from "../../src/components/MessageContent";
import { useApp } from "../../src/context/AppContext";
import { colors, spacing } from "../../src/theme";

const emojis = ["🧭", "📚", "📐", "💻", "🧪", "🎨", "🧠", "🎯"];

export default function NewMasteryTopic() {
  const { sourceSessionId, sourceMessageId, sourceExcerpt } = useLocalSearchParams<{
    sourceSessionId?: string; sourceMessageId?: string; sourceExcerpt?: string;
  }>();
  const { mastery, knowledgeCards, snapshot } = useApp();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState("");
  const [emoji, setEmoji] = useState(emojis[0]!);
  const [materials, setMaterials] = useState<{ key: string; label: string; material: TopicMaterial }[]>(() =>
    sourceSessionId && sourceExcerpt ? [{
      key: "forwarded", label: "来自问答的选文",
      material: { kind: "chat", sessionId: sourceSessionId, messageId: sourceMessageId, excerpt: sourceExcerpt },
    }] : []);
  const [sessions, setSessions] = useState<StoredSession[]>();
  const [cards, setCards] = useState<StoredKnowledgeCard[]>();
  const [cardsError, setCardsError] = useState(false);
  const [cardsAttempt, setCardsAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [messages, setMessages] = useState<StoredMessage[]>();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [sessionError, setSessionError] = useState(false);
  const [messageError, setMessageError] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [messageAttempt, setMessageAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const noteId = useRef(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const search = query.trim().toLocaleLowerCase();
  const recentLimit = 4;
  const visibleSessions = search ? sessions?.filter(({ title }) => title.toLocaleLowerCase().includes(search))
    : showAllSessions ? sessions : sessions?.slice(0, recentLimit);

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);

  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    void mastery.listMaterialSessions().then((items) => {
      if (active) setSessions(items);
    }).catch(() => { if (active) setSessionError(true); });
    return () => { active = false; };
  }, [mastery, sessionAttempt, step]);

  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    void knowledgeCards.list().then((result) => { if (active) setCards(result); })
      .catch(() => { if (active) setCardsError(true); });
    return () => { active = false; };
  }, [knowledgeCards, cardsAttempt, step]);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    void mastery.listMaterialMessages(expanded).then((items) => {
      if (active) setMessages(items);
    }).catch(() => { if (active) setMessageError(true); });
    return () => { active = false; };
  }, [expanded, mastery, messageAttempt]);

  function nextStep() {
    const count = [...goal.trim()].length;
    if (count === 0 || count > 2000) { setError("请填写学习目标，最多 2,000 字"); return; }
    setError(undefined);
    Keyboard.dismiss();
    setStep(2);
  }

  function select(key: string, label: string, material: TopicMaterial) {
    setMaterials((current) => current.some((item) => item.key === key)
      ? current.filter((item) => item.key !== key) : [...current, { key, label, material }]);
  }

  function addNote() {
    if (!note.trim()) return;
    const text = note.trim();
    select("note-" + ++noteId.current, "文本笔记", { kind: "text_note", text });
    setNote("");
  }

  async function submit() {
    if (working.current) return;
    working.current = true;
    Keyboard.dismiss();
    setBusy(true);
    setError(undefined);
    try {
      const { pathId, session } = await mastery.createTopic({
        goal, emoji, materials: [...materials.map(({ material }) => material),
          ...(note.trim() ? [{ kind: "text_note" as const, text: note.trim() }] : [])],
      });
      router.replace({ pathname: "/mastery/[pathId]/session/[sessionId]", params: { pathId, sessionId: session.session_id } });
    } catch (cause) {
      setError(cause instanceof MasterySessionError || cause instanceof RestoreGateError ? cause.message : "无法创建精通目标，请重试");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const footer = <View style={local.footer}>
    {error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
    <View style={local.footerActions}>
      {step === 2 && <Action label="返回上一步" onPress={() => { setStep(1); setError(undefined); }} disabled={busy} secondary />}
      <View style={local.primaryAction}>
        {step === 1 ? <Action label="下一步" onPress={nextStep} />
          : <Action label={busy ? "正在创建…" : "和导师一起定大纲"} onPress={() => void submit()} disabled={busy} />}
      </View>
    </View>
  </View>;

  return <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
    <Page title={step === 1 ? "你想掌握什么？" : "添加学习资料"} secondary scrollRef={scroll} footer={footer}>
    <View accessible accessibilityLabel={`第 ${step} 步，共 2 步。${step === 1 ? "学习目标" : "选择资料"}`} style={local.steps}>
      <Text style={[local.step, step === 1 && local.activeStep]}>1  学习目标</Text>
      <Text style={[local.step, step === 2 && local.activeStep]}>2  选择资料</Text>
    </View>
    {step === 1 ? <Card>
      <TextInput accessibilityLabel="学习目标" placeholder="例如，学会独立化简分数和比例"
        placeholderTextColor={colors.muted} multiline value={goal} onChangeText={setGoal}
        style={[local.input, local.goal]} testID="mastery-goal" />
      <Text style={styles.body}>{[...goal].length} / 2,000</Text>
      <View accessibilityLabel="目标图标" style={local.icons}>
        {emojis.map((icon) => <Pressable key={icon} accessibilityRole="button" accessibilityLabel={icon}
          accessibilityState={{ selected: emoji === icon }} onPress={() => setEmoji(icon)}
          style={[local.icon, emoji === icon && local.selected]}>
          <Text style={local.iconText}>{icon}</Text>
        </Pressable>)}
      </View>
    </Card> : <>
      {!!materials.length && <Card title="已选资料">
        {materials.map(({ key, label, material }) => <View key={key} style={local.material}>
          {material.kind === "text_note" && material.label
            ? <MessageContent content={"### " + label} /> : <Text style={styles.heading}>{label}</Text>}
          {material.kind === "chat" && material.excerpt && <Text style={styles.body}>{material.excerpt}</Text>}
          {material.kind === "text_note" && <Text style={styles.body}>{material.text}</Text>}
          <Action label="移除资料" onPress={() => setMaterials((items) => items.filter((item) => item.key !== key))} secondary />
        </View>)}
      </Card>}
      <Card title="从知识卡选择">
        {cardsError ? <RetryCard message="无法读取知识卡"
          retry={() => { setCardsError(false); setCardsAttempt((value) => value + 1); }} />
          : !cards && <LoadingCard label="正在读取知识卡…" />}
        {cards?.length === 0 && <Text style={styles.body}>还没有收藏的知识卡。</Text>}
        {cards?.map((card) => {
          const key = "knowledge-card-" + card.card_id;
          const checked = materials.some((item) => item.key === key);
          return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked }} style={local.material}
            onPress={() => select(key, card.title, { kind: "text_note", label: card.title, text: card.content })}>
            <MessageContent content={"### " + card.title} />
            <Text style={styles.body} numberOfLines={2}>{card.content}</Text>
            <Text style={local.link}>{checked ? "取消选择知识卡" : "选择这张知识卡"}</Text>
          </Pressable>;
        })}
      </Card>
      <Card title="问答会话">
        <ChatSearch label="搜索问答会话" value={query} change={setQuery} />
        {sessionError ? <RetryCard message="无法读取问答会话"
          retry={() => { setSessionError(false); setSessionAttempt((value) => value + 1); }} />
          : !sessions && <LoadingCard label="正在读取问答会话…" />}
        {sessions?.length === 0 && <Text style={styles.body}>没有可添加的问答会话。</Text>}
        {search && !!sessions?.length && visibleSessions?.length === 0 && <Text style={styles.body}>未找到匹配的会话。</Text>}
        {visibleSessions?.map((session) => <View key={session.session_id} style={local.material}>
          <Action label={session.title} onPress={() => {
            setMessages(undefined);
            setMessageError(false);
            setExpanded((current) => current === session.session_id ? undefined : session.session_id);
          }} secondary />
          {expanded === session.session_id && <>
            {messageError ? <RetryCard message="无法读取该会话"
              retry={() => { setMessageError(false); setMessageAttempt((value) => value + 1); }} />
              : !messages && <LoadingCard label="正在读取会话…" />}
            {messages?.length === 0 && <Text style={styles.body}>这段会话还没有可用的消息。</Text>}
            {!!messages?.length && <Action label="选择整段会话" onPress={() =>
              select("session-" + session.session_id, session.title, { kind: "chat", sessionId: session.session_id })} secondary />}
            {messages?.map((message) => <Pressable key={message.message_id} accessibilityRole="button"
              onPress={() => select(message.message_id, session.title, {
                kind: "chat", sessionId: session.session_id, messageId: message.message_id,
              })} style={local.material}>
              <Text style={styles.body} numberOfLines={3}>{message.content}</Text>
              <Text style={local.link}>{materials.some(({ key }) => key === message.message_id) ? "取消选择这条消息" : "选择这条消息"}</Text>
            </Pressable>)}
          </>}
        </View>)}
        {!search && !showAllSessions && (sessions?.length ?? 0) > recentLimit &&
          <Action label="展开更多会话" onPress={() => setShowAllSessions(true)} secondary />}
      </Card>
      <Card title="文本笔记">
        <TextInput accessibilityLabel="文本笔记" placeholder="输入可选的资料或学习笔记" placeholderTextColor={colors.muted}
          value={note} onChangeText={setNote} style={local.input} multiline />
        <Action label="添加笔记" disabled={!note.trim()} onPress={addNote} secondary />
      </Card>
      <Card title="模型">
        <Text style={styles.body}>{snapshot.model.settings?.model ?? "DeepSeek Flash"}</Text>
        {!snapshot.model.configured && <Text style={styles.body}>可先创建目标，发送消息前请到「我的」配置模型。</Text>}
      </Card>
      <ModelSetup />
    </>}
    </Page>
  </KeyboardAvoidingView>;
}

const local = StyleSheet.create({
  steps: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  step: { flex: 1, color: colors.muted, borderBottomWidth: 2, borderColor: colors.border,
    paddingBottom: spacing.sm, fontSize: 14, fontWeight: "600" },
  activeStep: { color: colors.primary, borderColor: colors.primary },
  footer: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background },
  footerActions: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  primaryAction: { flex: 1 },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, color: colors.text,
    padding: spacing.sm, fontSize: 16, textAlignVertical: "top" },
  goal: { minHeight: 96 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  icon: { alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 10 },
  selected: { backgroundColor: colors.soft, borderColor: colors.primary, borderWidth: 1 },
  iconText: { fontSize: 23 },
  material: { gap: spacing.xs, paddingVertical: spacing.xs },
  link: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.danger, marginTop: spacing.xs },
});
