import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Text } from "react-native";
import { Action, Card, LoadingCard, ModelSetup, Page, RetryCard, styles } from "../../src/components/Shell";
import { MasteryProgress } from "../../src/components/MasteryOutline";
import { useApp } from "../../src/context/AppContext";
import { useMasteryProjection } from "../../src/context/useMasteryProjection";

export default function Paths() {
  const { mastery } = useApp();
  const router = useRouter();
  const read = useCallback(() => mastery.listTopics(), [mastery]);
  const observe = useCallback((refresh: () => void) => mastery.observeChanges(refresh), [mastery]);
  const { data: topics, error, retry } = useMasteryProjection(read, observe);
  const due = topics?.reduce((sum, item) => sum + item.dueCount, 0) ?? 0;
  const firstDue = topics?.find(({ dueCount }) => dueCount > 0);

  return <Page title="精通之路">
    <Action label="新建精通目标" onPress={() => router.push("/mastery/new")} />
    {firstDue && <Action label={`${due} 项待复习`} onPress={() => router.push({
      pathname: "/mastery/[pathId]/session/[sessionId]", params: { pathId: firstDue.id, sessionId: "new", mode: "review" },
    })} />}
    {error !== undefined && <RetryCard message="无法读取精通目标" retry={retry} />}
    {!topics && error === undefined && <LoadingCard label="正在读取精通目标…" />}
    {topics?.length === 0 && <Card>
      <Text style={styles.body}>还没有精通目标。新建一个，和导师一起定下大纲。</Text>
    </Card>}
    {topics?.map((topic) => (
      <Card key={topic.id} title={topic.emoji + " " + topic.name}>
        <MasteryProgress {...topic} />
        <Action label={topic.status === "draft" ? "去定大纲" : "打开精通之路"}
          onPress={() => router.push({ pathname: "/mastery/[pathId]", params: { pathId: topic.id } })} secondary />
      </Card>
    ))}
    <ModelSetup />
  </Page>;
}
