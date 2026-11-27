import { createKnowledgePoint, createLearningModule, createLearningProgress } from "@learn-pace/domain";
import { MemoryAppStore } from "@learn-pace/infra";
import { loadModelConfigFromEnv, PiDurableRuntime, type RuntimeEvent, type RuntimeModelRound } from "@learn-pace/runtime";
import { zipSync } from "fflate";
import { chatInstructions } from "../src/lf01-chat.js";
import { SkillService } from "../src/extensions/skills/skill-service.js";
import { TurnExtensionResolver } from "../src/extensions/turn-scope/index.js";
import { registerTurnSkills } from "../src/extensions/turn-scope/skill-tools.js";
import { registerMasteryNavigation, type MasteryHandoff } from "../src/mastery/nav-tools.js";

const reference = "references/juice.md";
const samples = [
  { prompt: "总忘了分数除法为什么要乘倒数，能用果汁分杯的参考例子教我吗？", skill: "fraction-coach", file: reference },
  { prompt: "我把二分之一除以八分之一算错了，想看看分数除法教学资料里的例题。", skill: "fraction-coach", file: reference },
  { prompt: "请用本地教学里的例子解释分数除法和装满几杯之间的关系。", skill: "fraction-coach", file: reference },
  { prompt: "我在练习英语固定搭配，想用间隔回忆法试着说出几个搭配。", skill: "vocab-recall" },
  { prompt: "我记不住新学的英语词组，可以用回忆优先的方法练习吗？", skill: "vocab-recall" },
  { prompt: "请通过主动回忆帮我练习英文短语，不要先把答案给我。", skill: "vocab-recall" },
  { prompt: "用一句话说明天空为什么是蓝色的。" },
  { prompt: "现在日本的首都是哪个城市？" },
  { prompt: "请把「今天好冷」翻译成西班牙语。" },
  { prompt: "概括 photosynthesis 的定义即可，不要出题。" },
  { prompt: "怎样煮一杯咖啡？只需两条步骤。" },
  { prompt: "请直说 8 × 7 的结果。" },
];
const navigation = [
  { prompt: "帮我续上之前的「比例」精通之路学习会话。", kind: "open" },
  { prompt: "帮我在「比例」精通之路新开一次学习会话，给我入口。", kind: "new" },
] as const;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function main() {
  const config = loadModelConfigFromEnv(process.env);
  const store = new MemoryAppStore();
  const clock = { nowSeconds: () => 10 };
  const resolver = new TurnExtensionResolver(store, true);
  const service = new SkillService(store, clock, () => false);
  const encode = (value: string) => new TextEncoder().encode(value);
  async function install(name: string, description: string, instructions: string, file?: string) {
    const entry = encode(`---\nname: ${name}\ndescription: ${description}\n---\n${instructions}`);
    const preview = await service.previewLocal(file ? zipSync({ "SKILL.md": entry, [reference]: encode(file) }) : entry,
      file ? "local_zip" : "local_file");
    await service.confirm(preview);
    await service.setEnabled(name, true);
    await service.setScope(name, "lf01", true);
  }
  await install("fraction-coach", "用果汁分杯的参考例题帮助理解分数除法和乘倒数。",
    "先调用 read_skill_file 读取 references/juice.md，再用例题引导学习者自己计算。",
    "半升果汁，每杯八分之一升，正好装四杯。请学习者先把八分之一在数轴上标出。");
  await install("vocab-recall", "英语词组和搭配的主动回忆或间隔回忆练习。", "先给线索让学习者回忆英文词组。回答后再展示答案。");
  await install("bird-song", "辨认录音中北美鸟类的求偶鸣叫。", "询问录音场景和鸣声节奏。");
  await store.save(createLearningProgress({ book_id: "ratios", name: "比例", modules: [
    createLearningModule({ id: "mod", order: 0, name: "化简", knowledge_points: [
      createKnowledgePoint({ id: "ratio", name: "比的化简", module_id: "mod", type: "procedure" }),
    ] }),
  ] }));
  await store.saveSession({ session_id: "study", path_id: "ratios", kind: "mastery", mode: "study",
    title: "比例练习", model_id: null, created_at: 1, updated_at: 2 });

  async function run(id: string, prompt: string, discover: boolean, cancel = false) {
    const runtime = new PiDurableRuntime(config);
    const controller = new AbortController();
    const rounds: RuntimeModelRound[] = [];
    const calls: string[] = [];
    const handoffs: MasteryHandoff[] = [];
    const allowedTools = registerMasteryNavigation(runtime, store, clock, (card) => handoffs.push(card));
    const skills = discover ? registerTurnSkills(runtime, store, await resolver.resolve("lf01"), id) : undefined;
    let terminal: RuntimeEvent | undefined;
    let abortedAt: number | undefined;
    let cancellationMs: number | undefined;
    await runtime.runTurn({
      sessionId: "skill-smoke", turnId: id, prompt,
      instructions: [chatInstructions, skills?.supplementaryInstructions].filter(Boolean).join("\n\n"),
      allowedTools: [...allowedTools, ...skills?.allowedTools ?? []],
      maxTurns: 8,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
      onModelRound: (round) => rounds.push(round),
    }, (event) => {
      if (event.type === "tool_call") calls.push(event.toolName);
      if (cancel && event.type === "text_delta" && abortedAt === undefined) {
        abortedAt = performance.now();
        controller.abort();
      }
      if (event.type === "turn_failed" || event.type === "turn_completed") {
        terminal = event;
        if (abortedAt !== undefined) cancellationMs = Math.round(performance.now() - abortedAt);
      }
    });
    const stopped = terminal?.type === "turn_completed" ? terminal.stopReason : terminal?.type === "turn_failed" ? terminal.error : null;
    const tokens = rounds.length && rounds.every((round) => round.promptTokens !== undefined)
      ? rounds.reduce((total, round) => total + (round.promptTokens ?? 0), 0) : null;
    const receipts = (skills?.auditMetadata?.()?.skill_receipts ?? []) as { skillId: string; status: string; tool?: string; path?: string }[];
    return { id, stopped, rounds: rounds.length, tokens, calls, cancellationMs, http: rounds.map((round) => round.httpStatus),
      loaded: receipts.filter((item) => item.status === "loaded").map((item) => item.skillId),
      read: receipts.filter((item) => item.tool === "read_skill_file" && item.status === "succeeded")
        .map(({ skillId, path }) => ({ skillId, path })),
      navigation: handoffs.map(({ kind, path_id }) => ({ kind, path_id })),
    };
  }

  const results: { sample: (typeof samples)[number]; run: Awaited<ReturnType<typeof run>>; overhead: number | null }[] = [];
  const queue = samples.map((sample, index) => ({ sample, index }));
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { sample, index } = job;
      const base = await run(`baseline-${index + 1}`, sample.prompt, false);
      console.log(JSON.stringify(base));
      for (let repeat = 1; repeat <= 3; repeat++) {
        const observed = await run(`discovery-${index + 1}-${repeat}`, sample.prompt, true);
        const overhead = base.tokens === null || observed.tokens === null ? null : observed.tokens - base.tokens;
        results.push({ sample, run: observed, overhead });
        console.log(JSON.stringify({ ...observed, expectedSkill: sample.skill ?? null, expectedFile: sample.file ?? null, overhead }));
      }
    }
  }));

  const navRuns = await Promise.all(navigation.flatMap((sample, index) => Array.from({ length: 3 }, async (_, repeat) => {
    const observed = await run(`navigation-${index + 1}-${repeat + 1}`, sample.prompt, true);
    const passed = observed.stopped === "end_turn" && observed.navigation.some(({ kind, path_id }) => kind === sample.kind && path_id === "ratios") &&
      observed.calls.includes(sample.kind === "open" ? "mastery_open_session" : "mastery_new_session");
    console.log(JSON.stringify({ ...observed, passed }));
    return passed;
  })));
  const cancels = await Promise.all(Array.from({ length: 3 }, async (_, index) => {
    const observed = await run(`cancel-${index + 1}`, "逐段写一个至少四十段的学习故事。", true, true);
    const passed = observed.stopped === "cancelled" && observed.cancellationMs !== undefined && observed.cancellationMs <= 2000;
    console.log(JSON.stringify({ ...observed, passed }));
    return passed;
  }));

  const relevant = results.filter(({ sample }) => sample.skill);
  const references = relevant.filter(({ sample }) => sample.file);
  const ordinary = results.filter(({ sample }) => !sample.skill);
  const correct = relevant.filter(({ run, sample }) => run.loaded.includes(sample.skill!)).length;
  const read = references.filter(({ run, sample }) => run.read.some(({ skillId, path }) => skillId === sample.skill && path === sample.file)).length;
  const falseLoads = ordinary.filter(({ run }) => run.loaded.length).length;
  const counts = {
    discovery: [correct, relevant.length], references: [read, references.length], falseLoads: [falseLoads, ordinary.length],
    modelFailures: results.filter(({ run }) => run.stopped !== "end_turn").length,
    medianRounds: median(results.map(({ run }) => run.rounds)),
    maxRounds: Math.max(...results.map(({ run }) => run.rounds)),
    medianExtraPromptTokens: median(results.flatMap(({ overhead }) => overhead === null ? [] : [overhead])),
    missingUsage: results.filter(({ overhead }) => overhead === null).length,
    cancels: [cancels.filter(Boolean).length, cancels.length], navigation: [navRuns.filter(Boolean).length, navRuns.length],
  };
  const passed = correct / relevant.length >= 0.8 && read / references.length >= 0.8 && falseLoads / ordinary.length <= 0.2 &&
    counts.modelFailures === 0 && counts.medianRounds !== null && counts.medianRounds <= 4 && counts.maxRounds < 8 &&
    counts.missingUsage === 0 && counts.medianExtraPromptTokens !== null && counts.medianExtraPromptTokens <= 8000 &&
    cancels.every(Boolean) && navRuns.every(Boolean);
  console.log(JSON.stringify({ passed, ...counts }));
  if (!passed) process.exitCode = 1;
}

main().catch(() => {
  console.error("DeepSeek 技能门禁未完成。");
  process.exitCode = 1;
});
