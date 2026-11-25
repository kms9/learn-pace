import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Modal, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../../theme";
import { ChatAction } from "../chat-controls";
import { styles } from "../Shell";

export function LevelUpCelebration({ names, dismiss }: { names: readonly string[]; dismiss: () => void }) {
  const [reduced, setReduced] = useState<boolean | undefined>();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => {
      if (active) setReduced(true);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!names.length || reduced !== false) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 380, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [names, progress, reduced]);

  if (!names.length || reduced === undefined) return null;
  const notice = <>
    <Text accessibilityLiveRegion="polite" accessibilityRole="header" style={local.title}>新掌握的知识点</Text>
    {names.map((name, index) => <Text key={index} style={styles.body}>{name}</Text>)}
    <ChatAction label="继续学习" primary onPress={dismiss} />
  </>;
  if (reduced) return <View style={local.banner}>{notice}</View>;
  return <Modal transparent onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
    <View style={local.overlay}>
      <Animated.View accessibilityViewIsModal style={[local.banner, {
        opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
      }]}>{notice}</Animated.View>
    </View>
  </Modal>;
}

const local = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: colors.overlay },
  banner: { alignItems: "center", padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.success, borderRadius: radius.large, gap: spacing.sm },
  title: { color: colors.success, fontSize: 24, fontWeight: "700", textAlign: "center" },
});
