import { createPendingQuestion, publicPendingQuestion } from "@learn-pace/domain";
import { afterEach, expect, it, vi } from "vitest";
import {
  assessSemantically,
  exactVerdict,
  gradeQualitatively,
  validateStudyQuestion,
  loadModelConfigFromEnv,
  PiDurableRuntime,
  type RegisterQuestionHandler,
  type RuntimeEvent,
  type RuntimeTurnRequest,
} from "../index.js";
import { completion, mockDeepSeek, modelConfig, streamUntilAborted, text, toolCall } from "./deepseek-fixture.js";

afterEach(() => vi.unstubAllGlobals());

const request: RuntimeTurnRequest = { sessionId: "session", turnId: "turn", prompt: "Prompt", allowedTools: [] };
const questionRequest: RuntimeTurnRequest = { ...request, pathId: "path", mode: "study", allowedTools: ["register_question"] };
const question = {
  question_id: "q1",
  knowledge_point_id: "kp1",
  prompt: "Which fruit is yellow?",
  question_type: "choice",
  options: [{ label: "A", body: "Banana" }, { label: "B", body: "Blueberry" }],
  expected_answer: "a",
};
const cancelled = { type: "turn_completed", stopReason: "cancelled" };

async function collect(runtime: PiDurableRuntime, turn = request) {
  const events: RuntimeEvent[] = [];
  await runtime.runTurn(turn, (event) => events.push(event));
  return events;
}

it("parses and trims the configured DeepSeek model settings", () => {
  expect(loadModelConfigFromEnv({
    PI_OPENAI_BASE_URL: " https://deepseek.example/v1/ ",
    OPENAI_API_KEY: " test-credential ",
    PI_OPENAI_API: "openai-completions",
    PI_REASONING: "high",
    PI_CONTEXT_WINDOW: "8192",
    PI_MAX_TOKENS: "1024",
  })).toEqual(modelConfig);
});

it.each([
  ["PI_OPENAI_BASE_URL", "file:///tmp/test"],
  ["OPENAI_API_KEY", " "],
  ["PI_OPENAI_API", "openai-responses"],
  ["PI_REASONING", "extreme"],
  ["PI_CONTEXT_WINDOW", "0"],
  ["PI_MAX_TOKENS", "NaN"],
  ["PI_MAX_TOKENS", "5000000"],
])("rejects invalid %s", (name, value) => {
  expect(() => loadModelConfigFromEnv({
    PI_OPENAI_BASE_URL: modelConfig.baseUrl,
    OPENAI_API_KEY: modelConfig.apiKey,
    [name]: value,
  })).toThrow(name);
});

it("maps actual Pi SSE chunks to ordered runtime deltas and one completion", async () => {
  const fetch = mockDeepSeek(completion([{ reasoning_content: "private thinking" }, text("Hello"), text(" world")]));
  expect(await collect(new PiDurableRuntime(modelConfig))).toEqual([
    { type: "text_delta", delta: "Hello" },
    { type: "text_delta", delta: " world" },
    { type: "turn_completed", stopReason: "end_turn" },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({
    model: "deepseek-v4.1-flash",
    stream: true,
    reasoning_effort: "high",
    max_tokens: 1024,
  });
});

it("sends system instructions, ordered history and the current question once with no tools", async () => {
  const fetch = mockDeepSeek(completion([text("Second answer")]));
  const runtime = new PiDurableRuntime(modelConfig);
  runtime.registerTool({ name: "hidden", description: "Unavailable", parameters: {}, execute: async () => null });
  await collect(runtime, {
    ...request,
    instructions: "Answer in Chinese.",
    history: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ],
  });
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body.messages).toEqual([
    expect.objectContaining({ role: "system", content: expect.stringContaining("Answer in Chinese.") }),
    expect.objectContaining({ role: "user", content: "First question" }),
    expect.objectContaining({ role: "assistant", content: "First answer" }),
    expect.objectContaining({ role: "user", content: "Prompt" }),
  ]);
  expect(body.tools ?? []).toEqual([]);
});

it("does not present truncation as success", async () => {
  mockDeepSeek(completion([text("partial")], "length"));
  expect(await collect(new PiDurableRuntime(modelConfig))).toEqual([
    { type: "text_delta", delta: "partial" },
    { type: "turn_failed", error: "Model output reached its token limit" },
  ]);
});

it("reports a provider HTTP error without echoing the body", async () => {
  mockDeepSeek(new Response(JSON.stringify({ error: { message: "test-credential plus private data" } }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  }));
  expect(await collect(new PiDurableRuntime(modelConfig))).toEqual([
    { type: "turn_failed", error: "DeepSeek request failed (HTTP 403)" },
  ]);
});

