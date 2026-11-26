import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, LoadingCard, ModelSetup, Page, RetryCard, styles } from "../../src/components/Shell";
import { MasteryProgress } from "../../src/components/MasteryOutline";
import { ChatAction } from "../../src/components/chat-controls";
import { useApp } from "../../src/context/AppContext";
import { useMasteryProjection } from "../../src/context/useMasteryProjection";
import { colors, radius, spacing, typography } from "../../src/theme";

export default function Paths() {
  const { mastery } = useApp();
  const router = useRouter();
  const read = useCallback(() => mastery.listTopics(), [mastery]);
  const observe = useCallback((refresh: () => void) => mastery.observeChanges(refresh), [mastery]);
  const { data: topics, error, retry } = useMasteryProjection(read, observe);
  return <Page title="精通之路" headerAction={<ChatAction label="＋ 新建" onPress={() => router.push("/mastery/new")} />}>
    {error !== undefined && <RetryCard message="无法读取精通目标" retry={retry} />}
    {!topics && error === undefined && <LoadingCard label="正在读取精通目标…" />}
    {topics?.length === 0 && <Card>
      <Text style={styles.body}>还没有精通目标。新建一个，和导师一起定下大纲。</Text>
    </Card>}
    {topics?.map((topic) => (
      <View key={topic.id} style={local.card}>
        <Pressable accessibilityRole="button" android_ripple={{ color: colors.soft }} style={local.path}
          onPress={() => router.push({ pathname: "/mastery/[pathId]", params: { pathId: topic.id } })}>
          <View style={local.titleRow}>
            <Text style={[styles.heading, local.title]}>{topic.emoji} {topic.name}</Text>
            <Text style={local.link}>{topic.status === "draft" ? "去定大纲" : "›"}</Text>
          </View>
          <MasteryProgress {...topic} />
        </Pressable>
        {topic.dueCount > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`复习「${topic.name}」 · ${topic.dueCount} 项`}
          style={local.review} onPress={() => router.push({
          pathname: "/mastery/[pathId]/session/[sessionId]", params: { pathId: topic.id, sessionId: "new", mode: "review" },
        })}><Text style={local.link}>开始复习 ›</Text></Pressable>}
      </View>
    ))}
    <ModelSetup />
  </Page>;
}

const local = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, overflow: "hidden" },
  path: { padding: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1 },
  link: { color: colors.primary, fontSize: typography.caption, fontWeight: "600" },
  review: { minHeight: 44, alignItems: "flex-start", justifyContent: "center", paddingHorizontal: spacing.md,
    borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
});
