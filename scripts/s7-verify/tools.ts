import {
  computeMastery, createPendingQuestion, isReadableChoiceAnswer, publicPendingQuestion, resolveChoiceSubmission,
  type KnowledgeType, type PendingQuestion,
} from "../../packages/domain/src/index";
import type { PiDurableRuntime, RuntimeTool } from "../../packages/runtime/src/index";

export type Mode = "outline" | "study" | "review";
export const toolNames = ["mastery_status", "mastery_mode", "mastery_build", "mastery_quiz", "mastery_grade"] as const;
export type ToolName = (typeof toolNames)[number];
const knowledgeTypes = ["memory", "concept", "procedure", "design"] as const;
const modes: readonly Mode[] = ["outline", "study", "review"];

export const modeInstructions: Record<Mode, string> = {
  outline: "当前编辑大纲。按学习目标设计少量模块和知识点，使用 mastery_build 保存，不能出题或批改。学习者同意后，可调用 mastery_mode 进入学习。",
  study: "当前学习。先讲清原理，再用 mastery_quiz 出一道正式题；正文仅写简短中性引导。收到开放题的明确作答才调用 mastery_grade。普通追问直接解释并保留原题。",
  review: "当前复习。先让学习者独立回忆，不先展示解法、答案或提示；题卡通过 mastery_quiz 登记。明确作答后才批改。",
};

type Point = { id: string; name: string; type: KnowledgeType; prerequisites: string[] };
type Module = { name: string; objective: string; knowledge_points: Point[] };
export type Grade = { result: "correct" | "incorrect"; feedback: string; mastery_level: number; objective_mastered: boolean };
export interface TutorState {
  id: string;
  goal: string;
  name: string;
  mode: Mode;
  revision: number;
  modules: Module[];
  pending: PendingQuestion | null;
  questionNumber: number;
  attempts: { knowledge_point_id: string; correct: boolean }[];
  mastery: Record<string, number>;
  lastGrade: Grade | null;
}
export function newTutor(id: string, goal: string): TutorState {
  return { id, goal, name: goal, mode: "outline", revision: 0, modules: [], pending: null,
    questionNumber: 0, attempts: [], mastery: {}, lastGrade: null };
}

const mastered = (s: TutorState, id: string) => (s.mastery[id] ?? 0) >= 0.9;

export function statusSnapshot(s: TutorState) {
  const points = s.modules.flatMap((module) => module.knowledge_points);
  const next = s.pending ? points.find((point) => point.id === s.pending?.knowledge_point_id)
    : points.find((point) => !mastered(s, point.id) && point.prerequisites.every((id) => mastered(s, id)));
  return {
    path_id: s.id, path_name: s.name, goal: s.goal, status: points.length ? "active" : "draft",
    mode: s.mode, next: next ? { knowledge_point_id: next.id, name: next.name, type: next.type } : null,
    map: s.modules.map((module) => ({
      name: module.name, objective: module.objective,
      points: module.knowledge_points.map((point) => ({ ...point, mastery: s.mastery[point.id] ?? 0 })),
    })),
    pending_interaction: s.pending ? publicPendingQuestion(s.pending) : null,
    path_revision: s.revision,
  };
}

export function switchMode(state: TutorState, mode: Mode) {
  if (mode === "study" && !state.modules.length) {
    return { ok: false, code: "outline_required", message: "大纲为空，不能开始学习。先在 outline 调用 mastery_build。" } as const;
  }
  state.mode = mode;
  return { ok: true, mode, instructions: modeInstructions[mode] } as const;
}

const str = { type: "string", minLength: 1 };
const enumeration = (values: readonly string[]) => ({ type: "string", enum: values });
const array = (items: object, minItems: number, maxItems: number) => ({ type: "array", items, minItems, maxItems });
const object = (properties: Record<string, object>, required: string[] = []) =>
  ({ type: "object", properties, required, additionalProperties: false });
