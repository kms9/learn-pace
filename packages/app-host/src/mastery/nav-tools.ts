import type { AppStore, Clock, StoredMessage } from "@learn-pace/infra";
import type { PiDurableRuntime, RuntimeTool } from "@learn-pace/runtime";
import { limitText } from "../chat-turns.js";
import { latestSessionQuestion, projectLearningRecord } from "../learning-home.js";

type HandoffDestination = { kind: "open"; session_id: string; session_title: string; session_awaiting: boolean }
  | { kind: "new"; module_id: string; module_name: string };

export type MasteryHandoff = HandoffDestination & {
  path_id: string;
  path_name: string;
  emoji: string;
  mastered: number;
  total: number;
  percentage: number;
  due_count: number;
  opening_message: string;
  reason: string;
};

export function messageHandoffs(message: StoredMessage): MasteryHandoff[] {
  const cards = message.metadata?.handoffs;
  if (message.role !== "assistant" || !Array.isArray(cards)) return [];
  return cards.filter((card): card is MasteryHandoff =>
    typeof card?.path_id === "string" && !!card.path_id &&
    [card.path_name, card.emoji, card.opening_message, card.reason].every((value) => typeof value === "string") &&
    [card.mastered, card.total, card.percentage, card.due_count].every(Number.isFinite) &&
    (card.kind === "open" && typeof card.session_id === "string" && !!card.session_id &&
      typeof card.session_title === "string" && typeof card.session_awaiting === "boolean" ||
      card.kind === "new" && typeof card.module_id === "string" && typeof card.module_name === "string"));
}

const string = { type: "string" };
const path = { path_id: string };
const opening = { opening_message: string, reason: string };
const handoffHint = "已向学习者展示交接卡。简短说明会话里可以做什么，等待学习者选择。";

function input(args: Record<string, unknown>, key: string, max = 2_000) {
  const value = args[key];
  return typeof value === "string" ? limitText(value.trim(), max) : "";
}

export function registerMasteryNavigation(runtime: PiDurableRuntime, store: AppStore, clock: Clock,
  onHandoff: (handoff: MasteryHandoff) => void): string[] {
  type Result = Awaited<ReturnType<RuntimeTool["execute"]>>;
  const names: string[] = [];
  const register = (name: string, description: string, properties: object, required: string[], execute: RuntimeTool["execute"]) => {
    names.push(name);
    runtime.registerTool({ name, description, parameters: { type: "object", properties, required, additionalProperties: false },
      async execute(args, context) {
        try { return await execute(args, context); }
        catch { return { ok: false, message: "无法读取精通之路，请重试。" }; }
      },
    });
  };
  const topicMissing = { ok: false, message: "精通之路不存在，请用 mastery_topics 查看可用的路径 ID。" };

  register("mastery_topics", "列出精通之路的 ID、名称、模块、进度和到期复习。涉及已有路径时先调用。", {}, [], async () => {
    const now = clock.nowSeconds();
    const paths = await Promise.all((await store.listPathSummaries()).map(({ path_id }) => store.get(path_id)));
    const topics = paths.flatMap((progress) => {
      if (!progress) return [];
      const { id, name, emoji, mastered, total, percentage, dueCount, status } = projectLearningRecord(progress, now);
      return [{ path_id: id, name, emoji, mastered, total, percentage, due_count: dueCount, status,
        modules: progress.modules.map(({ id, name }) => ({ module_id: id, name })) }];
    });
    return { ok: true, topics };
  });

  register("mastery_sessions", "列出指定精通之路的会话、模式、最近消息时间和待处理题卡。", path, ["path_id"], async (args): Promise<Result> => {
    const pathId = input(args, "path_id");
    if (!pathId || !await store.get(pathId)) return topicMissing;
    const sessions = (await store.listSessionsByPath(pathId)).filter(({ kind, mode }) => kind === "mastery" && mode);
    return { ok: true, sessions: await Promise.all(sessions.map(async (session) => {
      const [messages, card] = await Promise.all([store.listMessages(session.session_id), latestSessionQuestion(store, session)]);
      return { session_id: session.session_id, title: session.title, mode: session.mode,
        last_message_at: messages.at(-1)?.created_at ?? null, has_pending_question: Boolean(card) };
    })) };
  });

  function registerHandoff(kind: MasteryHandoff["kind"]) {
    const open = kind === "open";
    register(open ? "mastery_open_session" : "mastery_new_session", open
      ? "为已知 ID 的精通会话提供继续学习卡片。写一条学习者可编辑的开场说与简短理由。"
      : "为指定路径提供另开学习会话的卡片，可指定模块。写一条学习者可编辑的开场说与简短理由。",
    { ...path, ...opening, ...(open ? { session_id: string } : { module_id: string }) },
    ["path_id", ...(open ? ["session_id"] : []), "opening_message", "reason"], async (args, { signal }): Promise<Result> => {
      const pathId = input(args, "path_id");
      const progress = pathId ? await store.get(pathId) : null;
      if (!progress) return topicMissing;
      const summary = projectLearningRecord(progress, clock.nowSeconds());
      let destination: HandoffDestination;
      if (open) {
        const session = await store.getSession(input(args, "session_id"));
        if (session?.kind !== "mastery" || session.path_id !== pathId || !session.mode) {
          return { ok: false, message: "该路径没有这次会话，请用 mastery_sessions 查看会话 ID。" };
        }
        destination = { kind: "open", session_id: session.session_id, session_title: session.title,
          session_awaiting: Boolean(await latestSessionQuestion(store, session)) };
      } else {
        if (summary.status === "draft") return { ok: false, message: "请先在这条精通之路定下大纲。" };
        const moduleId = input(args, "module_id");
        const module = progress.modules.find(({ id }) => id === moduleId);
        if (moduleId && !module) return { ok: false, message: "找不到该模块，请用 mastery_topics 查看模块 ID。" };
        destination = { kind: "new", module_id: module?.id ?? "", module_name: module?.name ?? "" };
      }
      const handoff: MasteryHandoff = { ...destination, path_id: pathId, path_name: summary.name, emoji: summary.emoji,
        mastered: summary.mastered, total: summary.total, percentage: summary.percentage, due_count: summary.dueCount,
        opening_message: input(args, "opening_message"), reason: input(args, "reason", 160) };
      signal.throwIfAborted();
      onHandoff(handoff);
      return { ok: true, handoff, message: handoffHint };
    });
  }
  registerHandoff("open");
  registerHandoff("new");
  return names;
}
