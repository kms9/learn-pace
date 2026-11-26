import { KnowledgeCardError, RestoreGateError } from "@learn-pace/app-host";
import { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { ChatAction, ChatSearch } from "../../src/components/chat-controls";
import { MessageContent } from "../../src/components/MessageContent";
import { Card, LoadingCard, Page, RetryCard, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";
import { useMasteryProjection } from "../../src/context/useMasteryProjection";
import { colors, spacing } from "../../src/theme";

const noObserver = () => () => {};

export default function KnowledgeCards() {
  const { knowledgeCards } = useApp();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; note: string }>();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const read = useCallback(() => knowledgeCards.list(query), [knowledgeCards, query]);
  const { data, error, retry } = useMasteryProjection(read, noObserver);

  async function change(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      await work();
      setEditing(undefined);
      retry();
    } catch (cause) {
      setMessage(cause instanceof KnowledgeCardError || cause instanceof RestoreGateError
        ? cause.message : "无法保存知识卡，请重试");
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  return <Page title="知识卡" secondary keyboard>
    <ChatSearch label="搜索知识卡" value={query} change={setQuery} />
    {message && <Text accessibilityRole="alert" style={styles.body}>{message}</Text>}
    {error !== undefined && <RetryCard message="无法读取知识卡" retry={retry} />}
    {!data && error === undefined && <LoadingCard label="正在读取知识卡…" />}
    {data?.length === 0 && <Card><Text style={styles.body}>{query.trim() ? "未找到匹配的知识卡。" : "还没有收藏的知识卡。"}</Text></Card>}
    {data?.map((card) => <Card key={card.card_id}>
      <MessageContent content={"### " + card.title} />
      <MessageContent content={card.content} />
      {editing?.id === card.card_id ? <>
        <TextInput accessibilityLabel="知识卡备注" style={local.input} value={editing.note}
          onChangeText={(note) => setEditing({ id: card.card_id, note })} multiline editable={!pending} />
        <View style={local.actions}>
          <ChatAction label="保存备注" primary disabled={pending}
            onPress={() => void change(() => knowledgeCards.updateNote(card.card_id, editing.note))} />
          <ChatAction label="取消" disabled={pending} onPress={() => setEditing(undefined)} />
        </View>
      </> : <>
        {!!card.note && <Text style={styles.body}>备注：{card.note}</Text>}
        <View style={local.actions}>
          <ChatAction label="编辑备注" disabled={pending} onPress={() => setEditing({ id: card.card_id, note: card.note })} />
          <ChatAction label="删除知识卡" danger disabled={pending} onPress={() => Alert.alert("删除这张知识卡？", undefined, [
            { text: "取消", style: "cancel" },
            { text: "删除", style: "destructive", onPress: () => void change(() => knowledgeCards.remove(card.card_id)) },
          ])} />
        </View>
      </>}
    </Card>)}
  </Page>;
}

const local = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text,
    padding: spacing.sm, textAlignVertical: "top", minHeight: 64 },
});
