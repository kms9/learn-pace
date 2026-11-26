import { findKnowledgePoint, isMastered } from "@learn-pace/domain";
import type { AppStore, QuestionGrade } from "@learn-pace/infra";
import { publicQuickCheck } from "./chat-quick-check.js";
import { evidenceKey, questionLeaves, savedAnswers } from "./mastery/study.js";
import { restoreGateFor } from "./restore-gate.js";

type MistakeDetails = {
  id: string;
  questionId: string;
  sessionId: string;
  prompt: string;
  learnerAnswer: string;
  feedback: string;
  explanation: string;
  referenceAnswer: string;
  occurredAt: number;
};

export type Mistake = MistakeDetails & (
  | { kind: "mastery"; pathId: string; pathName: string; objectiveId: string; objectiveName: string;
      mastered: boolean; interactionId: string }
  | { kind: "quick_check"; messageId: string; sessionTitle: string }
);

function referenceText(
  grade: QuestionGrade | undefined,
  options: readonly { label: string; body: string }[],
  fallback: string,
): string {
  const answer = grade?.reference_answer || fallback || grade?.correct_option || "";
  return options.find(({ label }) => label === answer)?.body ?? answer;
}

export class MistakeReviewService {
  constructor(private readonly store: AppStore) {}

  listMistakes({ pathId, includeQuickChecks = true }: { pathId?: string; includeQuickChecks?: boolean } = {}): Promise<Mistake[]> {
    return restoreGateFor(this.store).writeAfterRestore(() => this.store.runInTransaction(async (tx) => {
      const paths = new Map((await Promise.all((pathId ? [pathId] : await tx.listIds()).map((id) => tx.get(id))))
        .flatMap((path) => path ? [[path.book_id, path] as const] : []));
      const evidence = new Map([...paths].map(([id, path]) => [id, new Map(path.learning_evidence
        .filter((item) => item.assessment_type !== "qualitative" && item.result !== "correct")
        .map((item) => [item.evidence_id, item]))]));
      const voided = new Map([...paths].map(([id, path]) => [id, new Set(path.quiz_attempts.filter((item) => item.voided)
        .map((item) => item.evidence_id ?? item.knowledge_point_id + "/" + item.question_id))]));
      const mistakes: Mistake[] = [];
      for (const interaction of await tx.listGradedInteractions(pathId)) {
        const path = paths.get(interaction.path_id);
        if (!path) continue;
        const answers = savedAnswers(interaction);
        for (const question of questionLeaves(interaction.question)) {
          const id = evidenceKey(interaction, question);
          const item = evidence.get(path.book_id)?.get(id);
          const grade = interaction.grade?.questions[question.question_id];
          const invalid = voided.get(path.book_id)!;
          if (!item || grade?.voided || invalid.has(id) ||
              invalid.has(question.knowledge_point_id + "/" + question.question_id)) continue;
          const objective = findKnowledgePoint(path, item.knowledge_point_id).kp;
          mistakes.push({
            id, kind: "mastery", pathId: path.book_id, pathName: path.name, objectiveId: item.knowledge_point_id,
            objectiveName: objective?.name ?? "", mastered: !!objective && isMastered(path, objective),
            interactionId: interaction.interaction_id, questionId: question.question_id, sessionId: interaction.session_id,
            prompt: question.prompt, learnerAnswer: item.learner_answer || answers[question.question_id] || "",
            feedback: grade?.feedback || item.feedback, explanation: grade?.explanation || question.explanation,
            referenceAnswer: referenceText(grade, question.options, item.reference_answer || question.expected_answer),
            occurredAt: item.timestamp,
          });
        }
      }
      if (!pathId && includeQuickChecks) {
        for (const { session_id, title } of (await tx.listSessions()).filter(({ kind }) => kind === "lf01")) {
          for (const message of await tx.listMessages(session_id)) {
            const check = publicQuickCheck(message);
            if (check?.status !== "graded") continue;
            for (const { question_id, prompt, options } of check.questions) {
              const grade = check.grades[question_id];
              if (!grade?.final || grade.voided || grade.result === "correct" || grade.result === "ungraded") continue;
              mistakes.push({
                id: message.message_id + ":" + question_id, kind: "quick_check", questionId: question_id,
                sessionId: session_id, sessionTitle: title, messageId: message.message_id, prompt,
                learnerAnswer: check.answers[question_id] ?? "", feedback: grade.feedback,
                explanation: grade.explanation ?? "", referenceAnswer: referenceText(grade, options, ""),
                occurredAt: message.created_at,
              });
            }
          }
        }
      }
      return mistakes.sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id));
    }));
  }
}
