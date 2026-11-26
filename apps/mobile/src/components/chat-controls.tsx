import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "../theme";

export function ChatAction({ label, onPress, disabled, primary, danger, subtle, testID }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  subtle?: boolean;
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
        styles.action, subtle && styles.subtleAction, primary && styles.primary, pressed && styles.pressed, disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, subtle && styles.subtleLabel, primary && styles.inverse, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

function distanceFromBottom({ nativeEvent: { contentSize, contentOffset, layoutMeasurement } }: NativeSyntheticEvent<NativeScrollEvent>) {
  return contentSize.height - contentOffset.y - layoutMeasurement.height;
}

export function useConversationScroll() {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const follow = useRef(true);
  const [showBottom, setShowBottom] = useState(false);

  function settle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const distance = distanceFromBottom(event);
    follow.current = distance < 80;
    setShowBottom(distance > 160);
  }

  const scrollEvents = {
    scrollEventThrottle: 32,
    onScrollBeginDrag: () => { follow.current = false; },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => setShowBottom(!follow.current && distanceFromBottom(event) > 160),
    onScrollEndDrag: settle,
    onMomentumScrollEnd: settle,
  };

  function scrollToBottom() {
    follow.current = true;
    setShowBottom(false);
    scroll.current?.scrollToEnd({ animated: true });
  }

  return { scroll, follow, showBottom, scrollEvents, scrollToBottom };
}

export function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="回到底部"
    style={styles.scrollButton} onPress={onPress}>
    <Text style={styles.scrollLabel}>↓ 回到底部</Text>
  </Pressable>;
}

export function ChatSearch({ label, value, change }: { label: string; value: string; change: (value: string) => void }) {
  return <View style={styles.search}>
    <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.muted}
      style={styles.searchInput} value={value} onChangeText={change} returnKeyType="search" autoCorrect={false} />
    {!!value && <ChatAction label="清空搜索" onPress={() => change("")} />}
  </View>;
}

export function ConversationComposer({ label, placeholder, testID, draft, onChangeText, editable = true,
  send, sendDisabled, stop, model, openModelSettings, children }: {
  label: string;
  placeholder: string;
  testID: string;
  draft: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  send: () => void;
  sendDisabled: boolean;
  stop?: () => void;
  model?: string;
  openModelSettings?: () => void;
  children?: ReactNode;
}) {
  const modelName = model ? <Text style={styles.modelName} numberOfLines={1}>{model}</Text> : null;
  return (
    <View style={styles.composer}>
      {children}
      <TextInput accessibilityLabel={label} testID={testID} placeholder={placeholder} placeholderTextColor={colors.muted}
        value={draft} onChangeText={onChangeText} editable={editable} multiline style={styles.input} />
      <View style={styles.composerActions}>
        <View style={styles.model}>
          {openModelSettings ? (
            <Pressable accessibilityRole="button" accessibilityLabel={model ? `模型设置，当前模型 ${model}` : "打开模型设置"}
              onPress={openModelSettings} style={styles.modelButton}>
              {modelName ?? <Text style={styles.modelName}>配置 DeepSeek Flash</Text>}
            </Pressable>
          ) : modelName}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={stop ? "停止生成" : "发送"}
          accessibilityState={{ disabled: !stop && sendDisabled }} disabled={!stop && sendDisabled}
          onPress={stop ?? send} style={({ pressed }) => [styles.send, !stop && sendDisabled && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.sendSymbol} allowFontScaling={false}>{stop ? "■" : "↑"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ChatSheet({ title, close, children, keyboard = false }: {
  title: string; close: () => void; children: ReactNode; keyboard?: boolean;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding" enabled={keyboard}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭" onPress={close} />
        <SafeAreaView edges={["left", "right", "bottom"]} style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
            <ChatAction label="关闭" onPress={close} />
          </View>
          {children}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: "center", alignItems: "center", borderRadius: radius.md },
  subtleAction: { minHeight: 36, paddingHorizontal: spacing.xs },
  subtleLabel: { color: colors.muted, fontSize: typography.caption },
  primary: { backgroundColor: colors.primary, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  label: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  inverse: { color: colors.surface },
  danger: { color: colors.danger },
  scrollButton: { position: "absolute", right: spacing.md, bottom: spacing.xs, minHeight: 44, justifyContent: "center",
    paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, elevation: 2 },
  scrollLabel: { fontSize: typography.caption, color: colors.text, fontWeight: "600" },
  search: { minHeight: 44, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, borderRadius: 10 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, color: colors.text, paddingHorizontal: spacing.sm, fontSize: 15 },
  composer: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.large,
    padding: spacing.xs, gap: spacing.xs },
  input: { minHeight: 50, maxHeight: 124, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    color: colors.text, fontSize: 16, lineHeight: 23, textAlignVertical: "top" },
  composerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  model: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm },
  modelButton: { minHeight: 44, justifyContent: "center" },
  modelName: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center" },
  sendSymbol: { color: colors.surface, fontSize: 21, fontWeight: "600", includeFontPadding: false },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%", backgroundColor: colors.background, borderTopLeftRadius: radius.large,
    borderTopRightRadius: radius.large, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.xs },
  sheetTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "700" },
});
