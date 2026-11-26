import { BackupError, RestoreGateError, type BackupPreview } from "@learn-pace/app-host";
import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { pickBackup, shareBackup } from "../backup-io";
import { useApp } from "../context/AppContext";
import { colors, radius, spacing } from "../theme";
import { Action, Card, styles } from "./Shell";
import { ChatAction, ChatSheet } from "./chat-controls";

export function BackupCard() {
  const { backup, restart } = useApp();
  const [preview, setPreview] = useState<{ raw: string; summary: BackupPreview }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed?: boolean }>();
  const running = useRef(false);

  async function perform(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      setMessage({ failed: true, text: error instanceof BackupError || error instanceof RestoreGateError
        ? error.message : "备份操作失败，请重试。" });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  const confirm = (raw: string) => perform(async () => {
    await backup.restoreBackup(raw);
    setPreview(undefined);
    restart();
    Alert.alert("备份已恢复", "已刷新本地学习记录。");
  });
  const feedback = message && <Text accessibilityLiveRegion="polite"
    style={message.failed ? local.error : local.success}>{message.text}</Text>;
  const summary = preview?.summary;

  return <Card title="数据备份与恢复">
    <Text style={styles.body}>备份包含本地学习记录和模型设置，不包含 API Key。</Text>
    <Action label="导出本地备份" disabled={busy} onPress={() => void perform(async () => {
      await shareBackup(await backup.exportBackup());
      setMessage({ text: "备份文件已生成。" });
    })} secondary />
    <Action label="从备份恢复" disabled={busy} onPress={() => void perform(async () => {
      const raw = await pickBackup();
      if (raw !== null) setPreview({ raw, summary: await backup.inspectBackup(raw) });
    })} secondary />
    {!preview && feedback}
    {preview && summary && <ChatSheet title="备份恢复预览" close={() => { if (!running.current) setPreview(undefined); }}>
      <View style={local.preview}>
        <Text style={styles.body}>导出时间 {new Date(summary.exportedAt * 1000).toLocaleString()}</Text>
        <Text style={styles.body}>路径 {summary.counts.paths} · 会话 {summary.counts.sessions} · 消息 {summary.counts.messages}</Text>
        <Text style={styles.body}>小老师 {summary.counts.threads} · 题卡 {summary.counts.interactions} · 证据 {summary.counts.evidence}</Text>
        <Text style={styles.body}>知识卡 {summary.counts.knowledge_cards}</Text>
        <Text style={styles.body}>备份不包含 API Key。</Text>
        <Text style={local.warning}>恢复会覆盖设备上现有的学习记录和模型设置。</Text>
        {feedback}
        <ChatAction label={busy ? "正在恢复…" : "确认覆盖并恢复"} disabled={busy} danger
          onPress={() => void confirm(preview.raw)} />
      </View>
    </ChatSheet>}
  </Card>;
}

const local = StyleSheet.create({
  preview: { gap: spacing.sm },
  warning: { color: colors.warning, backgroundColor: colors.warningSoft, padding: spacing.sm, borderRadius: radius.sm },
  error: { color: colors.danger },
  success: { color: colors.success },
});
