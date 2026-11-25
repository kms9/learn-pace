import { grade, type Grade, type TutorState } from "./tools";

export const subjects = [
  { goal: "分数约分与比例化简", kind: "procedure", type: "choice" },
  { goal: "TCP 三次握手与四次挥手", kind: "concept", type: "short" },
  { goal: "英语常见虚拟语气结构", kind: "memory", type: "choice" },
  { goal: "HTTP 缓存与 ETag 机制", kind: "design", type: "choice" },
  { goal: "二分查找边界条件", kind: "procedure", type: "choice" },
] as const;
type Subject = (typeof subjects)[number];

function answer(state: TutorState, wrong = false): string {
  const pending = state.pending;
  if (!pending) return "";
  if (pending.question_type !== "choice") return wrong ? "这是一个与题目无关的说法。" : pending.expected_answer;
  return wrong ? pending.options.find(({ label }) => label !== pending.expected_answer)?.label ?? "" : pending.expected_answer;
}

export type Step = {
  label: string; text: string; receipt?: Grade; denials?: Record<string, string>; check: (state: TutorState) => boolean;
};
const build = (topic: Subject): Step => ({
  label: "build-outline", text: "请为「" + topic.goal + "」建一个简洁的大纲。请调用工具保存，含至少一个 "
    + topic.kind + " 类型知识点。今天先确认大纲，本轮留在编辑模式，先别出题。",
  check: (state) => state.modules.length > 0 && state.mode === "outline",
});
const explain = (topic: Subject, activate = false): Step => ({
  label: activate ? "switch-study-and-quiz" : "study-explain-and-quiz",
  text: (activate ? "同意大纲，请先切到学习模式。接着" : "请") + "给一句中性的学习引导，然后在本轮用题卡出一道"
    + (topic.type === "short" ? "短答题" : "选择题") + "。正文不得复述题目或透露答案。",
  check: (state) => state.mode === "study" && state.pending?.question_type === topic.type,
});
const enter: Step = {
  label: "switch-study", text: "我确认大纲，进入学习模式。先告诉我学哪个知识点，这轮先不出题。",
  check: (state) => state.mode === "study" && !state.pending,
};
export function hostGrade(state: TutorState, wrong: boolean) {
  const raw = answer(state, wrong);
  if (!raw || !state.pending) return null;
  const result = grade(state, raw, state.pending.question_id);
  return result.ok ? { raw, receipt: result } : null;
}
function hostAnswer(state: TutorState, wrong = false, nextQuiz = false): Step {
  const applied = hostGrade(state, wrong);
  return {
    label: wrong ? "host-grade-incorrect" : nextQuiz ? "host-grade-and-quiz" : "host-grade-correct",
    text: applied ? "我的题卡作答是 " + applied.raw + "。请根据已保存的批改回执"
      + (nextQuiz ? "简短反馈后，再出一道新的选择题。" : "给简短反馈，本轮不要出新题。") : "请解释如何作答。",
    receipt: applied?.receipt,
    check: (s) => Boolean(applied && s.lastGrade?.result === (wrong ? "incorrect" : "correct") && Boolean(s.pending) === nextQuiz),
  };
}
function textAnswer(state: TutorState, naturalChoice: boolean): Step {
  const value = answer(state);
  return { label: "tool-grade-explicit-answer",
    text: value ? naturalChoice ? "我选 " + value + "，因为我认为它符合刚才学习的机制。" : value : "我还没有题卡。",
    check: (s) => Boolean(value && s.lastGrade?.result === "correct" && !s.pending) };
}

export function benchmarkStep(group: number, index: number, state: TutorState): Step {
  const subject = subjects[group]!;
  if (group === 3 && index === 1) return {
    label: "empty-outline-denial", text: "先实际调用 mastery_mode 尝试切到 study，我想跳过大纲直接出题。若被拒绝，请直接告诉我原因，不要代我建大纲。",
    denials: { mastery_mode: "outline_required", mastery_quiz: "wrong_mode" },
    check: (s) => s.mode === "outline" && !s.modules.length && !s.pending,
  };
  if (group === 3 && index === 2 || group !== 3 && index === 1) return build(subject);
  if (index === 2) return group === 4 ? explain(subject, true) : enter;
  if (group === 4 && index === 3) return {
    label: "study-append-and-recover", text: "在学习过程中我想加一个「终止条件」模块。若当前不能修改，请先切编辑大纲并追加模块，保留现有题卡，随后回到学习模式；这轮不要另出题。",
    denials: { mastery_build: "wrong_mode" },
    check: (s) => s.mode === "study" && Boolean(s.pending),
  };
  if (index === 3) return explain(subject, group === 3);
  if (index === 4) return group === 0 || group === 2 || group === 4 ? hostAnswer(state, group === 2, group === 4) : textAnswer(state, group === 3);
  if (group === 4) {
    const id = state.pending?.question_id;
    return { label: "follow-up-not-an-answer", text: "等等，左闭右开是什么意思？我还没有作答，先说明一下。",
      check: (s) => Boolean(id && s.pending?.question_id === id) };
  }
  if (group === 1 || group === 3) return {
    label: group === 3 ? "grade-feedback-follow-up" : "concept-follow-up",
    text: "请围绕刚刚的作答讲一个相关细节，这次只解释，不再出题。",
    check: (s) => Boolean(s.lastGrade && !s.pending),
  };
  return { ...explain(subject), label: group === 2 ? "correct-and-requiz" : "follow-up-and-requiz",
    text: (group === 2 ? "请先用一句话指出我上次的错误，不要给出新题答案，再" : "我想巩固一下，请先给一句中性提示，再")
      + "用题卡出另一道选择题。" };
}

export const deviceBuild = (group: number) => build(subjects[group]!);
export const deviceEnter = enter;
export function deviceQuiz(group: number): Step {
  const step = explain(subjects[group]!);
  return { ...step, text: "请先把学习引导直接写在可见的回复正文，再调用出题工具。不要跳过正文。" + step.text };
}
