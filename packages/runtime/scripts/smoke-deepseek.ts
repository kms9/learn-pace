import assert from "node:assert/strict";
import {
  gradeQualitatively,
  loadModelConfigFromEnv,
  PiDurableRuntime,
  type RuntimeEvent,
  type RuntimeTurnRequest,
} from "../src/index.js";

const cases = [
  ["streaming", "Explain why the sky is blue in two short paragraphs."],
  ["cancellation", "Write a long story about a walking tour. Use at least 40 numbered paragraphs."],
  ["question", "Use register_question once for knowledge point smoke_ratio and question ID smoke_q. Ask a multiple-choice question about the ratio of 2 to 6 in simplest form, with exactly three options. Never print the answer."],
] as const;

async function main() {
  const config = loadModelConfigFromEnv(process.env);
  const registrations: { id: string; hasAnswer: boolean }[] = [];
  const runtime = new PiDurableRuntime(config, async ({ question }) => {
    registrations.push({ id: question.question_id, hasAnswer: question.expected_answer.length > 0 });
  });

  for (const [name, prompt] of cases) {
    const events: RuntimeEvent[] = [];
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]);
    const request: RuntimeTurnRequest = {
      sessionId: "deepseek-smoke",
      turnId: name,
      pathId: "smoke-path",
      mode: "study",
      prompt,
      allowedTools: name === "question" ? ["register_question"] : [],
      signal,
    };
    const start = performance.now();
    let firstTextMs: number | undefined;
    let deltas = 0;
    await runtime.runTurn(request, (event) => {
      events.push(event);
      if (event.type !== "text_delta") return;
      deltas++;
      firstTextMs ??= Math.round(performance.now() - start);
      if (name === "cancellation") abort.abort();
    });

    const terminal = events.filter((event) => event.type === "turn_completed" || event.type === "turn_failed");
    assert.equal(terminal.length, 1, `${name}: expected exactly one terminal event`);
    const last = terminal[0]!;
    if (last.type === "turn_failed") throw new Error(`${name}: ${last.error}`);
    if (name === "streaming") {
      assert.equal(last.stopReason, "end_turn");
      assert.ok(deltas > 1, "streaming: expected multiple deltas");
      console.log(JSON.stringify({ check: name, stopReason: last.stopReason, deltas, firstTextMs }));
    } else if (name === "cancellation") {
      assert.ok(abort.signal.aborted, "cancellation: no text delta arrived to trigger Abort");
      assert.equal(last.stopReason, "cancelled");
      assert.equal(deltas, 1, "cancellation: text after Abort");
      console.log(JSON.stringify({ check: name, stopReason: last.stopReason, deltas, firstTextMs }));
    } else {
      assert.equal(last.stopReason, "question_presented");
      assert.deepEqual(events.map(({ type }) => type), ["tool_call", "question_presented", "turn_completed"]);
      const presented = events.find((event) => event.type === "question_presented")!;
      assert.equal(presented.question.options.length, 3);
      assert.deepEqual(registrations, [{ id: presented.question.question_id, hasAnswer: true }]);
      assert.ok(!JSON.stringify(events).includes('"expected_answer"'), "question: private field reached the event stream");
      console.log(JSON.stringify({ check: name, stopReason: last.stopReason, options: presented.question.options.length, deltas }));
    }
  }

  const samples = [
    { learnerAnswer: "It is the amount of change in position divided by elapsed time, including direction.", result: "correct" },
    { learnerAnswer: "It is how far something travels.", result: "incorrect" },
    { learnerAnswer: "It is displacement divided by time, but it has no direction.", result: "partial" },
  ];
  for (const sample of samples) {
    const grade = await gradeQualitatively(config, {
      prompt: "Define average velocity. Full credit requires both rate of displacement and direction. Give partial credit for either criterion alone. Give zero for neither.",
      expectedAnswer: "Average velocity is displacement divided by elapsed time and is a vector with direction.",
      learnerAnswer: sample.learnerAnswer,
      criteria: ["rate of displacement", "direction"],
      signal: AbortSignal.timeout(90_000),
    });
    assert.equal(grade.result, sample.result, "grading: unexpected classification");
    console.log(JSON.stringify({ check: "grading", result: grade.result, score: grade.score, criteriaCount: grade.criteria_met.length }));
  }
}

main().catch((error: unknown) => {
  // Configuration and adapter errors are bounded. Unexpected errors may carry provider request data.
  const message = error instanceof Error ? error.message : "";
  const safeMessage = /^(?:Missing |Invalid PI_|Unsupported PI_|PI_MAX_TOKENS |(?:streaming|cancellation|question|grading): |DeepSeek request failed|Model returned )/.test(message)
    ? message.split("\n", 1)[0]
    : "DeepSeek smoke assertion or request failed";
  console.error(safeMessage);
  process.exitCode = 1;
});
