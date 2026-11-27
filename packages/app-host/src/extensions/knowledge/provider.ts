import type { StoredSourceBinding } from "@learn-pace/infra";

export type KnowledgeStatus = "ready" | "partial" | "no_matches" | "not_configured" | "auth_denied" |
  "rate_limited" | "content_unavailable" | "unsupported" | "network_error" | "timeout" | "cancelled" | "invalid_request";

export type KnowledgeFailure = { status: Exclude<KnowledgeStatus, "ready" | "partial">; message: string };
export type KnowledgeResult<T> = { status: "ready" | "partial"; value: T; message?: string } | KnowledgeFailure;

export const ready = <T>(value: T): KnowledgeResult<T> => ({ status: "ready", value });
export const hasKnowledgeValue = <T>(result: KnowledgeResult<T>): result is Extract<KnowledgeResult<T>, { value: T }> =>
  "value" in result;

export const knowledgeMessages = {
  no_matches: "未找到符合条件的资料",
  not_configured: "请先连接并授权知识库",
  auth_denied: "知识库拒绝授权，请检查凭据或重新连接",
  rate_limited: "知识库请求频繁，请稍后重试",
  content_unavailable: "该资料的正文暂不可用",
  unsupported: "暂不支持读取此格式的正文",
  network_error: "知识库请求失败，请检查网络后重试",
  timeout: "知识库请求超时，请重试",
  cancelled: "已取消知识库请求",
  invalid_request: "知识库请求参数无效",
} satisfies Record<KnowledgeFailure["status"], string>;

export function knowledgeFailure(status: KnowledgeFailure["status"]): KnowledgeFailure {
  return { status, message: knowledgeMessages[status] };
}

export interface KnowledgeLibrary {
  id: string;
  name: string;
  description: string;
  baseType: string;
  roleType: string;
  contentCount?: number;
}

export interface KnowledgeFolder {
  kind: "folder";
  folderId: string;
  title: string;
}

export interface KnowledgeDocument {
  kind: "document";
  mediaId: string;
  title: string;
  sourceType: string;
  highlight?: string;
}

export interface KnowledgePage<T> {
  items: T[];
  nextCursor?: string;
}

export interface KnowledgeBrowsePage extends KnowledgePage<KnowledgeFolder | KnowledgeDocument> {
  path: KnowledgeFolder[];
}

export interface VerifiedSourceHandle {
  bindingId: string;
  remoteKbId: string;
  document: KnowledgeDocument;
}

export interface KnowledgeText {
  text: string;
  sourceType: string;
}

type ConnectionRequest = { connectionId: string; signal: AbortSignal };
type BindingRequest = { binding: StoredSourceBinding; signal: AbortSignal };

export interface KnowledgeProvider {
  readonly providerId: string;
  probe(input: ConnectionRequest): Promise<KnowledgeResult<{ elapsedMs: number }>>;
  discover(input: ConnectionRequest & { query?: string; cursor?: string; limit?: number }): Promise<KnowledgeResult<KnowledgePage<KnowledgeLibrary>>>;
  browse(input: BindingRequest & { folderId?: string; cursor?: string; limit?: number }): Promise<KnowledgeResult<KnowledgeBrowsePage>>;
  search(input: BindingRequest & { query: string; topK: number }): Promise<KnowledgeResult<KnowledgePage<KnowledgeDocument>>>;
  read(input: BindingRequest & { handle: VerifiedSourceHandle }): Promise<KnowledgeResult<KnowledgeText>>;
}
