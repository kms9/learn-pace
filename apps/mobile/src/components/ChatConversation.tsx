import {
  ExtensionPrepareError, KnowledgeCardError, Lf01ChatError, RestoreGateError, messageQuotes, messageSkillReceipts, messageSkillSelection, publicQuickCheck, quickCheckExcerpt, renderedChatSelections,
  messageKnowledgeCitations, messageKnowledgeProvenance, messageKnowledgeReceipts,
  type ChatQuote, type ChatSelection, type SkillReceipt, type KnowledgeChoice, type KnowledgeCitation, type KnowledgeReceipt,
} from "@learn-pace/app-host";
import type { SkillScope, StoredMessage, StoredSession, StoredSourceBinding } from "@learn-pace/infra";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useApp } from "../context/AppContext";
import { colors, radius, spacing } from "../theme";
import { ChatAction, ChatSheet, ComposerSkillChip, ConversationComposer, ScrollToBottomButton, useConversationScroll } from "./chat-controls";
import { MessageContent } from "./MessageContent";
import { QuickCheckCard } from "./QuickCheckCard";
import { skillShortVersion } from "./SkillDetails";

type SelectionAction = "quote" | "dito" | "goal" | "save";
type ChatOperation = "turn" | "delete" | "quick-check";
type SourceSelection = { message: StoredMessage; candidates?: ChatSelection[] };
type RenderedSelection = { message: StoredMessage; text: string };
const starterPrompts = [
  ["讲懂一个概念", "请用一个生活中的例子解释："],
  ["帮我解一道题", "请带我一步步分析这道题："],
  ["定个学习目标", "我想学会……请帮我定一个可以验证的学习目标。"],
] as const;
type Properties = {
  sessionId?: string;
  initialMessages: StoredMessage[];
  scope: SkillScope;
  onSessionStarted?: (session: StoredSession) => void;
  onFirstMessage?: (sessionId: string, text: string) => void;
  onThreadsChanged?: () => void;
  renderThreadMarker?: (messageId: string) => ReactNode;
  renderReplyExtra?: (message: StoredMessage) => ReactNode;
  intro?: ReactNode;
};

function feedback(error: unknown): string {
  return error instanceof ExtensionPrepareError || error instanceof Lf01ChatError || error instanceof KnowledgeCardError || error instanceof RestoreGateError
    ? error.message : "无法完成操作，请重试";
}

