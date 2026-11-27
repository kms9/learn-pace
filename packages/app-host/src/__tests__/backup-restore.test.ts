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
  knowledge_cards: [{ card_id: "knowledge", source_kind: "mastery_card", title: "约分", content: "同时除以公因数",
    note: "复习时练习", path_id: "path", source_session_id: "study", source_message_id: null, source_interaction_id: "card",
    created_at: 1, updated_at: 1, deleted_at: null }],
  skills: [],
  skill_revisions: [],
  skill_bindings: [],
  provider_connections: [],
  source_bindings: [],
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
  expect(await target.backup.inspectBackup(raw)).toEqual({ exportedAt: startedAt, formatVersion: 2, counts: {
    paths: 1, sessions: 3, messages: 2, threads: 1, interactions: 1, evidence: 1, knowledge_cards: 1,
    skills: 0, skill_revisions: 0, skill_bindings: 0, provider_connections: 0, source_bindings: 0,
  }, model: { baseUrl: gatewayB, model: "openai/deepseek-v4.1-flash" } });
  await target.backup.restoreBackup(raw);
  expect(await target.store.exportSnapshot()).toEqual(envelope.payload);
  expect((await target.app.snapshot()).model).toMatchObject({ configured: false, settings: { baseUrl: gatewayB } });
});

it.each([5, 6])("authenticates the original schema v%i backup before adding empty tables", async (schema) => {
  const { envelope } = await withBackup();
  const { knowledge_cards: cards, skills: _skills, skill_revisions: _revisions, skill_bindings: _bindings,
    provider_connections: _connections, source_bindings: _sources, ...base } = envelope.payload;
  const { knowledge_cards: count, skills: _sc, skill_revisions: _rc, skill_bindings: _bc,
    provider_connections: _cc, source_bindings: _mc, ...baseline } = envelope.manifest.counts;
  const payload = schema === 5 ? base : { ...base, knowledge_cards: cards };
  const manifest = { ...envelope.manifest, format_version: 1, schema_version: schema,
    counts: schema === 5 ? baseline : { ...baseline, knowledge_cards: count } };
  const digest = await sha256(canonicalJson({ manifest, payload }));
  const raw = JSON.stringify({ manifest, payload, integrity: { algorithm: "sha256", digest } });
  const target = harness("legacy");
  await target.store.saveKnowledgeCard(full.knowledge_cards[0]!);
  await installExampleSkill(target);
  expect((await target.backup.inspectBackup(raw))).toMatchObject({ formatVersion: 1,
    counts: { knowledge_cards: schema === 5 ? 0 : 1, skills: 0 } });
  await target.backup.restoreBackup(raw);
  expect(await target.store.exportSnapshot()).toEqual({ ...base, knowledge_cards: schema === 5 ? [] : cards,
    skills: [], skill_revisions: [], skill_bindings: [], provider_connections: [], source_bindings: [] });
  await expect(target.backup.inspectBackup(raw.replace('"paths":1', '"paths":2'))).rejects.toThrow("完整性");
  const latest = await target.backup.exportBackup();
  expect(latest.manifest).toMatchObject({ format_version: 2, schema_version: 9, counts: { knowledge_cards: schema === 5 ? 0 : 1 } });
});

it("restores a v2 schema v7 backup and starts with empty external knowledge tables", async () => {
  const { envelope } = await withBackup();
  const { provider_connections: _connections, source_bindings: _bindings, ...payload } = envelope.payload;
  const { provider_connections: _pc, source_bindings: _bc, ...counts } = envelope.manifest.counts;
  const manifest = { ...envelope.manifest, schema_version: 7, counts };
  const digest = await sha256(canonicalJson({ manifest, payload }));
  const target = harness("legacy-v7");
  await target.backup.restoreBackup(JSON.stringify({ manifest, payload, integrity: { algorithm: "sha256", digest } }));
  expect(await target.store.exportSnapshot()).toEqual(envelope.payload);
});

