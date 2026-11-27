import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";
import { colors, typography } from "../../src/theme";

export const unstable_settings = { initialRouteName: "chat" };

export default function TabsLayout() {
  return (
    <Tabs backBehavior="initialRoute" screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.background },
      tabBarHideOnKeyboard: true,
      tabBarLabelStyle: { fontSize: typography.caption, fontWeight: "600" },
    }}>
      <Tabs.Screen name="index" options={{ title: "学习", tabBarAccessibilityLabel: "学习", tabBarButtonTestID: "tab-index",
        tabBarIcon: ({ color }) => <TabIcon kind="book" color={color ?? colors.muted} /> }} />
      <Tabs.Screen name="chat" options={{ title: "问答", tabBarAccessibilityLabel: "问答", tabBarButtonTestID: "tab-chat",
        tabBarIcon: ({ color }) => <TabIcon kind="chat" color={color ?? colors.muted} /> }} />
      <Tabs.Screen name="paths" options={{ title: "精通之路", tabBarAccessibilityLabel: "精通之路", tabBarButtonTestID: "tab-paths",
        tabBarIcon: ({ color }) => <TabIcon kind="compass" color={color ?? colors.muted} /> }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarAccessibilityLabel: "我的", tabBarButtonTestID: "tab-me",
        tabBarIcon: ({ color }) => <TabIcon kind="user" color={color ?? colors.muted} /> }} />
    </Tabs>
  );
}

function TabIcon({ kind, color }: { kind: "book" | "chat" | "compass" | "user"; color: ColorValue }) {
  const stroke = { borderColor: color };
  return <View style={icons.frame}>
    {kind === "book" && <>
      <View style={[icons.page, icons.leftPage, stroke]} />
      <View style={[icons.page, icons.rightPage, stroke]} />
    </>}
    {kind === "chat" && <>
      <View style={[icons.bubble, stroke]} />
      <View style={[icons.tail, stroke]} />
    </>}
    {kind === "compass" && <>
      <View style={[icons.compass, stroke]} />
      <View style={[icons.needle, stroke]} />
    </>}
    {kind === "user" && <>
      <View style={[icons.head, stroke]} />
      <View style={[icons.shoulders, stroke]} />
    </>}
  </View>;
}

const icons = StyleSheet.create({
  frame: { width: 22, height: 22 },
  page: { position: "absolute", top: 4, width: 10, height: 15, borderWidth: 1.6, borderRadius: 3 },
  leftPage: { left: 1 },
  rightPage: { right: 1 },
  bubble: { position: "absolute", top: 3, left: 2, width: 18, height: 15, borderWidth: 1.6, borderRadius: 5 },
  tail: { position: "absolute", top: 15, left: 6, width: 5, height: 5, borderLeftWidth: 1.6, borderBottomWidth: 1.6,
    transform: [{ rotate: "-45deg" }], backgroundColor: colors.background },
  compass: { position: "absolute", top: 2, left: 2, width: 18, height: 18, borderWidth: 1.6, borderRadius: 9 },
  needle: { position: "absolute", top: 6, left: 9, width: 4, height: 10, borderWidth: 1.4, borderRadius: 2,
    transform: [{ rotate: "40deg" }] },
  head: { position: "absolute", top: 2, left: 7, width: 8, height: 8, borderWidth: 1.6, borderRadius: 4 },
  shoulders: { position: "absolute", top: 12, left: 3, width: 16, height: 8, borderWidth: 1.6,
    borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
});
