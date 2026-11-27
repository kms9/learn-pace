import type { AppStore, StoredMessage, StoredSourceBinding } from "@learn-pace/infra";
import type { KnowledgeChoice, KnowledgeService } from "./knowledge-service.js";

export type KnowledgeProvenance = { bindingId: string; connectionId: string; provider: "ima"; remoteKbId: string };
export const unavailableSourceText = "[已撤销外部知识库来源的历史回答，默认不再次发送给模型]";

export function provenanceOf(binding: StoredSourceBinding): KnowledgeProvenance {
  return { bindingId: binding.binding_id, connectionId: binding.connection_id,
    provider: binding.provider, remoteKbId: binding.remote_kb_id };
}

export function knowledgeProvenance(value: unknown): KnowledgeProvenance | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Partial<KnowledgeProvenance>;
  if (item.provider === "ima" && typeof item.bindingId === "string" &&
      typeof item.connectionId === "string" && typeof item.remoteKbId === "string") {
    return { bindingId: item.bindingId, connectionId: item.connectionId, provider: item.provider, remoteKbId: item.remoteKbId };
  }
}

export function messageKnowledgeProvenance(message: StoredMessage | null | undefined): KnowledgeProvenance | undefined {
  return knowledgeProvenance(message?.metadata?.knowledge_provenance);
}

export function messageKnowledgeSelection(message: StoredMessage): KnowledgeChoice | undefined {
  const item = message.metadata?.knowledge_selection as Partial<KnowledgeChoice> | undefined;
  if (item && typeof item.bindingId === "string" && (item.mode === "kb_only" || item.mode === "kb_assisted")) {
    return { bindingId: item.bindingId, mode: item.mode };
  }
}

type QuoteSource = { source_message_id: string };
export type ProvenanceFilter = (source: StoredMessage | KnowledgeProvenance | undefined, quotedId?: string) => boolean;

export async function createProvenanceFilter(store: AppStore, service?: KnowledgeService,
  history: readonly StoredMessage[] = [], extraQuotes: readonly QuoteSource[] = []): Promise<ProvenanceFilter> {
  const quotedIds = new Set(extraQuotes.map(quote => quote.source_message_id));
  for (const message of history) {
    if (!Array.isArray(message.metadata?.quotes)) continue;
    for (const quote of message.metadata.quotes) {
      if (quote && typeof quote.source_message_id === "string") quotedIds.add(quote.source_message_id);
    }
  }
  const [bindings, quoted] = await Promise.all([
    service?.listAvailableBindings() ?? [],
    Promise.all([...quotedIds].map(async id => [id, messageKnowledgeProvenance(await store.getMessage(id))] as const)),
  ]);
  const available = new Map(bindings.map(binding => [binding.binding_id, provenanceOf(binding)]));
  const quotedProvenance = new Map(quoted);
  return (source, quotedId) => {
    const info = (quotedId && quotedProvenance.get(quotedId)) ||
      (source && ("message_id" in source ? messageKnowledgeProvenance(source) : source));
    if (!info) return true;
    const binding = available.get(info.bindingId);
    return binding?.connectionId === info.connectionId && binding.remoteKbId === info.remoteKbId && binding.provider === info.provider;
  };
}
