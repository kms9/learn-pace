import { expect, it } from "vitest";
import {
  applyGrade, classifyError, correctAnswerKey, createKnowledgePoint, createLearningModule, createLearningProgress,
  createPendingQuestion, derivePathStatus, masterySource, questionWithAnswerKey, recordQualitativeAssessment,
  setLearnerMasteryOverride, SpacedRepetitionScheduler, voidAttempt, type FinalGrade, type LearningProgress,
} from "../index.js";

const procedure = createKnowledgePoint({ id: "p", name: "约分", module_id: "m", type: "procedure" });
const concept = createKnowledgePoint({ id: "c", name: "公因数", module_id: "m", type: "concept" });
const scheduler = new SpacedRepetitionScheduler();
const base = () => createLearningProgress({ book_id: "b", modules: [
  createLearningModule({ id: "m", name: "数学", order: 0, knowledge_points: [procedure, concept] }),
] });
const verdict = (result: FinalGrade["result"]): FinalGrade => ({
  result, confidence: 0.9, feedback: "依据", reference_answer: "数值", criteria_met: ["关键点"],
});
const grade = (progress: LearningProgress, evidence_id: string, result: FinalGrade["result"], now: number,
  question_id = evidence_id, assistance_used = false) => applyGrade(progress, {
  evidence_id, question_id, knowledge_point_id: "p", learner_answer: "原话", session_id: "s", turn_id: evidence_id,
  verdict: verdict(result), assistance_used,
}, scheduler, now);

it("records new, retrying, and graduated errors while applying retry credit", () => {
  expect(classifyError("  ")).toBe("metacognitive");
  expect(classifyError("42")).toBe("application");
  let progress = grade(base(), "i1", "incorrect", 100, "q");
  expect(progress.error_records[0]).toMatchObject({ error_type: "application", status: "active" });
  progress = grade(progress, "i2", "incorrect", 110, "q");
  expect(progress.error_records[0]).toMatchObject({ status: "retrying", retry_history: [{ is_correct: false, attempt_number: 1 }] });
  progress = grade(progress, "i3", "correct", 120, "q");
  expect(progress.error_records[0]).toMatchObject({ status: "graduated", retry_history: [
    { is_correct: false, attempt_number: 1 }, { is_correct: true, attempt_number: 2 },
  ] });
  expect(progress.learning_evidence[2]).toMatchObject({ quality: 0.6, assessment_type: "review" });
});

it("caps the first scores and preserves stability across closely spaced answers", () => {
  const first = grade(base(), "1", "correct", 100);
  const second = grade(first, "2", "correct", 110);
  const third = grade(second, "3", "correct", 120);
  expect([first, second, third].map((state) => state.mastery_levels.p)).toEqual([0.5, 0.8, 1]);
  expect(third.learning_evidence.map((evidence) => evidence.assessment_type)).toEqual(["quiz", "review", "review"]);
  expect(third.repetition_states.p?.stability).toBe(first.repetition_states.p?.stability);
  expect(grade(base(), "partial", "partial", 100)).toMatchObject({
    mastery_levels: { p: 0.5 }, error_records: [], learning_evidence: [{ result: "partial", quality: 0.5 }],
  });
  expect(grade(third, "3", "incorrect", 200)).toBe(third);
});

it("records assistance and clears the deferral without changing the quantitative conclusion", () => {
  const progress = grade(base(), "one", "correct", 100);
  const assessed = grade({ ...progress, deferred_objectives: { p: { knowledge_point_id: "p", note: "", created_at: 100 } } },
    "assisted", "correct", 110, "q-assisted", true);
  expect(assessed.quiz_attempts[1]).toMatchObject({ independent: false });
  expect(assessed.learning_evidence[1]).toMatchObject({ quality: 0.6, hints_used: 1 });
  expect(assessed.mastery_levels.p).toBe(0.5);
  expect(assessed.deferred_objectives.p).toBeUndefined();
});

