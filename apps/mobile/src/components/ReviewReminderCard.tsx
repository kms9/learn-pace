import type { NotificationPermission } from "@learn-pace/app-host";
import { defaultReminderPreferences, type ReminderPreferences } from "@learn-pace/domain";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useApp } from "../context/AppContext";
import { colors, radius, spacing, typography } from "../theme";
import { Action, Card, styles } from "./Shell";

function formatTime(minute: number): string {
  return [Math.floor(minute / 60), minute % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

function parseTime(value: string): number | undefined {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim().replace("：", ":"));
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function toFields(preferences: ReminderPreferences) {
  return [preferences.preferredMinute, preferences.quietStartMinute, preferences.quietEndMinute].map(formatTime);
}

const timeLabels = ["每日提醒时间", "静默开始", "静默结束"];

export function ReviewReminderCard() {
  const { reminders } = useApp();
  const [preferences, setPreferences] = useState<ReminderPreferences>(defaultReminderPreferences);
  const [times, setTimes] = useState(() => toFields(defaultReminderPreferences));
  const [permission, setPermission] = useState<NotificationPermission>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; failed?: boolean }>();
  const running = useRef(false);

  useEffect(() => {
    let mounted = true;
    void reminders.preferences().then((next) => {
      if (!mounted) return;
      setPreferences(next);
      setTimes(toFields(next));
      setReady(true);
    }).catch(() => {
      if (mounted) setFeedback({ text: "无法读取提醒设置。", failed: true });
    });
    const refreshPermission = () => {
      void reminders.permissionStatus().then((current) => {
        if (mounted) setPermission(current);
      });
    };
    refreshPermission();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshPermission();
    });
    return () => { mounted = false; listener.remove(); };
  }, [reminders]);

  async function save(next: ReminderPreferences, enable = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await reminders.savePreferences(next, enable);
      setPreferences(next);
      setTimes(toFields(next));
      setPermission(await reminders.permissionStatus());
      setFeedback({ text: "提醒设置已保存。" });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "无法保存提醒设置。", failed: true });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  function saveTimes() {
    const [preferredMinute, quietStartMinute, quietEndMinute] = times.map(parseTime);
    if (preferredMinute === undefined || quietStartMinute === undefined || quietEndMinute === undefined) {
      setFeedback({ text: "请按 HH:mm 格式填写时间，例如 20:00。", failed: true });
      return;
    }
    void save({ ...preferences, preferredMinute, quietStartMinute, quietEndMinute });
  }

  return <Card title="复习提醒">
    <View style={local.row}>
      <Text style={styles.body}>启用复习提醒</Text>
      <Switch accessibilityLabel="启用复习提醒" value={preferences.enabled} disabled={!ready || busy}
        onValueChange={(enabled) => void save({ ...preferences, enabled }, enabled)} />
    </View>
    {preferences.enabled && <>
      <View style={local.inputs}>
        {timeLabels.map((label, index) => <View key={label} style={local.field}>
          <Text style={local.label}>{label}</Text>
          <TextInput accessibilityLabel={label} autoCorrect={false} editable={ready && !busy}
            value={times[index]} onChangeText={(value) => setTimes((current) =>
              current.map((time, position) => position === index ? value : time))}
            maxLength={5} style={local.input} />
        </View>)}
      </View>
      <Action label="保存提醒时间" onPress={saveTimes} disabled={!ready || busy} secondary />
    </>}
    {permission && <Text style={styles.body}>{permission === "granted" ? "通知权限已开启" : "通知权限尚未开启"}</Text>}
    {permission === "denied" && <Action label="去系统设置开启" onPress={() => {
      void Linking.openSettings().catch(() => setFeedback({ text: "无法打开系统设置。", failed: true }));
    }} secondary />}
    {__DEV__ && preferences.enabled && <Action label="10 秒后发送测试提醒" disabled={!ready || busy || permission !== "granted"}
      onPress={() => void reminders.reschedule({ shortDelaySeconds: 10 })} secondary />}
    {feedback && <Text accessibilityLiveRegion="polite" style={feedback.failed ? local.error : local.success}>{feedback.text}</Text>}
  </Card>;
}

const local = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inputs: { flexDirection: "row", gap: spacing.sm },
  field: { flex: 1, gap: spacing.xs },
  label: { color: colors.muted, fontSize: typography.caption },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, color: colors.text },
  error: { color: colors.danger },
  success: { color: colors.success },
});
