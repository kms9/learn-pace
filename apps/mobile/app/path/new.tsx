import { Card, Page, styles } from "../../src/components/Shell";
import { Text } from "react-native";

export default function NewPath() {
  return (
    <Page title="创建学习目标" secondary>
      <Card><Text style={styles.body}>目标创建将在学习路径流程开放。</Text></Card>
    </Page>
  );
}