it("stores qualitative rationale and criteria, handles partial and assisted judgments", () => {
  const assess = (progress: LearningProgress, evidence_id: string, result: FinalGrade["result"], assistance_used = false) =>
    recordQualitativeAssessment(progress, { evidence_id, knowledge_point_id: "c", learner_answer: "我的解释",
      verdict: verdict(result), session_id: "s", turn_id: evidence_id, model_id: "flash", assistance_used }, scheduler, 100);
  const passed = assess(base(), "first", "correct");
  expect(passed.qualitative_mastery.c).toBe(true);
  expect(passed.assessment_evidence.first).toMatchObject({ model_id: "flash", confidence: 0.9, criteria_met: ["关键点"] });
  expect(passed.learning_evidence[0]).toMatchObject({ learner_answer: "我的解释", feedback: "依据" });
  expect(assess(passed, "first", "incorrect")).toBe(passed);
  expect(assess(passed, "assisted-fail", "incorrect", true).qualitative_mastery.c).toBe(true);
  const partial = assess(passed, "partial", "partial");
  expect(partial.qualitative_mastery.c).toBe(false);
  expect(partial.mastery_levels.c).toBe(0.4);
  expect(assess(partial, "assisted-correct", "correct", true)).toMatchObject({ qualitative_mastery: { c: false } });
  expect(assess(partial, "assisted-correct", "correct", true).learning_evidence.at(-1)?.quality).toBe(0.6);
});

it("voids evidence and replays remaining attempts in durable order", () => {
  const first = grade(base(), "i1", "correct", 100);
  const wrong = grade(first, "i2", "incorrect", 120);
  const corrected = voidAttempt(wrong, { question_id: "i2", knowledge_point_id: "p" }, "题目有误", scheduler, 200);
  expect(corrected.quiz_attempts[1]).toMatchObject({ voided: true, void_reason: "题目有误" });
  expect(corrected.learning_evidence).toEqual(first.learning_evidence);
  expect(corrected.repetition_states).toEqual(first.repetition_states);
  expect(corrected.mastery_levels.p).toBe(0.5);
  expect(corrected.error_records).toEqual([]);
});

it("changes the key and replaces the saved attempt judgment without appending a new score", () => {
  const question = questionWithAnswerKey(createPendingQuestion({ question_id: "q", knowledge_point_id: "p",
    question_type: "choice", options: [{ label: "A", body: "原答案" }, { label: "B", body: "原话" }],
    expected_answer: "A", accepted_answers: ["A"] }), "原话", "已更正");
  expect(question).toMatchObject({ expected_answer: "B", accepted_answers: [], explanation: "已更正" });
  const attempted = grade(base(), "i", "incorrect", 100, "q");
  const next = correctAnswerKey(attempted, question, [verdict("correct")], scheduler, 200);
  expect(next.quiz_attempts).toHaveLength(1);
  expect(next.quiz_attempts[0]).toMatchObject({ result: "correct", user_answer: "原话", timestamp: 100 });
  expect(next.learning_evidence).toHaveLength(1);
  expect(next.learning_evidence[0]).toMatchObject({ evidence_id: "i", result: "correct", timestamp: 100 });
  expect(next.mastery_levels.p).toBe(0.5);
});

it("supports reversible learner mastery independently of scheduling and path status", () => {
  const initial = setLearnerMasteryOverride(base(), "c", true, "自报", 100);
  let progress = grade(grade(grade(initial, "one", "correct", 101), "two", "correct", 102), "three", "correct", 103);
  expect(derivePathStatus(progress)).toBe("completed");
  progress = grade(progress, "four", "incorrect", 104);
  expect(derivePathStatus(progress)).toBe("active");
  const marked = setLearnerMasteryOverride(progress, "p", true, "📝".repeat(501), 105);
  expect(masterySource(marked, procedure)).toBe("learner");
  expect([...marked.learner_mastery_overrides.p!.note]).toHaveLength(500);
  expect(marked.repetition_states).toBe(progress.repetition_states);
  expect(marked.learning_evidence).toBe(progress.learning_evidence);
  expect(derivePathStatus(marked)).toBe("completed");
  expect(derivePathStatus(setLearnerMasteryOverride(marked, "p", false, "", 106))).toBe("active");
});
