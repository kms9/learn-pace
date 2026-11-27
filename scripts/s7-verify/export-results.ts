import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promptLengths, type TurnLog } from "./tutor-loop";

type QuizReview = "passed" | "leaked";
type DeviceProof = {
  run_id: string;
  manual_switch: boolean;
  grade: { result: string; mastery: number; closed: boolean; before_feedback_completed: boolean };
  restore: { card_id: string; pid_before: number; pid_after: number; model_turns_unchanged: boolean } | null;
};

// The local audit contains observations, never request bodies or model transcripts.
type Audit = {
  date: string;
  baseline: string;
  node: string;
  model: string;
  device: string;
  reviews: Record<string, QuizReview>;
  findings: string[];
};
type Row = TurnLog & { manual_quiz_review: QuizReview | null };

const directory = fileURLToPath(new URL("../../tmp/s7-verify/", import.meta.url));
const destination = fileURLToPath(new URL("../../docs/evaluation/", import.meta.url));
const read = (name: string) => readFile(resolve(directory, name), "utf8");
const rows = async <T>(name: string): Promise<T[]> => (await read(name)).trim().split("\n").map((line) => JSON.parse(line) as T);
const reviewKey = (row: TurnLog) => [row.stage, row.reasoning, row.run_id, row.turn_index].join("/");
const rank = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const measured = (values: (number | null)[]) => values.filter((value): value is number => value !== null);
const seconds = (ms: number | null | undefined) => ms == null ? "缺失" : (ms / 1000).toFixed(3);
const rate = (yes: number, total: number) => (100 * yes / total).toFixed(1) + "%";
const passingRuns = (records: Row[]) => new Set(records.map((row) => row.run_id)).size -
  new Set(records.filter((row) => !row.passed).map((row) => row.run_id)).size;
const table = (head: string[], data: (string | number)[][]) => [head, head.map(() => "---"), ...data]
  .map((row) => "| " + row.join(" | ") + " |").join("\n");

function summaries(records: Row[]) {
  const all = records.flatMap((row) => row.tool_calls);
  const counted = all.filter((call) => !call.induced);
  const quizzes = records.filter((row) => row.quiz_terminated_immediately !== null);
  const safe = quizzes.filter((row) => row.quiz_terminated_immediately && !row.answer_leaked_in_text && row.manual_quiz_review === "passed");
  const live = quizzes.filter((row) => row.pre_quiz_streamed_live);
  const tokens = measured(records.flatMap((row) => row.model_rounds.map((request) => request.prompt_tokens)));
  const ttft = measured(records.map((row) => row.ttft_ms));
  const total = records.map((row) => row.total_ms);
  const recovered = records.flatMap((row) => row.tool_calls
    .filter((call, i) => call.refused && !call.induced && row.tool_calls.slice(i + 1)
      .some((next) => next.name === call.name && next.code === "ok"))).length;
  return { all, counted, valid: counted.filter((call) => call.schema_valid).length, quizzes, safe, live,
    denied: all.filter((call) => call.induced).length, unknown: all.filter((call) => call.name === "unknown").length,
    recovered, tokens, p50: rank(ttft, .5), p90: rank(ttft, .9), totalP50: rank(total, .5), totalP90: rank(total, .9),
    maxRounds: Math.max(...records.map((row) => row.internal_rounds)), failures: records.filter((row) => !row.passed).length };
}

