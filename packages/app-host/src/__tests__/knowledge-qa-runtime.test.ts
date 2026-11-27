import { createHash } from "node:crypto";
import { MemoryAppStore, MemorySecretStore, type StoredMessage, type StoredSourceBinding } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import {
  AppBootstrapService, imaSkillFile, messageKnowledgeCitations, messageKnowledgeReceipts, messageKnowledgeSelection, type KnowledgeChoice,
} from "../index.js";
import { SourceLedger } from "../extensions/knowledge/source-ledger.js";

const clock = { nowSeconds: () => 10 };
const marker = "蓝砂回声舟在午后发光";
const binding: StoredSourceBinding = { binding_id: "bound", connection_id: "ima", provider: "ima", remote_kb_id: "authorized",
  name: "测试库", description: "", base_type: "个人知识库", role_type: "创建者", writable: 0, enabled: 1, created_at: 1, updated_at: 1 };
const choice: KnowledgeChoice = { bindingId: binding.binding_id, mode: "kb_only" };

type Request = { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };

async function setup() {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  let id = 0;
  const modelRequests: Request[] = [];
  const modelRounds: ((request: Request) => Response)[] = [];
  const wire: { path: string; body: Record<string, unknown> }[] = [];
  const api = vi.fn(async (path: string, _signal?: AbortSignal | null): Promise<Response> => {
    if (path === "get_knowledge_list") return Response.json({ code: 0, data: {
      knowledge_list: [{ media_id: "fixture-note", title: "证据", media_type: 11 }, { folder_id: "folder", name: "文件夹" }],
    } });
    if (path === "get_media_info") return Response.json({ code: 0, data: { media_type: 11, notebook_ext_info: { notebook_id: "authored" } } });
    if (path === "get_doc_content") return Response.json({ code: 0, data: { content: marker } });
    if (path === "search_knowledge") return Response.json({ code: 0, data: { info_list: [] } });
    throw new Error("Unexpected IMA endpoint");
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).startsWith("https://ima.qq.com/")) {
      const path = String(url).split("/").at(-1)!;
      wire.push({ path, body });
      return api(path, init?.signal);
    }
    modelRequests.push(body);
    return modelRounds.shift()?.(body) ?? completion([text("普通回答")]);
  });
  const app = new AppBootstrapService(store, secrets, { makeId: () => String(++id), fetch });
  await app.saveModelSettings(modelConfig);
  await secrets.setItem("ima-credentials.fixture", JSON.stringify({ clientId: "synthetic-client", apiKey: "synthetic-key" }));
  await store.saveProviderConnection({ connection_id: "ima", provider: "ima", display_name: "测试",
    status: "ready", credential_ref: "ima-credentials.fixture", last_error: null, created_at: 1, updated_at: 1 });
  await store.saveSourceBinding(binding);
  await store.saveSourceBinding({ ...binding, binding_id: "other", remote_kb_id: "other-id" });
  return { store, app, api, wire, modelRequests, modelRounds, chat: app.createLf01ChatService(clock), knowledge: app.createKnowledgeService(clock) };
}

function expectDocumentHandle(request: Request): string {
  const tool = request.messages.filter(message => message.role === "tool").at(-1);
  const handle = /"handleId":"([^"]+)"/.exec(tool?.content ?? "")?.[1];
  expect(handle).toBeTruthy();
  return handle!;
}

function cite(env: Awaited<ReturnType<typeof setup>>) {
  env.modelRounds.push(
    () => completion([text("读前的猜测。"), toolCall("knowledge_list", {})], "tool_calls"),
    request => completion([toolCall("knowledge_read", { handleId: expectDocumentHandle(request) })], "tool_calls"),
    request => {
      expect(request.messages.at(-1)?.content).toContain(marker);
      return completion([text(marker + "[S1] [S99]")]);
    },
  );
}

