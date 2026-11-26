import type { KnowledgeType, MapSummary } from "@learn-pace/domain";
import { useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";
import { StatusBadge, styles } from "./Shell";

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
    {dueCount > 0 && <StatusBadge tone="warning" label={`${dueCount} 项复习已到期`} />}
  </View>;
}

export function MasteryOutline({ map, current, onObjective, objectiveRef, collapsible, revealObjective }: {
  map: MapSummary;
  current?: string;
  onObjective?: (id: string) => void;
  objectiveRef?: (id: string, view: ComponentRef<typeof View> | null) => void;
  collapsible?: boolean;
  revealObjective?: { id: string };
}) {
  const [expansion, setExpansion] = useState<Record<string, { open: boolean; reveal?: { id: string } }>>({});
  const names = new Map(map.modules.flatMap((module) => module.knowledge_points.map(({ id, name }) => [id, name])));
  const defaultModule = map.modules.find((module) => module.knowledge_points.some(({ id }) => id === current))
    ?? map.modules.find((module) => module.knowledge_points.some(({ status }) => status !== "mastered"));
  if (!map.counts.total) return <Text style={styles.body}>大纲还未定下。</Text>;
  return <View style={local.stack}>
    {map.modules.map((module) => {
      const override = expansion[module.id];
      const reveal = revealObjective && module.knowledge_points.some(({ id }) => id === revealObjective.id) ? revealObjective : undefined;
      const open = !collapsible || Boolean(reveal && override?.reveal !== reveal) || (override?.open ?? defaultModule?.id === module.id);
      return <View key={module.id} style={local.module}>
        {collapsible ? <Pressable accessibilityRole="button" accessibilityLabel={module.name}
          accessibilityState={{ expanded: open }} style={local.moduleToggle}
          onPress={() => setExpansion((current) => ({ ...current, [module.id]: { open: !open, reveal } }))}>
          <Text style={[styles.heading, local.moduleName]}>{module.name}</Text>
          <Text style={styles.body}>{open ? "⌃" : "⌄"}</Text>
        </Pressable> : <Text accessibilityRole="header" style={styles.heading}>{module.name}</Text>}
        {open && !!module.objective && <Text style={styles.body}>{module.objective}</Text>}
        {open && module.knowledge_points.map((point) => {
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
      </View>;
    })}
  </View>;
}

const local = StyleSheet.create({
  stack: { gap: spacing.xs },
  track: { height: 7, backgroundColor: colors.soft, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
  module: { gap: spacing.xs, paddingBottom: spacing.sm },
  moduleToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  moduleName: { flex: 1 },
  point: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  current: { backgroundColor: colors.soft },
  pointTitle: { fontSize: typography.body, fontWeight: "600", color: colors.text },
});
