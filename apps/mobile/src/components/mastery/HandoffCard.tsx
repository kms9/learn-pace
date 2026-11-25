import { MasterySessionError, type MasteryHandoff } from "@learn-pace/app-host";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, View } from "react-native";
import { useApp } from "../../context/AppContext";
import { colors, spacing } from "../../theme";
import { MasteryProgress } from "../MasteryOutline";
import { Action, Card, styles } from "../Shell";

export function HandoffCard({ handoff }: { handoff: MasteryHandoff }) {
  const { mastery } = useApp();
  const router = useRouter();
  const [opening, setOpening] = useState(handoff.opening_message);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const openingSession = useRef(false);

  async function follow() {
    if (openingSession.current) return;
    openingSession.current = true;
    setBusy(true);
    setError(undefined);
    Keyboard.dismiss();
    try {
      const session = await mastery.followHandoff(handoff, opening);
      router.push({ pathname: "/mastery/[pathId]/session/[sessionId]",
        params: { pathId: handoff.path_id, sessionId: session.session_id } });
    } catch (cause) {
      setError(cause instanceof MasterySessionError ? cause.message : "无法打开精通会话，请重试");
    } finally {
      openingSession.current = false;
      setBusy(false);
    }
  }

  const title = handoff.reason || (handoff.kind === "open" ? "从你上次停下的地方继续" : "在这条精通之路上另开一次学习");
  return <Card title={title}>
    <Text style={local.path}>{handoff.emoji} {handoff.path_name}</Text>
    {handoff.kind === "new" && !!handoff.module_name && <Text style={styles.body}>{handoff.module_name}</Text>}
    <MasteryProgress {...handoff} dueCount={handoff.due_count} />
    {handoff.kind === "open" ? <Text style={styles.body}>
      {handoff.session_title}{handoff.session_awaiting ? " · 有题卡待作答或评分" : " · 已有会话"}
    </Text> : <Text style={styles.body}>这条路的进度分毫不失</Text>}
    <View style={local.field}>
      <Text style={local.label}>开场说</Text>
      <TextInput accessibilityLabel="开场说" testID="handoff-opening" value={opening} onChangeText={setOpening}
        multiline maxLength={2000} editable={!busy} style={local.input} />
    </View>
    {error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
    <Action label={busy ? "正在打开…" : handoff.kind === "open" ? "回到这次会话" : "开始学习"}
      disabled={busy} onPress={() => void follow()} />
  </Card>;
}

const local = StyleSheet.create({
  path: { color: colors.text, fontSize: 15, fontWeight: "600" },
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  input: { color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, padding: spacing.sm, fontSize: 15, minHeight: 48, maxHeight: 128 },
  error: { color: colors.danger },
});
