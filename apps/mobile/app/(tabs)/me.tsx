import { ModelSettingsError, curriculumProfiles } from "@learn-pace/app-host";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { importUsbConfiguration } from "../../src/configuration";
import { Action, Card, Page, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";
import { colors, spacing } from "../../src/theme";

const defaultModel = "openai/deepseek-v4.1-flash";
type Feedback = { message: string; failed?: boolean };

export default function Settings() {
  const { service, snapshot, reload } = useApp();
  const router = useRouter();
  const saved = snapshot.model.settings;
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [model, setModel] = useState(saved?.model ?? defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const running = useRef(false);
  const scene = curriculumProfiles.find(({ id }) => id === snapshot.curriculumProfile)?.label;

  useEffect(() => {
    setBaseUrl(saved?.baseUrl ?? "");
    setModel(saved?.model ?? defaultModel);
  }, [saved?.baseUrl, saved?.model]);

  async function perform(action: () => Promise<Feedback>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      setFeedback(await action());
    } catch (error) {
      setFeedback({
        message: error instanceof ModelSettingsError ? error.message : "操作失败，请检查配置后重试。",
        failed: true,
      });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function save(source: "manual" | "usb"): Promise<Feedback> {
    if (source === "usb") {
      await service.saveImportedModelSettings(await importUsbConfiguration(code));
      setCode("");
    } else {
      await service.saveModelSettings({ baseUrl, model, apiKey });
    }
    setApiKey("");
    await reload();
    return { message: "模型配置已保存" };
  }

  return (
    <Page title="我的">
      <Card title="学习场景">
        <Text style={styles.body}>{scene ?? "自由"}</Text>
        <Action label="切换学习场景" onPress={() => router.push({ pathname: "/onboarding/scene", params: { source: "settings" } })} secondary />
      </Card>
      <Card title="DeepSeek Flash">
        <Text style={styles.body}>{snapshot.model.configured ? "已配置" : "尚未配置"}</Text>
        <Text style={styles.body}>网关地址</Text>
        <TextInput
          accessibilityLabel="网关地址"
          style={form.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="https://gateway.example/v1"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          keyboardType="url"
        />
        <Text style={styles.body}>模型 ID</Text>
        <TextInput
          accessibilityLabel="模型 ID"
          style={form.input}
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Text style={styles.body}>API Key</Text>
        <TextInput
          accessibilityLabel="API Key"
          style={form.input}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={snapshot.model.configured ? "同源更新可留空" : "输入 API Key"}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Action label="保存模型配置" disabled={busy || !baseUrl.trim()} onPress={() => void perform(() => save("manual"))} />
        <Action label="测试连通性" disabled={busy || !snapshot.model.configured} onPress={() => void perform(async () => {
          const result = await service.testModelConnection();
          return result.ok ? { message: `连接成功 · ${result.elapsedMs} ms` } : { message: result.message, failed: true };
        })} secondary />
        {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>正在处理</Text>}
        {feedback && <Text accessibilityLiveRegion="polite" style={feedback.failed ? form.failure : form.success}>{feedback.message}</Text>}
      </Card>
      {__DEV__ && (
        <Card title="开发工具">
          <TextInput
            accessibilityLabel="USB 配对码"
            style={form.input}
            value={code}
            onChangeText={setCode}
            placeholder="USB 配对码"
            maxLength={6}
            keyboardType="number-pad"
            editable={!busy}
          />
          <Action label="通过 USB 导入" disabled={busy || !/^\d{6}$/.test(code)} onPress={() => void perform(() => save("usb"))} secondary />
          <Action label="打开 M1 验证工作台" onPress={() => router.push("/dev/m1-workbench")} secondary />
        </Card>
      )}
    </Page>
  );
}

const form = StyleSheet.create({
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.sm, color: colors.text, fontSize: 15 },
  failure: { color: colors.danger, fontSize: 15 },
  success: { color: colors.success, fontSize: 15 },
});