it("reads a listed source, gates early text, and persists only verified references and sanitized receipts", async () => {
  const h = await setup();
  cite(h);
  const observer = vi.fn<(message: StoredMessage) => void>();
  const writes = vi.spyOn(h.store, "saveMessage");
  const result = await h.chat.sendNew("证据中的现象是什么？", [], { knowledge: choice, onMessage: observer });
  expect(result).toMatchObject({ status: "committed", content: marker + "[S1] " });
  expect(messageKnowledgeCitations(result)).toMatchObject([{ sourceId: "S1", mediaId: "fixture-note", excerpt: marker }]);
  expect(messageKnowledgeReceipts(result)).toMatchObject([
    { tool: "knowledge_list", status: "succeeded" }, { tool: "knowledge_read", status: "succeeded", sourceIds: ["S1"] },
  ]);
  expect(observer.mock.calls.some(([message]) => Array.isArray(message.metadata?.knowledge_activity) && message.content === "")).toBe(true);
  for (const { mock } of [writes, observer]) {
    expect(mock.calls.every(([item]) => !item.content.includes("读前的猜测。"))).toBe(true);
  }
  expect(h.wire).toEqual([
    { path: "get_knowledge_list", body: { knowledge_base_id: "authorized", cursor: "", limit: 20 } },
    { path: "get_media_info", body: { media_id: "fixture-note" } },
    { path: "get_doc_content", body: { note_id: "authored", target_content_format: 0 } },
  ]);
  expect(JSON.stringify(result.metadata?.knowledge_receipts)).not.toMatch(/synthetic-key|fixture-note|authored/);
  expect(h.modelRequests[0]?.tools.map(tool => tool.function.name)).toContain("knowledge_read");
  expect(h.modelRequests[0]?.tools.some(tool => /upload|import_urls/.test(tool.function.name))).toBe(false);
});

it.each(["kb_only", "kb_assisted"] as const)("honestly handles no readable evidence in %s", async (mode) => {
  const h = await setup();
  h.modelRounds.push(
    () => completion([toolCall("knowledge_read", { handleId: "remote-forgery" })], "tool_calls"),
    () => completion([text("探测期间的普通回答")]),
  );
  const result = await h.chat.sendNew("读原文", [], { knowledge: { ...choice, mode } });
  expect(h.wire).toEqual([]);
  expect(messageKnowledgeReceipts(result)).toMatchObject([{ resultStatus: "invalid_request" }]);
  expect(result.content).toContain(mode === "kb_only" ? "未找到可读正文" : "探测期间的普通回答");
  expect(result.content.includes("探测期间的普通回答")).toBe(mode === "kb_assisted");
});

it("rejects unavailable bindings or dependent skills before writes and permits knowledge without the skill", async () => {
  const h = await setup();
  const skills = h.app.createSkillService(clock);
  const installed = await skills.confirm(await skills.previewLocal(new TextEncoder().encode(imaSkillFile), "local_file"));
  await skills.setEnabled(installed.skill_id, true);
  await skills.setScope(installed.skill_id, "lf01", true);
  const saved = await h.store.exportSnapshot();
  await expect(h.chat.sendNew("查询", [], { skillId: installed.skill_id })).rejects.toMatchObject({ code: "dependency_missing" });
  await expect(h.chat.sendNew("查询", [], { knowledge: { ...choice, bindingId: "missing" } }))
    .rejects.toMatchObject({ code: "kb_binding_missing" });
  expect(await h.store.exportSnapshot()).toEqual(saved);
  expect(h.modelRequests).toEqual([]);
  await h.chat.sendNew("普通问题");
  expect(h.modelRequests[0]?.tools.some(tool => tool.function.name.startsWith("knowledge_"))).toBe(false);
  expect(h.wire).toEqual([]);
  cite(h);
  const result = await h.chat.sendNew("读取证据", [], { knowledge: choice, skillId: installed.skill_id });
  expect(result.metadata?.skill_receipts).toMatchObject([{ skillId: installed.skill_id, status: "explicit_loaded" }]);
  expect(messageKnowledgeCitations(result)).toHaveLength(1);
});

