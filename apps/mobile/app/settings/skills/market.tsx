import { defaultSkillRegistry, skillRegistries, type RegistrySkillPage, type SkillRegistry } from "@learn-pace/app-host";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Action, Card, LoadingCard, Page, RetryCard, styles } from "../../../src/components/Shell";
import { ChatSearch } from "../../../src/components/chat-controls";
import { useApp } from "../../../src/context/AppContext";
import { skillErrorMessage } from "../../../src/skill-io";
import { colors, spacing } from "../../../src/theme";

const sources: readonly SkillRegistry[] = ["eduhub", "skillhub", "clawhub"];

export default function SkillMarket() {
  const router = useRouter();
  const { skills } = useApp();
  const [registry, selectRegistry] = useState<SkillRegistry>(defaultSkillRegistry);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<RegistrySkillPage>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, retry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setFailure("");
    setLoading(true);
    const timer = setTimeout(() => {
      void skills.registry.browse(registry, query, cursor, controller.signal).then((page) => {
        if (controller.signal.aborted) return;
        setResult((prior) => {
          if (!cursor || !prior) return page;
          const combined = new Map(prior.skills.map((item) => [item.publisher + "/" + item.slug, item]));
          for (const item of page.skills) combined.set(item.publisher + "/" + item.slug, item);
          return { skills: [...combined.values()], next: page.next };
        });
      }).catch((error) => {
        if (!controller.signal.aborted) setFailure(skillErrorMessage(error));
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, query && !cursor ? 280 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [skills, registry, query, cursor, attempt]);

  function resetResult() {
    setResult(undefined);
    setCursor(null);
    setFailure("");
    setLoading(true);
  }

  return <Page title="技能市场" secondary keyboard>
    <View style={local.sources}>
      {sources.map((source) => <Pressable key={source} accessibilityRole="tab"
        accessibilityState={{ selected: registry === source }} onPress={() => {
          if (registry !== source) { resetResult(); selectRegistry(source); }
        }} style={[local.source, registry === source && local.selected]}>
        <Text style={styles.body}>{skillRegistries[source].label}</Text>
      </Pressable>)}
    </View>
    <ChatSearch label={`搜索 ${skillRegistries[registry].label}`} value={query} change={(value) => {
      if (query !== value) { resetResult(); setQuery(value); }
    }} />
    {loading && !result && <LoadingCard label="正在读取技能市场…" />}
    {!!failure && <RetryCard message={failure} retry={() => retry((value) => value + 1)} />}
    {!loading && !failure && result?.skills.length === 0 && <Card><Text style={styles.body}>未找到匹配的技能。</Text></Card>}
    {result?.skills.map((item) => <Card key={item.publisher + "/" + item.slug} title={item.title}>
      <Text style={styles.body}>{[item.publisher, item.version].filter(Boolean).join(" · ") || skillRegistries[registry].label}</Text>
      {!!item.summary && <Text style={styles.body} numberOfLines={3}>{item.summary}</Text>}
      <Action label="预览安装" secondary onPress={() => router.push({
        pathname: "/settings/skills/import",
        params: { source: "registry", registry: item.registry, slug: item.slug, publisher: item.publisher ?? "", version: item.version ?? "" },
      })} />
    </Card>)}
    {!!result?.next && !failure && <Action label={loading ? "正在读取…" : "加载更多"} secondary disabled={loading} onPress={() => {
      setLoading(true);
      setCursor(result.next);
    }} />}
  </Page>;
}

const local = StyleSheet.create({
  sources: { flexDirection: "row", gap: spacing.sm },
  source: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center",
    borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.primary },
});
