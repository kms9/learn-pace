import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModelConfigFromEnv, PiDurableRuntime } from "../../packages/runtime/src/index";
import { benchmarkStep, subjects } from "./scenarios";
import { newTutor } from "./tools";
import { runTutorTurn, type History, type Stage } from "./tutor-loop";

async function main() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  process.loadEnvFile(resolve(root, ".env"));
  const configured = loadModelConfigFromEnv(process.env);
  const stage: Stage = process.argv.includes("--pilot") ? "pilot" : process.argv.includes("--calibration") ? "calibration" : "benchmark";
  const config = { ...configured, reasoning: process.argv.includes("--off") ? undefined : configured.reasoning };
  const reasoning = config.reasoning ?? "off";
  const startAt = Number(process.env.LEARN_PACE_S7_FIRST_RUN ?? "1");
  const endAt = Number(process.env.LEARN_PACE_S7_LAST_RUN ?? "10");
  const maxTurns = Number(process.env.LEARN_PACE_S7_MAX_TURNS ?? "8");
  if (!(Number.isInteger(startAt) && Number.isInteger(endAt) && startAt >= 1 && endAt <= 10 && startAt <= endAt &&
    Number.isInteger(maxTurns) && maxTurns > 0)) {
    throw new Error("Invalid benchmark bounds");
  }
  const directory = resolve(root, "tmp/s7-verify");
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, stage + "-" + reasoning + "-" + startAt + "-" + endAt + ".jsonl");
  const proof = resolve(directory, stage + "-" + reasoning + "-" + startAt + "-" + endAt + "-review.jsonl");
  await writeFile(output, "", { flag: "wx" });
  await writeFile(proof, "", { flag: "wx" });
  const redact = (text: string) => text
    .replaceAll(config.apiKey, "[redacted]")
    .replaceAll(config.baseUrl, "[gateway]")
    .replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._~+\/-]{8,}/gi, "[redacted]");
  for (let run = startAt; run <= endAt; run++) {
    const group = Math.floor((run - 1) / 2);
    const id = "run-" + String(run).padStart(2, "0");
    const state = newTutor(id, subjects[group]!.goal);
    const history: History = [];
    for (let index = 1; index <= 5; index++) {
      const revision = state.revision;
      const step = benchmarkStep(group, index, state);
      const { record, text } = await runTutorTurn({
        runtime: new PiDurableRuntime(config), state, history, learnerText: step.text, receipt: step.receipt,
        stage, env: "node", index, scenario: step.label, reasoning, maxTurns, expectedDenials: step.denials,
      });
      const notes = [record.notes];
      const observedDenial = step.label !== "empty-outline-denial" || record.tool_calls.some((call) => call.induced);
      const recoveredAppend = step.label !== "study-append-and-recover" || state.revision > revision ||
        record.tool_calls.some((call) => call.induced);
      const gradeObserved = step.label !== "tool-grade-explicit-answer" ||
        record.tool_calls.some((call) => call.name === "mastery_grade" && call.code === "ok");
      if (!step.check(state) || !observedDenial || !recoveredAppend || !gradeObserved) {
        record.passed = false;
        notes.push("scenario_assertion");
      }
      if (record.quiz_terminated_immediately === false || record.answer_leaked_in_text) {
        record.passed = false;
        notes.push(record.answer_leaked_in_text ? "leak_suspected" : "quiz_not_terminal");
      }
      record.notes = notes.filter(Boolean).join(",");
      await appendFile(output, JSON.stringify(record) + "\n");
      if (record.quiz_terminated_immediately !== null) {
        const question = state.pending;
        await appendFile(proof, JSON.stringify({
          id, index, text: redact(text), question: redact(question?.prompt ?? ""),
          reference: redact(question?.question_type === "choice"
            ? question.options.find(({ label }) => label === question.expected_answer)?.body ?? ""
            : question?.expected_answer ?? ""),
        }) + "\n");
      }
      console.log(id + "/" + index + " " + (record.passed ? "pass" : "fail") + " " + record.turn_status +
        " " + record.total_ms + "ms " + (record.notes || "ok"));
    }
  }
}

main().catch(() => {
  console.error("S7 benchmark stopped before completion; check local configuration and output directory.");
  process.exitCode = 1;
});
