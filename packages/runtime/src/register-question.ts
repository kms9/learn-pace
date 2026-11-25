import { arr, obj, oneOf, str, type Static } from "@earendil-works/pi-schema";
import { createPendingQuestion, hasOptionBodies } from "@learn-pace/domain";

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
