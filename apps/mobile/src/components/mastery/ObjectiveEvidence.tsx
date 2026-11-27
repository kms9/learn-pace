import type { MasterySessionService } from "@learn-pace/app-host";
import type { LearnerProfile } from "@learn-pace/domain";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, spacing } from "../../theme";
import { ChatAction, ChatSheet } from "../chat-controls";
import { MessageContent } from "../MessageContent";
import { Card, styles } from "../Shell";

export type Evidence = Awaited<ReturnType<MasterySessionService["objectiveEvidence"]>>;
const types = { memory: "记忆", concept: "概念", procedure: "程序", design: "设计" };
const states = { new: "未学", learning: "学习中", mastered: "已掌握" };
const grades = { correct: "正确", partial: "部分正确", incorrect: "错误" };
const errors = { structural: "结构", deviation: "偏差", application: "应用", metacognitive: "元认知" };
const errorStates = { active: "待纠正", retrying: "重试中", review: "复习中", graduated: "已结业" };
const percent = (value: number) => Math.round(value * 100) + "%";

export function ObjectiveEvidence({ evidence, loadingError, close, busy, setMastery }: {
  evidence?: Evidence;
  loadingError?: string;
  close: () => void;
  busy: boolean;
  setMastery: (mastered: boolean, note?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const selfReported = evidence?.learnerOverride;
  const hasEvidence = evidence && (evidence.attempts.length || evidence.qualitative.length ||
    evidence.errors.length || evidence.explained || evidence.review);
  return <ChatSheet title={evidence?.name ?? "知识点证据"} close={close}>
    <ScrollView style={local.scroll} contentContainerStyle={local.body} keyboardShouldPersistTaps="handled">
      {!evidence && !loadingError && <Text style={styles.body}>正在读取证据…</Text>}
      {evidence && <>
        <Text style={styles.body}>{types[evidence.type]} · {states[evidence.status]}
          {evidence.mastery_source === "system" ? " · 测评通过" : evidence.mastery_source === "learner" ? " · 由你确认" : ""}</Text>
        <Text style={styles.heading}>{`当前得分 ${percent(evidence.mastery)} · 门槛 ${percent(evidence.threshold)}`}</Text>
        {!hasEvidence && <Text style={styles.body}>还没有这个知识点的学习证据。</Text>}
        {evidence.attempts.length > 0 && <Card title="作答记录">
          {evidence.attempts.map((attempt, index) => <View key={attempt.questionId + "-" + index} style={local.entry}>
            <Text style={styles.body}>{attempt.voided ? "已作废" : grades[attempt.result]} · {attempt.independent ? "独立作答" : "辅助作答"}</Text>
            <Text selectable style={styles.body}>{attempt.answer || "空答"}</Text>
          </View>)}
        </Card>}
        {evidence.qualitative.length > 0 && <Card title="定性评估">
          {evidence.qualitative.map((item) => <View key={item.id} style={local.entry}>
            <Text style={styles.body}>{grades[item.result]} · {item.independent ? "独立作答" : "辅助作答"}
              {item.model ? " · " + item.model : ""}</Text>
            <Text selectable style={styles.body}>{item.answer}</Text>
            <MessageContent content={item.feedback} />
            {item.criteria.length > 0 && <Text style={styles.body}>满足的标准 · {item.criteria.join("、")}</Text>}
          </View>)}
        </Card>}
        {evidence.errors.length > 0 && <Card title="错因记录">
          {evidence.errors.map((item) => <View key={item.id} style={local.entry}>
            <Text style={styles.body}>{errors[item.error_type]} · {errorStates[item.status]}</Text>
            {!!item.self_attribution && <Text style={styles.body}>{item.self_attribution}</Text>}
          </View>)}
        </Card>}
        {evidence.explained && <Card title="讲解记录">
          {typeof evidence.explained.summary === "string" && <Text style={styles.body}>{evidence.explained.summary}</Text>}
          {typeof evidence.explained.explanation_quote === "string" &&
            <MessageContent content={evidence.explained.explanation_quote} />}
        </Card>}
        {evidence.review && <Card title="复习摘要">
          {evidence.review.due_at !== null &&
            <Text style={styles.body}>下次复习 · {new Date(evidence.review.due_at * 1000).toLocaleString("zh-CN")}</Text>}
          <Text style={styles.body}>预计回忆率 · {percent(evidence.review.retrievability)}</Text>
          <Text style={styles.body}>复习失误 · {evidence.review.lapse_count} 次</Text>
        </Card>}
        {selfReported ? <Card title="由你确认">
          <Text style={styles.body}>已由你标记为掌握；测评证据保持不变。</Text>
          {!!evidence.override_note && <Text style={styles.body}>{evidence.override_note}</Text>}
          <ChatAction label="回到正常测评" disabled={busy} onPress={() => { setEditing(false); setMastery(false); }} />
        </Card> : !evidence.assessed_mastered && (editing ? <Card>
          <TextInput accessibilityLabel="可选：为什么跳过这一项？" placeholder="可选：为什么跳过这一项？"
            placeholderTextColor={colors.muted} multiline value={note} style={local.input}
            onChangeText={(value) => setNote([...value].slice(0, 500).join(""))} />
          <ChatAction label="确认已掌握" primary disabled={busy} onPress={() => setMastery(true, note)} />
          <ChatAction label="取消" onPress={() => setEditing(false)} />
        </Card> : <ChatAction label="我已经掌握，直接放行" disabled={busy} onPress={() => setEditing(true)} />)}
      </>}
      {loadingError && <Text accessibilityRole="alert" style={local.error}>{loadingError}</Text>}
    </ScrollView>
  </ChatSheet>;
}

export function LearnerProfileCard({ profile }: { profile: LearnerProfile }) {
  const fields = [
    ["已有基础", profile.prior_knowledge], ["目标程度", profile.target_level],
    ["可投入时间", profile.time_budget], ["学习偏好", profile.preferences], ["备注", profile.notes],
  ];
  return <Card title="学习档案">
    {fields.filter(([, value]) => value).map(([label, value]) => <Text key={label} style={styles.body}>{label} · {value}</Text>)}
    <Text style={styles.body}>{profile.teaching_strategy === "teach_first" ? "先讲解，再检查理解" : "先探查，再安排讲解"}</Text>
  </Card>;
}

const local = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { paddingBottom: spacing.md, gap: spacing.sm },
  entry: { gap: spacing.xs, paddingBottom: spacing.xs },
  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, padding: spacing.sm, borderRadius: 10,
    minHeight: 70, textAlignVertical: "top", fontSize: 16 },
  error: { color: colors.danger },
});
