import { Lf01ChatError, messageQuotes, type ChatQuote, type ChatSelection } from "@learn-pace/app-host";
import type { StoredMessage } from "@learn-pace/infra";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent,
} from "react-native";
import { useApp } from "../context/AppContext";
import { colors, radius, spacing } from "../theme";
import { ChatAction, ChatSheet } from "./chat-controls";
import { MessageContent } from "./MessageContent";

type SelectionAction = "quote" | "dito" | "goal";
type Properties = {
  sessionId?: string;
  initialMessages: StoredMessage[];
  initialDraft?: string;
  startSession?: () => Promise<string>;
  onThreadsChanged?: () => void;
  renderThreadMarker?: (messageId: string) => ReactNode;
  renderReplyExtra?: (message: StoredMessage) => ReactNode;
  intro?: ReactNode;
};

function feedback(error: unknown): string {
  return error instanceof Lf01ChatError ? error.message : "无法完成操作，请重试";
}

export function ChatConversation({
  sessionId, initialMessages, initialDraft = "", startSession, onThreadsChanged, renderThreadMarker, renderReplyExtra, intro,
}: Properties) {
  const { chat, snapshot } = useApp();
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState(initialDraft);
  const [quotes, setQuotes] = useState<ChatQuote[]>([]);
  const [busy, setBusy] = useState<"turn" | "delete" | null>(null);
  const busyRef = useRef(false);
  const targetId = useRef(sessionId);
  const stopRequested = useRef(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<StoredMessage | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const follow = useRef(true);
  const configured = snapshot.model.configured;
  const generating = busy === "turn" || (chat.isRunning(sessionId ?? "") && messages.some(({ status }) => status === "generating"));
  const latest = messages.filter(({ role, status }) => role === "assistant" && status === "committed").at(-1)?.message_id;

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

  async function choose(action: SelectionAction, selection: ChatSelection) {
    if (!selected || !sessionId) return;
    if (action === "quote") {
      if (quotes.length >= 3) throw new Lf01ChatError("最多添加 3 条引用");
      const quote = await chat.quoteSelection(sessionId, selected.message_id, selection);
      setQuotes((current) => [...current, quote]);
      setSelected(null);
      return;
    }
    if (action === "dito") {
      const thread = await chat.createThread(sessionId, selected.message_id, selection);
      follow.current = false;
      setSelected(null);
      onThreadsChanged?.();
      router.push({ pathname: "/chat/thread/[threadId]", params: { threadId: thread.thread_id } });
      return;
    }
    const params = await chat.learningGoalSource(sessionId, selected.message_id, selection);
    setSelected(null);
    router.push({ pathname: "/mastery/new", params: { ...params } });
  }

  function trackPosition({ contentSize, contentOffset, layoutMeasurement }: NativeScrollEvent) {
    follow.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  }

  function followLatest() {
    if (!follow.current || !messages.length) return;
    requestAnimationFrame(() => {
      if (follow.current) scroll.current?.scrollToEnd({ animated: false });
    });
  }

  return (
    <>
      <ScrollView
        ref={scroll}
        testID="chat-messages"
        style={styles.scroll}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => { follow.current = false; }}
        onScrollEndDrag={({ nativeEvent }) => trackPosition(nativeEvent)}
        onMomentumScrollEnd={({ nativeEvent }) => trackPosition(nativeEvent)}
        onLayout={followLatest}
        onContentSizeChange={followLatest}
      >
        {intro}
        {messages.length === 0 && !intro && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>有什么想了解的？</Text>
            <Text style={styles.emptyHint}>从一个问题开始，也可以继续之前的对话。</Text>
          </View>
        )}
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
              <Pressable
                accessibilityActions={canSelect ? [{ name: "longpress", label: "选文" }] : undefined}
                onAccessibilityAction={canSelect ? () => setSelected(message) : undefined}
                onLongPress={canSelect ? () => setSelected(message) : undefined}
                style={isUser ? styles.bubble : styles.answer}
                testID={isUser ? "chat-user-message" : "chat-reply"}
              >
                {isUser ? (
                  <>
                    <QuoteList quotes={messageQuotes(message)} />
                    <Text style={styles.prose}>{message.content}</Text>
                  </>
                ) : (
                  <View pointerEvents="none" style={styles.answer}>
                    <MessageContent content={message.content} streaming={live} />
                    {live && <Text style={styles.meta}>正在生成…</Text>}
                    {message.status === "interrupted" && <Text style={styles.meta}>生成已中断</Text>}
                    {message.status === "failed" && (
                      <Text style={styles.problem}>{String(message.metadata?.error ?? "回复失败，请重试")}</Text>
                    )}
                  </View>
                )}
              </Pressable>
              {!isUser && renderReplyExtra?.(message)}
              {renderThreadMarker?.(message.message_id)}
              {!isUser && !live && (
                <View style={styles.tools}>
                  {canSelect && <ChatAction label="选文" onPress={() => setSelected(message)} />}
                  {retryable && (
                    <ChatAction label="重试" disabled={!!busy || generating || !configured} onPress={() => repeat(message.message_id, "retry")} />
                  )}
                  {message.message_id === latest && (
                    <ChatAction label="重新生成" disabled={!!busy || generating || !configured} onPress={() => repeat(message.message_id, "regenerate")} />
                  )}
                  <ChatAction label="删除整轮" disabled={!!busy || generating} onPress={() => deleteTurn(message.message_id)} />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      {error && <Text accessibilityRole="alert" style={[styles.problem, styles.feedback]}>{error}</Text>}
      {!configured && (
        <View style={styles.modelNotice}>
          <Text style={styles.meta}>配置 DeepSeek Flash 后即可发送消息</Text>
          <ChatAction label="打开模型设置" onPress={() => router.navigate("/me")} />
        </View>
      )}
      <View style={styles.composer}>
        <QuoteList quotes={quotes} remove={(index) => setQuotes((current) => current.filter((_, i) => i !== index))} />
        <View style={styles.composeRow}>
          <TextInput
            accessibilityLabel="输入消息"
            testID="chat-composer"
            multiline
            editable={!busy && !generating}
            value={draft}
            onChangeText={setDraft}
            placeholder="问 Dito…"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          {generating ? (
            <ChatAction label="停止生成" onPress={stop} />
          ) : (
            <ChatAction label="发送" onPress={send} primary disabled={!!busy || !configured || !draft.trim()} />
          )}
        </View>
      </View>
      {selected && (
        <SelectionSheet
          key={selected.message_id}
          content={selected.content}
          littleTutor={!!startSession}
          close={() => setSelected(null)}
          submit={choose}
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

function SelectionSheet({ content, littleTutor, close, submit }: {
  content: string;
  littleTutor: boolean;
  close: () => void;
  submit: (action: SelectionAction, selection: ChatSelection) => Promise<void>;
}) {
  const [range, setRange] = useState({ start: 0, end: content.length });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const excerpt = content.slice(range.start, range.end);
  async function choose(action: SelectionAction) {
    if (busy) return;
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
      <Text style={styles.meta}>默认选中整条消息。长按原文并拖动选区可裁切。</Text>
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
        <ChatAction label="添加到对话框" disabled={busy} onPress={() => void choose("quote")} />
        {littleTutor && <ChatAction label="问 Dito" disabled={busy} onPress={() => void choose("dito")} />}
        {littleTutor && <ChatAction label="转为学习目标" disabled={busy} onPress={() => void choose("goal")} />}
      </View>
    </ChatSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  messages: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.lg },
  empty: { flexGrow: 1, justifyContent: "center", alignItems: "center", gap: spacing.sm, paddingBottom: 56 },
  emptyTitle: { color: colors.text, fontSize: 25, fontWeight: "700" },
  emptyHint: { color: colors.muted, fontSize: 14, textAlign: "center" },
  message: { gap: spacing.xs },
  bubble: {
    alignSelf: "flex-end", maxWidth: "92%", backgroundColor: colors.soft, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.card, gap: spacing.xs,
  },
  prose: { color: colors.text, fontSize: 16, lineHeight: 24 },
  answer: { gap: spacing.xs },
  attribution: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minHeight: 24 },
  author: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  problem: { color: colors.danger, fontSize: 14 },
  tools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  feedback: { paddingHorizontal: spacing.md },
  modelNotice: { paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  composer: {
    marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.xs, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.large, gap: spacing.xs,
  },
  composeRow: { alignItems: "flex-end", flexDirection: "row", gap: spacing.xs },
  input: {
    flex: 1, minHeight: 44, maxHeight: 132, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    color: colors.text, fontSize: 16, textAlignVertical: "center",
  },
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
