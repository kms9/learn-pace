import { MemoryAppStore, MemorySecretStore } from "@learn-pace/infra";
import { PiDurableRuntime, type RuntimeTool } from "@learn-pace/runtime";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, Lf01ChatService, messageSkillReceipts, messageSkillSelection, publicQuickCheck } from "../index.js";
import { hasActiveChatTurns } from "../chat-turns.js";
import { restoreGateFor } from "../restore-gate.js";
import { SkillService } from "../extensions/skills/skill-service.js";
import { TurnExtensionResolver, TurnSkillBudget } from "../extensions/turn-scope/index.js";
import { registerTurnSkills } from "../extensions/turn-scope/skill-tools.js";

const now = () => 10;
const clock = { nowSeconds: now };
const encode = (value: string) => new TextEncoder().encode(value);
const markdown = (name: string, body: string, flags = "") =>
  encode(`---\nname: ${name}\ndescription: Learn in steps\n${flags}---\n${body}`);
const readPath = "references/prompt.md";
const skillId = "focus-coach";
const reply = (value = "已解释。") => completion([text(value)]);
const tool = (name: string, args: Record<string, unknown>) => completion([toolCall(name, args)], "tool_calls");

function harness(...responses: Response[]) {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift() ?? reply());
  const resolver = new TurnExtensionResolver(store, true);
  let id = 0;
  const makeId = () => String(++id);
  const service = new SkillService(store, clock, () => hasActiveChatTurns(store));
  const host = new AppBootstrapService(store, secrets, { makeId, fetch });
  const normal = host.createLf01ChatService(clock);
  return { store, fetch, service, host, normal, resolver,
    automatic: () => new Lf01ChatService(store, clock, makeId, async () => modelConfig, fetch, restoreGateFor(store), resolver),
    configure: () => host.saveModelSettings(modelConfig),
    request: (index: number) => JSON.parse(String(fetch.mock.calls[index]?.[1]?.body)),
  };
}

async function install({ service }: ReturnType<typeof harness>, {
  name = skillId, body = "分步教学", flags = "", enabled = true, ref = "只供模型查看的唯一示例",
} = {}) {
  const preview = await service.previewLocal(zipSync({ "SKILL.md": markdown(name, body, flags),
    [readPath]: encode(ref), "run.sh": encode("#!/bin/sh"), "image.bin": Uint8Array.of(0xff),
  }), "local_zip");
  const saved = await service.confirm(preview);
  if (enabled) {
    await service.setEnabled(name, true);
    await service.setScope(name, "lf01", true);
  }
  return saved;
}

it("resolves scope and invocation flags independently, with the revision chosen at send time", async () => {
  const h = harness();
  const installed = await install(h, { flags: "disable-model-invocation: true\n" });
  await install(h, { name: "auto-only", flags: "user-invocable: false\n" });
  expect((await h.resolver.resolve("lf01")).discoverable.map((item) => item.skillId)).toEqual(["auto-only"]);
  expect(await h.resolver.selectable("lf01")).toMatchObject([{ skillId }]);
  await expect(h.resolver.resolve("little_tutor", { skillId })).rejects.toMatchObject({ code: "scope_denied" });
  await expect(h.resolver.resolve("lf01", { skillId: "auto-only" })).rejects.toMatchObject({ code: "scope_denied" });
  await h.configure();
  const session = await h.normal.createSession();
  await expect(h.normal.send(session.session_id, "Explain", [], { skillId: [skillId, "auto-only"] as unknown as string })).rejects.toThrow("1 个");
  const next = await install(h, { body: "新版教学资料" });
  const result = await h.normal.send(session.session_id, "继续", [], { skillId });
  const user = (await h.normal.readConversation(session.session_id)).messages[0]!;
  expect(messageSkillSelection(user)).toEqual([{ skillId, revision: next.active_revision }]);
  expect(h.request(0).messages[0].content).toContain("新版教学资料");
  expect(result.status).toBe("committed");
  expect(await h.store.getSkillRevision(skillId, installed.active_revision)).toBeNull();
});

