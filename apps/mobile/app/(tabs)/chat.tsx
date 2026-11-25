import { messageHandoffs, type Lf01ChatService } from "@learn-pace/app-host";
import type { StoredSession, StoredThread } from "@learn-pace/infra";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatConversation } from "../../src/components/ChatConversation";
import { ChatAction, ChatSheet } from "../../src/components/chat-controls";
import { HandoffCard } from "../../src/components/mastery/HandoffCard";
import { useApp } from "../../src/context/AppContext";
import { colors, radius, spacing } from "../../src/theme";

type Conversation = Awaited<ReturnType<Lf01ChatService["readConversation"]>>;
type Sheet = { kind: "history" | "menu" } | { kind: "threads"; messageId?: string };

export default function Chat() {
  const { chat, snapshot, reload } = useApp();
  const router = useRouter();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [version, setVersion] = useState(0);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string>();
  const [navigating, setNavigating] = useState(false);
  const sessionId = conversation?.session.session_id;

  useFocusEffect(useCallback(() => {
    if (!sessionId) return;
    let focused = true;
    void chat.listThreads(sessionId).then((result) => { if (focused) setThreads(result); }).catch(() => {});
    return () => { focused = false; };
  }, [chat, sessionId]));

  async function refreshThreads() {
    if (!sessionId) return;
    try {
      setThreads(await chat.listThreads(sessionId));
    } catch {
      setError("无法读取小老师记录，请重试");
    }
  }

  async function history() {
    setError(undefined);
    try {
      setSessions(await chat.listSessions());
      setSheet({ kind: "history" });
    } catch {
      setError("无法读取历史会话，请重试");
    }
  }

  async function startSession() {
    const session = await chat.createSession();
    setConversation({ session, messages: [] });
    setThreads([]);
    void reload().catch(() => {});
    return session.session_id;
  }

  async function openSession(id?: string) {
    if (navigating) return;
    setNavigating(true);
    setError(undefined);
    try {
      if (id) {
        const [session, records] = await Promise.all([chat.readConversation(id), chat.listThreads(id)]);
        setConversation(session);
        setThreads(records);
      } else {
        await startSession();
      }
      setVersion((previous) => previous + 1);
      setSheet(null);
    } catch {
      setError("无法打开对话，请重试");
    } finally {
      setNavigating(false);
    }
  }

  function visitThread(id: string) {
    setSheet(null);
    router.push({ pathname: "/chat/thread/[threadId]", params: { threadId: id } });
  }

  function threadMarker(messageId: string) {
    const count = threads.filter((thread) => thread.source_message_id === messageId && thread.detached_at === null).length;
    if (!count) return null;
    return (
      <View style={styles.marker}>
        <ChatAction label={`小老师 ×${count}`} onPress={() => { setError(undefined); setSheet({ kind: "threads", messageId }); }} />
      </View>
    );
  }

  function removeThread(thread: StoredThread) {
    Alert.alert("删除这条小老师追问？", undefined, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => {
        void chat.deleteThread(thread.thread_id).then(refreshThreads).catch(() => setError("无法删除这条小老师追问"));
      } },
    ]);
  }

  const matching = sheet?.kind === "threads" && sheet.messageId
    ? threads.filter((thread) => thread.source_message_id === sheet.messageId && thread.detached_at === null)
    : threads;
  const model = snapshot.model.configured ? snapshot.model.settings?.model.replace(/^openai\//, "") : "模型未配置";

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>问答</Text>
            <Pressable accessibilityRole="button" onPress={() => router.navigate("/me")}>
              <Text style={styles.caption} numberOfLines={1}>{model}</Text>
            </Pressable>
          </View>
          <ChatAction label="历史会话" onPress={() => void history()} />
          <ChatAction label="新对话" onPress={() => void openSession()} disabled={navigating} />
          {sessionId && <ChatAction label="会话菜单" onPress={() => { setError(undefined); setSheet({ kind: "menu" }); }} />}
        </View>
        {!sheet && error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <ChatConversation
          key={version}
          sessionId={sessionId}
          initialMessages={conversation?.messages ?? []}
          startSession={startSession}
          onThreadsChanged={() => void refreshThreads()}
          renderThreadMarker={threadMarker}
          renderReplyExtra={(message) => messageHandoffs(message).map((handoff) => <HandoffCard handoff={handoff}
            key={`${message.turn_id}:${handoff.kind}:${handoff.path_id}:${handoff.kind === "open" ? handoff.session_id : handoff.module_id}`} />)}
        />
        {sheet?.kind === "history" && (
          <ChatSheet title="历史会话" close={() => setSheet(null)}>
            <ChatAction label="新对话" primary onPress={() => void openSession()} disabled={navigating} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
              {sessions.length === 0 && <Text style={styles.caption}>暂无历史会话</Text>}
              {sessions.map((session) => (
                <Pressable
                  key={session.session_id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sessionId === session.session_id }}
                  disabled={navigating}
                  onPress={() => void openSession(session.session_id)}
                  style={styles.item}
                >
                  <Text numberOfLines={2} style={styles.itemTitle}>{session.title}</Text>
                  <Text style={styles.caption}>{new Date(session.updated_at * 1_000).toLocaleString()}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          </ChatSheet>
        )}
        {sheet?.kind === "menu" && (
          <ChatSheet title="聊天操作" close={() => setSheet(null)}>
            <ChatAction label="小老师记录" onPress={() => setSheet({ kind: "threads" })} />
          </ChatSheet>
        )}
        {sheet?.kind === "threads" && (
          <ChatSheet title={sheet.messageId ? "这条消息下的小老师追问" : "小老师记录"} close={() => setSheet(null)}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
              {matching.length === 0 && <Text style={styles.caption}>暂无小老师追问</Text>}
              {matching.map((thread) => (
                <View key={thread.thread_id} style={styles.item}>
                  <Text style={styles.itemTitle} numberOfLines={2}>{thread.title}</Text>
                  {thread.detached_at !== null && <Text style={styles.caption}>已解除关联</Text>}
                  <View style={styles.actions}>
                    <ChatAction label="打开" onPress={() => visitThread(thread.thread_id)} />
                    {thread.detached_at === null && (
                      <ChatAction label="解除关联" onPress={() => {
                        void chat.detachThread(thread.thread_id).then(refreshThreads).catch(() => setError("无法解除关联，请重试"));
                      }} />
                    )}
                    <ChatAction label="删除" danger onPress={() => removeThread(thread)} />
                  </View>
                </View>
              ))}
            </ScrollView>
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          </ChatSheet>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  heading: { flex: 1, paddingLeft: spacing.xs },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  list: { paddingVertical: spacing.xs, gap: spacing.xs },
  item: { padding: spacing.md, borderRadius: radius.card, gap: spacing.xs, backgroundColor: colors.soft },
  itemTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  actions: { flexDirection: "row", flexWrap: "wrap" },
  marker: { alignSelf: "flex-start", borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
  error: { color: colors.danger, paddingHorizontal: spacing.sm, fontSize: 14 },
});
