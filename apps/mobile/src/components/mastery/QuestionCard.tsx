import type { Answers, StudyCard } from "@learn-pace/app-host";
import type { PublicPendingQuestion } from "@learn-pace/domain";
import type { QuestionGrade } from "@learn-pace/infra";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing } from "../../theme";
import { ChatAction } from "../chat-controls";
import { MessageContent } from "../MessageContent";
import { styles } from "../Shell";

const labels = { correct: "正确", partial: "部分正确", incorrect: "还差一点", ungraded: "未评分，掌握状态不变" };
type AnswerInput = ComponentRef<typeof TextInput>;

export type AnswerControls = {
  next?: () => void;
  finishEditing: () => void;
  submit: () => void;
  submitLabel: string;
  canSubmit: boolean;
};

export function QuestionCard({ card, disabled, submitting, submit, retry, skip, challenge, onAnswerControls }: {
  card: StudyCard;
  disabled: boolean;
  submitting: boolean;
  submit: (answers: Answers, submissionId: string) => void;
  retry: () => void;
  skip: () => void;
  challenge: () => void;
  onAnswerControls: (interactionId: string, controls: AnswerControls | null) => void;
}) {
  const [edits, setEdits] = useState<Answers>({});
  const [free, setFree] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<string>();
  const inputs = useRef(new Map<string, AnswerInput>());
  const submission = useRef<{ content: string; id: string } | null>(null);
  const parts = card.question.questions?.length ? card.question.questions : [card.question];
  const group = card.question.question_type === "group";
  const draft = { ...card.answers, ...edits };
  const editable = card.status === "awaiting_input" && !disabled;
  const complete = parts.every(({ question_id }) => {
    const grade = card.grade?.questions[question_id];
    return grade?.final || grade?.voided || draft[question_id]?.trim();
  });
  const result = !group ? card.grade?.questions[card.question.question_id] : undefined;
  const border = result?.voided || !result?.final ? colors.border :
    result.result === "correct" ? colors.success : result.result === "incorrect" ? colors.danger : colors.primary;
  const submitLabel = group ? "提交整组作答" : "提交作答";
  const canSubmit = editable && complete;
  const focusedIndex = parts.findIndex(({ question_id }) => question_id === focused);
  const nextInput = parts.slice(focusedIndex + 1).find((question) => {
    const id = question.question_id;
    const grade = card.grade?.questions[id];
    return !grade?.final && !grade?.voided && (question.question_type !== "choice" ||
      (free[id] ?? Boolean(draft[id] && !question.options.some(({ label }) => label === draft[id]))));
  })?.question_id;

  function submitDraft() {
    if (!canSubmit) return;
    const active = parts.filter(({ question_id }) => !card.grade?.questions[question_id]?.voided);
    const content = JSON.stringify(active.map(({ question_id }) => [question_id, draft[question_id]]));
    if (submission.current?.content !== content) submission.current = { content, id: randomUUID() };
    const answers = Object.fromEntries(active.filter(({ question_id }) => !card.grade?.questions[question_id]?.final)
      .map(({ question_id }) => [question_id, draft[question_id] ?? ""]));
    submit(answers, submission.current.id);
  }
  const latestSubmit = useRef(submitDraft);
  latestSubmit.current = submitDraft;

  useEffect(() => {
    if (!focused || !editable) return;
    onAnswerControls(card.interaction_id, {
      next: nextInput ? () => inputs.current.get(nextInput)?.focus() : undefined,
      finishEditing: () => {
        inputs.current.get(focused)?.blur();
        setFocused(undefined);
      },
      submit: () => latestSubmit.current(),
      submitLabel,
      canSubmit,
    });
    return () => onAnswerControls(card.interaction_id, null);
  }, [canSubmit, card.interaction_id, editable, focused, nextInput, onAnswerControls, submitLabel]);

  function change(id: string, answer: string) {
    if (draft[id] !== answer) submission.current = null;
    setEdits((current) => ({ ...current, [id]: answer }));
  }

  return <View style={[local.card, { borderColor: border }]} testID="mastery-question-card">
    <Text accessibilityRole="header" style={local.caption}>{group ? "题组" : "题卡"}</Text>
    {group && <MessageContent content={card.question.prompt} />}
    {parts.map((question, index) => {
      const id = question.question_id;
      const part = card.grade?.questions[id];
      const value = (part?.final || card.status !== "awaiting_input" ? card.answers[id] : draft[id]) ?? "";
      const canEdit = editable && !part?.final && !part?.voided;
      const asText = free[id] ?? Boolean(value && !question.options.some((option) => option.label === value));
      return <View key={id} style={local.part}>
        {group && <Text style={styles.body}>{`第 ${index + 1} 题`}</Text>}
        <MessageContent content={question.prompt} />
        <QuestionInput question={question} value={value} grade={part} canEdit={canEdit} asText={asText}
          inputRef={(view) => { if (view) inputs.current.set(id, view); else inputs.current.delete(id); }}
          focus={() => setFocused(id)} blur={() => setFocused((current) => current === id ? undefined : current)}
          onChange={(answer) => change(id, answer)} toggle={() => {
            setFree((current) => ({ ...current, [id]: !asText }));
            change(id, "");
          }} />
        {part && (card.status !== "answered" || part.final || part.voided) && <Grade grade={part} />}
      </View>;
    })}
    {card.status === "awaiting_input" && <View style={local.actions}>
      <ChatAction label="跳过" disabled={!editable} onPress={skip} />
      <ChatAction label={submitLabel} primary disabled={!canSubmit} onPress={submitDraft} />
    </View>}
    {card.status === "answered" && <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        {submitting ? "正在批改…" : "批改未完成，原作答已保存"}
      </Text>
      {!submitting && <View style={local.actions}>
        <ChatAction label="重试批改" primary disabled={disabled} onPress={retry} />
        <ChatAction label="跳过" disabled={disabled} onPress={skip} />
      </View>}
    </>}
    {card.status === "abandoned" && <Text style={styles.body}>
      {Object.values(card.grade?.questions ?? {}).some(({ voided }) => voided) ? "题卡已作废" : "已跳过"}
    </Text>}
    {card.status === "graded" && <ChatAction label="复核或申诉本次判定" disabled={disabled} onPress={challenge} />}
  </View>;
}

function QuestionInput({ question, value, grade, canEdit, asText, onChange, toggle, inputRef, focus, blur }: {
  question: PublicPendingQuestion;
  value: string;
  grade?: QuestionGrade;
  canEdit: boolean;
  asText: boolean;
  onChange: (answer: string) => void;
  toggle: () => void;
  inputRef: (view: AnswerInput | null) => void;
  focus: () => void;
  blur: () => void;
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
    {canEdit && choice && <ChatAction label={asText ? "返回选项" : "用我自己的话回答"} onPress={toggle} />}
    {canEdit && (!choice || asText) && <TextInput ref={inputRef} accessibilityLabel="题卡作答" placeholder="输入答案"
      placeholderTextColor={colors.muted} style={local.input} multiline value={value} onChangeText={onChange}
      onFocus={focus} onBlur={blur} />}
    {!canEdit && value && (!choice || asText) && <Text selectable style={styles.body}>{value}</Text>}
  </>;
}

function Grade({ grade }: { grade: QuestionGrade }) {
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
  card: { backgroundColor: colors.surface, borderLeftWidth: 3, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  caption: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  part: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: spacing.sm },
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
