import { Redirect, Tabs } from "expo-router";
import { useApp } from "../../src/context/AppContext";
import { colors } from "../../src/theme";

export default function TabsLayout() {
  const { snapshot } = useApp();
  if (snapshot.curriculumProfile === null) return <Redirect href="/onboarding/scene" />;

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { borderTopColor: colors.border },
      tabBarLabelStyle: { fontSize: 14 },
      tabBarIcon: () => null,
      tabBarIconStyle: { display: "none" },
    }}>
      <Tabs.Screen name="index" options={{ title: "首页", tabBarAccessibilityLabel: "首页", tabBarButtonTestID: "tab-index" }} />
      <Tabs.Screen name="chat" options={{ title: "问答", tabBarAccessibilityLabel: "问答", tabBarButtonTestID: "tab-chat" }} />
      <Tabs.Screen name="paths" options={{ title: "路径", tabBarAccessibilityLabel: "路径", tabBarButtonTestID: "tab-paths" }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarAccessibilityLabel: "我的", tabBarButtonTestID: "tab-me" }} />
    </Tabs>
  );
}
