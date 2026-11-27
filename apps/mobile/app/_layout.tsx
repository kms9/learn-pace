import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../src/context/AppContext";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="mastery/new" options={{ title: "新建精通之路" }} />
        <Stack.Screen name="mastery/[pathId]/index" options={{ title: "精通之路" }} />
        <Stack.Screen name="mastery/[pathId]/session/[sessionId]" options={{ title: "精通会话" }} />
        <Stack.Screen name="chat/thread/[threadId]" options={{ title: "小老师" }} />
        <Stack.Screen name="learning/mistakes" options={{ title: "错题回看" }} />
        <Stack.Screen name="learning/cards" options={{ title: "知识卡" }} />
        <Stack.Screen name="settings/skills/index" options={{ title: "技能管理" }} />
        <Stack.Screen name="settings/skills/import" options={{ title: "导入技能" }} />
        <Stack.Screen name="settings/skills/market" options={{ title: "技能市场" }} />
        <Stack.Screen name="settings/skills/[skillId]" options={{ title: "技能详情" }} />
        <Stack.Screen name="settings/knowledge/index" options={{ title: "知识库" }} />
        <Stack.Screen name="settings/knowledge/ima" options={{ title: "ima 连接" }} />
        <Stack.Screen name="settings/knowledge/[bindingId]" options={{ title: "知识库目录" }} />
        <Stack.Screen name="review-reminder" options={{ headerShown: false }} />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="dev/m1-workbench" options={{ title: "M1 验证工作台" }} />
          <Stack.Screen name="dev/s7-tutor-loop" options={{ title: "S7 导师循环验证" }} />
        </Stack.Protected>
      </Stack>
    </AppProvider>
  );
}
