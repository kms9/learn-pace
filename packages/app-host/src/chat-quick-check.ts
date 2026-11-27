import { publicPendingQuestion, type PendingQuestion } from "@learn-pace/domain";
import { SubmissionConflictError, type AppStore, type Clock, type QuestionGrade, type StoredMessage } from "@learn-pace/infra";
import { assessSemantically, exactVerdict, generateQuickCheck, QuickCheckGenerationError } from "@learn-pace/runtime";
import { boundedHistory, ChatTurnError, limitText, type ChatTurns } from "./chat-turns.js";
import { partReceipt, type Answers } from "./mastery/study.js";
import type { RestoreGate } from "./restore-gate.js";
import type { KnowledgeService } from "./extensions/knowledge/knowledge-service.js";
import { createProvenanceFilter } from "./extensions/knowledge/provenance.js";

interface StoredQuickCheck {
  check_id: string;
  source_message_id?: string;
  status: "awaiting_input" | "answered" | "graded";
  questions: PendingQuestion[];
  answers: Answers;
  submission_id: string | null;
  grades: Record<string, QuestionGrade>;
  grading_failed?: boolean;
  created_at: number;
  updated_at: number;
}

type QuickCheckState = Pick<StoredQuickCheck, "check_id" | "source_message_id" | "status" |
  "answers" | "submission_id" | "grading_failed">;

export interface PublicQuickCheck extends QuickCheckState {
  questions: ReturnType<typeof publicPendingQuestion>[];
  grades: Record<string, QuestionGrade>;
}

function readCheck(message: StoredMessage): StoredQuickCheck | undefined {
  const check = message.metadata?.quick_check as StoredQuickCheck | undefined;
  if (message.role !== "assistant" || message.status !== "committed" || !check || typeof check.check_id !== "string" ||
      !["awaiting_input", "answered", "graded"].includes(check.status) || !Array.isArray(check.questions) ||
      !check.questions.length || !check.answers || !check.grades) return;
  return check;
}

/** A whitelist for both fresh messages from storage and messages already projected for chat. */
export function publicQuickCheck(message: StoredMessage): PublicQuickCheck | undefined {
  const check = readCheck(message);
  if (!check) return;
  const { check_id, source_message_id, status, submission_id, grading_failed } = check;
  const answers: Answers = {};
  const grades: Record<string, QuestionGrade> = {};
  for (const { question_id } of check.questions) {
    const answer = check.answers[question_id];
    if (typeof answer === "string") answers[question_id] = answer;
    const grade = check.grades[question_id];
    if (status === "graded" && grade?.final) {
      const { result, final, confidence, feedback, reference_answer, correct_option, explanation } = grade;
      grades[question_id] = { result, final, confidence, feedback, reference_answer, correct_option, explanation };
    }
  }
  return { check_id, source_message_id, status, submission_id, grading_failed, answers, grades,
    questions: check.questions.map(publicPendingQuestion) };
}

export function publicChatMessage(message: StoredMessage): StoredMessage {
  // 普通问答保留选择和轻量技能收据。自测继续使用独立的白名单投影。
  if (message.metadata?.quick_check === undefined) return message;
  return { ...message, metadata: { quick_check: publicQuickCheck(message) } };
}

export function quickCheckExcerpt(message: StoredMessage): string | undefined {
  const check = publicQuickCheck(message);
  if (check?.status !== "graded") return;
  return limitText(check.questions.map(({ question_id, prompt }) => {
    const result = check.grades[question_id]?.result;
    return (result === "correct" ? "自测题：" : "需巩固的自测题：") + prompt;
  }).join("\n"), 600).trim();
}

export function materialChatMessage(message: StoredMessage): StoredMessage {
  if (message.metadata?.quick_check === undefined) return message;
  return { ...message, content: quickCheckExcerpt(message) ?? message.content, metadata: null };
}

type Submission = { id: string; answers: Answers };
type RunningSubmission = Submission & { sessionId: string; result: Promise<StoredMessage> };
const submissions = new WeakMap<AppStore, Map<string, RunningSubmission>>();

