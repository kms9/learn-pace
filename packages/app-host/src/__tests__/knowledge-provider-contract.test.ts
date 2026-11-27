import { MemorySecretStore, type StoredSourceBinding } from "@learn-pace/infra";
import { describe, expect, it, vi } from "vitest";
import { ImaProvider } from "../extensions/knowledge/ima-provider.js";
import { ImaTransport } from "../extensions/knowledge/ima-transport.js";
import { hasKnowledgeValue, knowledgeFailure, ready, type KnowledgeDocument, type KnowledgeProvider } from "../extensions/knowledge/provider.js";

const binding: StoredSourceBinding = { binding_id: "bound", connection_id: "connection", provider: "ima", remote_kb_id: "library",
  name: "资料", description: "", base_type: "个人知识库", role_type: "创建者", writable: 0, enabled: 1, created_at: 1, updated_at: 1 };
const document: KnowledgeDocument = { kind: "document", mediaId: "md", title: "资料.md", sourceType: "markdown" };
const folder = { kind: "folder" as const, folderId: "folder_here", title: "目录" };
const library = { id: "library", name: "资料", description: "", baseType: "个人知识库", roleType: "创建者" };
const signal = new AbortController().signal;
const handle = { bindingId: binding.binding_id, remoteKbId: binding.remote_kb_id, document };
const source = "合成 Markdown 正文";

function fake(): KnowledgeProvider {
  return {
    providerId: "test",
    probe: async ({ signal }) => signal.aborted ? knowledgeFailure("cancelled") : ready({ elapsedMs: 0 }),
    discover: async ({ cursor }) => ready({ items: cursor ? [] : [library], nextCursor: cursor ? undefined : "more" }),
    browse: async ({ binding }) => binding.enabled ? ready({ path: [], items: [document, folder] }) : knowledgeFailure("not_configured"),
    search: async ({ query }) => query ? (query === "unknown" ? knowledgeFailure("no_matches") : ready({ items: [document] }))
      : knowledgeFailure("invalid_request"),
    read: async ({ binding, handle }) => handle.remoteKbId === binding.remote_kb_id && handle.bindingId === binding.binding_id
      ? ready({ text: source, sourceType: document.sourceType }) : knowledgeFailure("invalid_request"),
  };
}

function wireFixture(route: string, body: Record<string, unknown>): Record<string, unknown> {
  if (route.endsWith("search_knowledge_base")) return { info_list: body.cursor ? [] :
    [{ kb_id: "library", kb_name: "资料", base_type: "个人知识库", role_type: "创建者" }], next_cursor: "more" };
  if (route.endsWith("get_knowledge_list")) return {
    knowledge_list: [{ media_type: 7, media_id: "md", title: "资料.md" }], folder_list: [{ folder_id: "folder_here", name: "目录" }],
  };
  if (route.endsWith("search_knowledge")) return body.query === "unknown" ? { info_list: [] } : {
    info_list: [{ media_type: 99, media_id: "folder_here", title: "目录" }, { media_type: 7, media_id: "md", title: "资料.md" }],
    next_cursor: "same",
  };
  if (route.endsWith("get_media_info")) return { media_type: 7, url_info: { url: "https://skb.ima.myqcloud.com/synthetic",
    headers: { "X-IMA-Sign": "synthetic-signature", cookie: "hidden-cookie", "ima-openapi-apikey": "forbidden-key" } } };
  throw new Error("Unexpected endpoint");
}

async function real(makeFetch?: typeof fetch) {
  const secrets = new MemorySecretStore();
  await secrets.setItem("ima-credentials.fixture", JSON.stringify({ clientId: "client", apiKey: "secret" }));
  const fetch = vi.fn<typeof globalThis.fetch>(makeFetch ?? (async (request, init) => String(request).startsWith("https://ima.qq.com/")
    ? Response.json({ retcode: 0, data: wireFixture(String(request), JSON.parse(String(init?.body))) })
    : new Response(source, { headers: { "content-type": "text/markdown; charset=utf-8" } })));
  const transport = new ImaTransport(secrets, async () => "ima-credentials.fixture", fetch);
  return { provider: new ImaProvider(transport), transport, fetch };
}

