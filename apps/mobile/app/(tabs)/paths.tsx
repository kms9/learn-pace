import { useRouter } from "expo-router";
import { Text } from "react-native";
import { useApp } from "../../src/context/AppContext";
import { Action, Card, ModelSetup, Page, styles } from "../../src/components/Shell";

const labels = { draft: "草稿", active: "进行中", completed: "已完成", archived: "已归档" };

export default function Paths() {
  const { snapshot } = useApp();
  const router = useRouter();

  return (
    <Page title="路径">
      <ModelSetup />
      <Action label="创建学习目标" onPress={() => router.push("/path/new")} />
      {snapshot.paths.length === 0 && <Card><Text style={styles.body}>暂无学习路径。</Text></Card>}
      {snapshot.paths.map(({ path_id, name, status }) => (
        <Card key={path_id} title={name || "未命名路径"}>
          <Text style={styles.body}>{labels[status]}</Text>
          <Action label="打开路径" onPress={() => router.push({ pathname: "/path/[pathId]/workbench", params: { pathId: path_id } })} secondary />
        </Card>
      ))}
    </Page>
  );
}
