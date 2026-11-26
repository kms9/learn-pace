import { VersionConflictError, type AppStore, type Clock, type StoredMessage, type StoredSession } from "@learn-pace/infra";
import { requestModelId, type AgentRuntime, type ModelConfig, type RuntimeTurnRequest } from "@learn-pace/runtime";
import { restoreGateFor } from "./restore-gate.js";

export interface ChatQuote {
  text: string;
  source_message_id: string;
}

export class ChatTurnError extends Error {}

export type History = NonNullable<RuntimeTurnRequest["history"]>;
export type MessageObserver = (message: StoredMessage) => void;
export type ToolActivity = { toolName: string; callId: string; phase: "started" | "finished" };

export function limitText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = 0;
  for (const char of text) {
    if (limit-- === 0) break;
    end += char.length;
  }
  return text.slice(0, end);
}

export function chatTitleFromPrompt(content: string): string {
  return limitText(content.trim().replace(/\s+/g, " "), 36);
}

export function messageQuotes(message: StoredMessage): ChatQuote[] {
  return (Array.isArray(message.metadata?.quotes) ? message.metadata.quotes : []).filter(
    (quote): quote is ChatQuote => typeof quote?.text === "string" && typeof quote?.source_message_id === "string",
  );
}

function promptWithQuotes(message: StoredMessage): string {
  const references = messageQuotes(message).map(({ text }, index) => `引用 ${index + 1}：${text}`);
  return [...references, message.content].join("\n\n");
}

function sourceId(reply: StoredMessage): string | undefined {
  const id = reply.metadata?.source_user_message_id;
  return typeof id === "string" ? id : undefined;
}

export function interruptedReplies(session: StoredSession, messages: readonly StoredMessage[]) {
  const answered = new Set(messages.filter(({ role }) => role === "assistant").map(sourceId));
  const repairs: (Omit<StoredMessage, "message_id"> & { message_id?: string })[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.status === "generating") {
      repairs.push({ ...message, status: "interrupted" });
    } else if (message.role === "user" && message.status === "committed" && !answered.has(message.message_id)) {
      repairs.push({ session_id: session.session_id, role: "assistant", content: "", status: "interrupted",
        turn_id: message.turn_id, created_at: message.created_at + 0.0005,
        metadata: { source_user_message_id: message.message_id, model_id: message.metadata?.model_id ?? session.model_id } });
    }
  }
  return repairs;
}

export function boundedHistory(messages: readonly StoredMessage[], perMessage = Infinity): History {
  const users = new Map(messages.filter(({ role, status }) => role === "user" && status === "committed")
    .map((message) => [message.message_id, message]));
  const history: History[number][] = [];
  let budget = 12_000;
  for (let index = messages.length - 1; index >= 0 && history.length < 12; index--) {
    const reply = messages[index]!;
    if (reply.role !== "assistant" || reply.status !== "committed") continue;
    const user = users.get(sourceId(reply) ?? "");
    if (!user) continue;
    const question = limitText(promptWithQuotes(user), perMessage);
    const answer = limitText(reply.content, perMessage);
    const size = Array.from(question).length + Array.from(answer).length;
    if (size > budget) break;
    budget -= size;
    history.unshift({ role: "user", content: question }, { role: "assistant", content: answer });
  }
  return history;
}

function localizedFailure(error: string): string {
  const status = /^DeepSeek request failed \(HTTP ([45]\d{2})\)$/.exec(error)?.[1];
  if (status) return `模型请求失败（HTTP ${status}）`;
  if (error === "Model output reached its token limit") return "回复已达到模型输出上限";
  return "模型请求失败，请检查网络和模型配置后重试";
}

export function turnFrom(messages: StoredMessage[], messageId: string) {
  const message = messages.find(({ message_id }) => message_id === messageId);
  const reply = message?.role === "assistant" ? message : messages.find(
    (item) => item.role === "assistant" && sourceId(item) === messageId,
  );
  const userIndex = messages.findIndex((item) => item.role === "user" && item.message_id === (reply && sourceId(reply)));
  const user = messages[userIndex];
  if (!user || !reply) throw new ChatTurnError("找不到这轮对话");
  return { user, reply, userIndex };
}


export interface TurnContext {
  user: StoredMessage;
  turnId: string;
  signal: AbortSignal;
  deliveredText: () => string;
}

