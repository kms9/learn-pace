import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../src/context/AppContext";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTintColor: colors.text, headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/scene" options={{ title: "学习场景" }} />
        <Stack.Screen name="path/new" options={{ title: "创建学习目标" }} />
        <Stack.Screen name="path/[pathId]/workbench" options={{ title: "学习工作台" }} />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="dev/m1-workbench" options={{ title: "M1 验证工作台" }} />
        </Stack.Protected>
      </Stack>
    </AppProvider>
  );
}
