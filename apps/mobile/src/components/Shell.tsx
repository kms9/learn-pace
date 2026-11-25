import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../context/AppContext";
import { colors, spacing } from "../theme";

export function Page({ title, children, secondary = false }: { title: string; children: ReactNode; secondary?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={secondary ? ["left", "right", "bottom"] : ["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <View style={styles.card}>
      {title && <Text accessibilityRole="header" style={styles.heading}>{title}</Text>}
      {children}
    </View>
  );
}

export function Action({ label, onPress, disabled, secondary }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      android_ripple={{ color: colors.border }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, secondary && styles.secondaryAction, disabled && styles.disabled]}
    >
      <Text style={[styles.actionLabel, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

export function ModelSetup() {
  const { snapshot } = useApp();
  const router = useRouter();
  if (snapshot.model.configured) return null;
  return (
    <Card title="配置 DeepSeek Flash">
      <Text style={styles.body}>配置后可使用模型。已保存的会话和路径可以离线查看。</Text>
      <Action label="打开模型设置" onPress={() => router.navigate("/me")} secondary />
    </Card>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  page: { flexGrow: 1, padding: spacing.md, gap: spacing.md },
  title: { color: colors.text, fontSize: 27, fontWeight: "700", marginBottom: spacing.xs },
  heading: { color: colors.text, fontSize: 17, fontWeight: "700" },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: spacing.sm },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  action: { minHeight: 44, padding: spacing.sm, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: colors.primary },
  actionLabel: { color: colors.surface, fontSize: 15, fontWeight: "600" },
  secondaryAction: { backgroundColor: colors.soft },
  secondaryLabel: { color: colors.primary },
  disabled: { opacity: 0.45 },
});
