import { hasKnowledgeValue, type KnowledgeLibrary, type PublicKnowledgeConnection } from "@learn-pace/app-host";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { Action, Card, Page, StatusBadge, styles } from "../../../src/components/Shell";
import { ChatSearch } from "../../../src/components/chat-controls";
import { useApp } from "../../../src/context/AppContext";
import { colors, radius, spacing } from "../../../src/theme";

export default function ImaConnection() {
  const { connectionId } = useLocalSearchParams<{ connectionId?: string }>();
  const { knowledge } = useApp();
  const router = useRouter();
  const [connection, setConnection] = useState<PublicKnowledgeConnection>();
  const [ready, setReady] = useState(!connectionId);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("ima");
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [query, setQuery] = useState("");
  const [libraries, setLibraries] = useState<KnowledgeLibrary[]>();
  const [next, setNext] = useState<string>();
  const [bound, setBound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!connectionId) return;
    let live = true;
    void Promise.all([knowledge.listConnections(), knowledge.listBindings(connectionId)]).then(([connections, bindings]) => {
      if (!live) return;
      const item = connections.find(candidate => candidate.connection_id === connectionId);
      setConnection(item);
      setName(item?.display_name ?? "ima");
      setBound(bindings.filter(binding => binding.enabled && item?.status === "ready").map(binding => binding.remote_kb_id));
      setReady(true);
    }).catch(() => { if (live) { setNotice("无法读取连接。"); setReady(true); } });
    return () => { live = false; pending.current?.abort(); };
  }, [knowledge, connectionId]);

  useEffect(() => () => pending.current?.abort(), []);
  useFocusEffect(useCallback(() => {
    if (!connection?.connection_id) return;
    let live = true;
    void knowledge.listBindings(connection.connection_id).then(bindings => {
      if (live) setBound(bindings.filter(binding => binding.enabled && connection.status === "ready").map(binding => binding.remote_kb_id));
    }).catch(() => {});
    return () => { live = false; };
  }, [connection, knowledge]));

  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice(undefined);
    try { await operation(controller.signal); }
    catch { if (!controller.signal.aborted) setNotice("无法完成操作，请重试。"); }
    finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  function save() {
    if (!consent || !name.trim() || !clientId.trim() || !apiKey.trim()) return;
    void run(async (signal) => {
      const result = await knowledge.connect({ connectionId: connection?.connection_id, displayName: name, clientId, apiKey }, signal);
      if (signal.aborted) return;
      if (!hasKnowledgeValue(result)) { setNotice(result.message); return; }
      setConnection(result.value);
      setApiKey("");
      setClientId("");
      setEdit(false);
      setBound([]);
      setLibraries(undefined);
      setNext(undefined);
      setNotice("连接成功，可以查找知识库。");
    });
  }

  function search(cursor?: string) {
    if (!connection) return;
    void run(async signal => {
      const result = await knowledge.discover(connection.connection_id, query, cursor, signal);
      if (signal.aborted) return;
      if (!hasKnowledgeValue(result)) { setNotice(result.message); return; }
      setLibraries(previous => [...new Map([...(cursor ? previous ?? [] : []), ...result.value.items].map(item => [item.id, item])).values()]);
      setNext(result.value.nextCursor);
    });
  }

  const connected = connection?.status === "ready" && !edit;
  return <Page title={connected ? connection.display_name : "连接 ima"} secondary keyboard>
    {notice && <Text accessibilityRole="alert" style={styles.body}>{notice}</Text>}
    {!ready ? <Card><Text style={styles.body}>正在读取连接…</Text></Card> : connected ? <>
      <Card>
        <StatusBadge label="连接可用" />
        <ChatSearch label="按名称搜索知识库" value={query} change={(value) => { setQuery(value); setNext(undefined); }} />
        <Action label={busy ? "处理中…" : "查找知识库"} disabled={busy} onPress={() => search()} />
        <Action label="重新配置凭据" secondary disabled={busy} onPress={() => { setEdit(true); setConsent(false); }} />
      </Card>
      {libraries?.length === 0 && <Card><Text style={styles.body}>未找到匹配的知识库。</Text></Card>}
      {libraries?.map(library => <Card key={library.id} title={library.name}>
        {[library.baseType, library.roleType].some(Boolean) && <Text style={styles.body}>
          {[library.baseType, library.roleType].filter(Boolean).join(" · ")}</Text>}
        {!!library.description && <Text style={styles.body}>{library.description}</Text>}
        <Action label={bound.includes(library.id) ? "已授权" : "授权用于问答"} secondary disabled={busy || bound.includes(library.id)}
          onPress={() => void run(async () => {
            const result = await knowledge.bind(connection.connection_id, library.id);
            if (!hasKnowledgeValue(result)) { setNotice(result.message); return; }
            setBound(previous => [...previous, library.id]);
            router.push({ pathname: "/settings/knowledge/[bindingId]", params: { bindingId: result.value.binding_id } });
          })} />
      </Card>)}
      {next && <Action label="加载更多" secondary disabled={busy} onPress={() => search(next)} />}
    </> : <Card title="连接授权">
      <Text style={styles.body}>凭据只发送给 ima 并保存在本机安全存储。选库后，问题中的检索词会发送给 ima，读取到的相关资料会发给当前配置的模型生成回答。</Text>
      <Action label={consent ? "已确认数据流向" : "确认并继续"} secondary onPress={() => setConsent(true)} disabled={consent || busy} />
      {consent && <>
        <TextInput style={local.input} accessibilityLabel="连接名称" placeholder="连接名称" value={name} onChangeText={setName} editable={!busy} />
        <TextInput style={local.input} accessibilityLabel="ima Client ID" placeholder="Client ID" value={clientId} onChangeText={setClientId}
          editable={!busy} autoCapitalize="none" autoCorrect={false} />
        <TextInput style={local.input} accessibilityLabel="ima API Key" placeholder="API Key" value={apiKey} onChangeText={setApiKey}
          editable={!busy} autoCapitalize="none" autoCorrect={false} secureTextEntry />
        <Action label={busy ? "正在测试连接…" : "测试并保存"} disabled={busy || !name.trim() || !clientId.trim() || !apiKey.trim()} onPress={save} />
      </>}
      {edit && <Action label="返回知识库发现" secondary disabled={busy} onPress={() => setEdit(false)} />}
    </Card>}
  </Page>;
}

const local = StyleSheet.create({ input: { minHeight: 44, borderWidth: 1, borderColor: colors.border,
  borderRadius: radius.sm, paddingHorizontal: spacing.sm, color: colors.text, fontSize: 16 } });
