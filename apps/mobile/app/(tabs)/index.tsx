import { curriculumProfiles } from "@learn-pace/app-host";
import { useRouter } from "expo-router";
import { Text } from "react-native";
import { Action, Card, ModelSetup, Page, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";

export default function Home() {
  const { snapshot } = useApp();
  const router = useRouter();
  const scene = curriculumProfiles.find(({ id }) => id === snapshot.curriculumProfile)?.label;
  const { pending } = snapshot;

  return (
    <Page title="首页">
      <Card title="学习概览">
        <Text style={styles.body}>{scene} · {snapshot.paths.length} 条学习路径 · {snapshot.sessions.length} 个会话</Text>
      </Card>
      {pending && (
        <Card title={pending.status === "answered" ? "待评分题目" : "待答题目"}>
          <Text style={styles.body}>{pending.question.prompt}</Text>
          <Action label="打开学习工作台" onPress={() => router.push({ pathname: "/path/[pathId]/workbench", params: { pathId: pending.path_id } })} secondary />
        </Card>
      )}
      <ModelSetup />
    </Page>
  );
}
