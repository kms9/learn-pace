import { imaSkillFile, imaSkillName, type PublicKnowledgeConnection } from "@learn-pace/app-host";
import type { StoredSourceBinding } from "@learn-pace/infra";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Text } from "react-native";
import { Action, Card, LoadingCard, Page, StatusBadge, styles } from "../../../src/components/Shell";
import { useApp } from "../../../src/context/AppContext";

const statusLabels = { ready: "已连接", disconnected: "未连接", auth_denied: "授权失败", error: "连接异常" };

export default function KnowledgeSettings() {
  const { knowledge, skills } = useApp();
  const router = useRouter();
  const [connections, setConnections] = useState<PublicKnowledgeConnection[]>();
  const [bindings, setBindings] = useState<StoredSourceBinding[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();

  const refresh = useCallback(async () => {
    const [connections, bindings] = await Promise.all([knowledge.listConnections(), knowledge.listBindings()]);
    setConnections(connections);
    setBindings(bindings);
  }, [knowledge]);

  useFocusEffect(useCallback(() => { void refresh().catch(() => setMessage("无法读取本地知识库。")); }, [refresh]));

  async function change(work: () => Promise<unknown>, success?: string) {
    if (working) return;
    setWorking(true);
    setMessage(undefined);
    try {
      await work();
      await refresh();
      setMessage(success);
    } catch {
      setMessage("无法完成操作，请重试。");
    } finally {
      setWorking(false);
    }
  }

  function openConnection(connectionId?: string) {
    router.push({ pathname: "/settings/knowledge/ima", params: connectionId ? { connectionId } : {} });
  }

  return <Page title="我的知识库" secondary headerAction={<Action label="连接 ima" onPress={() => openConnection()} />}>
    {message && <Text accessibilityRole="alert" style={styles.body}>{message}</Text>}
    {!connections && <LoadingCard label="正在读取知识库…" />}
    {connections?.length === 0 && <Card><Text style={styles.body}>连接 ima 后即可选择知识库，浏览资料并在问答中引用。</Text></Card>}
    {connections?.map(connection => <Card key={connection.connection_id} title={connection.display_name}>
      <StatusBadge label={statusLabels[connection.status]} tone={connection.status === "ready" ? "primary" : "warning"} />
      {connection.last_error && <Text style={styles.body}>{connection.last_error}</Text>}
      <Action label={connection.status === "ready" ? "发现知识库" : "重新连接"} secondary
        onPress={() => openConnection(connection.connection_id)} />
      {bindings.filter(binding => binding.connection_id === connection.connection_id).map(binding => <Action
        key={binding.binding_id} secondary label={binding.name + (binding.enabled && connection.status === "ready" ? "" : " · 待授权")}
        onPress={() => router.push({ pathname: "/settings/knowledge/[bindingId]", params: { bindingId: binding.binding_id } })} />)}
      {connection.status === "ready" && <Action label="断开连接" secondary disabled={working}
        onPress={() => void change(() => knowledge.disconnect(connection.connection_id), "已断开连接。")} />}
      <Action label="删除本地连接" secondary disabled={working} onPress={() => Alert.alert("删除本地连接？",
        "本机保存的绑定也将被移除。ima 库和历史引用仍可查看。", [
          { text: "取消", style: "cancel" },
          { text: "删除", style: "destructive", onPress: () => void change(() => knowledge.deleteConnection(connection.connection_id)) },
        ])} />
    </Card>)}
    <Card title="ima 知识库技能">
      <Text style={styles.body}>启用后可在问答或小老师里手动选择此技能。</Text>
      <Action label="安装并启用 ima-knowledge" secondary disabled={working} onPress={() => void change(async () => {
        if (!await skills.detail(imaSkillName)) {
          await skills.confirm(await skills.previewLocal(new TextEncoder().encode(imaSkillFile), "local_file"));
        }
        await skills.setEnabled(imaSkillName, true);
        await skills.setScope(imaSkillName, "lf01", true);
        await skills.setScope(imaSkillName, "little_tutor", true);
      }, "已启用 ima-knowledge。")} />
    </Card>
  </Page>;
}