export type PrepareTurn = (session: StoredSession, config: ModelConfig, context: TurnContext) => Promise<{
  runtime: AgentRuntime;
  options?: Pick<RuntimeTurnRequest, "instructions" | "mode" | "pathId" | "maxTurns" | "onModelRound">;
  allowedTools?: readonly string[];
  toolSettled?: () => void;
  onToolActivity?: (activity: ToolActivity | null) => void;
  replyMetadata?: () => Record<string, unknown> | undefined;
  measure?: boolean;
}>;

export class ChatTurns {
  private readonly active = new Map<string, { session: string; controller: AbortController }>();
  private readonly observers = new Map<string, Set<MessageObserver>>();

  constructor(
    private readonly store: AppStore,
    private readonly clock: Clock,
    private readonly makeId: () => string,
    private readonly getModelConfig: () => Promise<ModelConfig | null>,
    private readonly restoreGate = restoreGateFor(store),
  ) {}

  running(scope: string) { return this.active.get(scope)?.session; }

  stop(scope: string, sessionId: string): void {
    const current = this.active.get(scope);
    if (current?.session === sessionId) current.controller.abort();
  }

  async configured(): Promise<boolean> {
    return Boolean(await this.getModelConfig().catch(() => null));
  }

  async exclusively<T>(scope: string, session: string, action: (signal: AbortSignal) => Promise<T>,
    busy = "此对话正在处理另一项操作"): Promise<T> {
    return this.restoreGate.write(async () => {
      if (this.active.has(scope)) throw new ChatTurnError(busy);
      const controller = new AbortController();
      this.active.set(scope, { session, controller });
      try {
        return await action(controller.signal);
      } finally {
        this.active.delete(scope);
      }
    });
  }

  observeMessages(sessionId: string, observer: MessageObserver): () => void {
    const observers = this.observers.get(sessionId) ?? new Set<MessageObserver>();
    observers.add(observer);
    this.observers.set(sessionId, observers);
    return () => {
      observers.delete(observer);
      if (!observers.size) this.observers.delete(sessionId);
    };
  }

  async send(session: StoredSession, content: string, quotes: readonly ChatQuote[], prepare: PrepareTurn,
    signal: AbortSignal, onMessage?: MessageObserver, metadata?: Record<string, unknown>) {
    const sessionId = session.session_id;
    const messages = await this.store.listMessages(sessionId);
    const config = await this.requireModel();
    const turnId = this.makeId();
    // Preserve ordering even when two rows share the same clock tick.
    const createdAt = Math.max(this.clock.nowSeconds(), (messages.at(-1)?.created_at ?? 0) + 0.001);
    const modelId = requestModelId(config);
    const user: StoredMessage = {
      message_id: this.makeId(), session_id: sessionId, role: "user",
      content, status: "committed", turn_id: turnId, created_at: createdAt,
      metadata: {
        ...metadata,
        model_id: modelId,
        quotes: quotes.map(({ text, source_message_id }) => ({ text: limitText(text, 2_000), source_message_id })),
      },
    };
    const reply: StoredMessage = {
      message_id: this.makeId(), session_id: sessionId, role: "assistant",
      content: "", status: "generating", turn_id: turnId, created_at: createdAt + 0.001,
      metadata: { source_user_message_id: user.message_id, model_id: modelId },
    };
    await this.store.saveMessage(user);
    this.publish(user, onMessage);
    return this.generate(session, config, user, reply, boundedHistory(messages), prepare, signal, onMessage);
  }

  async repeat(session: StoredSession, replyId: string, action: "retry" | "regenerate", prepare: PrepareTurn,
    signal: AbortSignal, onMessage?: MessageObserver) {
    const messages = await this.store.listMessages(session.session_id);
    const { user, reply, userIndex } = turnFrom(messages, replyId);
    const allowed = action === "retry"
      ? reply.status === "interrupted" || reply.status === "failed"
      : reply.status === "committed" && messages.filter(
          ({ role, status, metadata }) => role === "assistant" && status === "committed" && metadata?.quick_check === undefined,
        ).at(-1)?.message_id === replyId;
    if (!allowed) throw new ChatTurnError("此回复无法执行该操作");
    const config = await this.requireModel();
    return this.generate(session, config, user, {
      ...reply, content: "", status: "generating", turn_id: this.makeId(),
      metadata: { source_user_message_id: user.message_id, model_id: requestModelId(config) },
    }, boundedHistory(messages.slice(0, userIndex)), prepare, signal, onMessage);
  }

