import type { PublicPendingQuestion } from "@learn-pace/domain";
import { studyQuestionParameters } from "@learn-pace/runtime";
import type { StudyInteractions } from "../study.js";
import type { RegisterMasteryTool } from "./index.js";

export type StudyToolContext = {
  cards: StudyInteractions;
  scope: Parameters<StudyInteractions["postQuiz"]>[0];
};

const text = { type: "string", minLength: 1 };
const fields = (properties: Record<string, object>, required: string[] = [], acceptUnused = false) =>
  ({ type: "object", properties, required, additionalProperties: acceptUnused });

export function registerStudyTools(register: RegisterMasteryTool, { cards, scope }: StudyToolContext) {
  register("mastery_quiz", "登记并展示一道正式题卡。先在可见正文写简短引导语，私有答案只放参数。成功后立即结束整轮。",
    studyQuestionParameters, (args) => cards.postQuiz(scope, args as Parameters<StudyInteractions["postQuiz"]>[1]),
    "practice", (output) => {
      const result = output as { ok?: boolean; question?: PublicPendingQuestion };
      return result.ok && result.question ? { question: result.question } : undefined;
    });
  register("mastery_grade", "只批改学习者本轮明确的作答。可省略 question_id，题组用按小题 ID 映射的 answers。普通追问和申诉不要调用。",
    fields({ question_id: text, answer: text, answers: { type: "object", additionalProperties: text } }),
    (args) => cards.gradeFromTurn(scope, args as Parameters<StudyInteractions["gradeFromTurn"]>[1]), "practice");
  register("mastery_assess", "用学习者本轮自己的话评估概念或设计。只传知识点 ID。",
    fields({ knowledge_point_id: text }, ["knowledge_point_id"], true),
    ({ knowledge_point_id }) => cards.assess(scope, knowledge_point_id as string), "practice");
  register("mastery_note_explained", "记录已讲解的内容，引用必须逐字来自本轮已展示的导师正文。",
    fields({ knowledge_point_id: text, summary: text, explanation_quote: text }, ["knowledge_point_id", "summary", "explanation_quote"]),
    (args) => cards.noteExplained(scope, args.knowledge_point_id as string, args.summary as string, args.explanation_quote as string), "practice");
  register("mastery_defer_objective", "学习者明确想先跳过一个尚未掌握的知识点时，把它延后。",
    fields({ knowledge_point_id: text, reason: text }, ["knowledge_point_id"]),
    (args) => cards.defer(scope, args.knowledge_point_id as string, (args.reason as string | undefined) ?? ""), "practice");
  register("mastery_skip_question", "学习者明确要求跳过时，放弃当前题卡。",
    fields({}), () => cards.skip(scope), "practice");
  register("mastery_repair_question", "复核后可用 void 作废错误题目，或用 correct 更正答案并重新批改。选择题的新答案须为选项正文。",
    fields({ action: { type: "string", enum: ["void", "correct"] }, question_id: text, reason: text, expected_answer: text },
      ["action", "reason"]),
    (args) => cards.repair(scope, args as Parameters<StudyInteractions["repair"]>[1]), "practice");
}