it("performs no writes on first send or regenerate if the selected version is unavailable", async () => {
  const h = harness();
  await h.configure();
  const installed = await install(h);
  const opened = vi.fn();
  const before = await h.store.exportSnapshot();
  await expect(h.normal.sendNew("首条", [], { skillId: "missing", onSession: opened })).rejects.toMatchObject({ code: "revision_missing" });
  expect(opened).not.toHaveBeenCalled();
  expect(h.fetch).not.toHaveBeenCalled();
  expect(await h.store.exportSnapshot()).toEqual(before);

  const result = await h.normal.sendNew("首条", [], { skillId, onSession: opened });
  expect(opened).toHaveBeenCalledOnce();
  const oldRow = await h.store.getSkillRevision(skillId, installed.active_revision);
  await install(h, { body: "新版" });
  await h.store.saveSkillRevision(oldRow!); // 模拟尚未回收。
  const changed = await h.store.exportSnapshot();
  await expect(h.normal.regenerate(result.session_id, result.message_id)).rejects.toMatchObject({ code: "revision_missing" });
  expect(h.fetch).toHaveBeenCalledOnce();
  expect(await h.store.exportSnapshot()).toEqual(changed);
  await h.service.setEnabled(skillId, false);
  const disabled = await h.store.exportSnapshot();
  await expect(h.normal.send(result.session_id, "再次发送", [], { skillId })).rejects.toMatchObject({ code: "skill_disabled" });
  expect(await h.store.exportSnapshot()).toEqual(disabled);
});

it("offers only reference tools for explicit use when discovery is off and stores bounded receipts", async () => {
  const h = harness(tool("read_skill_file", { skillId, path: readPath }), reply());
  await h.configure();
  const installed = await install(h, { flags: "disable-model-invocation: true\n" });
  const response = await h.normal.sendNew("请读取参考文件", [], { skillId });
  const names = (index: number) => h.request(index).tools.map(({ function: f }: { function: { name: string } }) => f.name);
  expect(names(0)).toEqual(expect.arrayContaining(["list_skill_files", "read_skill_file"]));
  expect(names(0)).not.toContain("load_skill");
  expect(h.request(1).messages.at(-1).content).toContain("只供模型查看的唯一示例");
  expect(messageSkillReceipts(response)).toMatchObject([
    { skillId, revision: installed.active_revision, status: "explicit_loaded" },
    { skillId, revision: installed.active_revision, status: "succeeded", path: readPath },
  ]);
  expect(JSON.stringify(response.metadata)).not.toContain("只供模型查看的唯一示例");
});

it("introduces reference tools to the model only after an automatic load", async () => {
  const h = harness(tool("load_skill", { skillId }), tool("read_skill_file", { skillId, path: readPath }), reply());
  await install(h);
  const response = await h.automatic().sendNew("教我分步学习");
  const names = (index: number) => h.request(index).tools.map(({ function: f }: { function: { name: string } }) => f.name);
  expect(names(0)).toEqual(expect.arrayContaining(["list_local_skills", "load_skill"]));
  expect(names(0)).not.toContain("read_skill_file");
  expect(names(1)).toContain("read_skill_file");
  expect(messageSkillReceipts(response)).toMatchObject([{ status: "loaded", mode: "automatic" }, { status: "succeeded" }]);
});

it("rejects out-of-bound tools and enforces shared content and call budgets across concurrent reads", async () => {
  const h = harness();
  await install(h, { body: "A".repeat(8000), ref: "Z".repeat(9_000) });
  const runtime = new PiDurableRuntime(modelConfig);
  const registered = vi.spyOn(runtime, "registerTool");
  const snapshot = await h.resolver.resolve("lf01", { skillId });
  const skills = registerTurnSkills(runtime, h.store, snapshot, "turn");
  const tools = new Map(registered.mock.calls.map(([item]) => [item.name, item]));
  const context = { turnId: "turn", sessionId: "session", signal: new AbortController().signal };
  const invoke = (name: string, args: Parameters<RuntimeTool["execute"]>[0]) => tools.get(name)!.execute(args, context);
  const read = (path: string, id = skillId) => invoke("read_skill_file", { skillId: id, path });
  expect(await read(readPath, "not-loaded")).toEqual({ ok: false, code: "not_loaded" });
  for (const path of ["../x", "/refs/x", "run.sh", "image.bin", "other.md"]) {
    expect(await read(path)).toEqual({ ok: false, code: "path_denied" });
  }
  const results = await Promise.all(Array.from({ length: 3 }, () => read(readPath)));
  expect(results.map((item) => typeof item === "object" && item && "ok" in item && item.ok)).toEqual([true, true, false]);
  expect(results[0]).toMatchObject({ truncated: true });
  const more = await Promise.all(Array.from({ length: 4 }, () => invoke("list_local_skills", {})));
  expect(more.at(-1)).toEqual({ ok: false, code: "budget_exceeded" });
  expect(JSON.stringify(skills.auditMetadata?.())).not.toContain("Z".repeat(100));
});

