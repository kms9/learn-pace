import { createHash } from "node:crypto";
import { createLearningEvidence, createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore, type AppStore, type DatabaseSnapshot } from "@learn-pace/infra";
import { FaultInjectingAppStore } from "@learn-pace/infra/testing";
import { expect, it, vi } from "vitest";
import { streamUntilAborted } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { AppBootstrapService, RestoreGateError, type BackupEnvelope } from "../index.js";
import { canonicalJson, maxBackupBytes, type BackupDigest } from "../backup-format.js";

const modelSetting = "deepseek-model-config";
const legacyKey = "deepseek-api-key";
const gatewayA = "https://a.example/v1";
const gatewayB = "https://b.example/v1";
const startedAt = 1_700_000_000;
const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");

function harness(label: string, store: AppStore = new MemoryAppStore(), fetch?: typeof globalThis.fetch, digest: BackupDigest = sha256) {
  let id = 0;
  const secrets = new MemorySecretStore();
  const app = new AppBootstrapService(store, secrets, { makeId: () => `${label}-${++id}`, fetch });
  return { store, app, secrets, backup: app.createBackupRestoreService("0.1.0", digest, { nowSeconds: () => startedAt }) };
}

const full: DatabaseSnapshot = {
  settings: [{ name: "curriculum_profile", value: "free" }],
  learning_progress: [{ status: "active", progress: createLearningProgress({ book_id: "path", name: "约分", version: 4,
    learning_evidence: [createLearningEvidence({ evidence_id: "card", knowledge_point_id: "ratio", result: "correct" })] }) }],
  sessions: [
    { session_id: "chat", kind: "lf01", title: "问答", path_id: null, mode: null, model_id: null, created_at: 1, updated_at: 1 },
    { session_id: "study", kind: "mastery", title: "精通约分", path_id: "path", mode: "study", model_id: null, created_at: 2, updated_at: 2 },
    { session_id: "thread", kind: "little_tutor", title: "小老师", path_id: null, mode: null, model_id: null, created_at: 3, updated_at: 3 },
  ],
  messages: [
    { message_id: "assistant", session_id: "chat", role: "assistant", content: "约分题", status: "committed", turn_id: "chat-turn",
      metadata: { source_user_message_id: "user" }, created_at: 2 },
    { message_id: "user", session_id: "chat", role: "user", content: "怎么约分？", status: "committed", turn_id: "chat-turn", metadata: null, created_at: 1 },
  ],
  session_threads: [{ thread_id: "thread", parent_session_id: "chat", source_message_id: "assistant", selected_text: "约分",
    title: "小老师", selection_start: 0, selection_end: 2, detached_at: null, created_at: 3, updated_at: 3 }],
  interactions: [{ interaction_id: "card", path_id: "path", session_id: "study", turn_id: "question-turn", status: "graded",
    question: createPendingQuestion({ question_id: "ratio-q", knowledge_point_id: "ratio", expected_answer: "1/2" }),
    raw_answer: "1/2", submission_id: "submission", updated_at: 3 }],
  domain_events: [{ event_id: "grade", path_id: "path", session_id: "study", turn_id: "question-turn",
    event_type: "AssessmentCommitted", payload: { interaction_id: "card" }, created_at: 4 }],
};

async function withBackup(baseUrl = gatewayB, payload = full) {
  const source = harness("source");
  await source.store.replaceSnapshot(payload);
  await source.app.saveModelSettings({ baseUrl, apiKey: "source-credential" });
  return { ...source, envelope: await source.backup.exportBackup() };
}

it("exports all learning data, excludes device key names and values, and restores an empty device", async () => {
  const source = await withBackup();
  const readSecret = vi.spyOn(source.secrets, "getItem");
  await source.store.writeSetting(modelSetting, JSON.stringify({ baseUrl: gatewayB, credentialRef: "deepseek-api-key.source-1",
    retiredCredentialRefs: ["deepseek-api-key.retired"], apiKey: "unrecognized-secret-field" }));
  const envelope = await source.backup.exportBackup();
  const raw = JSON.stringify(envelope, null, 2);
  expect(readSecret).not.toHaveBeenCalled();
  expect(raw).not.toMatch(/source-credential|deepseek-api-key|retiredCredentialRefs|unrecognized-secret-field/);
  expect(JSON.parse(envelope.payload.settings.find(({ name }) => name === modelSetting)!.value).credentialRef).toBeNull();
  const target = harness("target");
  expect(await target.backup.inspectBackup(raw)).toEqual({ exportedAt: startedAt, counts: {
    paths: 1, sessions: 3, messages: 2, threads: 1, interactions: 1, evidence: 1,
  }, model: { baseUrl: gatewayB, model: "openai/deepseek-v4.1-flash" } });
  await target.backup.restoreBackup(raw);
  expect(await target.store.exportSnapshot()).toEqual(envelope.payload);
  expect((await target.app.snapshot()).model).toMatchObject({ configured: false, settings: { baseUrl: gatewayB } });
});

