import { createLearningProgress, createPendingQuestion } from "@learn-pace/domain";
import { MemoryAppStore, MemorySecretStore } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { AppBootstrapService } from "../index.js";

const config = { baseUrl: "https://gateway.example/v1", model: "openai/deepseek-v4.1-flash" };
const secret = "fixture-key";
const modelSetting = "deepseek-model-config";
const legacyKey = "deepseek-api-key";

function harness(fetch?: typeof globalThis.fetch) {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  let id = 0;
  const open = () => new AppBootstrapService(store, secrets, { makeId: () => String(++id), fetch });
  return { store, secrets, open };
}

it("loads an unconfigured app with saved local records and leaves the legacy scene setting intact", async () => {
  const { store, open } = harness();
  await store.save(createLearningProgress({ book_id: "path", name: "Stored path" }));
  await store.saveSession({
    session_id: "chat", kind: "chat", path_id: null, mode: null, title: "Stored chat",
    model_id: null, created_at: 0, updated_at: 1,
  });
  await store.saveMessage({
    message_id: "message", session_id: "chat", role: "user", content: "Saved text",
    status: "completed", turn_id: null, metadata: null, created_at: 1,
  });
  await store.insertInteraction({
    interaction_id: "interaction", path_id: "path", session_id: "chat", turn_id: "turn",
    status: "awaiting_input", raw_answer: null, submission_id: null, updated_at: 2,
    question: createPendingQuestion({
      question_id: "q", knowledge_point_id: "kp", expected_answer: "private answer",
    }),
  });

  await store.writeSetting("curriculum_profile", "middle");
  const reads = vi.spyOn(store, "readSetting");
  const initial = await open().snapshot();
  expect(initial).not.toHaveProperty("curriculumProfile");
  expect(reads).not.toHaveBeenCalledWith("curriculum_profile");
  expect(initial.model.configured).toBe(false);
  expect(initial.pending?.question).not.toHaveProperty("expected_answer");
  expect(await store.readSetting("curriculum_profile")).toBe("middle");
  const restored = await open().snapshot();
  expect(restored.paths).toEqual(initial.paths);
  expect(restored.sessions).toEqual(initial.sessions);
  expect(await open().readSessionHistory("chat")).toEqual([
    { message_id: "message", role: "user", content: "Saved text", status: "completed" },
  ]);
});

it("retains the legacy Key only for same-origin updates and saves a new Key separately", async () => {
  const { store, secrets, open } = harness();
  await store.writeSetting(modelSetting, JSON.stringify(config));
  await secrets.setItem(legacyKey, secret);
  expect((await open().snapshot()).model.configured).toBe(true);

  const host = open();
  await host.saveModelSettings({ baseUrl: "https://gateway.example/new", reasoning: "medium" });
  const sameOrigin = await store.readSetting(modelSetting);
  expect(sameOrigin).not.toContain(secret);
  expect(await secrets.getItem(legacyKey)).toBe(secret);
  await expect(host.saveModelSettings({ baseUrl: "https://other.example/v1" })).rejects.toThrow("目标网关");
  expect(await store.readSetting(modelSetting)).toBe(sameOrigin);
  await host.saveModelSettings({ baseUrl: "https://other.example/v1", apiKey: "new-key" });

  expect(await secrets.getItem(legacyKey)).toBeNull();
  const raw = await store.readSetting(modelSetting);
  expect(raw).not.toContain("new-key");
  expect(await secrets.getItem(JSON.parse(raw!).credentialRef)).toBe("new-key");
  expect((await open().snapshot()).model.settings).toMatchObject({ baseUrl: "https://other.example/v1" });
  expect((await open().snapshot()).model.settings).not.toHaveProperty("credentialRef");
});

it("keeps the saved model and credential paired when saving a new gateway fails", async () => {
  const { store, secrets, open } = harness();
  const host = open();
  await host.saveModelSettings({ ...config, apiKey: secret });
  const record = await store.readSetting(modelSetting);
  const ref = JSON.parse(record!).credentialRef;
  vi.spyOn(store, "writeSetting").mockRejectedValueOnce(new Error("write failed"));
  await expect(host.saveModelSettings({ baseUrl: "https://other.example/v1", apiKey: "new-key" })).rejects.toThrow();
  expect(await store.readSetting(modelSetting)).toBe(record);
  expect(await secrets.getItem(ref)).toBe(secret);
  expect(await secrets.getItem("deepseek-api-key.2")).toBeNull();
});

it("reports a live probe's elapsed time and classifies HTTP errors without the response body", async () => {
  const chunk = (delta: object, finish_reason: string | null) =>
    "data: " + JSON.stringify({ id: "test", choices: [{ index: 0, delta, finish_reason }] }) + "\n\n";
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(chunk({ content: "Ready" }, null) + chunk({}, "stop") + "data: [DONE]\n\n"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: secret } }), {
      status: 401, headers: { "Content-Type": "application/json" },
    }));
  const { store, open } = harness(fetch);
  const host = open();
  expect((await host.testModelConnection()).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await host.saveModelSettings({ ...config, apiKey: secret });
  expect(await host.testModelConnection()).toEqual({ ok: true, elapsedMs: expect.any(Number) });
  const failure = await host.testModelConnection();
  expect(failure).toEqual({ ok: false, message: expect.stringContaining("HTTP 401") });
  expect(JSON.stringify(failure)).not.toContain(secret);
  expect(await store.listSessions()).toEqual([]);
});
