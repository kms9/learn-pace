import type { MasterySessionService } from "@learn-pace/app-host";
import { MAX_DESIRED_RETENTION, MIN_DESIRED_RETENTION } from "@learn-pace/domain";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme";
import { ChatAction } from "../chat-controls";
import { Card, styles } from "../Shell";

type Plan = Awaited<ReturnType<MasterySessionService["reviewPlan"]>>;
const strategies = [
  [null, "默认"], ["preset-daily-long-term", "日常长期学习"], ["preset-exam-cramming", "考前冲刺"],
  ["preset-language", "语言类"], ["preset-science", "理科类"],
] as const;

function timeLabel(seconds: number) {
  if (seconds <= 0) return "现在可复习";
  if (seconds >= 86_400) return `${Math.ceil(seconds / 86_400)} 天后`;
  if (seconds >= 3_600) return `${Math.ceil(seconds / 3_600)} 小时后`;
  return `${Math.max(1, Math.ceil(seconds / 60))} 分钟后`;
}

export function ReviewPlan({ plan, busy, locate, start, chooseStrategy, setRetention }: {
  plan: Plan;
  busy: boolean;
  locate: (id: string) => void;
  start: (id: string) => void;
  chooseStrategy: (id: string | null) => void;
  setRetention: (value: number) => void;
}) {
  return <Card title="复习计划">
    <View style={local.line}>
      <Text style={styles.body}>按遗忘曲线安排</Text>
      <Text style={styles.body}>{`${plan.due.length} 项到期`}</Text>
    </View>
    {plan.due.length === 0 && <Text style={styles.body}>今天没有待复习的内容。继续学习，到时间会自动提醒你复习。</Text>}
    {[...plan.due, ...plan.upcoming].map((item) => <View key={item.knowledge_point_id} style={local.item}>
      <Pressable accessibilityRole="button" accessibilityLabel={`在大纲中定位${item.knowledge_point_name}`}
        onPress={() => locate(item.knowledge_point_id)} style={local.itemContent}>
        <Text style={styles.heading}>{item.knowledge_point_name}</Text>
        <Text style={styles.body}>{timeLabel(item.due_at - plan.now)} · 遗忘风险 {Math.round(item.forgetting_risk * 100)}%</Text>
        {!!item.reason && <Text style={styles.body}>{item.reason}</Text>}
        {item.lapse_count > 0 && <Text style={local.lapse}>{`有失误记录 · ${item.lapse_count} 次`}</Text>}
      </Pressable>
      <ChatAction label={item.due_at <= plan.now ? "开始复习" : "提前复习"}
        disabled={busy} onPress={() => start(item.knowledge_point_id)} />
    </View>)}
    <Text style={styles.heading}>复习策略</Text>
    <View style={local.strategies} accessibilityRole="radiogroup">
      {strategies.map(([id, label]) => {
        const selected = plan.strategy_id === id;
        return <Pressable key={id ?? "default"} accessibilityRole="radio" accessibilityLabel={label}
          accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
          onPress={() => { if (!selected) chooseStrategy(id); }} style={[local.strategy, selected && local.selected]}>
          <Text style={local.strategyLabel}>{label}</Text>
        </Pressable>;
      })}
    </View>
    <RetentionSlider retention={plan.desired_retention} disabled={busy} save={setRetention} />
  </Card>;
}

const min = Math.round(MIN_DESIRED_RETENTION * 100);
const max = Math.round(MAX_DESIRED_RETENTION * 100);

function RetentionSlider({ retention, disabled, save }: { retention: number; disabled: boolean; save: (value: number) => void }) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number>();
  const current = Math.round(retention * 100);
  const shown = drag ?? current;
  const percent = `${(shown - min) / (max - min) * 100}%` as const;
  const fromX = (x: number) => Math.round(min + (max - min) * Math.min(Math.max(x / width, 0), 1));
  const commit = (next: number) => {
    setDrag(undefined);
    if (!disabled && current !== next) save(next / 100);
  };
  return <>
    <View style={local.line}>
      <Text style={styles.heading}>记忆保持目标</Text>
      <Text style={styles.body}>{`${shown}%`}</Text>
    </View>
    <View accessible accessibilityRole="adjustable" accessibilityLabel="记忆保持目标"
      accessibilityValue={{ min, max, now: shown, text: `${shown}%` }} accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        commit(nativeEvent.actionName === "increment" ? Math.min(max, current + 1) : Math.max(min, current - 1));
      }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled && width > 0}
      onResponderGrant={({ nativeEvent }) => setDrag(fromX(nativeEvent.locationX))}
      onResponderMove={({ nativeEvent }) => setDrag(fromX(nativeEvent.locationX))}
      onResponderRelease={({ nativeEvent }) => commit(fromX(nativeEvent.locationX))}
      onResponderTerminate={() => setDrag(undefined)}
      style={local.slider}>
      <View pointerEvents="none" style={local.track}>
        <View style={[local.fill, { width: percent }]} />
        <View style={[local.thumb, { left: percent }]} />
      </View>
    </View>
    <View style={local.line}>
      <Text style={styles.body}>{`${min}%`}</Text>
      <Text style={styles.body}>{`${max}%`}</Text>
    </View>
  </>;
}

const local = StyleSheet.create({
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.xs },
  item: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  itemContent: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  lapse: { color: colors.danger, fontSize: 14 },
  strategies: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  strategy: { minHeight: 42, justifyContent: "center", borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.sm },
  selected: { backgroundColor: colors.soft, borderColor: colors.primary },
  strategyLabel: { color: colors.text, fontSize: 14 },
  slider: { justifyContent: "center", minHeight: 44, marginHorizontal: 10 },
  track: { backgroundColor: colors.soft, height: 6, borderRadius: 3 },
  fill: { height: "100%", backgroundColor: colors.primary, borderRadius: 3 },
  thumb: { position: "absolute", backgroundColor: colors.primary, width: 20, height: 20, borderRadius: 10, top: -7, marginLeft: -10 },
});
