import { Lf01ChatError, RestoreGateError, type Answers, type PublicQuickCheck } from "@learn-pace/app-host";
import { SubmissionConflictError } from "@learn-pace/infra";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { ChatAction } from "./chat-controls";
import { MessageContent } from "./MessageContent";
import { QuestionGradeResult, QuestionInput } from "./QuestionFields";
import { SaveKnowledgeCardAction } from "./SaveKnowledgeCardAction";
import { styles } from "./Shell";

export function QuickCheckCard({ intro, check, disabled, submit, retry, continueChat, learningGoal, saveExplanation }: {
  intro: string;
  check: PublicQuickCheck;
  disabled: boolean;
  submit: (answers: Answers, submissionId: string) => Promise<void>;
  retry: () => Promise<void>;
  continueChat: () => void;
  learningGoal: () => Promise<void>;
  saveExplanation: (questionId: string) => Promise<unknown>;
}) {
  const [edits, setEdits] = useState<Answers>({});
  const [pending, setPending] = useState<"grade" | "goal">();
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const submission = useRef<{ content: string; id: string } | undefined>(undefined);
  const draft = { ...check.answers, ...edits };
  const editable = check.status === "awaiting_input" && !pending && !disabled;
  const complete = check.questions.every(({ question_id }) => draft[question_id]?.trim());

  async function run(action: "grade" | "goal", work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setError(undefined);
    setPending(action);
    try {
      await work();
      if (action === "grade") setEdits({});
    } catch (cause) {
      setError(cause instanceof Lf01ChatError || cause instanceof RestoreGateError || cause instanceof SubmissionConflictError
        ? cause.message : "操作未完成，请重试");
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  }

  function submitDraft() {
    if (!editable || !complete || busy.current) return;
    const answers = Object.fromEntries(check.questions.map(({ question_id }) => [question_id, draft[question_id]!]));
    const content = JSON.stringify(answers);
    const matchesSaved = check.questions.every(({ question_id }) => check.answers[question_id] === answers[question_id]);
    if (submission.current?.content !== content) {
      submission.current = { content, id: (matchesSaved && check.submission_id) || randomUUID() };
    }
    const { id } = submission.current;
    Keyboard.dismiss();
    void run("grade", () => submit(answers, id));
  }

  return <View testID="quick-check-card" style={local.card}>
    <Text accessibilityRole="header" style={styles.heading}>问答自测</Text>
    <MessageContent content={intro} />
    {check.questions.map((question, index) => {
      const id = question.question_id;
      const grade = check.grades[id];
      return <View key={id} style={local.question}>
        {check.questions.length > 1 && <Text style={styles.body}>{`第 ${index + 1} 题`}</Text>}
        <MessageContent content={question.prompt} />
        <QuestionInput question={question} value={(check.status === "awaiting_input" ? draft[id] : check.answers[id]) ?? ""}
          grade={grade} canEdit={editable} asText={false} onChange={(answer) => setEdits((current) => ({ ...current, [id]: answer }))} />
        {grade && <QuestionGradeResult grade={grade} />}
        {grade?.final && !grade.voided && grade.result !== "ungraded" &&
          <SaveKnowledgeCardAction save={() => saveExplanation(id)} />}
      </View>;
    })}
    {error && <Text accessibilityRole="alert" style={[styles.body, local.error]}>{error}</Text>}
    {pending === "grade" && <Text accessibilityLiveRegion="polite" style={styles.body}>正在批改…</Text>}
    {check.status === "awaiting_input" && <View style={local.question}>
      {check.submission_id && !pending && <Text accessibilityLiveRegion="polite" style={styles.body}>
        部分作答仍需确认，可以补充后再提交。
      </Text>}
      <View style={local.actions}>
        <ChatAction testID="quick-check-submit" label="提交作答" primary disabled={!editable || !complete} onPress={submitDraft} />
      </View>
    </View>}
    {check.status === "answered" && !pending && <View style={local.question}>
      <Text accessibilityLiveRegion="polite" style={styles.body}>批改未完成，原作答已保存</Text>
      <View style={local.actions}>
        <ChatAction testID="quick-check-retry" label="重试批改" primary disabled={disabled} onPress={() => void run("grade", retry)} />
      </View>
    </View>}
    {check.status === "graded" && <View style={local.actions}>
      <ChatAction testID="quick-check-continue" label="继续聊" disabled={disabled || !!pending} onPress={continueChat} />
      <ChatAction testID="quick-check-goal" label="转为学习目标" disabled={disabled || !!pending}
        onPress={() => void run("goal", learningGoal)} />
    </View>}
  </View>;
}

const local = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm,
    borderLeftWidth: 3, borderLeftColor: colors.primary },
  question: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  error: { color: colors.danger },
});
