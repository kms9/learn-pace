import { arr, obj, oneOf, opt, str, type Static } from "@earendil-works/pi-schema";
import { createPendingQuestion, hasOptionBodies, positionalLabel, type PendingQuestion } from "@learn-pace/domain";

export const registerQuestionName = "register_question";

const nonBlank = str({ pattern: "\\S" });
export const questionParameters = obj({
  question_id: nonBlank,
  knowledge_point_id: nonBlank,
  prompt: nonBlank,
  question_type: oneOf(["choice", "short", "open"]),
  options: arr(obj({ label: nonBlank, body: nonBlank }), {
    description: "For choice questions use unique option labels. For other questions return an empty array.",
  }),
  expected_answer: str({
    pattern: "\\S",
    description: "Private answer. For choice questions use the correct option label.",
  }),
});

export function validateQuestion(args: Static<typeof questionParameters>) {
  const question = createPendingQuestion({
    question_id: args.question_id.trim(),
    knowledge_point_id: args.knowledge_point_id.trim(),
    prompt: args.prompt.trim(),
    question_type: args.question_type,
    options: args.options.map(({ label, body }) => ({
      label: label.trim().toUpperCase(),
      body: body.trim(),
    })),
    expected_answer: args.expected_answer.trim(),
  });
  if (question.question_type !== "choice") {
    if (question.options.length) throw new Error("Options are only valid for choice questions");
    return question;
  }

  const options = Object.fromEntries(question.options.map(({ label, body }) => [label, body]));
  const answer = question.expected_answer.toUpperCase();
  if (Object.keys(options).length !== question.options.length || !hasOptionBodies(options) ||
      !Object.hasOwn(options, answer)) {
    throw new Error("Choice questions require unique labeled options and a matching answer label");
  }
  question.expected_answer = answer;
  return question;
}

const leafFields = {
  question: nonBlank,
  options: opt(arr(nonBlank, { description: "选择题的纯文本选项，省略 A/B 标签。" })),
  expected_answer: opt(str({ pattern: "\\S", description: "私有答案，选择题填写正确选项的完整正文。" })),
  accepted_answers: opt(arr(nonBlank)),
  explanation: opt(str()),
};
const studyLeaf = obj({ ...leafFields, knowledge_point_id: opt(nonBlank), question_type: oneOf(["choice", "short", "open"]) });
export const studyQuestionParameters = obj({
  ...leafFields,
  knowledge_point_id: nonBlank,
  question_type: oneOf(["choice", "short", "open", "group"]),
  questions: opt(arr(studyLeaf, { minItems: 2, maxItems: 4 })),
});

export function validateStudyQuestion(input: Static<typeof studyQuestionParameters>, makeId: () => string,
  now: number, random = Math.random): PendingQuestion {
  function leaf(args: Static<typeof studyLeaf>, fallback: string) {
    const prompt = args.question.trim();
    const expected = args.expected_answer?.trim();
    const methods = ["choice", "short", "open"];
    if (!prompt || !expected || !methods.includes(args.question_type)) throw new Error("每道小题都需要有效题干、题型和私有答案");
    const bodies = (args.options ?? []).map((option) => option.trim());
    if (args.question_type === "choice") {
      if (bodies.length < 2 || bodies.some((body) => !body) || new Set(bodies.map((body) => body.normalize("NFC").toLowerCase())).size !== bodies.length ||
          !bodies.includes(expected)) throw new Error("选择题需要至少两个不同选项，答案须为其中一个选项的完整正文");
      for (let i = bodies.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bodies[i], bodies[j]] = [bodies[j]!, bodies[i]!];
      }
    } else if (bodies.length) throw new Error("仅选择题允许提供选项");
    const options = bodies.map((body, index) => ({ label: positionalLabel(index), body }));
    return createPendingQuestion({ question_id: makeId(), knowledge_point_id: args.knowledge_point_id?.trim() || fallback,
      prompt, question_type: args.question_type, options, expected_answer: options.find(({ body }) => body === expected)?.label ?? expected,
      accepted_answers: args.accepted_answers?.map((answer) => answer.trim()).filter(Boolean) ?? [],
      explanation: args.explanation?.trim() ?? "", created_at: now });
  }
  const goal = input.knowledge_point_id.trim();
  if (!goal || !input.question.trim()) throw new Error("题目需要知识点 ID 和题干");
  if (input.question_type !== "group") {
    if (input.questions?.length) throw new Error("只有题组可包含小题");
    return leaf({ ...input, question_type: input.question_type }, goal);
  }
  if (!input.questions || input.questions.length < 2 || input.questions.length > 4 || input.options?.length ||
      input.expected_answer?.trim() || input.accepted_answers?.length) throw new Error("题组需要两至四道小题，每道小题各有答案");
  return createPendingQuestion({ question_id: makeId(), knowledge_point_id: goal, prompt: input.question.trim(),
    question_type: "group", questions: input.questions.map((part) => leaf(part, goal)), created_at: now });
}
