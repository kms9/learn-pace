import type { KnowledgeType, MapSummary } from "@learn-pace/domain";
import type { ComponentRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";
import { styles } from "./Shell";

const types: Record<KnowledgeType, string> = { memory: "记忆", concept: "概念", procedure: "程序", design: "设计" };
const statuses = { new: "未学", learning: "学习中", mastered: "已掌握" };

export function MasteryProgress({ mastered, total, percentage, dueCount }: {
  mastered: number; total: number; percentage: number; dueCount: number;
}) {
  return <View style={local.stack}>
    <Text style={styles.body}>{`已掌握 ${mastered} / 共 ${total}（${percentage}%）`}</Text>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total || 1, now: mastered }} style={local.track}>
      <View style={[local.fill, { width: `${percentage}%` }]} />
    </View>
    <Text style={styles.body}>{`${dueCount} 项复习已到期`}</Text>
  </View>;
}

export function MasteryOutline({ map, current, onObjective, objectiveRef }: {
  map: MapSummary;
  current?: string;
  onObjective?: (id: string) => void;
  objectiveRef?: (id: string, view: ComponentRef<typeof View> | null) => void;
}) {
  const names = new Map(map.modules.flatMap((module) => module.knowledge_points.map(({ id, name }) => [id, name])));
  if (!map.counts.total) return <Text style={styles.body}>大纲还未定下。</Text>;
  return <View style={local.stack}>
    {map.modules.map((module) => <View key={module.id} style={local.module}>
      <Text accessibilityRole="header" style={styles.heading}>{module.name}</Text>
      {!!module.objective && <Text style={styles.body}>{module.objective}</Text>}
      {module.knowledge_points.map((point) => {
        const content = <>
        <Text style={local.pointTitle}>{point.name}</Text>
        <Text style={styles.body}>{types[point.type]} · {statuses[point.status]}{current === point.id ? " · 当前" : ""}</Text>
        {point.prerequisite_ids.length > 0 && <Text style={styles.body}>
          先修 · {point.prerequisite_ids.map((id) => names.get(id) ?? id).join("、")}
        </Text>}
        </>;
        const style = [local.point, current === point.id && local.current];
        return onObjective ? <Pressable key={point.id} accessibilityRole="button" accessibilityLabel={point.name}
          ref={objectiveRef ? (view) => objectiveRef(point.id, view) : undefined}
          onPress={() => onObjective(point.id)} style={style}>{content}</Pressable>
          : <View key={point.id} style={style}>{content}</View>;
      })}
    </View>)}
  </View>;
}

const local = StyleSheet.create({
  stack: { gap: spacing.xs },
  track: { height: 7, backgroundColor: colors.soft, borderRadius: 9, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
  module: { gap: spacing.xs, paddingBottom: spacing.sm },
  point: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 8 },
  current: { backgroundColor: colors.soft },
  pointTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
});