it("inherits the parent binding, rejects expansion and filters quoted and historical knowledge after revocation", async () => {
  const h = await setup();
  cite(h);
  const parent = await h.chat.sendNew("读取证据", [], { knowledge: choice });
  const selected = { start: 0, end: marker.length, text: marker };
  const thread = await h.chat.createThread(parent.session_id, parent.message_id, selected);
  expect(await h.chat.inheritedKnowledge(thread.thread_id)).toEqual(choice);
  await expect(h.chat.send(thread.thread_id, "换库", [], { knowledge: { ...choice, bindingId: "other" } }))
    .rejects.toMatchObject({ code: "kb_binding_missing" });
  cite(h);
  await h.chat.send(thread.thread_id, "接着问");
  const user = (await h.chat.readConversation(thread.thread_id)).messages.find(message => message.role === "user")!;
  expect(messageKnowledgeSelection(user)).toEqual(choice);
  const quote = await h.chat.quoteSelection(parent.session_id, parent.message_id, selected);
  await h.knowledge.unbind(binding.binding_id);
  const previous = await h.chat.readConversation(parent.session_id);
  await expect(h.chat.regenerate(parent.session_id, parent.message_id)).rejects.toMatchObject({ code: "kb_binding_missing" });
  expect(await h.chat.readConversation(parent.session_id)).toEqual(previous);
  await expect(h.chat.createQuickCheck(parent.session_id, parent.message_id)).rejects.toThrow("已断开");
  await h.chat.send(parent.session_id, "普通问答", [quote], { knowledge: null });
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).toContain("已撤销");
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).not.toContain(marker);
  await h.chat.send(thread.thread_id, "普通追问", [], { knowledge: null });
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).toContain("已撤销");
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).not.toContain(marker);
  expect(messageKnowledgeCitations(parent)).toMatchObject([{ excerpt: marker }]);
  await h.chat.deleteTurn(parent.session_id, parent.message_id);
  await h.chat.send(thread.thread_id, "解除关联后追问", [], { knowledge: null });
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).not.toContain(marker);
});

it("closes pending receipts on cancellation and restart recovery", async () => {
  const h = await setup();
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  h.api.mockImplementationOnce(async (_path, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    started();
  }));
  h.modelRounds.push(() => completion([toolCall("knowledge_list", {})], "tool_calls"));
  let sessionId = "";
  const turn = h.chat.sendNew("开始读取", [], { knowledge: choice, onSession: session => { sessionId = session.session_id; } });
  await pending;
  h.chat.stop(sessionId);
  const cancelled = await turn;
  expect(cancelled.status).toBe("interrupted");
  expect(messageKnowledgeReceipts(cancelled)).toMatchObject([{ tool: "knowledge_list", status: "interrupted" }]);
  await h.store.saveMessage({ ...cancelled, status: "generating", metadata: { ...cancelled.metadata,
    knowledge_receipts: [{ ...messageKnowledgeReceipts(cancelled)[0], status: "started" }] } });
  await h.app.recoverOnStartup(clock);
  const recovered = await h.store.getMessage(cancelled.message_id);
  expect(recovered?.status).toBe("interrupted");
  expect(messageKnowledgeReceipts(recovered!)).toMatchObject([{ tool: "knowledge_list", status: "unknown" }]);
});

it("filters external history after restore until the user reauthorizes the binding", async () => {
  const h = await setup();
  cite(h);
  const parent = await h.chat.sendNew("读取证据", [], { knowledge: choice });
  const backup = h.app.createBackupRestoreService("fixture", async raw => createHash("sha256").update(raw).digest("hex"), clock);
  await backup.restoreBackup(JSON.stringify(await backup.exportBackup()));
  await h.chat.send(parent.session_id, "继续普通问答");
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).not.toContain(marker);
  expect(JSON.stringify(h.modelRequests.at(-1)?.messages)).toContain("已撤销");
  expect((await h.chat.readConversation(parent.session_id)).messages.find(message => message.message_id === parent.message_id)?.content)
    .toContain(marker);
});

it("reserves document budgets before concurrent reads and accepts handles only from the current turn", () => {
  const ledger = new SourceLedger(binding, "turn", () => 10);
  const documents = Array.from({ length: 5 }, (_, i) => ledger.handle(ledger.issue({ kind: "document", mediaId: String(i),
    title: "资料", sourceType: "text" }))!);
  expect(ledger.handle("other:document:1")).toBeUndefined();
  const first = ledger.reserve(documents[0]!)!;
  const second = ledger.reserve(documents[1]!)!;
  expect(ledger.reserve(documents[2]!)).toBeUndefined();
  expect(first.capture("文".repeat(13_000), "text")?.text.length).toBe(12_000);
  first.release();
  expect(second.capture("测试", "text")?.text.length).toBe(2);
  second.release();
  for (const document of documents.slice(2, 4)) {
    const reservation = ledger.reserve(document)!;
    expect(reservation.capture("更多资料", "text")?.text).toBe("更多资料");
    reservation.release();
  }
  expect(ledger.reserve(documents[4]!)).toBeUndefined();
});
