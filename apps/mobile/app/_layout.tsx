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
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="dev/m1-workbench" options={{ title: "M1 验证工作台" }} />
          <Stack.Screen name="dev/s7-tutor-loop" options={{ title: "S7 导师循环验证" }} />
        </Stack.Protected>
      </Stack>
    </AppProvider>
  );
}
