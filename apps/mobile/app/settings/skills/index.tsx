import type { SkillSummary } from "@learn-pace/app-host";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { ChatSearch } from "../../../src/components/chat-controls";
import { Action, Card, LoadingCard, Page, RetryCard, styles } from "../../../src/components/Shell";
import { SkillBadges, skillSourceLabel } from "../../../src/components/SkillDetails";
import { useApp } from "../../../src/context/AppContext";

export default function SkillLibrary() {
  const router = useRouter();
  const { skills } = useApp();
  const [query, setQuery] = useState("");
  const [list, setList] = useState<SkillSummary[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setFailed(false);
    void skills.list(query).then((result) => { if (active) setList(result); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [skills, query, attempt]));

  return <Page title="本地技能" secondary keyboard headerAction={<Action label="添加技能" onPress={() => router.push("/settings/skills/import")} />}>
    <Action label="技能市场" secondary onPress={() => router.push("/settings/skills/market")} />
    <ChatSearch label="搜索技能" value={query} change={setQuery} />
    {failed ? <RetryCard message="无法读取技能库" retry={() => setAttempt((value) => value + 1)} /> : !list ?
      <LoadingCard label="正在读取技能…" /> : list.length === 0 ?
      <Card><Text style={styles.body}>{query.trim() ? "未找到匹配的技能。" : "还没有技能。可以从本地文件或公开 GitHub 导入。"}</Text></Card> :
      list.map((item) => <Card key={item.skill.skill_id} title={item.skill.name}>
        <Text style={styles.body}>{item.skill.description}</Text>
        <Text style={styles.body}>{skillSourceLabel(item.skill.origin_kind, item.skill.origin_locator)}</Text>
        <SkillBadges summary={item} />
        <Action label={`查看 ${item.skill.name}`} secondary onPress={() => router.push({
          pathname: "/settings/skills/[skillId]", params: { skillId: item.skill.skill_id },
        })} />
      </Card>)}
  </Page>;
}