it("keeps the valid device key for an import from the same origin only", async () => {
  const { envelope } = await withBackup("https://a.example/restored");
  const target = harness("target");
  await target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "same-device-key" });
  await target.backup.restoreBackup(JSON.stringify(envelope));
  expect(JSON.parse((await target.store.readSetting(modelSetting))!)).toMatchObject({ baseUrl: "https://a.example/restored",
    credentialRef: "deepseek-api-key.target-1" });
  expect((await target.app.snapshot()).model.configured).toBe(true);
  expect(await target.secrets.getItem("deepseek-api-key.target-1")).toBe("same-device-key");
});

it("keeps an imported gateway explicitly unbound, including when restoring back to the retired origin", async () => {
  const before = await withBackup(gatewayA);
  const after = await withBackup(gatewayB);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const target = harness("target", undefined, fetch);
  await target.store.writeSetting(modelSetting, JSON.stringify({ baseUrl: gatewayA }));
  await target.secrets.setItem(legacyKey, "legacy-device-key");
  await target.backup.restoreBackup(JSON.stringify(after.envelope));
  const reads = vi.spyOn(target.secrets, "getItem");
  expect((await target.app.snapshot()).model).toMatchObject({ configured: false, settings: { baseUrl: gatewayB } });
  expect(await target.app.testModelConnection()).toMatchObject({ ok: false });
  expect(reads).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(await target.secrets.getItem(legacyKey)).toBe("legacy-device-key");
  expect(JSON.parse((await target.store.readSetting(modelSetting))!)).toMatchObject({ credentialRef: null, retiredCredentialRefs: [legacyKey] });
  await expect(target.app.saveModelSettings({ baseUrl: gatewayB })).rejects.toThrow("目标网关");

  await target.backup.restoreBackup(JSON.stringify(before.envelope));
  expect((await target.app.snapshot()).model).toMatchObject({ configured: false, settings: { baseUrl: gatewayA } });
  expect(JSON.stringify(await target.backup.exportBackup())).not.toContain(legacyKey);
  await target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "new-key" });
  expect(await target.secrets.getItem(legacyKey)).toBeNull();
  const retained = JSON.parse((await target.store.readSetting(modelSetting))!);
  expect(retained).not.toHaveProperty("retiredCredentialRefs");
  expect(await target.secrets.getItem(retained.credentialRef)).toBe("new-key");
});

it("retains cleanup information locally when a backup contains no model configuration", async () => {
  const blank = harness("source");
  await blank.store.replaceSnapshot(full);
  const target = harness("target");
  await target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "old-key" });
  await target.backup.restoreBackup(JSON.stringify(await blank.backup.exportBackup()));
  expect((await target.app.snapshot()).model).toEqual({ configured: false, settings: null });
  expect(await target.secrets.getItem("deepseek-api-key.target-1")).toBe("old-key");
  expect(JSON.stringify(await target.backup.exportBackup())).not.toContain("credential-refs");
  await target.app.saveModelSettings({ baseUrl: gatewayB, apiKey: "new-key" });
  expect(await target.secrets.getItem("deepseek-api-key.target-1")).toBeNull();
});