it("exposes and dispatches only the intersection of registered and allowed tools", async () => {
  const fetch = mockDeepSeek(
    completion([toolCall("denied", {}), toolCall("trusted", {}, 1), toolCall("missing", {}, 2)], "tool_calls"),
    completion([text("done")]),
  );
  const runtime = new PiDurableRuntime(modelConfig);
  const execute = vi.fn(async () => ({ ok: true }));
  const denied = vi.fn(async () => null);
  runtime.registerTool({ name: "trusted", description: "Trusted tool", parameters: { type: "object" }, execute });
  runtime.registerTool({ name: "denied", description: "Denied tool", parameters: { type: "object" }, execute: denied });
  expect(() => runtime.registerTool({ name: "register_question", description: "", parameters: {}, execute })).toThrow();
  const events = await collect(runtime, { ...request, allowedTools: ["trusted", "missing"] });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(denied).not.toHaveBeenCalled();
  expect(events).toEqual([
    { type: "tool_call", toolName: "trusted", callId: "call_1", args: {} },
    { type: "tool_result", toolName: "trusted", callId: "call_1", output: { ok: true } },
    { type: "text_delta", delta: "done" },
    { type: "turn_completed", stopReason: "end_turn" },
  ]);
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["trusted"]);
});

it("registers one private question, emits the domain card, and ends the entire tool batch", async () => {
  const fetch = mockDeepSeek(completion([
    text("The answer is A."),
    toolCall("register_question", question),
    toolCall("register_question", { ...question, question_id: "second" }, 1),
    toolCall("sibling", {}, 2),
    toolCall("unknown", {}, 3),
    text("I answered it myself."),
  ], "tool_calls"));
  const register = vi.fn<RegisterQuestionHandler>(async () => {});
  const sibling = vi.fn(async () => null);
  const runtime = new PiDurableRuntime(modelConfig, register);
  runtime.registerTool({ name: "sibling", description: "Another tool", parameters: { type: "object" }, execute: sibling });
  const events = await collect(runtime, {
    ...questionRequest, instructions: "Use the learner's language.", allowedTools: ["register_question", "sibling"],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body.messages[0]).toMatchObject({
    role: "system",
    content: expect.stringContaining("Use the learner's language.\n\nWhen presenting a question, call register_question directly."),
  });
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith(expect.objectContaining({
    type: "RegisterQuestion", path_id: "path", session_id: "session", turn_id: "turn",
    question: expect.objectContaining({ expected_answer: "A", knowledge_point_id: "kp1" }),
  }), expect.any(AbortSignal));
  expect(sibling).not.toHaveBeenCalled();
  const card = {
    question_id: "q1", question_type: "choice", prompt: "Which fruit is yellow?",
    options: [{ id: "A", label: "A", body: "Banana" }, { id: "B", label: "B", body: "Blueberry" }],
  };
  expect(events).toEqual([
    { type: "tool_call", toolName: "register_question", callId: "call_0", args: card },
    { type: "question_presented", question: card },
    { type: "turn_completed", stopReason: "question_presented" },
  ]);
});

it.each([
  { ...question, question_id: " " },
  { ...question, expected_answer: undefined },
  { ...question, expected_answer: "C" },
  { ...question, options: [{ label: "A", body: "Banana" }, { label: " a ", body: "Blueberry" }] },
  { ...question, question_type: "short" },
])("rejects malformed or inconsistent question arguments", async (args) => {
  mockDeepSeek(
    completion([toolCall("register_question", args)], "tool_calls"),
    completion([text("The answer is A.")]),
  );
  const register = vi.fn<RegisterQuestionHandler>(async () => {});
  const events = await collect(new PiDurableRuntime(modelConfig, register), questionRequest);
  expect(register).not.toHaveBeenCalled();
  expect(events).toEqual([{ type: "turn_failed", error: "Question registration did not complete" }]);
});

it("does not present a card if Host registration fails", async () => {
  mockDeepSeek(
    completion([toolCall("register_question", question)], "tool_calls"),
    completion([text("The answer is A.")]),
  );
  const register: RegisterQuestionHandler = async () => { throw new Error("Host rejected question"); };
  const events = await collect(new PiDurableRuntime(modelConfig, register), questionRequest);
  expect(events.map((event) => event.type)).toEqual(["tool_call", "turn_failed"]);
});

it.each(["signal", "cancelTurn"])("aborts the live provider via %s", async (mechanism) => {
  const providerAborted = vi.fn();
  streamUntilAborted(providerAborted);
  const runtime = new PiDurableRuntime(modelConfig);
  const abort = new AbortController();
  const events: RuntimeEvent[] = [];
  await runtime.runTurn({
    ...request, signal: abort.signal,
    history: [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier answer" }],
  }, (event) => {
    events.push(event);
    if (event.type === "text_delta") {
      if (mechanism === "signal") abort.abort();
      else void runtime.cancelTurn(request.turnId);
    }
  });
  expect(providerAborted).toHaveBeenCalledTimes(1);
  expect(events).toEqual([{ type: "text_delta", delta: "first" }, cancelled]);
});

it("handles pre-aborted requests without contacting DeepSeek", async () => {
  const fetch = mockDeepSeek();
  expect(await collect(new PiDurableRuntime(modelConfig), { ...request, signal: AbortSignal.abort() })).toEqual([cancelled]);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the presented card if Host confirms registration during cancellation", async () => {
  mockDeepSeek(completion([toolCall("register_question", question)], "tool_calls"));
  const abort = new AbortController();
  const register: RegisterQuestionHandler = async () => { abort.abort(); };
  const events = await collect(new PiDurableRuntime(modelConfig, register), { ...questionRequest, signal: abort.signal });
  expect(events.map((event) => event.type)).toEqual(["tool_call", "question_presented", "turn_completed"]);
  expect(events.at(-1)).toEqual({ type: "turn_completed", stopReason: "question_presented" });
});

const gradeRequest = { prompt: "Explain", expectedAnswer: "Reference", learnerAnswer: "Answer", criteria: ["concept"] };
const grade = { result: "partial", score: 0.5, rationale: "Partial evidence", criteria_met: ["concept"] };

it("requests JSON mode and validates the returned assessment", async () => {
  const fetch = mockDeepSeek(completion([text(JSON.stringify(grade))]));
  expect(await gradeQualitatively(modelConfig, gradeRequest)).toEqual(grade);
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body.response_format).toEqual({ type: "json_object" });
});

it.each(["not JSON", JSON.stringify({ ...grade, score: 2 }), JSON.stringify({ ...grade, criteria_met: ["invented"] })])(
  "rejects invalid grading output",
  async (output) => {
    mockDeepSeek(completion([text(output)]));
    await expect(gradeQualitatively(modelConfig, gradeRequest)).rejects.toThrow(/invalid/i);
  },
);

const decimalQuiz = createPendingQuestion({ question_id: "q2", knowledge_point_id: "kp1",
  prompt: "化成小数", question_type: "short", expected_answer: "0.50", accepted_answers: ["0.5", "ONE HALF"] });

it("uses exact stored choice and accepted short answers without a model request", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const choice = createPendingQuestion({ ...question, expected_answer: "B" });
  expect(await assessSemantically(modelConfig, { question: choice, learner_answer: "我选 B" }, fetch))
    .toMatchObject({ result: "correct", final: true, confidence: 1 });
  expect(exactVerdict(choice, "A 或 B")).toMatchObject({ result: "ungraded", final: false });
  expect(await assessSemantically(modelConfig, { question: decimalQuiz, learner_answer: "  One Half " }, fetch))
    .toMatchObject({ result: "correct", final: true });
  expect(fetch).not.toHaveBeenCalled();
});

