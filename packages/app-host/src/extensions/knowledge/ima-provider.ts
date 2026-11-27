import { limitText } from "../../chat-turns.js";
import { ImaTransport, row, type Row } from "./ima-transport.js";
import {
  hasKnowledgeValue, knowledgeFailure, ready, type KnowledgeBrowsePage, type KnowledgeDocument,
  type KnowledgeFolder, type KnowledgeLibrary, type KnowledgePage, type KnowledgeProvider,
  type KnowledgeResult, type KnowledgeText,
} from "./provider.js";

const markdownMime = new Set(["text/markdown", "text/x-markdown", "text/plain"]);
const textMime = new Set(["text/plain"]);
const csvMime = new Set(["text/csv", "text/plain"]);
const htmlMime = new Set(["text/html", "text/plain"]);
const jsonMime = new Set(["application/json", "text/json", "text/plain"]);
const supportedMime = { markdown: markdownMime, text: textMime, csv: csvMime, html: htmlMime, json: jsonMime };
const blockedTypes = new Set([1, 3, 4, 6, 9, 12, 14, 15, 16, 21, 99]);

function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function id(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : string(value);
}
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.map(row) : []; }
function nextCursor(data: Row, previous?: string): string | undefined {
  const cursor = id(data.next_cursor);
  return data.is_end === true || !cursor || cursor === previous ? undefined : cursor;
}
function boundedCount(limit = 20, cap = 50) {
  return Number.isFinite(limit) ? Math.min(cap, Math.max(1, Math.floor(limit))) : 20;
}

function textType(type: number, title: string): keyof typeof supportedMime | undefined {
  if (type === 5) return /\.csv$/i.test(title) ? "csv" : undefined;
  if (blockedTypes.has(type)) return undefined;
  if (/\.json$/i.test(title)) return "json";
  if (type === 7) return "markdown";
  if (type === 13) return "text";
  if (type === 20) return "html";
  return undefined;
}

function isFolder(item: Row): boolean {
  return Number(item.media_type) === 99 || id(item.media_id).startsWith("folder_") || Boolean(id(item.folder_id) && !id(item.media_id));
}

function folder(item: Row): KnowledgeFolder | undefined {
  const folderId = id(item.folder_id ?? item.id ?? item.media_id);
  return folderId ? { kind: "folder", folderId, title: string(item.title ?? item.name ?? item.folder_name) || "未命名文件夹" } : undefined;
}

function document(item: Row): KnowledgeDocument | undefined {
  const mediaId = id(item.media_id);
  if (!mediaId || isFolder(item)) return undefined;
  const title = limitText(string(item.title).trim() || "未命名文档", 240);
  const type = Number(item.media_type);
  const highlight = limitText(string(item.highlight_content).trim(), 12_000);
  return { kind: "document", mediaId, title, sourceType: type === 11 ? "note" : textType(type, title) ?? "unavailable",
    ...(highlight && { highlight }) };
}

function library(item: Row): KnowledgeLibrary | undefined {
  const libraryId = id(item.kb_id ?? item.id);
  const name = limitText(string(item.kb_name ?? item.name).trim(), 240);
  if (!libraryId || !name) return undefined;
  return { id: libraryId, name, description: limitText(string(item.description), 800),
    baseType: string(item.base_type), roleType: string(item.role_type),
    ...(typeof item.content_count === "number" && { contentCount: item.content_count }) };
}

