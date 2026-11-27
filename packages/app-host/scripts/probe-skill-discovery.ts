import { createKnowledgePoint, createLearningModule, createLearningProgress } from "@learn-pace/domain";
import { MemoryAppStore } from "@learn-pace/infra";
import { loadModelConfigFromEnv, PiDurableRuntime, type RuntimeEvent, type RuntimeModelRound, type RuntimeTool } from "@learn-pace/runtime";
import { registerMasteryNavigation, type MasteryHandoff } from "../src/mastery/nav-tools.js";

type Output = Awaited<ReturnType<RuntimeTool["execute"]>>;

const skillId = "fraction-coach";
const body = "用一个生活中的具体例子讲解分数除法，再让学习者试一道题。需要例题时读取 references/example.md。";
const cases = [
  { id: "discover", prompt: "我总忘记分数除法为什么要乘倒数，能用一个生活例子教我吗？", discovery: true, explicit: false },
  { id: "ordinary", prompt: "北京是中国的首都吗？用一句话回答。", discovery: true, explicit: false },
  { id: "navigation-baseline", prompt: "请打开我上次的「分数」精通之路学习会话。", discovery: false, explicit: false },
  { id: "navigation-explicit", prompt: "请打开我上次的「分数」精通之路学习会话。", discovery: false, explicit: true },
] as const;

async function main() {
  const config = loadModelConfigFromEnv(process.env);
  const store = new MemoryAppStore();
  const clock = { nowSeconds: () => 10 };
  await store.save(createLearningProgress({ book_id: "fractions", name: "分数", modules: [
    createLearningModule({ id: "mod", order: 0, name: "分数除法", knowledge_points: [
      createKnowledgePoint({ id: "fraction-division", name: "分数除法", module_id: "mod", type: "procedure" }),
    ] }),
  ] }));
  await store.saveSession({ session_id: "study", path_id: "fractions", kind: "mastery", mode: "study",
    title: "分数除法练习", model_id: null, created_at: 1, updated_at: 2 });

  for (const sample of cases) {
    const runtime = new PiDurableRuntime(config);
    const handoffs: MasteryHandoff[] = [];
    const rounds: RuntimeModelRound[] = [];
    const calls: string[] = [];
    let terminal: RuntimeEvent | undefined;
    let loaded = sample.explicit;
    const allowed = registerMasteryNavigation(runtime, store, clock, (card) => handoffs.push(card));
    const register = (name: string, description: string, fields: string[], execute: (args: Record<string, unknown>) => Output) => {
      allowed.push(name);
      runtime.registerTool({ name, description, parameters: {
        type: "object", properties: Object.fromEntries(fields.map((key) => [key, { type: "string" }])),
        required: fields, additionalProperties: false,
      }, async execute(args) { return execute(args); } });
    };
    if (sample.discovery) {
      register("list_local_skills", "列出当前可用的本地教学技能。", [], () => ({
        skills: [{ skillId, description: "通过生活例子讲解分数除法的教学方法。" }],
      }));
      register("load_skill", "加载一个已列出的本地技能正文。", ["skillId"], (args): Output => {
        if (args.skillId !== skillId) return { ok: false };
        loaded = true;
        return { ok: true, body };
      });
    }
    if (sample.discovery || sample.explicit) {
      register("list_skill_files", "列出已加载技能的参考文件。", ["skillId"], (args): Output =>
        loaded && args.skillId === skillId ? { files: ["references/example.md"] } : { ok: false });
      register("read_skill_file", "读取已加载技能的参考文本。", ["skillId", "path"], (args): Output =>
        loaded && args.skillId === skillId && args.path === "references/example.md"
          ? { ok: true, text: "把半升果汁每八分之一升装一杯，可以装四杯。" } : { ok: false });
    }
    await runtime.runTurn({
      sessionId: "skill-probe", turnId: sample.id, prompt: sample.prompt, allowedTools: allowed,
      instructions: [
        "你是学习助手 Dito。用户要求继续已有精通之路时，先查询路径和会话，再用导航工具给出交接卡。",
        sample.discovery ? "若问题与本地分数除法教学技能有关，可先列出技能再加载；不相关时直接回答。" : "",
        sample.explicit ? `本轮显式选择的教学资料如下，仅在相关时参考。\n<skill-data>${body}</skill-data>` : "",
      ].filter(Boolean).join("\n"),
      signal: AbortSignal.timeout(90_000), onModelRound: (round) => rounds.push(round),
    }, (event) => {
      if (event.type === "tool_call") calls.push(event.toolName);
      if (event.type === "turn_completed" || event.type === "turn_failed") terminal = event;
    });
    const promptTokens = rounds.every((round) => round.promptTokens !== undefined)
      ? rounds.reduce((total, round) => total + (round.promptTokens ?? 0), 0) : null;
    const stopped = terminal?.type === "turn_completed" ? terminal.stopReason : terminal?.type === "turn_failed" ? terminal.error : null;
    console.log(JSON.stringify({ sample: sample.id, stopped, rounds: rounds.length, promptTokens,
      httpStatus: rounds.map((round) => round.httpStatus), calls, handoffs: handoffs.map((card) => card.kind) }));
  }
}

main().catch(() => {
  console.error("DeepSeek 技能快速探测未完成");
  process.exitCode = 1;
});
