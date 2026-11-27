import type { PublicPendingQuestion } from "@learn-pace/domain";
import type { QuestionGrade } from "@learn-pace/infra";
import type { ComponentRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, spacing } from "../theme";
import { ChatAction } from "./chat-controls";
import { MessageContent } from "./MessageContent";
import { styles } from "./Shell";

const labels = { correct: "正确", partial: "部分正确", incorrect: "还差一点", ungraded: "未评分，掌握状态不变" };
type AnswerInput = ComponentRef<typeof TextInput>;

export function QuestionInput({ question, value, grade, canEdit, asText, onChange, toggle, inputRef, focus, blur }: {
  question: PublicPendingQuestion;
  value: string;
  grade?: QuestionGrade;
  canEdit: boolean;
  asText: boolean;
  onChange: (answer: string) => void;
  toggle?: () => void;
  inputRef?: (view: AnswerInput | null) => void;
  focus?: () => void;
  blur?: () => void;
}) {
  const choice = question.question_type === "choice";
  return <>
    {choice && (!asText || grade?.final) && question.options.map(({ id, label, body }) => {
      const selected = value === label;
      const correct = grade?.final && grade.result !== "correct" && grade.correct_option === label;
      return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={label + "．" + body}
        accessibilityState={{ checked: selected, disabled: !canEdit }} disabled={!canEdit}
        onPress={() => onChange(label)} style={[local.option, selected && local.selected, correct && local.correct]}>
        <View style={[local.optionBadge, selected && local.selectedBadge]}>
          <Text style={[local.optionLabel, selected && local.selectedLabel]}>{label}</Text>
        </View>
        <View style={local.optionText}>
          <MessageContent content={body} />
          {correct && <Text style={local.correctText}>正确选项</Text>}
        </View>
      </Pressable>;
    })}
    {canEdit && choice && toggle && <ChatAction label={asText ? "返回选项" : "用我自己的话回答"} onPress={toggle} />}
    {canEdit && (!choice || asText) && <TextInput ref={inputRef} accessibilityLabel="题卡作答" placeholder="输入答案"
      placeholderTextColor={colors.muted} style={local.input} multiline value={value} onChangeText={onChange}
      onFocus={focus} onBlur={blur} />}
    {!canEdit && value && (!choice || asText) && <Text selectable style={styles.body}>{value}</Text>}
  </>;
}

export function QuestionGradeResult({ grade }: { grade: QuestionGrade }) {
  const title = grade.voided ? "该题已作废" : labels[grade.result];
  return <View style={local.feedback}>
    <Text accessibilityLiveRegion="polite" style={[
      styles.heading, grade.result === "correct" && local.correctText, grade.result === "incorrect" && local.incorrect,
    ]}>{title}</Text>
    {grade.feedback && grade.feedback !== grade.explanation && <MessageContent content={grade.feedback} />}
    {grade.final && grade.explanation && <MessageContent content={grade.explanation} />}
    {grade.final && grade.result !== "correct" && !grade.correct_option && grade.reference_answer &&
      <MessageContent content={"参考答案：" + grade.reference_answer} />}
  </View>;
}

const local = StyleSheet.create({
  option: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm, borderRadius: 10 },
  optionBadge: { minWidth: 30, minHeight: 30, borderRadius: 15, paddingHorizontal: spacing.xs,
    borderColor: colors.border, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  selectedBadge: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  selectedLabel: { color: colors.surface },
  optionText: { flex: 1, minWidth: 0, gap: spacing.xs },
  selected: { backgroundColor: colors.soft, borderColor: colors.primary },
  correct: { borderColor: colors.success },
  correctText: { color: colors.success, fontWeight: "700" },
  incorrect: { color: colors.danger },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: spacing.sm, minHeight: 48, fontSize: 16, textAlignVertical: "top" },
  feedback: { gap: spacing.xs, paddingTop: spacing.xs },
});