it("rejects corrupted JSON, tampered preview and payload, future schema, and oversized UTF-8 without changing data", async () => {
  const { envelope } = await withBackup();
  const target = harness("target");
  await target.store.writeSetting("unrelated", "keep");
  const original = await target.store.exportSnapshot();
  const changedTime: BackupEnvelope = { ...envelope, manifest: { ...envelope.manifest, exported_at: startedAt + 1 } };
  const changedCount: BackupEnvelope = { ...envelope, manifest: { ...envelope.manifest, counts: { ...envelope.manifest.counts, paths: 811 } } };
  const changedData: BackupEnvelope = { ...envelope, payload: { ...envelope.payload, messages: envelope.payload.messages.map((message) =>
    ({ ...message, content: "被修改" })) } };
  for (const changed of [changedTime, changedCount, changedData]) {
    await expect(target.backup.inspectBackup(JSON.stringify(changed))).rejects.toThrow("完整性校验失败");
    await expect(target.backup.restoreBackup(JSON.stringify(changed))).rejects.toThrow("完整性校验失败");
  }
  await expect(target.backup.restoreBackup(JSON.stringify(envelope).slice(0, -1))).rejects.toThrow("JSON 已损坏");
  const future = { ...envelope, manifest: { ...envelope.manifest, schema_version: 999 } };
  future.integrity = { algorithm: "sha256", digest: await sha256(canonicalJson({ manifest: future.manifest, payload: future.payload })) };
  await expect(target.backup.restoreBackup(JSON.stringify(future))).rejects.toThrow("数据库版本");
  await expect(target.backup.inspectBackup("三".repeat(Math.floor(maxBackupBytes / 3) + 1))).rejects.toThrow("20 MiB");
  expect(await target.store.exportSnapshot()).toEqual(original);
});

it("rejects restore while a chat is running and again allows restore after that turn ends", async () => {
  const { envelope } = await withBackup();
  const target = harness("target", undefined, streamUntilAborted(() => {}));
  await target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "local" });
  const chat = target.app.createLf01ChatService();
  const { session_id } = await chat.createSession();
  const running = chat.send(session_id, "继续问答");
  try {
    await vi.waitFor(async () => expect((await target.store.listMessages(session_id)).at(-1)?.content).toBe("first"));
    await expect(target.backup.restoreBackup(JSON.stringify(envelope))).rejects.toThrow("进行中的会话");
    expect(await target.store.getSession(session_id)).not.toBeNull();
  } finally {
    chat.stop(session_id);
    await running;
  }
  await target.backup.restoreBackup(JSON.stringify(envelope));
  expect(await target.store.getSession(session_id)).toBeNull();
});

it("holds the restore gate before validation and excludes concurrent writes across entry points", async () => {
  const { envelope } = await withBackup();
  let release!: () => void;
  const suspended = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const validating = new Promise<void>((resolve) => { entered = resolve; });
  const target = harness("target", undefined, undefined, async (value) => {
    entered();
    await suspended;
    return sha256(value);
  });
  const chat = target.app.createLf01ChatService();
  const mastery = target.app.createMasterySessionService();
  const restoring = target.backup.restoreBackup(JSON.stringify(envelope));
  try {
    await validating;
    const rejected = [chat.createSession(), chat.send("chat", "问题"), chat.detachThread("thread"), chat.deleteThread("thread"),
      mastery.createTopic({ goal: "目标" }), mastery.submitAnswer("path", "study", "card", { a: "answer" }, "submission"),
      mastery.renameTopic("path", "新名称"), target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "new" }),
      target.app.recoverOnStartup(), target.backup.restoreBackup(JSON.stringify(envelope))];
    expect((await Promise.allSettled(rejected)).every((result) => result.status === "rejected" && result.reason instanceof RestoreGateError)).toBe(true);
  } finally {
    release();
    await restoring;
  }
  await expect(chat.createSession()).resolves.toMatchObject({ kind: "lf01" });
});

it.each(["replaceSnapshot", "saveMessage"] as const)("rolls back the original database if %s fails during restore", async (operation) => {
  const generating = { ...full, messages: full.messages.map((message) => ({ ...message,
    status: message.role === "assistant" ? "generating" : message.status })) };
  const { envelope } = await withBackup(gatewayB, generating);
  const base = new MemoryAppStore();
  const faults = new FaultInjectingAppStore(base);
  const target = harness("target", faults.store);
  await base.replaceSnapshot(full);
  await target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "local-key" });
  const original = await base.exportSnapshot();
  faults.injectNext(operation, "after");
  await expect(target.backup.restoreBackup(JSON.stringify(envelope))).rejects.toThrow("原有本地数据已保留");
  expect(await base.exportSnapshot()).toEqual(original);
  expect(await target.secrets.getItem("deepseek-api-key.target-1")).toBe("local-key");
  await target.backup.restoreBackup(JSON.stringify(envelope));
  expect(await base.getMessage("assistant")).toMatchObject({ status: "interrupted", content: "约分题" });
  expect(await base.listDomainEvents("path")).toEqual(full.domain_events);
});