const invalid = (message: string) => ({ ok: false, code: "invalid_argument", message }) as const;
type BuildArgs = {
  mode: "replace" | "append"; path_name?: string;
  modules: { name: string; objective: string; knowledge_points: { name: string; type: KnowledgeType; prerequisites?: string[] }[] }[];
};
function build(state: TutorState, input: BuildArgs) {
  let sequence = input.mode === "append" ? state.modules.flatMap((module) => module.knowledge_points).length : 0;
  const modules: Module[] = [
    ...(input.mode === "append" ? state.modules : []),
    ...input.modules.map((module) => ({
      name: module.name.trim(), objective: module.objective.trim(),
      knowledge_points: module.knowledge_points.map((point) => ({
        id: "kp-" + ++sequence, name: point.name.trim(), type: point.type, prerequisites: point.prerequisites ?? [],
      })),
    })),
  ];
  const points = modules.flatMap((module) => module.knowledge_points);
  if (modules.some((module) => !module.name || !module.objective || !module.knowledge_points.length) ||
      points.some((point) => !point.name) || new Set(points.map((point) => point.name)).size !== points.length) {
    return invalid("请提供非空模块、目标及不重名的知识点。");
  }
  const aliases = new Map(points.flatMap((point) => [[point.id, point.id], [point.name, point.id]] as const));
  const graph = new Map(points.map((point) => [point.id, point.prerequisites.map((ref) => aliases.get(ref.trim()))]));
  const visiting = new Set<string>();
  const finished = new Set<string>();
  function valid(id: string): boolean {
    if (visiting.has(id)) return false;
    if (finished.has(id)) return true;
    visiting.add(id);
    if (!graph.get(id)?.every((parent) => parent !== undefined && valid(parent))) return false;
    visiting.delete(id);
    finished.add(id);
    return true;
  }
  if (!points.every(({ id }) => valid(id))) return invalid("先修必须引用已存在的知识点，且不能自依赖或成环。");
  state.modules = modules.map((module) => ({
    ...module, knowledge_points: module.knowledge_points.map((point) => ({
      ...point, prerequisites: [...new Set(graph.get(point.id) as string[])],
    })),
  }));
  if (input.mode === "replace") {
    state.attempts = [];
    state.mastery = {};
    state.pending = null;
  }
  state.name = input.path_name?.trim() || state.name;
  state.revision++;
  return { ok: true, path_revision: state.revision, modules: state.modules.map((module) => module.name),
    points: points.map(({ id, name, type }) => ({ id, name, type })) } as const;
}

type QuizArgs = {
  knowledge_point_id: string; question: string; question_type: "choice" | "short" | "open";
  options?: string[]; expected_answer: string; accepted_answers?: string[]; explanation?: string;
};
function quiz(state: TutorState, input: QuizArgs) {
  if (state.pending) return { ok: false, code: "pending_exists", message: "先保留并处理当前待答题卡。" } as const;
  const point = state.modules.flatMap((module) => module.knowledge_points)
    .find(({ id }) => id === input.knowledge_point_id);
  if (!point) return invalid("请用 mastery_status 中的知识点 ID。");
  const expected = input.expected_answer.trim();
  const prompt = input.question.trim();
  const bodies = (input.options ?? []).map((option) => option.trim());
  if (!expected || !prompt) return invalid("题干及参考答案不能为空。");
  if (input.question_type === "choice") {
    if (bodies.length < 2 || bodies.some((option) => !option) || new Set(bodies).size !== bodies.length ||
        !bodies.includes(expected)) return invalid("选择题需要 2–4 个不同的纯文本选项，expected_answer 必须是某个选项的完整正文。");
    for (let index = bodies.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [bodies[index], bodies[other]] = [bodies[other]!, bodies[index]!];
    }
  } else if (bodies.length) {
    return invalid("简答和开放题不提供 options。");
  }
  const options = bodies.map((body, i) => ({ label: "ABCD"[i]!, body }));
  state.pending = createPendingQuestion({
    question_id: state.id + "-q" + ++state.questionNumber, knowledge_point_id: point.id, prompt,
    question_type: input.question_type, options, expected_answer: options.find(({ body }) => body === expected)?.label ?? expected,
    accepted_answers: input.accepted_answers ?? [], explanation: input.explanation ?? "",
  });
  return { ok: true, card: publicPendingQuestion(state.pending) };
}

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]+/gu, "");