function cleanHtml(value: string): string {
  return value.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export class ImaProvider implements KnowledgeProvider {
  readonly providerId = "ima";
  constructor(private readonly transport: ImaTransport) {}

  async probe(input: Parameters<KnowledgeProvider["probe"]>[0]) {
    const started = performance.now();
    const result = await this.discover({ ...input, limit: 1 });
    return hasKnowledgeValue(result) ? ready({ elapsedMs: Math.round(performance.now() - started) }) : result;
  }

  async discover({ connectionId, query, cursor, limit, signal }: Parameters<KnowledgeProvider["discover"]>[0]):
    Promise<KnowledgeResult<KnowledgePage<KnowledgeLibrary>>> {
    const result = await this.transport.post(connectionId, "wiki/v1/search_knowledge_base",
      { query: limitText(query?.trim() ?? "", 300), cursor: cursor ?? "", limit: boundedCount(limit) }, signal);
    if (!hasKnowledgeValue(result)) return result;
    if (!Array.isArray(result.value.info_list)) return knowledgeFailure("network_error");
    const items = rows(result.value.info_list).flatMap(item => library(item) ?? []);
    return ready({ items, nextCursor: nextCursor(result.value, cursor) });
  }

  async browse({ binding, folderId, cursor, limit, signal }: Parameters<KnowledgeProvider["browse"]>[0]):
    Promise<KnowledgeResult<KnowledgeBrowsePage>> {
    if (!binding.enabled || binding.provider !== this.providerId) return knowledgeFailure("not_configured");
    const result = await this.transport.post(binding.connection_id, "wiki/v1/get_knowledge_list", {
      knowledge_base_id: binding.remote_kb_id, cursor: cursor ?? "", limit: boundedCount(limit),
      ...(folderId && folderId !== binding.remote_kb_id && { folder_id: folderId }),
    }, signal);
    if (!hasKnowledgeValue(result)) return result;
    const data = result.value;
    const items = rows(data.knowledge_list ?? data.info_list).flatMap(item => {
      const entry = isFolder(item) ? folder(item) : document(item);
      return entry ? [entry] : [];
    });
    const seen = new Set(items.filter(item => item.kind === "folder").map(item => item.folderId));
    for (const item of rows(data.folder_list ?? data.folders)) {
      const entry = folder(item);
      if (!entry || seen.has(entry.folderId)) continue;
      seen.add(entry.folderId);
      items.push(entry);
    }
    return ready({ items, nextCursor: nextCursor(data, cursor), path: rows(data.current_path).flatMap(item => folder(item) ?? []) });
  }

  async search({ binding, query, topK, signal }: Parameters<KnowledgeProvider["search"]>[0]):
    Promise<KnowledgeResult<KnowledgePage<KnowledgeDocument>>> {
    if (!binding.enabled || binding.provider !== this.providerId) return knowledgeFailure("not_configured");
    if (!query.trim()) return knowledgeFailure("invalid_request");
    const count = boundedCount(topK, 20);
    const found = new Map<string, KnowledgeDocument>();
    const seen = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const result = await this.transport.post(binding.connection_id, "wiki/v1/search_knowledge",
        { knowledge_base_id: binding.remote_kb_id, query: limitText(query.trim(), 300), cursor }, signal);
      if (!hasKnowledgeValue(result)) return found.size && result.status !== "cancelled" && result.status !== "auth_denied"
        ? { status: "partial", value: { items: [...found.values()] }, message: result.message } : result;
      if (!Array.isArray(result.value.info_list)) return knowledgeFailure("network_error");
      for (const item of rows(result.value.info_list)) {
        const entry = document(item);
        if (entry && !found.has(entry.mediaId)) found.set(entry.mediaId, entry);
      }
      const next = nextCursor(result.value, cursor);
      if (!next || seen.has(next) || found.size >= count) break;
      seen.add(next);
      cursor = next;
    }
    return found.size ? ready({ items: [...found.values()].slice(0, count) }) : knowledgeFailure("no_matches");
  }

  async read({ binding, handle, signal }: Parameters<KnowledgeProvider["read"]>[0]): Promise<KnowledgeResult<KnowledgeText>> {
    const { document: entry } = handle;
    if (!binding.enabled || handle.bindingId !== binding.binding_id || handle.remoteKbId !== binding.remote_kb_id ||
        !entry.mediaId || entry.mediaId.startsWith("folder_")) return knowledgeFailure("invalid_request");

    const result = await this.transport.post(binding.connection_id, "wiki/v1/get_media_info", { media_id: entry.mediaId }, signal);
    if (!hasKnowledgeValue(result)) return result;
    const info = result.value;
    if (id(info.media_id) && id(info.media_id) !== entry.mediaId) return knowledgeFailure("content_unavailable");
    const type = Number(info.media_type);
    if (type === 11) {
      const note = row(info.notebook_ext_info);
      const noteId = id(note.notebook_id ?? note.doc_id);
      if (!noteId) return knowledgeFailure("content_unavailable");
      const content = await this.transport.post(binding.connection_id, "note/v1/get_doc_content",
        { note_id: noteId, target_content_format: 0 }, signal);
      if (!hasKnowledgeValue(content)) return content;
      const text = limitText(string(content.value.content).trim(), 12_000);
      return text ? ready({ text, sourceType: "note" }) : knowledgeFailure("content_unavailable");
    }
    const sourceType = textType(type, entry.title);
    if (!sourceType) return knowledgeFailure("unsupported");
    const content = await this.transport.download(info.url_info, supportedMime[sourceType], signal);
    if (!hasKnowledgeValue(content)) return content;
    const text = sourceType === "html" ? cleanHtml(content.value) : content.value;
    return text ? ready({ text, sourceType }) : knowledgeFailure("content_unavailable");
  }
}
