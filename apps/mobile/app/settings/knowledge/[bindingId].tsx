import { hasKnowledgeValue, type KnowledgeBrowsePage } from "@learn-pace/app-host";
import type { StoredSourceBinding } from "@learn-pace/infra";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import { Action, Card, LoadingCard, Page, StatusBadge, styles } from "../../../src/components/Shell";
import { useApp } from "../../../src/context/AppContext";

export default function BoundLibrary() {
  const { bindingId } = useLocalSearchParams<{ bindingId: string }>();
  const router = useRouter();
  const { knowledge } = useApp();
  const [binding, setBinding] = useState<StoredSourceBinding | null>();
  const [folder, setFolder] = useState<string>();
  const [page, setPage] = useState<KnowledgeBrowsePage>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void knowledge.listBindings().then(result => {
      if (live) setBinding(result.find(entry => entry.binding_id === bindingId) ?? null);
    }).catch(() => { if (live) setBinding(null); });
    return () => { live = false; };
  }, [bindingId, knowledge]);

  const read = useCallback(async (folderId?: string, cursor?: string, signal?: AbortSignal) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await knowledge.browse(bindingId, folderId, cursor, signal);
      if (signal?.aborted) return;
      if (!hasKnowledgeValue(result)) { setNotice(result.message); return; }
      setPage(previous => ({ ...result.value, items: cursor ? [...(previous?.items ?? []), ...result.value.items] : result.value.items }));
    } catch {
      if (!signal?.aborted) setNotice("无法读取目录，请重试。");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, [bindingId, knowledge]);

  useEffect(() => {
    if (!binding?.enabled) return;
    const controller = new AbortController();
    setPage(undefined);
    void read(folder, undefined, controller.signal);
    return () => controller.abort();
  }, [binding, folder, read]);

  return <Page title={binding?.name ?? "知识库目录"} secondary>
    {binding === undefined && <LoadingCard label="正在读取绑定…" />}
    {binding === null && <Card><Text style={styles.body}>找不到此知识库绑定。</Text></Card>}
    {binding && <>
      <Card>
        <StatusBadge label={binding.enabled ? "只读绑定" : "待重新授权"} tone={binding.enabled ? "primary" : "warning"} />
        {!!binding.description && <Text style={styles.body}>{binding.description}</Text>}
        {(!binding.enabled || notice) && <Action label="打开连接与授权" secondary onPress={() => router.push({
          pathname: "/settings/knowledge/ima", params: { connectionId: binding.connection_id },
        })} />}
        <Action label="取消本地绑定" secondary onPress={() => Alert.alert("取消绑定？", "历史引用仍可离线查看。", [
          { text: "取消", style: "cancel" },
          { text: "取消绑定", style: "destructive", onPress: () => void knowledge.unbind(bindingId)
            .then(() => router.back()).catch(() => setNotice("无法取消绑定，请重试。")) },
        ])} />
      </Card>
      {notice && <Text accessibilityRole="alert" style={styles.body}>{notice}</Text>}
      {busy && !page && <LoadingCard label="正在读取目录…" />}
      {folder && <Action label="返回根目录" secondary onPress={() => setFolder(undefined)} />}
      {page && <Card title={page.path.map(item => item.title).join(" / ") || "目录"}>
        {!page.items.length && <Text style={styles.body}>目录为空。</Text>}
        {page.items.map((item, index) => item.kind === "folder"
          ? <Action secondary key={item.folderId + index} label={item.title} onPress={() => setFolder(item.folderId)} />
          : <Text key={item.mediaId + index} style={styles.body}>{item.title} · {item.sourceType === "unavailable" ? "仅元数据" : "可尝试读取"}</Text>)}
        {page.nextCursor && <Action label="加载更多" secondary disabled={busy} onPress={() => void read(folder, page.nextCursor)} />}
      </Card>}
    </>}
  </Page>;
}
