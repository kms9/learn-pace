import { afterEach, expect, it, vi } from "vitest";
import { newTutor } from "../../../../scripts/s7-verify/tools";
import { runTutorTurn } from "../../../../scripts/s7-verify/tutor-loop";
import { PiDurableRuntime, type RuntimeEvent } from "../index.js";
import { completion, mockDeepSeek, modelConfig, text, toolCall } from "./deepseek-fixture.js";

afterEach(() => vi.unstubAllGlobals());

it("uses live mode after a refusal and streams pre-quiz text before the safe terminal card", async () => {
  const transport = mockDeepSeek(
    completion([toolCall("mastery_mode", { mode: "study" })], "tool_calls"),
    completion([toolCall("mastery_build", { mode: "replace", modules: [
      { name: "Ratios", objective: "Simplify", knowledge_points: [{ name: "Reducing", type: "procedure" }] },
    ] })], "tool_calls"),
    completion([toolCall("mastery_mode", { mode: "study" })], "tool_calls"),
    completion([text("Try applying the rule."), toolCall("mastery_quiz", {
      knowledge_point_id: "kp-1", question: "Choose an example.", question_type: "choice",
      options: ["answer-private", "decoy"], expected_answer: "answer-private", explanation: "explanation-private",
    })], "tool_calls"),
  );
  const state = newTutor("offline", "Ratios");
  const deltas = vi.fn();
  const result = await runTutorTurn({
    runtime: new PiDurableRuntime(modelConfig), state, history: [
      { role: "user", content: "Earlier prompt" }, { role: "assistant", content: "Earlier answer" },
    ],
    learnerText: "Start", stage: "pilot", env: "node", index: 1, scenario: "offline",
    reasoning: "high", maxTurns: 8, onText: deltas,
  });
  expect(state.mode).toBe("study");
  expect(result.record.tool_calls.map(({ name, code }) => [name, code])).toEqual([
    ["mastery_mode", "outline_required"], ["mastery_build", "ok"], ["mastery_mode", "ok"], ["mastery_quiz", "ok"],
  ]);
  expect(transport).toHaveBeenCalledTimes(4);
  const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
  expect(body.messages.map(({ role }: { role: string }) => role)).toEqual(["system", "user", "assistant", "user"]);
  expect(result.record).toMatchObject({ turn_status: "question_presented", pre_quiz_streamed_live: true,
    quiz_terminated_immediately: true, answer_leaked_in_text: false, internal_rounds: 4 });
  expect(deltas).toHaveBeenCalledWith("Try applying the rule.");
  expect(JSON.stringify(result)).not.toContain("answer-private");
});

it("lets a generic terminating tool commit once and suppresses sibling tool side effects", async () => {
  mockDeepSeek(completion([
    text("One step."), toolCall("finish", { secret: "private" }), toolCall("later", {}, 1),
  ], "tool_calls"));
  const runtime = new PiDurableRuntime(modelConfig);
  const later = vi.fn(async () => true);
  const events: RuntimeEvent[] = [];
  runtime.registerTool({ name: "finish", description: "Finish.", parameters: { type: "object" },
    privateArgs: true, execute: async () => true, termination: () => ({}) });
  runtime.registerTool({ name: "later", description: "Later.", parameters: { type: "object" }, execute: later });
  await runtime.runTurn({ sessionId: "s", turnId: "t", prompt: "Finish", allowedTools: ["finish", "later"] },
    (event) => events.push(event));
  expect(later).not.toHaveBeenCalled();
  expect(events).toContainEqual({ type: "turn_completed", stopReason: "tool_terminated" });
  expect(JSON.stringify(events)).not.toContain("private");
});
