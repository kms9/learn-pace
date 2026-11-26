import { MasterySessionError, RestoreGateError, type Mistake } from "@learn-pace/app-host";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChatAction } from "../../src/components/chat-controls";
import { MessageContent } from "../../src/components/MessageContent";
import { SaveKnowledgeCardAction } from "../../src/components/SaveKnowledgeCardAction";
import { Card, LoadingCard, Page, RetryCard, StatusBadge, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";
import { useMasteryProjection } from "../../src/context/useMasteryProjection";
import { spacing } from "../../src/theme";

export default function Mistakes() {
  const { mistakes, mastery, knowledgeCards } = useApp();
  const { pathId } = useLocalSearchParams<{ pathId?: string }>();
  const router = useRouter();
  const [filter, setFilter] = useState(pathId ?? "");
  const [busy, setBusy] = useState<string>();
  const [jumpError, setJumpError] = useState<string>();
  const opening = useRef(false);
  const read = useCallback(() => mistakes.listMistakes(), [mistakes]);
  const observe = useCallback((refresh: () => void) => mastery.observeChanges(refresh), [mastery]);
  const { data, error, retry } = useMasteryProjection(read, observe);
  const paths = new Map(data?.flatMap((item) => item.kind === "mastery" ? [[item.pathId, item.pathName] as const] : []) ?? []);
  const list = data?.filter((item) => !filter || (item.kind === "mastery" && item.pathId === filter));

  async function practice(item: Extract<Mistake, { kind: "mastery" }>) {
    if (opening.current) return;
    opening.current = true;
    setBusy(item.id);
    setJumpError(undefined);
    try {
      const { session } = await mastery.startObjectivePractice(item.pathId, item.objectiveId);
      router.push({ pathname: "/mastery/[pathId]/session/[sessionId]",
        params: { pathId: item.pathId, sessionId: session.session_id } });
    } catch (cause) {
      setJumpError(cause instanceof MasterySessionError || cause instanceof RestoreGateError
        ? cause.message : "无法打开学习会话，请重试");
    } finally {
      opening.current = false;
      setBusy(undefined);
    }
  }

  return <Page title="错题回看" secondary>
    {!!(paths.size || filter) && <View style={local.actions}>
      <ChatAction label="全部" primary={!filter} onPress={() => setFilter("")} />
      {[...paths].map(([id, name]) => <ChatAction key={id} label={name} primary={id === filter} onPress={() => setFilter(id)} />)}
    </View>}
    {error !== undefined && <RetryCard message="无法读取错题" retry={retry} />}
    {!list && error === undefined && <LoadingCard label="正在读取错题…" />}
    {list?.length === 0 && <Card><Text style={styles.body}>这里暂无错题。</Text></Card>}
    {jumpError && <Text accessibilityRole="alert" style={styles.body}>{jumpError}</Text>}
    {list?.map((item) => <Card key={`${item.kind}:${item.id}`}>
      <View style={local.actions}>
        <Text style={styles.heading}>{item.kind === "mastery" ? item.pathName : item.sessionTitle}</Text>
        {item.kind === "quick_check" ? <StatusBadge label="未计入掌握" /> :
          <StatusBadge label={item.mastered ? "已掌握" : "学习中"} />}
      </View>
      <MessageContent content={item.prompt} />
      {!!item.learnerAnswer && <MessageContent content={"你的作答：" + item.learnerAnswer} />}
      {!!item.feedback && item.feedback !== item.explanation && <MessageContent content={item.feedback} />}
      {!!item.referenceAnswer && <MessageContent content={"参考答案：" + item.referenceAnswer} />}
      {!!item.explanation && <MessageContent content={item.explanation} />}
      {item.kind === "mastery" ? <View style={local.actions}>
        {item.objectiveName && <ChatAction label={busy === item.id ? "正在打开…" : "去练这个知识点"} disabled={!!busy}
          onPress={() => void practice(item)} />}
        <SaveKnowledgeCardAction save={() => knowledgeCards.saveMasteryExplanation(item.interactionId, item.questionId)} />
      </View> : <View style={local.actions}>
        <ChatAction label="回到原问答" onPress={() => router.navigate({ pathname: "/chat", params: { openSessionId: item.sessionId } })} />
        <SaveKnowledgeCardAction save={() => knowledgeCards.saveQuickCheckExplanation(item.messageId, item.questionId)} />
      </View>}
    </Card>)}
  </Page>;
}

const local = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
});
