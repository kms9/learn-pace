import type { SecretStore } from "@learn-pace/infra";
import { limitText } from "../../chat-turns.js";
import { decodeImaCredentials, isImaCredentialRef } from "./ima-credentials.js";
import { knowledgeFailure, ready, type KnowledgeFailure, type KnowledgeResult } from "./provider.js";

const origin = "https://ima.qq.com";
const routes = new Set([
  "wiki/v1/search_knowledge_base", "wiki/v1/get_knowledge_base", "wiki/v1/get_knowledge_list",
  "wiki/v1/search_knowledge", "wiki/v1/get_media_info", "note/v1/get_doc_content",
]);
const allowedSignedHeaders = new Set([
  "x-ima-create-url-time", "x-ima-platform", "x-ima-resource-category",
  "x-ima-sign", "x-ima-trace-id", "x-ima-uid-sha256",
]);
const maxDownload = 5 * 1024 * 1024;
const errorCodes: Partial<Record<number, KnowledgeFailure["status"]>> = {
  20004: "auth_denied", 200002: "auth_denied", 20002: "rate_limited", 110021: "rate_limited",
  110010: "network_error", 100003: "network_error", 220030: "content_unavailable",
  51: "invalid_request", 110001: "invalid_request", 220001: "invalid_request",
};

export type Row = Record<string, unknown>;
export const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const headersPolicy = { credentials: "omit", redirect: "error" } as const;

function failedHttp(status: number, fallback: KnowledgeFailure["status"]): KnowledgeFailure {
  if (status === 401 || status === 403) return knowledgeFailure("auth_denied");
  if (status === 429) return knowledgeFailure("rate_limited");
  return knowledgeFailure(fallback);
}

export class ImaTransport {
  constructor(private readonly secrets: SecretStore,
    private readonly credentialRef: (connectionId: string) => Promise<string | null>,
    private readonly request: typeof fetch = globalThis.fetch) {}

  async hasCredentials(connectionId: string): Promise<boolean> {
    return Boolean(await this.loadCredentials(connectionId));
  }

  private async loadCredentials(connectionId: string) {
    const ref = await this.credentialRef(connectionId);
    return isImaCredentialRef(ref) ? decodeImaCredentials(await this.secrets.getItem(ref).catch(() => null)) : null;
  }

  async post(connectionId: string, path: string, body: Row, signal: AbortSignal): Promise<KnowledgeResult<Row>> {
    if (!routes.has(path)) return knowledgeFailure("unsupported");
    const timeout = AbortSignal.timeout(15_000);
    try {
      if (signal.aborted) return knowledgeFailure("cancelled");
      const credentials = await this.loadCredentials(connectionId);
      if (signal.aborted) return knowledgeFailure("cancelled");
      if (!credentials) return knowledgeFailure("not_configured");
      const response = await this.request(origin + "/openapi/" + path, {
        ...headersPolicy, method: "POST", body: JSON.stringify(body), signal: AbortSignal.any([signal, timeout]),
        headers: {
          "content-type": "application/json", "ima-openapi-clientid": credentials.clientId,
          "ima-openapi-apikey": credentials.apiKey, "ima-openapi-ctx": "app=learn-pace",
        },
      });
      if (response.redirected) return knowledgeFailure("network_error");
      if (!response.ok) return failedHttp(response.status, "network_error");
      const envelope = row(await response.json());
      if (signal.aborted) return knowledgeFailure("cancelled");
      const code = envelope.code ?? envelope.retcode;
      if (code === 0 || code === "0") return ready(row(envelope.data));
      return knowledgeFailure(errorCodes[Number(code)] ?? "network_error");
    } catch {
      return knowledgeFailure(signal.aborted ? "cancelled" : timeout.aborted ? "timeout" : "network_error");
    }
  }

  async download(info: unknown, allowedMime: ReadonlySet<string>, signal: AbortSignal): Promise<KnowledgeResult<string>> {
    const download = row(info);
    if (typeof download.url !== "string" || !download.url) return knowledgeFailure("content_unavailable");
    let url: URL;
    try { url = new URL(download.url); } catch { return knowledgeFailure("unsupported"); }
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        (url.hostname !== "res-pkb.ima.qq.com" && !url.hostname.endsWith(".myqcloud.com"))) {
      return knowledgeFailure("unsupported");
    }
    const timeout = AbortSignal.timeout(15_000);
    const controller = new AbortController();
    const downloadSignal = AbortSignal.any([signal, timeout, controller.signal]);
    try {
      if (signal.aborted) return knowledgeFailure("cancelled");
      const headers = new Headers();
      for (const [name, value] of Object.entries(row(download.headers))) {
        if (allowedSignedHeaders.has(name.toLowerCase()) && typeof value === "string") headers.set(name, value);
      }
      const response = await this.request(url.href, { ...headersPolicy, headers, signal: downloadSignal });
      if (signal.aborted) return knowledgeFailure("cancelled");
      if (response.redirected || !response.ok) return failedHttp(response.status, "content_unavailable");
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const length = Number(response.headers.get("content-length"));
      if (!mime || !allowedMime.has(mime) || length > maxDownload) return knowledgeFailure("unsupported");
      if (!response.body) return knowledgeFailure("content_unavailable");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const reader = response.body.getReader();
      let bytes = 0;
      let text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (signal.aborted) return knowledgeFailure("cancelled");
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxDownload) return knowledgeFailure("unsupported");
          try { text = limitText(text + decoder.decode(value, { stream: true }), 12_000); }
          catch { return knowledgeFailure("unsupported"); }
        }
        try { text = limitText(text + decoder.decode(), 12_000).trim(); }
        catch { return knowledgeFailure("unsupported"); }
        return text ? ready(text) : knowledgeFailure("content_unavailable");
      } finally {
        reader.releaseLock();
      }
    } catch {
      return knowledgeFailure(signal.aborted ? "cancelled" : timeout.aborted ? "timeout" : "network_error");
    } finally {
      controller.abort();
    }
  }
}
