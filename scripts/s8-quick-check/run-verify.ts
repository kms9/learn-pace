import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateQuickCheck, loadModelConfigFromEnv, QuickCheckGenerationError, requestModelId,
} from "../../packages/runtime/src/index.js";
import { samples } from "./scenarios.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

function percentile(samplesMs: number[], fraction: number): number {
  return [...samplesMs].sort((a, b) => a - b)[Math.ceil(samplesMs.length * fraction) - 1]!;
}

async function main() {
  process.loadEnvFile(resolve(root, ".env"));
  const config = loadModelConfigFromEnv(process.env);
  if (!/^deepseek.*flash$/i.test(requestModelId(config))) {
    throw new Error("需要 DeepSeek Flash 模型");
  }
  const workspace = resolve(root, "tmp/s8-quick-check");
  await mkdir(workspace, { recursive: true });
  const directory = await mkdtemp(resolve(workspace, "run-"));
  const output = resolve(directory, "cases.jsonl");
  const redact = (text: string) => text.replaceAll(config.apiKey, "[已脱敏]")
    .replaceAll(config.baseUrl, "[网关已脱敏]")
    .replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._~+\/-]{8,}/gi, "[已脱敏]");
  const times: number[] = [];
  let shapePasses = 0;
  let leakPasses = 0;

  for (const [index, { name, ...sample }] of samples.entries()) {
    const started = performance.now();
    let result;
    let status = "pass";
    try {
      result = await generateQuickCheck(config, { ...sample, signal: AbortSignal.timeout(45_000) });
    } catch (error) {
      status = error instanceof QuickCheckGenerationError ? error.code : "request_failed";
    }
    const elapsedMs = Math.round(performance.now() - started);
    times.push(elapsedMs);
    if (result || status === "answer_leak") shapePasses++;
    if (result) leakPasses++;
    const review = result && {
      intro: redact(result.intro),
      questions: result.questions.map(({ prompt, question_type, options, expected_answer, accepted_answers, explanation }) => ({
        prompt: redact(prompt),
        type: question_type,
        options: options.map(({ label, body }) => ({ label, body: redact(body) })),
        expected: redact(expected_answer),
        accepted: accepted_answers.map(redact),
        explanation: redact(explanation),
      })),
    };
    await appendFile(output, JSON.stringify({ index: index + 1, name, status, elapsedMs, review }) + "\n", { mode: 0o600 });
    console.log(index + 1, name, status, elapsedMs + "ms");
  }

  const summary = {
    model: requestModelId(config),
    mode: "non-thinking",
    total: samples.length,
    shapePasses,
    leakPasses,
    p50Ms: percentile(times, 0.50),
    p90Ms: percentile(times, 0.90),
  };
  const passed = shapePasses >= 9 && leakPasses === samples.length && summary.p50Ms <= 10_000 && summary.p90Ms <= 18_000;
  await writeFile(resolve(directory, "summary.json"), JSON.stringify({ ...summary, passed }, null, 2) + "\n");
  console.log(JSON.stringify({ ...summary, passed, directory }));
  if (!passed) process.exitCode = 1;
}

void main().catch(() => {
  console.error("S8 小验证未完成，请检查本地模型配置和临时输出目录。");
  process.exitCode = 1;
});
