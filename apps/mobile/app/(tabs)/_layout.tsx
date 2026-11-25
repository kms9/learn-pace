import { Tabs } from "expo-router";
import { colors } from "../../src/theme";

export const unstable_settings = { initialRouteName: "chat" };

export default function TabsLayout() {
  return (
    <Tabs backBehavior="initialRoute" screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.background },
      tabBarHideOnKeyboard: true,
      tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
      tabBarIcon: () => null,
      tabBarIconStyle: { display: "none" },
    }}>
      <Tabs.Screen name="index" options={{ title: "学习", tabBarAccessibilityLabel: "学习", tabBarButtonTestID: "tab-index" }} />
      <Tabs.Screen name="chat" options={{ title: "问答", tabBarAccessibilityLabel: "问答", tabBarButtonTestID: "tab-chat" }} />
      <Tabs.Screen name="paths" options={{ title: "精通之路", tabBarAccessibilityLabel: "精通之路", tabBarButtonTestID: "tab-paths" }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarAccessibilityLabel: "我的", tabBarButtonTestID: "tab-me" }} />
    </Tabs>
  );
}