  async requireModel(): Promise<ModelConfig> {
    const config = await this.getModelConfig().catch(() => null);
    if (!config) throw new ChatTurnError("请先在「我的」中配置 DeepSeek Flash");
    return config;
  }

  private async generate(
    session: StoredSession,
    config: ModelConfig,
    user: StoredMessage,
    reply: StoredMessage,
    history: History,
    prepare: PrepareTurn,
    signal: AbortSignal,
    onMessage?: MessageObserver,
  ): Promise<StoredMessage> {
    await this.store.saveMessage(reply);
    this.publish(reply, onMessage);
    await this.store.saveSession({
      ...session,
      title: session.kind === "lf01" && session.model_id === null
        ? chatTitleFromPrompt(user.content)
        : session.title,
      model_id: requestModelId(config),
      updated_at: this.clock.nowSeconds(),
    });

    let content = "";
    let conflict: VersionConflictError | undefined;
    const prepared = await prepare(session, config, { user, turnId: reply.turn_id!, signal, deliveredText: () => content })
      .catch((error: unknown) => {
        if (error instanceof VersionConflictError) conflict = error;
        return undefined;
      });
    const { runtime, options, allowedTools = [], toolSettled, onToolActivity, replyMetadata, measure } = prepared ?? {};
    const started = performance.now();
    let ttft: number | null = null;
    const rounds: { input: number | null; output: number | null }[] = [];
    const tools: { name: string; action?: string; code: string }[] = [];
    let status = signal.aborted ? "interrupted" : "failed";
    let error: string | undefined;
    let savedAt: number | undefined;
    let writes = Promise.resolve();
    await runtime?.runTurn({
      sessionId: session.session_id, turnId: reply.turn_id!, prompt: promptWithQuotes(user),
      ...options, allowedTools, history, signal,
      ...(measure && { onModelRound: (round: Parameters<NonNullable<RuntimeTurnRequest["onModelRound"]>>[0]) => {
        rounds.push({ input: round.promptTokens ?? null, output: round.completionTokens ?? null });
      } }),
    }, (event) => {
      if (measure && (event.type === "text_delta" || event.type === "tool_call")) ttft ??= Math.round(performance.now() - started);
      if (event.type === "tool_call" || event.type === "tool_result") {
        onToolActivity?.({ toolName: event.toolName, callId: event.callId, phase: event.type === "tool_call" ? "started" : "finished" });
      }
      if (event.type === "text_delta") {
        content += event.delta;
        const partial = { ...reply, content };
        const now = this.clock.nowSeconds();
        if (savedAt === undefined || now - savedAt >= 1) {
          savedAt = now;
          // A later checkpoint can still succeed after a temporary write failure.
          writes = writes.then(() => this.store.saveMessage(partial)).catch(() => {});
        }
        this.publish(partial, onMessage);
      }
      if (event.type === "turn_completed") {
        if ((event.stopReason === "end_turn" && (content.trim() || replyMetadata?.())) || event.stopReason === "tool_terminated" ||
          event.stopReason === "question_presented") status = "committed";
        if (event.stopReason === "cancelled") status = "interrupted";
      }
      if (event.type === "turn_failed") error = event.error;
      if (event.type === "tool_result") {
        if (measure) {
          const result = event.output as { action?: string; code?: string } | null;
          tools.push({ name: event.toolName, action: result?.action, code: result?.code ?? "ok" });
        }
        toolSettled?.();
      }
    }).catch(() => {}).finally(() => onToolActivity?.(null));
    await writes;
    const terminal: StoredMessage = {
      ...reply, content, status,
      metadata: { ...reply.metadata, ...replyMetadata?.(), ...(status === "failed" ? { error: conflict?.message ?? localizedFailure(error ?? "") } : {}),
        ...(measure && { runtime: { ttft_ms: ttft, total_ms: Math.round(performance.now() - started), rounds, tools } }),
      },
    };
    await this.store.saveMessage(terminal);
    this.publish(terminal, onMessage);
    if (conflict) throw conflict;
    return terminal;
  }

  publish(message: StoredMessage, observer?: MessageObserver): void {
    observer?.(message);
    for (const notify of this.observers.get(message.session_id) ?? []) notify(message);
  }
}
