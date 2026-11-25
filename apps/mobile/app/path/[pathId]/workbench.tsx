import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Card, Page, styles } from "../../../src/components/Shell";
import { useApp } from "../../../src/context/AppContext";

export default function PathWorkbench() {
  const { pathId } = useLocalSearchParams<{ pathId: string }>();
  const { snapshot } = useApp();
  const path = snapshot.paths.find((item) => item.path_id === pathId);
  return (
    <Page title={path?.name || "学习工作台"} secondary>
      <Card><Text style={styles.body}>{path ? "学习流程将在后续开放。" : "找不到该学习路径。"}</Text></Card>
    </Page>
  );
}