it("uses an injected transport and treats 0.8 as final, passing through criteria and feedback", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(completion([text(JSON.stringify({
    result: "partial", confidence: 0.8, feedback: "缺少依据", criteria_met: ["可公约"], reference_answer: "0.5",
  }))]));
  const assessment = await assessSemantically(modelConfig, { question: decimalQuiz, learner_answer: "大概是 0.5" }, fetch);
  expect(assessment).toMatchObject({ result: "partial", confidence: 0.8, final: true, criteria_met: ["可公约"] });
  const payload = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(payload.response_format).toEqual({ type: "json_object" });
  expect(JSON.parse(payload.messages.at(-1).content).learner_answer).toBe("大概是 0.5");
});

it("withholds solution fields on a low-confidence result and rejects invalid assessment JSON", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(completion([text(JSON.stringify({
    result: "partial", confidence: 0.7, feedback: "参考解答", reference_answer: "参考解答", criteria_met: ["依据"],
  }))])).mockResolvedValueOnce(completion([text("invalid json")]));
  const input = { criteria: { objective: "最大公因数", module_objective: "约分" }, learner_answer: "原话" };
  const result = await assessSemantically(modelConfig, input, fetch);
  expect(result).toMatchObject({ result: "ungraded", final: false, confidence: 0.7 });
  expect(JSON.stringify(result)).not.toContain("参考解答");
  await expect(assessSemantically(modelConfig, input, fetch)).rejects.toThrow("invalid assessment JSON");
});

it("validates and shuffles a question group with private answers at every level", () => {
  let id = 0;
  const input = { knowledge_point_id: "kp", question_type: "group" as const, question: "请计算", questions: [
    { question_type: "choice" as const, question: "选一项", options: ["正确正文", "干扰项"], expected_answer: "正确正文",
      explanation: "私有解析" },
    { question_type: "short" as const, question: "写数字", expected_answer: "314159", accepted_answers: ["3.14159"] },
  ] };
  const checked = validateStudyQuestion(input, () => String(++id), 1, () => 0);
  expect(checked.questions[0]).toMatchObject({ knowledge_point_id: "kp", expected_answer: "B", options: [
    { label: "A", body: "干扰项" }, { label: "B", body: "正确正文" },
  ] });
  const visible = JSON.stringify(publicPendingQuestion(checked));
  for (const secretField of ["expected_answer", "accepted_answers", "explanation", "私有解析", "314159", "3.14159"]) {
    expect(visible).not.toContain(secretField);
  }
  expect(() => validateStudyQuestion({ ...input, questions: input.questions.slice(0, 1) }, () => "x", 1)).toThrow(/两至四/);
  expect(() => validateStudyQuestion({ ...input, questions: [{ ...input.questions[0]!, options: ["相同", "相同"] }, input.questions[1]!] },
    () => "x", 1)).toThrow(/不同选项/);
});
