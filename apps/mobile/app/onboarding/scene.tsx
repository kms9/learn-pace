import { curriculumProfiles } from "@learn-pace/app-host";
import type { CurriculumProfileId } from "@learn-pace/domain";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Action, Page, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";
import { colors, spacing } from "../../src/theme";

export default function SceneSelection() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  const { snapshot, service, reload } = useApp();
  const [selected, setSelected] = useState(snapshot.curriculumProfile);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fromSettings = source === "settings";

  async function save(profile: CurriculumProfileId) {
    setBusy(true);
    setFailed(false);
    try {
      await service.saveCurriculumProfile(profile);
      await reload();
      if (fromSettings && router.canGoBack()) router.back();
      else router.replace(fromSettings ? "/me" : "/");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="选择学习场景" secondary>
      <Stack.Screen options={{ headerBackVisible: fromSettings }} />
      <Text style={styles.body}>这个偏好可以随时在「我的」中更改。</Text>
      {curriculumProfiles.map(({ id, label }) => (
        <Pressable
          key={id}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === id, disabled: busy }}
          disabled={busy}
          style={[sceneStyles.option, selected === id && sceneStyles.selected]}
          onPress={() => setSelected(id)}
        >
          <Text style={styles.heading}>{label}</Text>
        </Pressable>
      ))}
      <Action label="确认场景" disabled={!selected || busy} onPress={() => { if (selected) void save(selected); }} />
      {!fromSettings && <Action label="直接进入自由模式" disabled={busy} onPress={() => void save("free")} secondary />}
      {failed && <Text accessibilityRole="alert" style={styles.body}>无法保存场景，请重试。</Text>}
    </Page>
  );
}

const sceneStyles = StyleSheet.create({
  option: { minHeight: 48, justifyContent: "center", padding: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  selected: { borderColor: colors.primary, backgroundColor: colors.soft },
});
