import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { StoredMessage, StoredSourceBinding } from "@learn-pace/infra";
import { limitText } from "../../chat-turns.js";
import type { KnowledgeDocument, VerifiedSourceHandle } from "./provider.js";

export interface KnowledgeCitation {
  sourceId: string;
  bindingId: string;
  remoteKbId: string;
  mediaId: string;
  title: string;
  sourceType: string;
  retrievedAt: number;
  contentSha256: string;
  excerpt: string;
}

const maxDocumentCharacters = 12_000;
const totalDocumentCharacters = 24_000;
const maxDocuments = 4;
const citationMarker = /\[S\d+\]/g;

export function redactDownloadUrls(value: string): string {
  return value
    .replace(/https?:\/\/(?:[a-z0-9.-]+\.myqcloud\.com|res-pkb\.ima\.qq\.com)\b[^\s<>"'\])}，。；]*/gi, "[下载地址已省略]")
    .replace(/\b(?:ima-openapi-(?:clientid|apikey)|x-ima-(?:sign|uid-sha256|create-url-time))\s*[:=]\s*[^\s,，;；]+/gi, "[凭据字段已省略]");
}

export function messageKnowledgeCitations(message: StoredMessage): KnowledgeCitation[] {
  const citations = message.metadata?.citations;
  if (!Array.isArray(citations)) return [];
  return citations.filter((value): value is KnowledgeCitation => value &&
    /^S\d+$/.test(value.sourceId) && typeof value.title === "string" && typeof value.excerpt === "string" &&
    typeof value.sourceType === "string" && typeof value.contentSha256 === "string");
}

export class SourceLedger {
  private readonly handles = new Map<string, VerifiedSourceHandle>();
  private readonly handlesByMedia = new Map<string, string>();
  private readonly citations = new Map<string, KnowledgeCitation>();
  private readonly byMedia = new Map<string, KnowledgeCitation>();
  private readonly admitted = new Set<string>();
  private readonly pending = new Set<string>();
  private remaining = totalDocumentCharacters;

  constructor(private readonly binding: StoredSourceBinding, private readonly turnId: string, private readonly now: () => number) {}

  issue(document: KnowledgeDocument): string {
    const existing = this.handlesByMedia.get(document.mediaId);
    if (existing) return existing;
    const handleId = this.turnId + ":document:" + (this.handles.size + 1);
    this.handles.set(handleId, { bindingId: this.binding.binding_id, remoteKbId: this.binding.remote_kb_id, document });
    this.handlesByMedia.set(document.mediaId, handleId);
    return handleId;
  }

  handle(handleId: string): VerifiedSourceHandle | undefined { return this.handles.get(handleId); }
  evidence(mediaId: string): KnowledgeCitation | undefined { return this.byMedia.get(mediaId); }
  hasEvidence(): boolean { return this.citations.size > 0; }

  reserve(handle: VerifiedSourceHandle, readOriginal = false) {
    const mediaId = handle.document.mediaId;
    const evidence = this.byMedia.get(mediaId);
    if (this.pending.has(mediaId) || (evidence && (!readOriginal || evidence.sourceType !== "highlight")) || this.remaining <= 0 ||
        (!this.admitted.has(mediaId) && this.admitted.size >= maxDocuments)) return;
    this.admitted.add(mediaId);
    this.pending.add(mediaId);
    const budget = Math.min(maxDocumentCharacters, this.remaining);
    this.remaining -= budget;
    let used = 0;
    let completed = false;
    return {
      capture: (body: string, sourceType: string) => {
        if (completed || used) return;
        const text = limitText(redactDownloadUrls(body).trim(), budget);
        if (!text) return;
        used = Array.from(text).length;
        const sourceId = "S" + (this.citations.size + 1);
        const citation = {
          sourceId, bindingId: handle.bindingId, remoteKbId: handle.remoteKbId, mediaId,
          title: redactDownloadUrls(handle.document.title), sourceType, retrievedAt: this.now(),
          contentSha256: bytesToHex(sha256(new TextEncoder().encode(text))), excerpt: limitText(text, 1_500),
        };
        this.citations.set(sourceId, citation);
        this.byMedia.set(mediaId, citation);
        return { sourceId, text };
      },
      release: () => {
        if (completed) return;
        completed = true;
        this.pending.delete(mediaId);
        this.remaining += budget - used;
      },
    };
  }

  finalize(raw: string) {
    const citations = new Map<string, KnowledgeCitation>();
    const content = redactDownloadUrls(raw).replace(citationMarker, marker => {
      const citation = this.citations.get(marker.slice(1, -1));
      if (citation) citations.set(citation.sourceId, citation);
      return citation ? marker : "";
    });
    return { content, citations: [...citations.values()] };
  }
}