export function grade(state: TutorState, answer: string, id?: string): { ok: true } & Grade | ReturnType<typeof invalid> |
    { ok: false; code: "no_pending" | "not_an_answer"; message: string } {
  const pending = state.pending;
  if (!pending || (id && pending.question_id !== id)) {
    return { ok: false, code: "no_pending", message: "没有匹配的待答题卡。" };
  }
  const candidate = normalize(answer);
  if (!candidate || /^(?:等等|请解释|我想问|什么是)|(?:是什么意思|是指什么|为什么[？?]?$)|[？?]\s*$/.test(answer)) {
    return { ok: false, code: "not_an_answer", message: "这是追问，保留待答题。请直接讲解。" };
  }
  let correct: boolean;
  if (pending.question_type === "choice") {
    const options = Object.fromEntries(pending.options.map(({ label, body }) => [label, body]));
    if (!isReadableChoiceAnswer(answer, options)) {
      return { ok: false, code: "not_an_answer", message: "未明确选择某项，保留待答题。" };
    }
    correct = resolveChoiceSubmission(answer, options) === pending.expected_answer;
  } else {
    correct = [pending.expected_answer, ...pending.accepted_answers].map(normalize)
      .some((text) => text && (candidate === text || (text.length >= 5 && candidate.includes(text))));
  }
  const idForPoint = pending.knowledge_point_id;
  state.attempts.push({ knowledge_point_id: idForPoint, correct });
  const mastery = computeMastery(state.attempts.filter((record) => record.knowledge_point_id === idForPoint).map((record) => record.correct));
  state.mastery[idForPoint] = mastery;
  state.pending = null;
  state.revision++;
  state.lastGrade = { result: correct ? "correct" : "incorrect",
    feedback: correct ? "判定正确，请继续练习。" : "本次作答有误，请先讲解错因。",
    mastery_level: mastery, objective_mastered: mastered(state, idForPoint) };
  return { ok: true, ...state.lastGrade };
}

export interface ToolOutcome {
  name: ToolName; semanticValid: boolean; modeAllowed: boolean; refused: boolean; code: string;
}
export function registerTutorTools(runtime: PiDurableRuntime, state: TutorState, learnerText: string, outcomes: ToolOutcome[]) {
  const definition = (name: ToolName, description: string, parameters: object, allowed: readonly Mode[],
    execute: (args: Record<string, unknown>) => Promise<unknown>, termination?: RuntimeTool["termination"]) => {
    runtime.registerTool({
      name, description, parameters: { ...parameters }, privateArgs: true, termination,
      async execute(args) {
        const modeAllowed = allowed.includes(state.mode);
        const output = modeAllowed ? await execute(args)
          : { ok: false, code: "wrong_mode", message: "当前模式 " + state.mode + " 禁止此操作。请先用 mastery_mode 切到 " + allowed.join(" / ") + "。" };
        const outcome = output as { ok?: boolean; code?: string };
        outcomes.push({ name, semanticValid: outcome.code !== "invalid_argument", modeAllowed,
          refused: outcome.ok === false, code: outcome.code ?? "ok" });
        return JSON.parse(JSON.stringify(output)) as Awaited<ReturnType<RuntimeTool["execute"]>>;
      },
    });
  };
  definition("mastery_status", "读取路径、当前模式、目标和公开待答题的最新只读状态。", object({}), modes,
    async () => statusSnapshot(state));
  definition("mastery_mode", "切换到指定会话模式。切换后继续当前请求。", object({ mode: enumeration(modes), reason: str }, ["mode"]),
    modes, async ({ mode }) => switchMode(state, mode as Mode));
  definition("mastery_build", "保存大纲。每次只建 1–2 个简明模块。先修可用本大纲内的知识点名称。", object({
    mode: enumeration(["replace", "append"]), path_name: str,
    modules: array(object({
      name: str, objective: str,
      knowledge_points: array(object({ name: str, type: enumeration(knowledgeTypes), prerequisites: array(str, 0, 4) }, ["name", "type"]), 1, 3),
    }, ["name", "objective", "knowledge_points"]), 1, 2),
  }, ["mode", "modules"]), ["outline"], async (args) => build(state, args as BuildArgs));
  definition("mastery_quiz", "登记并展示一道题，成功即结束本轮。答案、解析只放工具参数。选择题 options 传 2–4 项纯正文，expected_answer 传正确选项完整正文。", object({
    knowledge_point_id: str, question: str, question_type: enumeration(["choice", "short", "open"]),
    options: array(str, 0, 4), expected_answer: str, accepted_answers: array(str, 0, 4), explanation: str,
  }, ["knowledge_point_id", "question", "question_type", "expected_answer"]), ["study", "review"],
  async (args) => quiz(state, args as QuizArgs), (result) => (result as { ok?: boolean }).ok && state.pending
    ? { question: publicPendingQuestion(state.pending) } : undefined);
  definition("mastery_grade", "只批改当前学习者明确提交的答案。answer 必须原样复制本轮用户作答，普通追问不能调用。", object({
    question_id: str, answer: str,
  }, ["answer"]), ["study", "review"], async ({ question_id, answer }) => {
    if (String(answer).trim() !== learnerText.trim()) return invalid("answer 必须原样使用本轮学习者的明确作答。");
    return grade(state, String(answer), question_id as string | undefined);
  });
}