it("restores a v2 schema v8 backup with existing learning data and local skills", async () => {
  const source = await withBackup();
  await installExampleSkill(source);
  const { manifest: latest, payload } = await source.backup.exportBackup();
  const manifest = { ...latest, schema_version: 8 };
  const digest = await sha256(canonicalJson({ manifest, payload }));
  const target = harness("legacy-v8");
  await target.backup.restoreBackup(JSON.stringify({ manifest, payload, integrity: { algorithm: "sha256", digest } }));
  const actual = await target.store.exportSnapshot();
  expect(actual.learning_progress).toEqual(payload.learning_progress);
  expect(actual.skills).toEqual(payload.skills.map((skill) => ({ ...skill, enabled: 0 })));
  expect(actual.skill_bindings).toEqual(payload.skill_bindings.map((binding) => ({ ...binding, enabled: 0 })));
});

it("exports portable external bindings, retires local credentials and requires explicit authorization after restore", async () => {
  const source = await withBackup();
  const ref = "ima-credentials.local-fixture";
  await source.secrets.setItem(ref, JSON.stringify({ clientId: "fixture-client", apiKey: "fixture-secret" }));
  await source.store.writeSetting("ima-retired-credential-refs", JSON.stringify(["ima-credentials.retired"]));
  await source.store.saveProviderConnection({ connection_id: "ima", provider: "ima", display_name: "个人账号",
    status: "ready", credential_ref: ref, last_error: "private-error", created_at: 1, updated_at: 2 });
  await source.store.saveSourceBinding({ binding_id: "source", connection_id: "ima", provider: "ima", remote_kb_id: "remote",
    name: "示例库", description: "", base_type: "", role_type: "", writable: 0, enabled: 1, created_at: 1, updated_at: 2 });
  const envelope = await source.backup.exportBackup();
  const raw = JSON.stringify(envelope);
  expect(raw).not.toMatch(/ima-credentials|fixture-client|fixture-secret|private-error/);
  expect(envelope.manifest.counts).toMatchObject({ provider_connections: 1, source_bindings: 1 });
  await source.backup.restoreBackup(raw);
  expect(await source.store.getProviderConnection("ima")).toMatchObject({ credential_ref: null, status: "disconnected" });
  expect(await source.store.getSourceBinding("source")).toMatchObject({ enabled: 0 });
  expect(await source.secrets.getItem(ref)).toContain("fixture-secret");
  expect(JSON.parse((await source.store.readSetting("ima-retired-credential-refs"))!)).toContain(ref);

  for (const change of [
    (payload: DatabaseSnapshot) => { payload.provider_connections[0]!.credential_ref = ref; },
    (payload: DatabaseSnapshot) => { payload.source_bindings[0]!.connection_id = "orphan"; },
  ]) {
    const payload = structuredClone(envelope.payload);
    change(payload);
    const digest = await sha256(canonicalJson({ manifest: envelope.manifest, payload }));
    await expect(source.backup.inspectBackup(JSON.stringify({ ...envelope, payload,
      integrity: { algorithm: "sha256", digest } }))).rejects.toThrow("数据结构");
  }
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
  const source = await withBackup(gatewayB, generating);
  const incoming = await installExampleSkill(source, "Incoming revision");
  const envelope = await source.backup.exportBackup();
  const base = new MemoryAppStore();
  const faults = new FaultInjectingAppStore(base);
  const target = harness("target", faults.store);
  await base.replaceSnapshot(full);
  await target.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "local-key" });
  await installExampleSkill(target, "Existing revision");
  const original = await base.exportSnapshot();
  faults.injectNext(operation, "after");
  await expect(target.backup.restoreBackup(JSON.stringify(envelope))).rejects.toThrow("原有本地数据已保留");
  expect(await base.exportSnapshot()).toEqual(original);
  expect(await target.secrets.getItem("deepseek-api-key.target-1")).toBe("local-key");
  await target.backup.restoreBackup(JSON.stringify(envelope));
  expect(await base.getSkill(incoming.skill_id)).toMatchObject({ active_revision: incoming.active_revision, enabled: 0 });
  expect(await base.getMessage("assistant")).toMatchObject({ status: "interrupted", content: "约分题" });
  expect(await base.listDomainEvents("path")).toEqual(full.domain_events);
});

async function installExampleSkill(source: ReturnType<typeof harness>, body = "Show a small example.") {
  const service = source.app.createSkillService({ nowSeconds: () => 1 });
  const candidate = await service.previewLocal(new TextEncoder().encode(
    `---\nname: fraction-coach\ndescription: Practice fractions\n---\n${body}`), "local_file");
  const installed = await service.confirm(candidate);
  await service.setEnabled(installed.skill_id, true);
  await service.setScope(installed.skill_id, "lf01", true);
  return installed;
}