function questionAnswers(check: StoredQuickCheck, answers: Answers): Answers {
  if (Object.keys(answers).length !== check.questions.length || check.questions.some(({ question_id }) => {
    const answer = answers[question_id];
    return !Object.hasOwn(answers, question_id) || typeof answer !== "string" || !answer.trim();
  })) throw new ChatTurnError("请为每道自测题填写有效作答");
  return Object.fromEntries(check.questions.map(({ question_id }) => [question_id, answers[question_id]!]));
}

function sameAnswers(previous: Answers, incoming: Answers): boolean {
  return Object.keys(previous).length === Object.keys(incoming).length &&
    Object.entries(incoming).every(([id, answer]) => Object.hasOwn(previous, id) && previous[id] === answer);
}

export class ChatQuickChecks {
  private readonly running: Map<string, RunningSubmission>;

  constructor(
    private readonly store: AppStore,
    private readonly clock: Clock,
    private readonly makeId: () => string,
    private readonly turns: ChatTurns,
    private readonly restoreGate: RestoreGate,
    private readonly fetch?: typeof globalThis.fetch,
    private readonly knowledge?: KnowledgeService,
  ) {
    this.running = submissions.get(store) ?? new Map();
    submissions.set(store, this.running);
  }

  async create(sessionId: string, sourceMessageId?: string): Promise<StoredMessage> {
    return this.turns.exclusively(sessionId, sessionId, async (signal) => {
      await this.requireSession(this.store, sessionId);
      const messages = await this.store.listMessages(sessionId);
      const index = sourceMessageId === undefined ? messages.length - 1 :
        messages.findIndex(({ message_id }) => message_id === sourceMessageId);
      const source = sourceMessageId === undefined ? undefined : messages[index];
      if (sourceMessageId !== undefined && (source?.role !== "assistant" || source.status !== "committed" ||
          !source.content.trim() || typeof source.metadata?.source_user_message_id !== "string")) {
        throw new ChatTurnError("请从已完成的回复发起自测");
      }
      const filter = await createProvenanceFilter(this.store, this.knowledge, messages);
      if (source && !filter(source)) throw new ChatTurnError("该回复来自已断开的知识库，请重新连接或从其他回复发起自测。");
      const history = boundedHistory(messages.slice(0, index + 1), 800, filter);
      if (!history.length) throw new ChatTurnError("请先完成一轮问答，再生成自测");
      const config = await this.turns.requireModel();
      const generated = await generateQuickCheck(config, {
        history, focusExcerpt: source?.content, signal, makeId: this.makeId,
      }, this.fetch).catch((error: unknown) => {
        if (error instanceof QuickCheckGenerationError) throw new ChatTurnError(error.message);
        throw new ChatTurnError("无法生成自测，请检查网络后重试");
      });
      signal.throwIfAborted();
      const now = this.clock.nowSeconds();
      const check: StoredQuickCheck = { check_id: this.makeId(), source_message_id: sourceMessageId,
        status: "awaiting_input", questions: generated.questions, answers: {}, submission_id: null, grades: {},
        created_at: now, updated_at: now };
      const saved = await this.store.runInTransaction(async (tx) => {
        const current = await tx.listMessages(sessionId);
        const message: StoredMessage = {
          message_id: this.makeId(), session_id: sessionId, role: "assistant", status: "committed",
          content: generated.intro, turn_id: null, metadata: { quick_check: check },
          created_at: Math.max(now, (current.at(-1)?.created_at ?? 0) + 0.001),
        };
        await tx.saveMessage(message);
        return message;
      });
      return this.publish(saved);
    });
  }

  async submit(sessionId: string, messageId: string, supplied?: Submission): Promise<StoredMessage> {
    return this.restoreGate.write(async () => {
      const { check, message } = await this.load(this.store, sessionId, messageId);
      const id = supplied?.id ?? check.submission_id;
      if (typeof id !== "string" || !id.trim()) throw new ChatTurnError("请先提交自测作答");
      const requested = supplied?.answers ?? check.answers;
      if (check.submission_id === id && !sameAnswers(check.answers, requested)) throw new SubmissionConflictError();
      if (check.status === "graded") {
        if (check.submission_id !== id) throw new ChatTurnError("这张自测题已完成判分");
        return publicChatMessage(message);
      }
      const active = this.running.get(messageId);
      if (active) {
        if (active.sessionId !== sessionId || active.id !== id) throw new ChatTurnError("正在批改这张自测题");
        if (!sameAnswers(active.answers, requested)) throw new SubmissionConflictError();
        return active.result;
      }
      const answers = questionAnswers(check, requested);
      const submission = { id, answers };
      const result = this.grade(sessionId, messageId, submission, supplied === undefined)
        .finally(() => this.running.delete(messageId));
      this.running.set(messageId, { ...submission, sessionId, result });
      return result;
    });
  }