export function ChatConversation({
  sessionId, initialMessages, scope, onSessionStarted, onFirstMessage, onThreadsChanged, renderThreadMarker, renderReplyExtra, intro,
}: Properties) {
  const { chat, knowledge, knowledgeCards, snapshot } = useApp();
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [skillId, setSkillId] = useState<string>();
  const [skills, setSkills] = useState<{ skillId: string; name: string; description: string }[] | null>();
  const [receipts, setReceipts] = useState<SkillReceipt[]>();
  const [resend, setResend] = useState<StoredMessage>();
  const [knowledgeChoice, setKnowledgeChoice] = useState<KnowledgeChoice | null>();
  const [inherited, setInherited] = useState<KnowledgeChoice>();
  const [knownLibraries, setKnownLibraries] = useState<StoredSourceBinding[]>([]);
  const [libraryMenu, setLibraryMenu] = useState<StoredSourceBinding[] | null>();
  const [knowledgeError, setKnowledgeError] = useState(false);
  const [citation, setCitation] = useState<KnowledgeCitation>();
  const [sourceReceipts, setSourceReceipts] = useState<KnowledgeReceipt[]>();
  const isMainChat = scope === "lf01";
  const [busy, setBusy] = useState<ChatOperation | null>(null);
  const busyRef = useRef(false);
  const targetId = useRef(sessionId);
  const stopRequested = useRef(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<SourceSelection | null>(null);
  const [renderedSelection, setRenderedSelection] = useState<RenderedSelection | null>(null);
  const { scroll, follow, showBottom, scrollEvents, scrollToBottom } = useConversationScroll();
  const [copiedId, setCopiedId] = useState<string>();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyRequest = useRef(0);
  const composerInput = useRef<ComponentRef<typeof TextInput>>(null);
  const configured = snapshot.model.configured;
  const model = configured ? snapshot.model.settings?.model.replace(/^openai\//, "") : undefined;
  const generating = busy === "turn" || (chat.isRunning(sessionId ?? "") && messages.some(({ status }) => status === "generating"));
  const latest = messages.filter(({ role, status, metadata }) =>
    role === "assistant" && status === "committed" && metadata?.quick_check === undefined).at(-1)?.message_id;
  const hasCompletedReply = messages.some(({ role, status, content, metadata }) => role === "assistant" &&
    status === "committed" && content.trim() && typeof metadata?.source_user_message_id === "string");
  const canStartCheck = !!sessionId && hasCompletedReply && !busy && !generating && configured;
  const effectiveKnowledge = knowledgeChoice === undefined ? inherited : knowledgeChoice;
  const selectedLibrary = knownLibraries.find(item => item.binding_id === effectiveKnowledge?.bindingId);

  useFocusEffect(useCallback(() => {
    let active = true;
    void Promise.all([knowledge.listBindings(), scope === "little_tutor" && sessionId ? chat.inheritedKnowledge(sessionId) : undefined])
      .then(([bindings, choice]) => { if (active) { setKnownLibraries(bindings); setInherited(choice); } })
      .catch(() => {});
    return () => { active = false; };
  }, [chat, knowledge, scope, sessionId]));

  useEffect(() => () => { copyRequest.current++; clearTimeout(copyTimer.current); }, []);

  async function copyReply(message: StoredMessage) {
    const request = ++copyRequest.current;
    try {
      if (!await Clipboard.setStringAsync(message.content)) throw new Error();
      if (request !== copyRequest.current) return;
      clearTimeout(copyTimer.current);
      setCopiedId(message.message_id);
      copyTimer.current = setTimeout(() => setCopiedId(undefined), 1_500);
    } catch {
      if (request === copyRequest.current) setError("无法复制回复，请重试");
    }
  }

  const applyMessage = useCallback((updated: StoredMessage) => {
    setMessages((items) => {
      const index = items.findIndex(({ message_id }) => message_id === updated.message_id);
      if (index < 0) return [...items, updated];
      if (items[index] === updated) return items;
      return items.map((item, i) => i === index ? updated : item);
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    let observed = false;
    const unsubscribe = chat.observeMessages(sessionId, (message) => {
      observed = true;
      applyMessage(message);
    });
    // Catch a checkpoint that settled between opening the conversation and subscribing.
    void chat.readConversation(sessionId).then(({ messages: stored }) => {
      if (mounted && !observed && !busyRef.current) setMessages(stored);
    }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, [applyMessage, chat, sessionId]);

  async function run(action: ChatOperation, operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    stopRequested.current = false;
    setBusy(action);
    setError(undefined);
    setResend(undefined);
    setKnowledgeError(false);
    try {
      await operation();
    } catch (cause) {
      if (cause instanceof ExtensionPrepareError && cause.code.startsWith("kb_")) setKnowledgeError(true);
      setError(feedback(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function send() {
    if (!configured || generating || !draft.trim()) return;
    void run("turn", async () => {
      targetId.current = sessionId;
      Keyboard.dismiss();
      follow.current = true;
      const onMessage = (message: StoredMessage) => {
        applyMessage(message);
        if (message.role === "user") {
          if (!messages.some(({ role }) => role === "user")) onFirstMessage?.(message.session_id, message.content);
          setDraft("");
          setQuotes([]);
          setSkillId(undefined);
        }
      };
      if (sessionId) {
        await chat.send(sessionId, draft, quotes, { skillId, knowledge: knowledgeChoice, onMessage });
      } else {
        await chat.sendNew(draft, quotes, { skillId, knowledge: knowledgeChoice,
          onSession(session) {
            targetId.current = session.session_id;
            onSessionStarted?.(session);
            if (stopRequested.current) chat.stop(session.session_id);
          },
          onMessage,
        });
      }
    });
  }

  function stop() {
    stopRequested.current = true;
    const id = targetId.current ?? sessionId;
    if (id) chat.stop(id);
  }

  function repeat(messageId: string, action: "retry" | "regenerate") {
    if (!sessionId) return;
    void run("turn", async () => {
      targetId.current = sessionId;
      try {
        await chat[action](sessionId, messageId, applyMessage);
      } catch (cause) {
        if (cause instanceof ExtensionPrepareError) {
          const reply = messages.find(({ message_id }) => message_id === messageId);
          const user = messages.find(({ message_id }) => message_id === reply?.metadata?.source_user_message_id);
          if (user) setResend(user);
        }
        throw cause;
      }
    });
  }

  async function useCurrentVersion(message: StoredMessage) {
    if (busyRef.current) return;
    const original = messageSkillSelection(message)[0]?.skillId;
    const menu = await chat.listSelectableSkills(scope);
    const current = menu.find((item) => item.skillId === original);
    setDraft(message.content);
    setQuotes(messageQuotes(message));
    setSkillId(current?.skillId);
    setResend(undefined);
    setError(original && !current ? "此技能在当前场景已不可用，已回填原消息和引用。" : undefined);
    scrollToBottom();
    composerInput.current?.focus();
  }

  function chooseSkill() {
    Keyboard.dismiss();
    setSkills(null);
    void chat.listSelectableSkills(scope).then(setSkills).catch(() => {
      setSkills(undefined);
      setError("无法读取当前场景的技能，请重试。");
    });
  }

  function chooseLibrary() {
    Keyboard.dismiss();
    setLibraryMenu(null);
    void chat.listAvailableKnowledge().then((bindings) => {
      setKnownLibraries(previous => [...new Map([...previous, ...bindings].map(item => [item.binding_id, item])).values()]);
      setLibraryMenu(isMainChat ? bindings : bindings.filter(item => item.binding_id === inherited?.bindingId));
    }).catch(() => { setLibraryMenu(undefined); setError("无法读取已授权的知识库。"); });
  }

  function switchToOrdinary() {
    if (resend) {
      setDraft(resend.content);
      setQuotes(messageQuotes(resend));
    }
    if (skillId === "ima-knowledge") setSkillId(undefined);
    setKnowledgeChoice(null);
    setResend(undefined);
    setKnowledgeError(false);
    setError(undefined);
    scrollToBottom();
    composerInput.current?.focus();
  }

  function createQuickCheck(sourceMessageId?: string) {
    if (!sessionId || !canStartCheck) return;
    void run("quick-check", async () => {
      Keyboard.dismiss();
      follow.current = true;
      applyMessage(await chat.createQuickCheck(sessionId, sourceMessageId));
    });
  }

  function continueAfterQuickCheck(message: StoredMessage) {
    const excerpt = quickCheckExcerpt(message);
    if (!excerpt) return;
    const prompt = `我想继续聊刚才的自测。请帮我梳理这些题目涉及的概念。\n${excerpt}`;
    setDraft((current) => current.trim() ? `${current}\n\n${prompt}` : prompt);
    scrollToBottom();
    composerInput.current?.focus();
  }

  async function quickCheckLearningGoal(session: string, message: StoredMessage) {
    const params = await chat.learningGoalSource(session, message.message_id);
    router.push({ pathname: "/mastery/new", params: { ...params } });
  }

  function deleteTurn(messageId: string) {
    if (!sessionId) return;
    Alert.alert("删除这轮对话？", "这轮提问和回复将被删除。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => {
        void run("delete", async () => {
          await chat.deleteTurn(sessionId, messageId);
          const { messages: remaining } = await chat.readConversation(sessionId);
          setMessages(remaining);
          onThreadsChanged?.();
        });
      } },
    ]);
  }

  async function choose(message: StoredMessage, action: SelectionAction, selection: ChatSelection, confirm = false) {
    if (!sessionId) return;
    setError(undefined);
    if (!confirm && messageKnowledgeProvenance(message) && (action === "save" || action === "goal")) {
      Alert.alert(action === "save" ? "保存外部资料到知识卡？" : "将外部资料用于学习目标？",
        action === "save" ? "选文将复制到本机知识卡，可随本地备份导出。"
          : "选文将带入学习目标，继续生成大纲时可能发送给当前配置的模型。", [
          { text: "取消", style: "cancel" },
          { text: "继续", onPress: () => void choose(message, action, selection, true).catch(cause => setError(feedback(cause))) },
        ]);
      return;
    }
    if (action === "quote") {
      if (quotes.length >= 3) throw new Lf01ChatError("最多添加 3 条引用");
      const quote = await chat.quoteSelection(sessionId, message.message_id, selection);
      setQuotes((current) => [...current, quote]);
      setSelected(null);
      return;
    }
    if (action === "dito") {
      const thread = await chat.createThread(sessionId, message.message_id, selection);
      follow.current = false;
      setSelected(null);
      onThreadsChanged?.();
      router.push({ pathname: "/chat/thread/[threadId]", params: { threadId: thread.thread_id } });
      return;
    }
    if (action === "save") {
      await knowledgeCards.saveSelection(sessionId, message.message_id, selection, confirm);
      setSelected(null);
      setRenderedSelection(null);
      Alert.alert("已收藏为知识卡");
      return;
    }
    const params = await chat.learningGoalSource(sessionId, message.message_id, selection, confirm);
    setSelected(null);
    router.push({ pathname: "/mastery/new", params: { ...params } });
  }

  function fromRendered(message: StoredMessage, action: SelectionAction, text: string) {
    const candidates = renderedChatSelections(message.content, text);
    if (candidates.length !== 1) {
      setSelected({ message, candidates });
      return;
    }
    void choose(message, action, candidates[0]!).catch((cause: unknown) => setError(feedback(cause)));
  }

  function trackSelection(message: StoredMessage, text: string) {
    if (text.trim()) {
      follow.current = false;
      setRenderedSelection({ message, text });
    } else {
      setRenderedSelection((current) => current?.message.message_id === message.message_id ? null : current);
    }
  }

  function followLatest() {
    if (!follow.current || !messages.length) return;
    requestAnimationFrame(() => {
      if (follow.current) scroll.current?.scrollToEnd({ animated: false });
    });
  }

  return (
    <>
      <View style={styles.scroll}>
      <ScrollView
        ref={scroll}
        testID="chat-messages"
        style={styles.scroll}
        contentContainerStyle={[styles.messages, !messages.length && !intro && styles.emptyMessages]}
        keyboardShouldPersistTaps="handled"
        {...scrollEvents}
        onLayout={followLatest}
        onContentSizeChange={followLatest}
      >
        {intro}
        {messages.length === 0 && !intro && <View style={styles.welcome}>
          <Text accessibilityRole="header" style={styles.emptyTitle}>有什么想了解的？</Text>
          {isMainChat && <View style={styles.starters}>
            {starterPrompts.map(([label, prompt]) => <View key={label} style={styles.starter}>
              <ChatAction label={label} disabled={!!draft || generating}
                onPress={() => setDraft((current) => current || prompt)} />
            </View>)}
          </View>}
        </View>}
        {messages.map((message) => {
          const check = publicQuickCheck(message);
          if (check && sessionId) return <View key={message.message_id} style={styles.message}>
            <View style={styles.attribution}><Text style={styles.author}>Dito</Text></View>
            <QuickCheckCard intro={message.content} check={check} disabled={!!busy || generating}
              submit={async (answers, submissionId) => {
                applyMessage(await chat.submitQuickCheck(sessionId, message.message_id, answers, submissionId));
              }}
              retry={async () => { applyMessage(await chat.retryQuickCheck(sessionId, message.message_id)); }}
              saveExplanation={(id) => knowledgeCards.saveQuickCheckExplanation(message.message_id, id)}
              continueChat={() => continueAfterQuickCheck(message)}
              learningGoal={() => quickCheckLearningGoal(sessionId, message)} />
          </View>;
          const isUser = message.role === "user";
          const done = message.status === "committed";
          const canSelect = done && !!message.content.trim();
          const live = message.status === "generating";
          const retryable = message.status === "interrupted" || message.status === "failed";
          const modelId = message.metadata?.model_id;
          const messageReceipts = isUser ? [] : messageSkillReceipts(message);
          const citations = isUser ? [] : messageKnowledgeCitations(message);
          const knowledgeReceipts = isUser ? [] : messageKnowledgeReceipts(message);
          const activities = Array.isArray(message.metadata?.knowledge_activity) ? message.metadata.knowledge_activity : [];
          return (
            <View key={message.message_id} style={styles.message}>
              {!isUser && (
                <View style={styles.attribution}>
                  <Text style={styles.author}>Dito</Text>
                  {typeof modelId === "string" && <Text style={styles.meta}>{modelId}</Text>}
                </View>
              )}
              {isUser ? <Pressable style={styles.bubble} testID="chat-user-message"
                accessibilityActions={canSelect ? [{ name: "longpress", label: "选文" }] : undefined}
                onAccessibilityAction={canSelect ? () => setSelected({ message }) : undefined}
                onLongPress={canSelect ? () => setSelected({ message }) : undefined}>
                <QuoteList quotes={messageQuotes(message)} />
                <Text style={styles.prose}>{message.content}</Text>
              </Pressable> : <View style={styles.answer} testID="chat-reply">
                <MessageContent content={message.content} streaming={live}
                  onSelectionChange={canSelect && Platform.OS === "android" ? (text) => trackSelection(message, text) : undefined}
                  selectionActions={canSelect && Platform.OS !== "android" ? [
                  { text: "添加到对话框", onPress: ({ text }) => fromRendered(message, "quote", text) },
                  { text: "收藏为知识卡", onPress: ({ text }) => fromRendered(message, "save", text) },
                  { text: "问 Dito", visible: isMainChat, onPress: ({ text }) => fromRendered(message, "dito", text) },
                  { text: "转为学习目标", visible: isMainChat, onPress: ({ text }) => fromRendered(message, "goal", text) },
                ] : undefined} />
                {live && <Text accessibilityLiveRegion="polite" style={styles.meta}>{activities.includes("knowledge_read") ? "正在阅读知识库…"
                  : activities.length ? "正在检索知识库…" : "正在生成…"}</Text>}
                {message.status === "interrupted" && <Text style={styles.meta}>生成已中断</Text>}
                {message.status === "failed" && (
                  <Text style={styles.problem}>{String(message.metadata?.error ?? "回复失败，请重试")}</Text>
                )}
              </View>}
              {messageReceipts.length > 0 && <View style={styles.tools}>
                <ChatAction label={`技能记录 · ${[...new Set(messageReceipts.map(({ name }) => name))].join("、")}`}
                  subtle testID="chat-skill-receipts" onPress={() => setReceipts(messageReceipts)} />
              </View>}
              {citations.length > 0 && <View style={styles.tools}>
                {citations.map(item => <ChatAction key={item.sourceId} label={`${item.sourceId} · ${item.title}`}
                  testID="knowledge-citation" onPress={() => setCitation(item)} />)}
              </View>}
              {!live && knowledgeReceipts.length > 0 && <View style={styles.tools}>
                <ChatAction label="知识库记录" subtle onPress={() => setSourceReceipts(knowledgeReceipts)} />
              </View>}
              {!isUser && renderReplyExtra?.(message)}
              {renderThreadMarker?.(message.message_id)}
              {!isUser && !live && (
                <View style={styles.tools}>
                  {isMainChat && canSelect && typeof message.metadata?.source_user_message_id === "string" &&
                    <ChatAction label="考考我" subtle testID="quick-check-reply-action"
                      disabled={!canStartCheck} onPress={() => createQuickCheck(message.message_id)} />}
                  {canSelect && <ChatAction label="选文" subtle onPress={() => setSelected({ message })} />}
                  {done && message.content.length > 0 && <ChatAction label={copiedId === message.message_id ? "已复制" : "复制"}
                    subtle testID="copy-reply" onPress={() => void copyReply(message)} />}
                  {retryable && (
                    <ChatAction label="重试" disabled={!!busy || generating || !configured} onPress={() => repeat(message.message_id, "retry")} />
                  )}
                  {message.message_id === latest && (
                    <ChatAction label="重新生成" subtle disabled={!!busy || generating || !configured} onPress={() => repeat(message.message_id, "regenerate")} />
                  )}
                  <ChatAction label="删除整轮" subtle disabled={!!busy || generating} onPress={() => deleteTurn(message.message_id)} />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      {showBottom && <ScrollToBottomButton onPress={scrollToBottom} />}
      </View>
      {error && <Text accessibilityRole="alert" style={[styles.problem, styles.feedback]}>{error}</Text>}
      {knowledgeError && <View style={styles.tools}>
        <ChatAction label="前往重新连接" onPress={() => router.push("/settings/knowledge")} />
        <ChatAction label="以普通问答重新发送" onPress={switchToOrdinary} />
      </View>}
      {resend && !knowledgeError && <ChatAction label="用当前版本重新发送" disabled={!!busy} onPress={() =>
        void useCurrentVersion(resend).catch(() => setError("无法读取当前技能，请重试。"))} />}
      <View style={styles.composer}>
        {renderedSelection && messages.some(({ message_id }) => message_id === renderedSelection.message.message_id) && (
          <View style={[styles.tools, styles.selectionActions]}>
            <ChatAction label="添加到对话框" onPress={() => fromRendered(renderedSelection.message, "quote", renderedSelection.text)} />
            <ChatAction label="收藏为知识卡" onPress={() => fromRendered(renderedSelection.message, "save", renderedSelection.text)} />
            {isMainChat && <ChatAction label="问 Dito" onPress={() => fromRendered(renderedSelection.message, "dito", renderedSelection.text)} />}
            {isMainChat && <ChatAction label="转为学习目标" onPress={() => fromRendered(renderedSelection.message, "goal", renderedSelection.text)} />}
          </View>
        )}
        <ConversationComposer label="输入消息" testID="chat-composer" placeholder="问 Dito…" draft={draft}
          inputRef={composerInput}
          onChangeText={setDraft} editable={!busy && !generating} send={send}
          sendDisabled={!!busy || !configured || !draft.trim()} stop={generating ? stop : undefined}
          model={model} openModelSettings={() => router.navigate("/me")}
          action={<>
            <ChatAction label="技能" testID="chat-skill-menu" subtle disabled={!!busy || generating} onPress={chooseSkill} />
            <ChatAction label="知识库" testID="chat-knowledge-menu" subtle disabled={!!busy || generating} onPress={chooseLibrary} />
            {isMainChat && <ChatAction label={busy === "quick-check" ? "出题中…" : "考考我"} subtle
              testID="quick-check-composer-action" disabled={!canStartCheck} onPress={() => createQuickCheck()} />}
          </>}>
          {skillId && <ComposerSkillChip skillId={skillId} remove={() => setSkillId(undefined)} />}
          {effectiveKnowledge && <View style={styles.quote}>
            <Text numberOfLines={1} style={styles.quoteText}>{selectedLibrary?.name ?? "待授权知识库"}</Text>
            <ChatAction label={effectiveKnowledge.mode === "kb_only" ? "仅知识库回答" : "普通问答"} subtle
              disabled={!!busy || generating} onPress={() => setKnowledgeChoice({ ...effectiveKnowledge,
                mode: effectiveKnowledge.mode === "kb_only" ? "kb_assisted" : "kb_only" })} />
            <ChatAction label="移除知识库" subtle disabled={!!busy || generating} onPress={() => setKnowledgeChoice(null)} />
          </View>}
          <QuoteList quotes={quotes} remove={(index) => setQuotes((current) => current.filter((_, i) => i !== index))} />
        </ConversationComposer>
      </View>
      {skills !== undefined && <ChatSheet title="选择技能" close={() => setSkills(undefined)}>
        {skills === null ? <Text style={styles.meta}>正在读取技能…</Text> : skills.length === 0 ?
          <Text style={styles.meta}>此场景还没有可以手动选择的技能。可在「我的 → 技能管理」中启用。</Text> :
          <ScrollView keyboardShouldPersistTaps="handled">
            {skills.map((item) => <View key={item.skillId} style={styles.skillOption}>
              <ChatAction label={`${item.name}${item.skillId === skillId ? " · 已选" : ""}`}
                onPress={() => { setSkillId(item.skillId); setSkills(undefined); }} />
              <Text style={styles.meta}>{item.description}</Text>
            </View>)}
          </ScrollView>}
      </ChatSheet>}
      {libraryMenu !== undefined && <ChatSheet title="选择知识库" close={() => setLibraryMenu(undefined)}>
        {libraryMenu === null ? <Text style={styles.meta}>正在读取知识库…</Text> : libraryMenu.length ? <ScrollView>
          {libraryMenu.map(item => <View key={item.binding_id} style={styles.skillOption}>
            <ChatAction label={item.name} onPress={() => {
              setKnowledgeChoice({ bindingId: item.binding_id, mode: inherited?.mode ?? "kb_only" });
              setLibraryMenu(undefined);
            }} />
            {!!item.base_type && <Text style={styles.meta}>{item.base_type}</Text>}
          </View>)}
        </ScrollView> : <Text style={styles.meta}>{isMainChat ? "还没有可用的已授权知识库。" : "小老师可使用父回合授权的知识库。"}</Text>}
        <ChatAction label="管理知识库" onPress={() => { setLibraryMenu(undefined); router.push("/settings/knowledge"); }} />
      </ChatSheet>}
      {citation && <ChatSheet title={citation.title} close={() => setCitation(undefined)}>
        <Text style={styles.meta}>{citation.sourceId} · {sourceTypeLabel[citation.sourceType] ?? "资料"} · 回答时的摘录</Text>
        <ScrollView><Text selectable style={styles.prose}>{citation.excerpt}</Text></ScrollView>
      </ChatSheet>}
      {sourceReceipts && <ChatSheet title="知识库记录" close={() => setSourceReceipts(undefined)}>
        <ScrollView>{sourceReceipts.map((item, index) => <View key={index} style={styles.skillOption}>
          <Text style={styles.author}>{knowledgeToolLabels[item.tool]} · {knowledgeReceiptStatus[item.status]}</Text>
          {item.sourceIds?.length ? <Text style={styles.meta}>{item.sourceIds.join("、")}</Text>
            : item.tool === "knowledge_search" && item.status === "succeeded" ? <Text style={styles.meta}>搜索结果无正文高亮</Text> : null}
        </View>)}</ScrollView>
      </ChatSheet>}
      {receipts && <ChatSheet title="技能记录" close={() => setReceipts(undefined)}>
        <ScrollView>
          {receipts.map((item, index) => <View key={index} style={styles.skillOption}>
            <Text style={styles.author}>{item.name} · {receiptStatus[item.status]}</Text>
            <Text style={styles.meta}>{item.mode === "explicit" ? "手动选择" : "自动发现"} · 版本 {skillShortVersion(item.revision)}</Text>
            {item.tool && <Text style={styles.meta}>{item.path ? `${item.tool} · ${item.path}` : item.tool}</Text>}
            {item.errorCode && <Text style={styles.problem}>{receiptErrors[item.errorCode] ?? "技能工具调用失败"}</Text>}
          </View>)}
        </ScrollView>
      </ChatSheet>}
      {selected && (
        <SelectionSheet
          key={selected.message.message_id}
          content={selected.message.content}
          candidates={selected.candidates}
          littleTutor={isMainChat}
          close={() => setSelected(null)}
          submit={(action, selection) => choose(selected.message, action, selection)}
        />
      )}
    </>
  );
}

function QuoteList({ quotes, remove }: { quotes: ChatQuote[]; remove?: (index: number) => void }) {
  return quotes.map((quote, index) => (
    <View key={index} style={styles.quote}>
      <Text style={styles.quoteText} numberOfLines={2}>引用 {index + 1} · {quote.text}</Text>
      {remove && <ChatAction label={`移除引用 ${index + 1}`} onPress={() => remove(index)} />}
    </View>
  ));
}

function SelectionSheet({ content, candidates, littleTutor, close, submit }: {
  content: string;
  candidates?: ChatSelection[];
  littleTutor: boolean;
  close: () => void;
  submit: (action: SelectionAction, selection: ChatSelection) => Promise<void>;
}) {
  const [range, setRange] = useState<{ start: number; end: number } | undefined>(
    candidates ? undefined : { start: 0, end: content.length },
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const excerpt = range ? content.slice(range.start, range.end) : "";
  async function choose(action: SelectionAction) {
    if (busy || !range || !excerpt.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await submit(action, { ...range, text: excerpt });
    } catch (cause) {
      setError(feedback(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChatSheet title="选中内容" close={close}>
      <Text style={styles.meta}>{candidates ? "请确认选文在原文中的位置，也可以长按原文后拖动选区。"
        : "默认选中整条消息。长按原文并拖动选区可裁切。"}</Text>
      {!!candidates?.length && <View style={styles.tools}>
        {candidates.slice(0, 4).map((candidate, index) => <ChatAction key={candidate.start}
          label={`第 ${index + 1} 处 · ${content.slice(Math.max(0, candidate.start - 8), candidate.start + 8).trim()}`}
          onPress={() => setRange(candidate)} />)}
      </View>}
      <TextInput
        accessibilityLabel="消息原文"
        value={content}
        onChangeText={() => {}}
        showSoftInputOnFocus={false}
        multiline
        disableFullscreenUI
        onSelectionChange={({ nativeEvent: { selection } }) => {
          if (selection.end > selection.start) setRange(selection);
        }}
        style={styles.selectionText}
      />
      <View style={styles.selectionPreview}>
        <Text style={styles.quoteText} numberOfLines={2}>{excerpt}</Text>
        {excerpt !== content && <ChatAction label="选中整条" onPress={() => setRange({ start: 0, end: content.length })} />}
      </View>
      {error && <Text accessibilityRole="alert" style={styles.problem}>{error}</Text>}
      <View style={styles.tools}>
        <ChatAction label="添加到对话框" disabled={busy || !excerpt.trim()} onPress={() => void choose("quote")} />
        <ChatAction label="收藏为知识卡" disabled={busy || !excerpt.trim()} onPress={() => void choose("save")} />
        {littleTutor && <ChatAction label="问 Dito" disabled={busy || !excerpt.trim()} onPress={() => void choose("dito")} />}
        {littleTutor && <ChatAction label="转为学习目标" disabled={busy || !excerpt.trim()} onPress={() => void choose("goal")} />}
      </View>
    </ChatSheet>
  );
}

const receiptStatus: Record<SkillReceipt["status"], string> = {
  started: "调用中", explicit_loaded: "已加载", loaded: "已加载", succeeded: "已执行",
  failed: "调用失败", interrupted: "已中断", unknown: "结果未确认",
};
const receiptErrors: Record<string, string> = {
  budget_exceeded: "达到本轮阅读上限", scope_denied: "当前场景不允许调用", not_loaded: "技能尚未加载",
  path_denied: "该文件不可读取", revision_missing: "版本已不可用",
};
const sourceTypeLabel: Record<string, string> = { note: "笔记", markdown: "Markdown", text: "文本",
  csv: "CSV", html: "HTML", json: "JSON", highlight: "检索片段" };
const knowledgeToolLabels: Record<KnowledgeReceipt["tool"], string> = {
  knowledge_list: "浏览目录", knowledge_search: "搜索", knowledge_read: "读取正文",
};
const knowledgeReceiptStatus: Record<KnowledgeReceipt["status"], string> = {
  started: "进行中", succeeded: "已完成", failed: "未取得结果", interrupted: "已取消", unknown: "结果未确认",
};

const styles = StyleSheet.create({
  skillOption: { padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.xs },
  scroll: { flex: 1 },
  messages: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.lg },
  emptyMessages: { justifyContent: "center" },
  welcome: { gap: spacing.lg, alignItems: "center" },
  starters: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.xs },
  starter: { borderRadius: radius.card, backgroundColor: colors.soft },
  emptyTitle: { color: colors.text, fontSize: 28, fontWeight: "700", textAlign: "center" },
  message: { gap: spacing.xs },
  bubble: {
    alignSelf: "flex-end", maxWidth: "92%", backgroundColor: colors.soft, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.large, borderBottomRightRadius: 6, gap: spacing.xs,
  },
  prose: { color: colors.text, fontSize: 16, lineHeight: 24 },
  answer: { gap: spacing.xs },
  attribution: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minHeight: 24 },
  author: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  problem: { color: colors.danger, fontSize: 14 },
  tools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  selectionActions: { backgroundColor: colors.soft, borderRadius: radius.card, marginBottom: spacing.xs },
  feedback: { paddingHorizontal: spacing.md },
  composer: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  quote: {
    borderLeftWidth: 2, borderLeftColor: colors.primary, backgroundColor: colors.soft, paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs, flexDirection: "row", alignItems: "center", borderRadius: 8,
  },
  quoteText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 20 },
  selectionText: {
    maxHeight: 240, minHeight: 90, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    color: colors.text, fontSize: 15, lineHeight: 23, textAlignVertical: "top",
  },
  selectionPreview: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.soft, padding: spacing.sm, borderRadius: 10,
  },
});
