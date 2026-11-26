import { MasterySessionError, type MasteryHandoff } from "@learn-pace/app-host";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, View } from "react-native";
import { useApp } from "../../context/AppContext";
import { colors, spacing } from "../../theme";
import { ChatAction } from "../chat-controls";
import { Action, Card, styles } from "../Shell";

export function HandoffCard({ handoff }: { handoff: MasteryHandoff }) {
  const { mastery } = useApp();
  const router = useRouter();
  const [opening, setOpening] = useState(handoff.opening_message);
  const [editing, setEditing] = useState(false);
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

  return <Card title={`${handoff.emoji} ${handoff.path_name}`}>
    {handoff.kind === "new" && !!handoff.module_name && <Text style={styles.body}>{handoff.module_name}</Text>}
    <Text style={styles.body}>已掌握 {handoff.mastered} / {handoff.total}（{handoff.percentage}%）
      {handoff.due_count > 0 ? ` · ${handoff.due_count} 项复习已到期` : ""}
    </Text>
    {handoff.kind === "open" && <Text style={styles.body} numberOfLines={2}>
      {handoff.session_title && handoff.session_title !== handoff.path_name ? handoff.session_title + " · " : ""}
      {handoff.session_awaiting ? "有题卡待作答或评分" : "已有会话"}
    </Text>}
    {error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
    <Action label={busy ? "正在打开…" : handoff.kind === "open" ? "回到这次会话" : "开始学习"}
      disabled={busy} onPress={() => void follow()} />
    {!!handoff.reason && <Text style={styles.body} numberOfLines={2}>{handoff.reason}</Text>}
    <View style={local.field}>
      <View style={local.openingBar}>
        <Text style={local.label}>开场说</Text>
        <ChatAction label={editing ? "收起开场说" : "编辑开场说"} disabled={busy} onPress={() => {
          if (editing) Keyboard.dismiss();
          setEditing(!editing);
        }} />
      </View>
      {editing ? <TextInput accessibilityLabel="开场说" testID="handoff-opening" value={opening} onChangeText={setOpening}
        multiline maxLength={2000} editable={!busy} style={local.input} />
        : <Text style={styles.body} numberOfLines={2}>{opening.trim() || "未填写"}</Text>}
    </View>
  </Card>;
}

const local = StyleSheet.create({
  field: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  openingBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  input: { color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, padding: spacing.sm, fontSize: 15, minHeight: 48, maxHeight: 128 },
  error: { color: colors.danger },
});
