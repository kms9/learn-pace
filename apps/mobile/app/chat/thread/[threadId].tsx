import type { Lf01ChatService } from "@learn-pace/app-host";
import { useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatConversation } from "../../../src/components/ChatConversation";
import { LoadingCard, RetryCard } from "../../../src/components/Shell";
import { useApp } from "../../../src/context/AppContext";
import { colors, radius, spacing } from "../../../src/theme";

type Thread = Awaited<ReturnType<Lf01ChatService["readThread"]>>;

export default function LittleTutor() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { chat } = useApp();
  const headerHeight = useHeaderHeight();
  const [thread, setThread] = useState<Thread>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    void chat.readThread(threadId).then((result) => {
      if (mounted) setThread(result);
    }).catch(() => {
      if (mounted) setFailed(true);
    });
    return () => { mounted = false; };
  }, [attempt, chat, threadId]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
        {!thread ? (
          <View style={styles.loading}>
            {failed ? <RetryCard message="无法读取这条小老师追问"
              retry={() => { setFailed(false); setAttempt((value) => value + 1); }} />
              : <LoadingCard label="正在读取小老师追问…" />}
          </View>
        ) : (
          <ChatConversation
            key={thread.session.session_id}
            sessionId={thread.session.session_id}
            initialMessages={thread.messages}
            initialDraft={thread.messages.length ? "" : thread.thread.selected_text}
            intro={(
              <View style={styles.selection}>
                <Text style={styles.heading}>选中内容</Text>
                <Text style={styles.excerpt} selectable>{thread.thread.selected_text}</Text>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.md },
  selection: { padding: spacing.md, borderRadius: radius.card, backgroundColor: colors.soft, gap: spacing.xs },
  heading: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  excerpt: { color: colors.text, fontSize: 15, lineHeight: 23 },
});