for (const [name, create] of [["fake", async () => fake()], ["ima", async () => (await real()).provider]] as const) {
  describe(name + " read-only knowledge provider contract", () => {
    it("probes, pages libraries and differentiates browse and search", async () => {
      const provider = await create();
      await expect(provider.probe({ connectionId: "connection", signal })).resolves.toMatchObject({ status: "ready" });
      const first = await provider.discover({ connectionId: "connection", signal });
      expect(first).toMatchObject({ status: "ready", value: { items: [library], nextCursor: "more" } });
      await expect(provider.discover({ connectionId: "connection", signal, cursor: "more" }))
        .resolves.toEqual({ status: "ready", value: { items: [], nextCursor: undefined } });
      await expect(provider.browse({ binding, signal })).resolves.toMatchObject({ status: "ready", value: { items: [document, folder] } });
      await expect(provider.search({ binding, query: "资料", topK: 4, signal })).resolves.toMatchObject({ status: "ready", value: { items: [document] } });
      await expect(provider.search({ binding, query: "unknown", topK: 4, signal })).resolves.toMatchObject({ status: "no_matches" });
    });
    it("reads a verified document and rejects revoked or cross-library access", async () => {
      const provider = await create();
      await expect(provider.read({ binding, handle, signal })).resolves.toMatchObject({ status: "ready", value: { text: source } });
      await expect(provider.read({ binding, handle: { ...handle, remoteKbId: "outside" }, signal })).resolves.toMatchObject({ status: "invalid_request" });
      await expect(provider.browse({ binding: { ...binding, enabled: 0 }, signal })).resolves.toMatchObject({ status: "not_configured" });
      await expect(provider.probe({ connectionId: "connection", signal: AbortSignal.abort() })).resolves.toMatchObject({ status: "cancelled" });
    });
  });
}

it("uses only published read routes and sends only signed headers to COS", async () => {
  const { provider, transport, fetch } = await real();
  await expect(transport.post("connection", "wiki/v1/import_urls", {}, signal)).resolves.toMatchObject({ status: "unsupported" });
  expect(fetch).not.toHaveBeenCalled();
  await provider.read({ binding, handle, signal });
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", credentials: "omit",
    headers: { "ima-openapi-clientid": "client", "ima-openapi-apikey": "secret" } });
  const sent = new Headers(fetch.mock.calls[1]?.[1]?.headers);
  expect([...sent.entries()]).toEqual([["x-ima-sign", "synthetic-signature"]]);
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ redirect: "error", credentials: "omit" });
  await provider.search({ binding, query: "资料", topK: 20, signal });
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("search_knowledge"))).toHaveLength(2);
});

it.each([[401, 0, "auth_denied"], [429, 0, "rate_limited"], [200, 220030, "content_unavailable"],
  [200, 51, "invalid_request"], [503, 0, "network_error"]])("maps HTTP %s and business %s", async (http, code, status) => {
  const { transport } = await real(async () => Response.json({ code, msg: "vendor private error" }, { status: http }));
  const result = await transport.post("connection", "wiki/v1/get_media_info", {}, signal);
  expect(result.status).toBe(status);
  expect(JSON.stringify(result)).not.toContain("vendor private error");
});

it("recognizes notes, rejects xlsx before download and truncates text reads", async () => {
  const { provider, fetch } = await real(async (input, init) => {
    const url = String(input);
    const { media_id } = JSON.parse(String(init?.body));
    return url.endsWith("get_doc_content") ? Response.json({ code: 0, data: { content: "文".repeat(13_000) } })
      : Response.json({ code: 0, data: media_id === "note" ? {
        media_type: 11, notebook_ext_info: { notebook_id: "linked-note" },
      } : { media_type: 5, url_info: { url: "https://skb.ima.myqcloud.com/fake" } } });
  });
  const note = await provider.read({ binding, signal, handle: { ...handle, document: { ...document, mediaId: "note" } } });
  expect(hasKnowledgeValue(note) && note.value.text.length).toBe(12_000);
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ note_id: "linked-note", target_content_format: 0 });
  await expect(provider.read({ binding, signal, handle: { ...handle, document: { ...document, title: "bad.xlsx" } } }))
    .resolves.toMatchObject({ status: "unsupported" });
  expect(fetch).toHaveBeenCalledTimes(3);
});
