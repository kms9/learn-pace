import { Lf01ChatError, RestoreGateError, messageQuotes, renderedChatSelections, type ChatQuote, type ChatSelection } from "@learn-pace/app-host";
import type { StoredMessage } from "@learn-pace/infra";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useApp } from "../context/AppContext";
import { colors, radius, spacing } from "../theme";
import { ChatAction, ChatSheet, ConversationComposer, ScrollToBottomButton, useConversationScroll } from "./chat-controls";
import { MessageContent } from "./MessageContent";

type SelectionAction = "quote" | "dito" | "goal";
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
  startSession?: () => Promise<string>;
  onFirstMessage?: (sessionId: string, text: string) => void;
  onThreadsChanged?: () => void;
  renderThreadMarker?: (messageId: string) => ReactNode;
  renderReplyExtra?: (message: StoredMessage) => ReactNode;
  intro?: ReactNode;
};

function feedback(error: unknown): string {
  return error instanceof Lf01ChatError || error instanceof RestoreGateError ? error.message : "无法完成操作，请重试";
}

export function ChatConversation({
  sessionId, initialMessages, startSession, onFirstMessage, onThreadsChanged, renderThreadMarker, renderReplyExtra, intro,
}: Properties) {
  const { chat, snapshot } = useApp();
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [busy, setBusy] = useState<"turn" | "delete" | null>(null);
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
  const configured = snapshot.model.configured;
  const model = configured ? snapshot.model.settings?.model.replace(/^openai\//, "") : undefined;
  const generating = busy === "turn" || (chat.isRunning(sessionId ?? "") && messages.some(({ status }) => status === "generating"));
  const latest = messages.filter(({ role, status }) => role === "assistant" && status === "committed").at(-1)?.message_id;

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

  async function run(action: "turn" | "delete", operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    stopRequested.current = false;
    setBusy(action);
    setError(undefined);
    try {
      await operation();
    } catch (cause) {
      setError(feedback(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function send() {
    if (!configured || generating || !draft.trim()) return;
    void run("turn", async () => {
      const id = sessionId ?? await startSession?.();
      if (!id) return;
      targetId.current = id;
      Keyboard.dismiss();
      follow.current = true;
      const request = chat.send(id, draft, quotes, (message) => {
        applyMessage(message);
        if (message.role === "user") {
          if (!messages.some(({ role }) => role === "user")) onFirstMessage?.(id, message.content);
          setDraft("");
          setQuotes([]);
        }
      });
      if (stopRequested.current) chat.stop(id);
      await request;
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
      await chat[action](sessionId, messageId, applyMessage);
    });
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

  async function choose(message: StoredMessage, action: SelectionAction, selection: ChatSelection) {
    if (!sessionId) return;
    setError(undefined);
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
    const params = await chat.learningGoalSource(sessionId, message.message_id, selection);
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
          {!!startSession && <View style={styles.starters}>
            {starterPrompts.map(([label, prompt]) => <View key={label} style={styles.starter}>
              <ChatAction label={label} disabled={!!draft || generating}
                onPress={() => setDraft((current) => current || prompt)} />
            </View>)}
          </View>}
        </View>}
        {messages.map((message) => {
          const isUser = message.role === "user";
          const done = message.status === "committed";
          const canSelect = done && !!message.content.trim();
          const live = message.status === "generating";
          const retryable = message.status === "interrupted" || message.status === "failed";
          const modelId = message.metadata?.model_id;
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
                  { text: "问 Dito", visible: !!startSession, onPress: ({ text }) => fromRendered(message, "dito", text) },
                  { text: "转为学习目标", visible: !!startSession, onPress: ({ text }) => fromRendered(message, "goal", text) },
                ] : undefined} />
                {live && <Text style={styles.meta}>正在生成…</Text>}
                {message.status === "interrupted" && <Text style={styles.meta}>生成已中断</Text>}
                {message.status === "failed" && (
                  <Text style={styles.problem}>{String(message.metadata?.error ?? "回复失败，请重试")}</Text>
                )}
              </View>}
              {!isUser && renderReplyExtra?.(message)}
              {renderThreadMarker?.(message.message_id)}
              {!isUser && !live && (
                <View style={styles.tools}>
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
      <View style={styles.composer}>
        {renderedSelection && messages.some(({ message_id }) => message_id === renderedSelection.message.message_id) && (
          <View style={[styles.tools, styles.selectionActions]}>
            <ChatAction label="添加到对话框" onPress={() => fromRendered(renderedSelection.message, "quote", renderedSelection.text)} />
            {startSession && <ChatAction label="问 Dito" onPress={() => fromRendered(renderedSelection.message, "dito", renderedSelection.text)} />}
            {startSession && <ChatAction label="转为学习目标" onPress={() => fromRendered(renderedSelection.message, "goal", renderedSelection.text)} />}
          </View>
        )}
        <ConversationComposer label="输入消息" testID="chat-composer" placeholder="问 Dito…" draft={draft}
          onChangeText={setDraft} editable={!busy && !generating} send={send}
          sendDisabled={!!busy || !configured || !draft.trim()} stop={generating ? stop : undefined}
          model={model} openModelSettings={() => router.navigate("/me")}>
          <QuoteList quotes={quotes} remove={(index) => setQuotes((current) => current.filter((_, i) => i !== index))} />
        </ConversationComposer>
      </View>
      {selected && (
        <SelectionSheet
          key={selected.message.message_id}
          content={selected.message.content}
          candidates={selected.candidates}
          littleTutor={!!startSession}
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
        {littleTutor && <ChatAction label="问 Dito" disabled={busy || !excerpt.trim()} onPress={() => void choose("dito")} />}
        {littleTutor && <ChatAction label="转为学习目标" disabled={busy || !excerpt.trim()} onPress={() => void choose("goal")} />}
      </View>
    </ChatSheet>
  );
}

const styles = StyleSheet.create({
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