  private async grade(sessionId: string, messageId: string, { id, answers }: Submission, retry: boolean) {
    const staged = await this.turns.exclusively(sessionId, sessionId, () =>
      this.store.runInTransaction(async (tx) => {
        const { check, message } = await this.load(tx, sessionId, messageId);
        if (check.submission_id === id && !sameAnswers(check.answers, answers)) throw new SubmissionConflictError();
        if (check.status === "graded") {
          if (check.submission_id !== id) throw new ChatTurnError("这张自测题已完成判分");
          return { check, message };
        }
        if ((check.status === "answered" || retry) && check.submission_id !== id) {
          throw new ChatTurnError("自测作答已更新，请刷新题卡后重试");
        }
        const grades = Object.fromEntries(Object.entries(check.grades).filter(([questionId, grade]) =>
          grade.final && check.answers[questionId] === answers[questionId]));
        const pending: StoredQuickCheck = { ...check, status: "answered", answers: questionAnswers(check, answers),
          submission_id: id, grades, grading_failed: false, updated_at: this.clock.nowSeconds() };
        return { check: pending, message: await this.save(tx, message, pending) };
      }));
    if (staged.check.status === "graded") return publicChatMessage(staged.message);
    this.publish(staged.message);

    let config: ReturnType<ChatTurns["requireModel"]> | undefined;
    const scored = await Promise.all(staged.check.questions.map(async (question) => {
      const questionId = question.question_id;
      try {
        const answer = answers[questionId]!;
        const previous = staged.check.grades[questionId];
        const verdict = previous ?? partReceipt(question, exactVerdict(question, answer) ??
          await assessSemantically(await (config ??= this.turns.requireModel()),
            { question, learner_answer: answer }, this.fetch));
        return [questionId, verdict] as const;
      } catch {
        return [questionId, undefined] as const;
      }
    }));
    const grades = Object.fromEntries(scored.flatMap(([key, grade]) => grade ? [[key, grade]] : []));
    const failed = scored.some(([, grade]) => !grade);
    const finished = scored.every(([, grade]) => grade?.final);
    // Ordinary chat can continue during grading; the transaction only replaces the staged check.
    const saved = await this.store.runInTransaction(async (tx) => {
      const { check, message } = await this.load(tx, sessionId, messageId);
      if (check.check_id !== staged.check.check_id || check.submission_id !== id || !sameAnswers(check.answers, answers) ||
          JSON.stringify(check.questions) !== JSON.stringify(staged.check.questions)) {
        throw new ChatTurnError("自测作答已更新，请刷新题卡后重试");
      }
      if (check.status === "graded") return message;
      if (check.status !== "answered") throw new ChatTurnError("自测作答已更新，请刷新题卡后重试");
      return this.save(tx, message, { ...check, grades, status: failed ? "answered" : finished ? "graded" : "awaiting_input",
        grading_failed: failed, updated_at: this.clock.nowSeconds() });
    });
    return this.publish(saved);
  }

  private async requireSession(store: AppStore, sessionId: string): Promise<void> {
    if ((await store.getSession(sessionId))?.kind !== "lf01") throw new ChatTurnError("找不到主对话");
  }

  private async load(store: AppStore, sessionId: string, messageId: string) {
    await this.requireSession(store, sessionId);
    const message = await store.getMessage(messageId);
    const check = message && message.session_id === sessionId ? readCheck(message) : undefined;
    if (!message || !check) throw new ChatTurnError("找不到这张自测题");
    return { message, check };
  }

  private async save(store: AppStore, message: StoredMessage, check: StoredQuickCheck) {
    const updated = { ...message, metadata: { quick_check: check } };
    await store.saveMessage(updated);
    return updated;
  }

  private publish(message: StoredMessage) {
    const visible = publicChatMessage(message);
    this.turns.publish(visible);
    return visible;
  }
}
