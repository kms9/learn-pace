import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme";

export function ChatAction({ label, onPress, disabled, primary, danger, testID }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action, primary && styles.primary, pressed && styles.pressed, disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, primary && styles.inverse, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

export function ChatSheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭" onPress={close} />
        <SafeAreaView edges={["left", "right", "bottom"]} style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
            <ChatAction label="关闭" onPress={close} />
          </View>
          {children}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: "center", alignItems: "center", borderRadius: 12 },
  primary: { backgroundColor: colors.primary, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  label: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  inverse: { color: colors.surface },
  danger: { color: colors.danger },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%", backgroundColor: colors.background, borderTopLeftRadius: radius.large,
    borderTopRightRadius: radius.large, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.xs },
  sheetTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "700" },
});
