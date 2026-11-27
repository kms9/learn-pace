import { MemoryAppStore, MemorySecretStore } from "@learn-pace/infra";
import { expect, it, vi } from "vitest";
import { AppBootstrapService } from "../app-bootstrap.js";
import { restoreGateFor } from "../restore-gate.js";
import { hasKnowledgeValue } from "../extensions/knowledge/provider.js";

const clock = { nowSeconds: () => 10 };
const input = { displayName: "测试账号", clientId: "synthetic-client", apiKey: "synthetic-key" };
const library = Response.json({ code: 0, data: { info_list: [{ kb_id: "authorized", kb_name: "示例库" }] } });
function fixture() {
  const store = new MemoryAppStore();
  const secrets = new MemorySecretStore();
  let id = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => library.clone());
  const app = new AppBootstrapService(store, secrets, { makeId: () => String(++id), fetch });
  return { store, secrets, fetch, service: app.createKnowledgeService(clock) };
}

it("stores credentials separately, binds only discovered libraries, and requires new authorization after reconnect", async () => {
  const { store, secrets, fetch, service } = fixture();
  const result = await service.connect(input);
  expect(result).toMatchObject({ status: "ready", value: { display_name: "测试账号" } });
  if (!hasKnowledgeValue(result)) throw new Error("Connect failed");
  const id = result.value.connection_id;
  expect(JSON.stringify(await store.exportSnapshot())).not.toContain(input.apiKey);
  expect(JSON.stringify(await service.listConnections())).not.toContain("credential_ref");
  await expect(service.bind(id, "unknown")).resolves.toMatchObject({ status: "invalid_request" });
  await service.discover(id);
  const bound = await service.bind(id, "authorized");
  if (!hasKnowledgeValue(bound)) throw new Error("Bind failed");
  const ref = (await store.getProviderConnection(id))!.credential_ref!;
  expect(await secrets.getItem(ref)).toContain(input.apiKey);
  const count = fetch.mock.calls.length;
  await service.disconnect(id);
  expect(fetch).toHaveBeenCalledTimes(count);
  await expect(service.authorize(bound.value.binding_id)).resolves.toMatchObject({ status: "not_configured" });
  await service.connect({ ...input, connectionId: id, apiKey: "rotated-key" });
  expect(await secrets.getItem(ref)).toBeNull();
  expect(await store.getSourceBinding(bound.value.binding_id)).toMatchObject({ enabled: 0 });
  await service.discover(id);
  await expect(service.bind(id, "authorized")).resolves.toMatchObject({ status: "ready", value: { binding_id: bound.value.binding_id } });
  await service.deleteConnection(id);
  expect(await store.listSourceBindings()).toEqual([]);
});

it("allows restore during a slow probe and discards its result and staged credentials", async () => {
  const { store, secrets, fetch, service } = fixture();
  let started!: () => void;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const resume = new Promise<void>(resolve => { finish = resolve; });
  fetch.mockImplementationOnce(async () => { started(); await resume; return library.clone(); });
  const connecting = service.connect(input);
  await pending;
  await restoreGateFor(store).restore(() => store.writeSetting("restored", "yes"));
  finish();
  await expect(connecting).resolves.toMatchObject({ status: "cancelled" });
  expect(await store.listProviderConnections()).toEqual([]);
  expect(await secrets.getItem("ima-credentials.2")).toBeNull();
});

it("cancels an active read on unbind without sending remote writes", async () => {
  const { fetch, service } = fixture();
  await service.connect(input);
  await service.discover("1");
  const binding = await service.bind("1", "authorized");
  if (!hasKnowledgeValue(binding)) throw new Error("Bind failed");
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const aborted = vi.fn();
  fetch.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); }, { once: true });
    started();
  }));
  const browsing = service.browse(binding.value.binding_id);
  await pending;
  await service.unbind(binding.value.binding_id);
  await expect(browsing).resolves.toMatchObject({ status: "cancelled" });
  expect(aborted).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.map(([url]) => String(url).split("/").at(-1))).toEqual([
    "search_knowledge_base", "search_knowledge_base", "get_knowledge_list",
  ]);
});
