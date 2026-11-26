import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MasteryProgress } from "../../src/components/MasteryOutline";
import { Action, LoadingCard, ModelSetup, Page, RetryCard, StatusBadge, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";
import { useMasteryProjection } from "../../src/context/useMasteryProjection";
import { colors, spacing } from "../../src/theme";

export default function Home() {
  const { learningHome, mastery } = useApp();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const read = useCallback(() => learningHome.read(), [learningHome]);
  const observe = useCallback((refresh: () => void) => mastery.observeChanges(refresh), [mastery]);
  const { data, error, retry } = useMasteryProjection(read, observe);

  return <Page title="学习">
    {error !== undefined && <RetryCard message="无法读取学习记录" retry={retry} />}
    {!data && error === undefined && <LoadingCard label="正在读取学习记录…" />}
    {!!data?.attention.length && <View style={local.section}>
      <Text accessibilityRole="header" style={styles.heading}>该做的事</Text>
      {data.attention.map((item) => <Pressable key={item.kind === "question" ? `question-${item.sessionId}` : `review-${item.path.id}`}
        accessibilityRole="button" style={styles.card} onPress={() => router.push({
          pathname: "/mastery/[pathId]/session/[sessionId]",
          params: item.kind === "question" ? { pathId: item.path.id, sessionId: item.sessionId }
            : { pathId: item.path.id, sessionId: "new", mode: "review" },
        })}>
        <Text style={local.name}>{item.path.emoji} {item.path.name}</Text>
        {item.kind === "review" ? <StatusBadge tone="warning" label={`${item.path.dueCount} 项复习已到期`} /> : <>
          <StatusBadge label={item.answered ? "待评分" : "待作答"} />
          <Text style={styles.body} numberOfLines={2}>{item.prompt}</Text>
        </>}
      </Pressable>)}
    </View>}
    {!!data?.records.length && <View style={local.section}>
      <Text accessibilityRole="header" style={styles.heading}>学习记录</Text>
      {(expanded ? data.records : data.records.slice(0, 6)).map((path) => <Pressable key={path.id}
        accessibilityRole="button" style={styles.card}
        onPress={() => router.push({ pathname: "/mastery/[pathId]", params: { pathId: path.id } })}>
        <Text style={local.name}>{path.emoji} {path.name}</Text>
        {path.status === "draft" && <Text style={styles.body}>去定大纲</Text>}
        <MasteryProgress {...path} />
      </Pressable>)}
      {!expanded && data.records.length > 6 && <Action label="展开显示" onPress={() => setExpanded(true)} secondary />}
    </View>}
    {data?.records.length === 0 && <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.push("/mastery/new")}>
      <Text style={local.name}>🧭 精通之路</Text>
      <Text style={styles.body}>创建一个学习目标，和导师一起定大纲、学习并复习。</Text>
    </Pressable>}
    <ModelSetup />
  </Page>;
}

const local = StyleSheet.create({
  section: { gap: spacing.sm },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