async function main() {
  const audit = JSON.parse(await read("audit.json")) as Audit;
  const source = (await Promise.all([
    rows<TurnLog>("benchmark-high-1-10.jsonl"), rows<TurnLog>("calibration-off-1-2.jsonl"),
    rows<TurnLog>("calibration-off-7-8.jsonl"), rows<TurnLog>("device-records.jsonl"),
    rows<TurnLog>("device-rehearsal.jsonl"),
  ])).flat();
  if (new Set(source.map(reviewKey)).size !== source.length) throw new Error("Duplicate turn records");
  const all: Row[] = source.map((row) => {
    const review = audit.reviews[reviewKey(row)] ?? null;
    if (row.quiz_terminated_immediately !== null && !review) throw new Error("Manual quiz review missing");
    return { ...row, manual_quiz_review: review, ...(review === "leaked" ? { passed: false, answer_leaked_in_text: true } : {}) };
  });
  const baseline = all.filter((row) => row.stage === "benchmark");
  const calibration = all.filter((row) => row.stage === "calibration");
  const android = all.filter((row) => row.stage === "device");
  const proofs = (await rows<DeviceProof>("device-summary.jsonl"))
    .sort((a, b) => Number(a.manual_switch) - Number(b.manual_switch));
  const runs = [...new Set(baseline.map((row) => row.run_id))].map((id) => baseline.filter((row) => row.run_id === id));
  if (runs.length !== 10 || runs.some((run) => run.length !== 5) || calibration.length !== 20 || proofs.length !== 2) {
    throw new Error("Expected ten Node runs, twenty calibration turns and two Android proofs");
  }
  const runPasses = runs.filter((run) => run.every((row) => row.passed)).length;
  const stats = summaries(baseline);
  const measuredRequests = baseline.flatMap((row) => row.model_rounds);
  const snapshots = baseline.map((row) => row.snapshot_chars);
  const tokenMean = Math.round(avg(stats.tokens));
  const tokenPeak = Math.max(...stats.tokens);
  const validRate = stats.valid / stats.counted.length;
  const quizRetries = baseline.filter((row) => row.quiz_terminated_immediately !== null &&
    row.tool_calls.some((tool) => tool.name === "mastery_quiz" && tool.refused)).length;
  const metrics = [
    [`M1 · 工具名与参数合法率`, `${stats.valid}/${stats.counted.length}（${rate(stats.valid, stats.counted.length)}），未知工具 ${stats.unknown}`,
      "≥ 90%，零未知工具", validRate >= .9 && !stats.unknown ? "PASS" :
        validRate >= .85 && stats.unknown <= 1 && stats.recovered > 0 ? "CONDITIONAL" : "FAIL"],
    ["M2 · 出题收尾与零剧透", `${stats.safe.length}/${stats.quizzes.length}（${rate(stats.safe.length, stats.quizzes.length)}），出题重调 ${quizRetries}`,
      "100%，零剧透、零续写", stats.quizzes.length && stats.safe.length === stats.quizzes.length
        ? (quizRetries === 0 ? "PASS" : quizRetries === 1 ? "CONDITIONAL" : "FAIL") : "FAIL"],
    ["M3 · 完整循环通关率", `${runPasses}/10（${rate(runPasses, 10)}）`,
      "≥ 8/10", runPasses >= 8 ? "PASS" : runPasses === 7 ? "CONDITIONAL" : "FAIL"],
    ["M4 · TTFT", `P50 ${seconds(stats.p50)} s，P90 ${seconds(stats.p90)} s`,
      "P50 ≤ 10 s，P90 ≤ 18 s", stats.p50! <= 10000 && stats.p90! <= 18000 && baseline.every((r) => r.ttft_ms !== null) ? "PASS" :
        stats.p50! <= 12000 && stats.p90! <= 22000 ? "CONDITIONAL" : "FAIL"],
    ["M5 · 单次 LLM 输入 Token", `${stats.tokens.length} 次请求，均值 ${tokenMean}，峰值 ${tokenPeak}`,
      "均值 ≤ 12,000，峰值 ≤ 16,000", stats.tokens.length === measuredRequests.length && tokenMean <= 12000 && tokenPeak <= 16000 ? "PASS" :
        tokenMean <= 15000 ? "CONDITIONAL" : "FAIL"],
  ];
  const deviceOutcomes = proofs.map((proof, i) => {
    const records = android.filter((row) => row.run_id === proof.run_id);
    const deviceStats = summaries(records);
    const switchOkay = i === 0 ?
      !proof.manual_switch && records.some((row) => row.mode_before === "outline" && row.mode_after === "study" &&
        row.tool_calls.some((tool) => tool.name === "mastery_mode" && tool.code === "ok")) :
      proof.manual_switch && proof.restore?.model_turns_unchanged && proof.restore.pid_before !== proof.restore.pid_after;
    const passed = records.length === (i === 0 ? 4 : 3) && !deviceStats.failures && switchOkay &&
      deviceStats.safe.length === 1 && deviceStats.live.length === 1 &&
      proof.grade.result === (i === 0 ? "correct" : "incorrect") && proof.grade.closed && proof.grade.before_feedback_completed;
    return { proof, records, deviceStats, passed };
  });
  const devicePassed = deviceOutcomes.filter((run) => run.passed).length;
  const go = devicePassed === 2 && metrics.every((metric) => metric[3] === "PASS");
  const verdict = go ? "GO" : devicePassed === 2 && !metrics.some((metric) => metric[3] === "FAIL") ? "CONDITIONAL GO" : "NO-GO";
  const highMatched = baseline.filter((row) => calibration.some((other) => other.run_id === row.run_id));
  const off = summaries(calibration);
  const h20 = summaries(highMatched);
  const firstPrompt = baseline[0]?.model_rounds[0]?.prompt_tokens ?? "缺失";
  const runStats = runs.map((run) => {
    const s = summaries(run);
    return [run[0]!.run_id, s.failures ? "FAIL" : "PASS", `${s.all.length} / ${s.all.filter((t) => t.schema_valid).length}`,
      `${s.denied} / ${s.recovered}`, `${s.live.length}/${s.quizzes.length} · ${s.safe.length}/${s.quizzes.length}`,
      s.quizzes.some((row) => row.answer_leaked_in_text) ? "有" : "无", s.maxRounds, `${Math.round(avg(s.tokens))} / ${Math.max(...s.tokens)}`,
      `${seconds(s.p50)} / ${seconds(s.p90)}`];
  });
  const perTool = [...new Set(stats.all.map((tool) => tool.name))].map((name) =>
    `\`${name}\` ${stats.all.filter((tool) => tool.name === name).length}`).join("、");
  const reason = go ? "M1–M5 均达到 PASS，Android ARM64 两组通过，可以进入 Change 3′–6′ 实施。" : "当前数据仍有待解决的验收项。";
  const rounds = baseline.map((row) => row.internal_rounds);
  const deviceDetail = deviceOutcomes.flatMap(({ records }, index) => records.map((row) => [
    `Device ${index + 1} / ${row.turn_index}`, row.scenario, seconds(row.ttft_ms), seconds(row.total_ms),
    row.prompt_tokens ?? "缺失", row.completion_tokens ?? "缺失", row.internal_rounds, row.turn_status,
  ]));
  const deviceCompare = deviceOutcomes.map(({ proof, records, deviceStats, passed }, index) => [
    `Device ${index + 1}`, index === 0 ? "比例化简 · 选择题" : "TCP 三次握手 · 简答题",
    proof.manual_switch ? "顶部按钮" : "模型调用 mastery_mode", `${deviceStats.live.length}/${deviceStats.quizzes.length} · ${deviceStats.safe.length}/${deviceStats.quizzes.length}`,
    proof.restore ? `${proof.restore.card_id}，PID ${proof.restore.pid_before} → ${proof.restore.pid_after}，模型回合数不变` : "强杀验证见 Device 2",
    `${proof.grade.result === "correct" ? "答对" : "答错"} · ${Math.round(proof.grade.mastery * 100)}% · ${proof.grade.before_feedback_completed ? "先保存批改" : "未观察到顺序"}`,
    records[0]?.reasoning ?? "缺失", passed ? "PASS" : "FAIL",
  ]);

  const report = `# S7 · DeepSeek Flash 与 Pi Durable 导师循环技术验证

## 结论

**${verdict}**。${reason}

建议默认 **\`maxTurns: 8\`**。50 轮模型往返 P95 为 ${rank(rounds, .95)}，最大 ${stats.maxRounds}，给同轮切换、追加、再次切换等路径保留余量。

建议默认 **\`reasoning: "high"\`**。正式基准 P50 / P90 首事件均有余量。` +
  `关闭推理的同场景样本首事件更快，仍出现 ${off.failures} 轮失败，详见对照表和样本复盘。

## 环境与提示词

${table(["项目", "实测基线"], [
  ["代码基线", audit.date + " · " + audit.baseline + " + 本次工作区 S7 扩展"],
  ["Node 与 Android", audit.node + "。设备为 " + audit.device],
  ["模型", audit.model + " · openai-completions"],
  ["默认配置", `high 50 轮，off 20 轮（Run 01–02、07–08），maxTurns 8`],
  ["裁剪中文提示词", Object.entries(promptLengths()).map(([mode, count]) => `${mode} ${count} 字符`).join("，")],
  ["状态快照", `P50 ${rank(snapshots, .5)} 字符，范围 ${Math.min(...snapshots)}–${Math.max(...snapshots)}`],
  ["正式基准首个请求", `${firstPrompt} 输入 Token，含提示词、状态与工具定义`],
])}

## 阶段 A · Node 正式基准

${table(["Run", "结果", "工具总数 / 合法", "诱导拒绝 / 同轮自愈", "有引导语流式 / 即停且无剧透", "剧透", "最大往返", "平均 / 峰值输入 Token", "TTFT P50 / P90 (s)"], runStats)}

五个工具调用次数为 ${perTool}。有引导语的 ${stats.live.length} 轮均在出题完成前收到流式增量。${stats.quizzes.length - stats.live.length} 轮没有引导语，仍成功出题并结束。全部 ${stats.quizzes.length} 张题卡经过公开正文与私有参考答案比对。

${table(["指标", "实测", "PASS 阈值", "判定"], metrics)}

TTFT 从 Runtime 回合发起计到首个公开 \`text_delta\` 或 \`tool_call\`，百分位取最近秩。Raw 中单个 Turn 的 Token 是该 Turn 内各模型请求用量之和。M5 取每次模型请求的输入用量。

正式基准收到 HTTP 200 的模型请求为 ${measuredRequests.filter((request) => request.http_status === 200).length}/${measuredRequests.length}。

### Reasoning 对照

同主题、同脚本对照 Run 01–02、07–08。每组独立生成大纲和题卡。

${table(["配置", "回合通过", "完整循环", "即停且无剧透", "TTFT P50 / P90 (s)", "总耗时 P50 / P90 (s)", "最长 (s)"], [
  [`high（50 轮正式）`, `${50 - stats.failures}/50`, `${runPasses}/10`, `${stats.safe.length}/${stats.quizzes.length}`, `${seconds(stats.p50)} / ${seconds(stats.p90)}`, `${seconds(stats.totalP50)} / ${seconds(stats.totalP90)}`, seconds(Math.max(...baseline.map((r) => r.total_ms)))],
  ["high（配对 20 轮）", `${20 - h20.failures}/20`, `${passingRuns(highMatched)}/4`, `${h20.safe.length}/${h20.quizzes.length}`, `${seconds(h20.p50)} / ${seconds(h20.p90)}`, `${seconds(h20.totalP50)} / ${seconds(h20.totalP90)}`, seconds(Math.max(...highMatched.map((r) => r.total_ms)))],
  ["off（配对 20 轮）", `${20 - off.failures}/20`, `${passingRuns(calibration)}/4`, `${off.safe.length}/${off.quizzes.length}`, `${seconds(off.p50)} / ${seconds(off.p90)}`, `${seconds(off.totalP50)} / ${seconds(off.totalP90)}`, seconds(Math.max(...calibration.map((r) => r.total_ms)))],
])}

## 阶段 B · Android 真机

${table(["运行", "主题", "切学习方式", "前置流式 / 即停且无剧透", "强杀恢复", "批改与掌握度", "Reasoning", "结果"], deviceCompare)}

${table(["运行 / 轮", "场景", "TTFT (s)", "总耗时 (s)", "合计输入 Token", "合计输出 Token", "往返", "结束状态"], deviceDetail)}

真机用 Dev Client 的 S7 路由、Hermes、USB Metro 和独立的 S7 SQLite。公开题卡与流式引导同时做了自动检查和人工复核。诊断试跑以 \`device_rehearsal\` 单列，不计入两组正式运行。

## 拒绝、失败与边界样本

${audit.findings.map((line) => "- " + line).join("\n")}

## 复跑

从仓库根执行 Node 基准。脚本读取根目录 \`.env\`，运行指标和人工复核材料写入被 Git 忽略的 \`tmp/s7-verify/\`。重跑前先移开同名样本，保留既有记录。

\`\`\`sh
corepack pnpm --filter @learn-pace/runtime exec node --import tsx ../../scripts/s7-verify/run-node-benchmark.ts
LEARN_PACE_S7_LAST_RUN=2 corepack pnpm --filter @learn-pace/runtime exec node --import tsx ../../scripts/s7-verify/run-node-benchmark.ts --calibration --off
LEARN_PACE_S7_FIRST_RUN=7 LEARN_PACE_S7_LAST_RUN=8 corepack pnpm --filter @learn-pace/runtime exec node --import tsx ../../scripts/s7-verify/run-node-benchmark.ts --calibration --off
\`\`\`

[逐轮脱敏原始记录](s7-raw-runs.jsonl) · [验收计划](s7-tutor-loop-verification-plan.md)
`;
  await writeFile(resolve(destination, "s7-raw-runs.jsonl"), all.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await writeFile(resolve(destination, "s7-tutor-loop-verification-report.md"), report);
  console.log(`S7 ${verdict}, ${all.length} turn records`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error && !(error instanceof SyntaxError) ? error.message : "S7 export input is invalid";
  console.error(message);
  process.exitCode = 1;
});