it("includes explicit loads in the three-skill limit", async () => {
  const budget = new TurnSkillBudget();
  expect(budget.reserveLoad("explicit", "教程")).toBe(true);
  const attempts = await Promise.all(["automatic-one", "automatic-two", "automatic-three"].map(async (name) => {
    await Promise.resolve();
    return budget.reserveLoad(name, "示例");
  }));
  expect(attempts).toEqual([true, true, false]);
});

it("keeps each scope snapshot consistent while a different scope resolves a newly published revision", async () => {
  const h = harness(reply("原始选文"), reply("旧版回合"), reply("新版回合"));
  await h.configure();
  const chat = h.normal;
  const parent = await chat.sendNew("先问一个问题");
  const thread = await chat.createThread(parent.session_id, parent.message_id, { text: "原始选文", start: 0, end: 4 });
  const old = await install(h, { body: "固定旧版正文" });
  await h.service.setScope(skillId, "little_tutor", true);
  const original = h.store.scopeSnapshot.bind(h.store);
  let signalSnapshot!: () => void;
  const captured = new Promise<void>((resolve) => { signalSnapshot = resolve; });
  let release!: () => void;
  const suspended = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(h.store, "scopeSnapshot").mockImplementationOnce(async (scope) => {
    const snapshot = await original(scope);
    signalSnapshot();
    await suspended;
    return snapshot;
  });
  const main = chat.send(parent.session_id, "沿用旧版", [], { skillId });
  await captured;
  const updated = await install(h, { body: "发布新版正文" });
  const dito = await chat.send(thread.thread_id, "读取新版", [], { skillId });
  release();
  const first = await main;
  expect(messageSkillReceipts(dito)[0]?.revision).toBe(updated.active_revision);
  expect(messageSkillReceipts(first)[0]?.revision).toBe(old.active_revision);
  expect(h.request(1).messages[0].content).toContain("发布新版正文");
  expect(h.request(2).messages[0].content).toContain("固定旧版正文");
});

it("keeps quick checks and successful history alongside a failed receipt-only reply", async () => {
  const check = { question_type: "choice", question: "哪个等于 4/8？",
    options: ["1/2", "1/3"], expected_answer: "1/2", explanation: "分子与分母同除以四" };
  const h = harness(reply("约分时分子分母除以相同的非零公因数。"), completion([]),
    completion([text(JSON.stringify({ intro: "试一试", questions: [check] }))]));
  await h.configure();
  await install(h);
  const first = await h.normal.sendNew("怎样约分？");
  const failed = await h.normal.send(first.session_id, "隐含失败的问题", [], { skillId });
  expect(failed.status).toBe("failed");
  expect(messageSkillReceipts(failed)).toHaveLength(1);
  const quickCheck = await h.normal.createQuickCheck(first.session_id);
  expect(publicQuickCheck(quickCheck)?.questions).toHaveLength(1);
  expect(JSON.stringify(quickCheck.metadata)).not.toContain("分子与分母同除以四");
  expect(JSON.stringify(h.request(2))).not.toContain("隐含失败的问题");
  expect((await h.normal.readConversation(first.session_id)).messages.find((item) => item.message_id === failed.message_id))
    .toMatchObject({ metadata: { skill_receipts: [{ skillId }] } });
});