it("restores active skill bytes and historical receipts, with all skills and scopes disabled", async () => {
  const source = await withBackup();
  const skill = await installExampleSkill(source);
  const original = await source.store.getMessage("assistant");
  const receipts = [{ turnId: "chat-turn", skillId: skill.skill_id, name: skill.name, revision: skill.active_revision,
    mode: "explicit", status: "explicit_loaded" }];
  await source.store.saveMessage({ ...original!, metadata: { ...original!.metadata, skill_receipts: receipts } });

  const backup = await source.backup.exportBackup();
  expect(backup.manifest).toMatchObject({ counts: { skills: 1, skill_revisions: 1, skill_bindings: 1 } });
  const target = harness("restore-skill");
  await target.backup.restoreBackup(JSON.stringify(backup));
  const snapshot = await target.store.exportSnapshot();
  expect(snapshot.skills).toEqual([{ ...skill, enabled: 0 }]);
  expect(snapshot.skill_bindings[0]?.enabled).toBe(0);
  expect(snapshot.skill_revisions).toEqual(backup.payload.skill_revisions);
  expect((await target.store.getMessage("assistant"))?.metadata?.skill_receipts).toEqual(receipts);
});

it.each(["uninstall", "update"] as const)("filters retained inactive revisions after %s during a chat", async (change) => {
  const fetch = streamUntilAborted(() => {});
  const source = harness("export-skill", undefined, fetch);
  await source.app.saveModelSettings({ baseUrl: gatewayA, apiKey: "fixture" });
  const skill = await installExampleSkill(source);
  const chat = source.app.createLf01ChatService();
  const session = await chat.createSession();
  const running = chat.send(session.session_id, "解释分数", [], { skillId: skill.skill_id });
  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const service = source.app.createSkillService();
    const next = change === "update" ? await installExampleSkill(source, "Update during a turn.") : null;
    if (!next) await service.uninstall(skill.skill_id);
    expect((await source.store.exportSnapshot()).skill_revisions).toHaveLength(next ? 2 : 1);
    const backup = await source.backup.exportBackup();
    const count = next ? 1 : 0;
    expect(backup.manifest.counts).toMatchObject({ skills: count, skill_revisions: count, skill_bindings: count });
    const target = harness("export-round-trip");
    await target.backup.restoreBackup(JSON.stringify(backup));
    expect((await target.store.getSkillRevision(skill.skill_id, skill.active_revision))).toBeNull();
    if (next) expect(await target.store.getSkill(skill.skill_id)).toMatchObject({ active_revision: next.active_revision, enabled: 0 });
    expect((await target.store.listMessages(session.session_id)).at(-1)?.metadata?.skill_receipts)
      .toMatchObject([{ skillId: skill.skill_id, revision: skill.active_revision, status: "explicit_loaded" }]);
  } finally {
    chat.stop(session.session_id);
    await running;
    vi.unstubAllGlobals();
  }
});

it.each(["unsafe path", "missing revision", "orphan revision", "wrong revision"] as const)(
  "rejects a re-signed backup with a skill integrity problem: %s", async (problem) => {
    const source = await withBackup();
    const installed = await installExampleSkill(source);
    const { manifest, payload } = await source.backup.exportBackup();
    const rev = payload.skill_revisions[0]!;
    if (problem === "unsafe path") rev.files_json_base64 = JSON.stringify({ ...JSON.parse(rev.files_json_base64), "../x": "eA==" });
    if (problem === "missing revision") payload.skill_revisions = [];
    if (problem === "orphan revision") rev.skill_id = "orphan";
    if (problem === "wrong revision") payload.skills[0]!.active_revision = rev.revision = "directory-sha256:" + "0".repeat(64);
    const digest = await sha256(canonicalJson({ manifest, payload }));
    const target = harness("preserve");
    await target.store.writeSetting("original", installed.skill_id);
    const before = await target.store.exportSnapshot();
    await expect(target.backup.restoreBackup(JSON.stringify({ manifest, payload, integrity: { algorithm: "sha256", digest } })))
      .rejects.toThrow("技能");
    expect(await target.store.exportSnapshot()).toEqual(before);
  },
);
