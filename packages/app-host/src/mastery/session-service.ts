import {
  bindBuiltinReviewStrategy, createLearningProgress, derivePathStatus, findKnowledgePoint, isAssessedMastered,
  isMastered, objectiveReport, pathDisplayName, rebindOutlineQuestion, resetProgress, schedulerForProgress,
  setLearnerMasteryOverride, stateDigest, validateDesiredRetention,
  type LearningProgress, type SessionMode, type TopicSource,
} from "@learn-pace/domain";
import type { AppStore, Clock, StoredInteraction, StoredMessage, StoredSession } from "@learn-pace/infra";
import { PiDurableRuntime, type ModelConfig } from "@learn-pace/runtime";
import { ChatTurnError, ChatTurns, limitText, type MessageObserver, type PrepareTurn } from "../chat-turns.js";
import { readLearningRecords } from "../learning-home.js";
import { restoreGateFor } from "../restore-gate.js";
import { masteryInstructions, masteryOpeningMessage, reviewOpeningMessage } from "./prompts.js";
import type { MasteryHandoff } from "./nav-tools.js";
import { saveProgress } from "./persistence.js";
import { reviewPlan } from "./review.js";
import { masteryStatus } from "./status.js";
import { registerMasteryTools, ToolRefusal, type OutlinePreview } from "./tools/index.js";
import { displayStudyAnswer, projectStudyCard, savedAnswers, StaleInteractionError, StudyInteractions, type Answers, type StudyCard } from "./study.js";

const blocked = "同一精通目标的另一会话正在进行，请等它结束再发送";
const emptyOutline = "还没有可以学习的大纲。请留在「编辑大纲」模式，先和导师定下大纲。";

const toolLabels = new Map([
  ["read_source", "正在读取资料…"], ["mastery_profile", "正在更新学习档案…"],
  ["mastery_build", "正在整理大纲…"], ["mastery_revise", "正在修订大纲…"],
  ["mastery_mode", "正在切换模式…"], ["mastery_quiz", "正在准备题目…"],
  ["mastery_grade", "正在批改作答…"], ["mastery_assess", "正在评估你的解释…"],
  ["mastery_status", "正在查看学习进度…"], ["mastery_note_explained", "正在记录讲解…"],
  ["mastery_defer_objective", "正在调整学习顺序…"], ["mastery_skip_question", "正在跳过题目…"],
  ["mastery_repair_question", "正在复核题目…"],
]);

export function masteryToolStatusLabel(toolName: string): string {
  return toolLabels.get(toolName) ?? "正在处理…";
}

type ActivityObserver = (toolName: string | null) => void;
type OutlineCommit = { sessionId: string; turnId: string };

export type TopicMaterial =
  | { kind: "chat"; sessionId: string; messageId?: string; excerpt?: string }
  | { kind: "text_note"; label?: string; text: string };

export type SubmitAnswerResult = { kind: "turn"; message: StoredMessage } | { kind: "receipt"; card: StudyCard };

export class MasterySessionService {
  private readonly turns: ChatTurns;
  private readonly study: StudyInteractions;
  private readonly previews = new Map<string, OutlinePreview>();
  private readonly observers = new Map<string, Set<() => void>>();
  private readonly changeObservers = new Set<() => void>();
  private readonly activityObservers = new Map<string, Set<ActivityObserver>>();
  private readonly activity = new Map<string, string>();

  constructor(private readonly store: AppStore, private readonly clock: Clock, private readonly makeId: () => string,
    getModelConfig: () => Promise<ModelConfig | null>, private readonly fetch?: typeof globalThis.fetch,
    private readonly restoreGate = restoreGateFor(store)) {
    this.turns = new ChatTurns(store, clock, makeId, getModelConfig, restoreGate);
    this.study = new StudyInteractions(store, () => this.clock.nowSeconds(), makeId,
      (id) => this.requirePath(id), (progress) => this.persist(progress), fetch);
  }

  async createTopic(input: { goal: string; emoji?: string; materials?: readonly TopicMaterial[] }) {
    return this.restoreGate.write(async () => {
      const goal = input.goal.trim();
      if (!goal || [...goal].length > 2000) throw new ChatTurnError("请输入 1–2,000 个字符的学习目标");
      const now = this.clock.nowSeconds();
      const id = this.makeId();
      const goalSource: TopicSource = { id: this.makeId(), kind: "goal", label: "学习目标", excerpt: goal, created_at: now };
      const materials = await Promise.all((input.materials ?? []).map((item) => this.resolveSource(item, now)));
      const progress = createLearningProgress({
        book_id: id, goal, name: limitText(goal.replace(/\s+/g, " "), 48), emoji: input.emoji?.trim() || "🧭",
        topic_sources: [goalSource, ...materials], created_at: now, updated_at: now,
      });
      const session = await this.withPath(id, "", () => this.store.runInTransaction(async (tx) => {
        await tx.saveWithCas(progress, null, derivePathStatus(progress));
        return this.insertSession(progress, "outline", this.makeId(), tx);
      }));
      const opening = this.sendOpening(session, masteryOpeningMessage);
      return { pathId: id, session, opening };
    });
  }

  async listTopics() {
    const records = await readLearningRecords(this.store, this.clock.nowSeconds());
    return records.map((record) => ({ ...record, dueReviews: record.dueCount }));
  }

  async listMaterialSessions() {
    return (await this.store.listSessions()).filter(({ kind }) => kind === "lf01");
  }

  async listMaterialMessages(sessionId: string) {
    await this.requireSourceSession(sessionId);
    return (await this.store.listMessages(sessionId)).filter((message) => message.status === "committed" &&
      (message.role === "user" || message.role === "assistant") && message.content.trim());
  }

  async readTopic(pathId: string) {
    const path = await this.requirePath(pathId);
    const [sessions, open] = await Promise.all([this.listSessions(pathId), this.store.getOpenInteraction(pathId)]);
    const now = this.clock.nowSeconds();
    const plan = reviewPlan(path, now);
    const status = masteryStatus(path, "outline", now, open, undefined, plan);
    return { pathId, name: status.path_name, goal: status.goal, emoji: path.emoji ?? "🧭", status: status.summary.status,
      summary: status.summary, sources: status.sources, map: status.map, next: status.next, sessions,
      learnerProfile: path.learner_profile, reviewPlan: plan };
  }

  async reviewPlan(pathId: string) {
    const progress = await this.requirePath(pathId);
    return reviewPlan(progress, this.clock.nowSeconds());
  }

  async setReviewStrategy(pathId: string, templateId: string | null) {
    return this.withPath(pathId, "", async () => {
      const progress = await this.requirePath(pathId);
      let next: LearningProgress;
      try { next = bindBuiltinReviewStrategy(progress, templateId, this.clock.nowSeconds()); }
      catch (cause) {
        if (cause instanceof RangeError) throw new ChatTurnError(cause.message);
        throw cause;
      }
      await this.persist(next);
    });
  }

  async setDesiredRetention(pathId: string, target: number) {
    try { validateDesiredRetention(target); }
    catch { throw new ChatTurnError("记忆保持目标须在 70%–99% 之间"); }
    return this.withPath(pathId, "", async () => {
      const progress = await this.requirePath(pathId);
      schedulerForProgress(progress).setDesiredRetention(progress, target, this.clock.nowSeconds());
      await this.persist(progress);
    });
  }

  async renameTopic(pathId: string, rawName: string) {
    const name = rawName.trim();
    if (!name || [...name].length > 120) throw new ChatTurnError("请输入 1–120 个字符的名称");
    return this.withPath(pathId, "", async () => this.persist({ ...await this.requirePath(pathId), name }));
  }

  async resetTopic(pathId: string) {
    return this.withPath(pathId, "", async () => {
      const now = this.clock.nowSeconds();
      const progress = await this.requirePath(pathId);
      const reset = resetProgress(progress, now);
      await this.store.runInTransaction(async (tx) => {
        await tx.saveWithCas(reset, progress.version, derivePathStatus(reset));
        for (const card of await tx.listOpenInteractionsByPath(pathId)) {
          await tx.abandonInteraction(card.interaction_id, now);
        }
      });
      this.clearPreviews(pathId);
    });
  }

  async deleteTopic(pathId: string) {
    return this.withPath(pathId, "", async () => {
      await this.store.runInTransaction(async (tx) => {
        await this.requirePath(pathId, tx);
        await tx.deleteInteractionsByPath(pathId);
        await tx.deleteSessionsByPath(pathId, "mastery");
        await tx.delete(pathId);
        await tx.deleteDomainEventsByPath(pathId);
      });
      this.clearPreviews(pathId);
    });
  }

  async listSessions(pathId: string) {
    const sessions = (await this.store.listSessionsByPath(pathId)).filter(({ kind }) => kind === "mastery");
    return Promise.all(sessions.map(async (session) => {
      const latest = (await this.store.listMessages(session.session_id)).reverse().find(({ content }) => content.trim());
      return { ...session, lastMessage: latest ? limitText(latest.content, 96) : "" };
    }));
  }

  async createSession(pathId: string, mode: SessionMode): Promise<StoredSession> {
    return this.withPath(pathId, "", async () => {
      const progress = await this.requirePath(pathId);
      this.assertAdmission(mode, progress);
      return this.insertSession(progress, mode);
    });
  }

  followHandoff(handoff: MasteryHandoff, opening: string): Promise<StoredSession> {
    const pathId = handoff.path_id;
    const sessionId = handoff.kind === "open" ? handoff.session_id : this.makeId();
    const content = opening.trim();
    return new Promise((resolve, reject) => {
      void this.withPath(pathId, sessionId, async (signal) => {
        const progress = await this.store.get(pathId);
        if (!progress) throw new ChatTurnError("该精通之路不存在");
        const existing = handoff.kind === "open" ? await this.requireSession(pathId, sessionId) : null;
        const moduleId = handoff.kind === "new" ? handoff.module_id : "";
        if (moduleId && !progress.modules.some(({ id }) => id === moduleId)) throw new ChatTurnError("该模块不存在");
        if (!existing) this.assertAdmission("study", progress);
        if (content && !await this.turns.configured()) throw new ChatTurnError("请先在「我的」中配置 DeepSeek Flash");
        const session = existing ?? await this.insertSession(progress, "study", sessionId);
        if (content) {
          await this.turns.send(session, content, [], this.prepare, signal, ({ role }) => {
            if (role === "user") resolve(session);
          }, moduleId ? { mastery_module_id: moduleId } : undefined);
        } else {
          resolve(session);
        }
      }).catch(reject);
    });
  }

  async startReview(pathId: string, objectiveId?: string) {
    return this.restoreGate.write(async () => {
      const { session, message } = await this.withPath(pathId, "", async () => {
        const progress = await this.requirePath(pathId);
        const objective = objectiveId ? findKnowledgePoint(progress, objectiveId).kp : undefined;
        if (objectiveId && (!objective || !isMastered(progress, objective))) {
          throw new ChatTurnError("复习只考已经掌握的知识点");
        }
        const titles = objective ? [objective.name] : reviewPlan(progress, this.clock.nowSeconds()).due.map(({ knowledge_point_name }) => knowledge_point_name);
        return { session: await this.insertSession(progress, "review"), message: reviewOpeningMessage(titles) };
      });
      const opening = this.sendOpening(session, message);
      return { session, opening };
    });
  }

  private sendOpening(session: StoredSession, message: string) {
    const opening = this.restoreGate.write(async () => await this.turns.configured()
      ? this.send(session.path_id!, session.session_id, message) : null);
    // 进入会话时，开场消息可继续在后台生成。
    void opening.catch(() => {});
    return opening;
  }

  private async insertSession(progress: LearningProgress, mode: SessionMode, sessionId = this.makeId(), store = this.store) {
    const now = this.clock.nowSeconds();
    const session: StoredSession = {
      session_id: sessionId, kind: "mastery", path_id: progress.book_id, mode,
      title: pathDisplayName(progress), model_id: null, created_at: now, updated_at: now,
    };
    await store.saveSession(session);
    return session;
  }

  async openSession(pathId: string, sessionId: string) {
    const session = await this.requireSession(pathId, sessionId);
    const [path, messages, open, cards] = await Promise.all([
      this.requirePath(pathId), this.store.listMessages(sessionId), this.store.getOpenInteraction(pathId),
      this.store.listInteractionsBySession(sessionId),
    ]);
    return { session, messages, status: masteryStatus(path, session.mode!, this.clock.nowSeconds(), open, sessionId),
      cards: cards.filter(({ path_id }) => path_id === pathId).map(projectStudyCard) };
  }

  async switchMode(pathId: string, sessionId: string, mode: SessionMode) {
    return this.withPath(pathId, sessionId, async () => {
      try {
        await this.persistMode(await this.requireSession(pathId, sessionId), mode);
      } catch (error) {
        if (error instanceof ToolRefusal) throw new ChatTurnError(error.message);
        throw error;
      }
    });
  }

  runningSession(pathId: string) { return this.turns.running(pathId); }

  observePath(pathId: string, observer: () => void): () => void {
    const subscribers = this.observers.get(pathId) ?? new Set<() => void>();
    subscribers.add(observer);
    this.observers.set(pathId, subscribers);
    return () => {
      subscribers.delete(observer);
      if (!subscribers.size) this.observers.delete(pathId);
    };
  }

  observeChanges(observer: () => void): () => void {
    this.changeObservers.add(observer);
    return () => { this.changeObservers.delete(observer); };
  }

  observeMessages(sessionId: string, observer: MessageObserver) {
    return this.turns.observeMessages(sessionId, observer);
  }

  observeActivity(sessionId: string, observer: ActivityObserver): () => void {
    const subscribers = this.activityObservers.get(sessionId) ?? new Set<ActivityObserver>();
    observer(this.activity.get(sessionId) ?? null);
    subscribers.add(observer);
    this.activityObservers.set(sessionId, subscribers);
    return () => {
      subscribers.delete(observer);
      if (!subscribers.size) this.activityObservers.delete(sessionId);
    };
  }

  private publishActivity(sessionId: string, toolName: string | null) {
    if ((this.activity.get(sessionId) ?? null) === toolName) return;
    if (toolName === null) this.activity.delete(sessionId);
    else this.activity.set(sessionId, toolName);
    for (const notify of this.activityObservers.get(sessionId) ?? []) {
      // A view observer must not interrupt the tutor turn.
      try { notify(toolName); } catch {}
    }
  }

  stop(pathId: string, sessionId: string) {
    this.turns.stop(pathId, sessionId);
  }

  async send(pathId: string, sessionId: string, content: string, onMessage?: MessageObserver) {
    if (!content.trim()) throw new ChatTurnError("请输入消息");
    return this.withPath(pathId, sessionId, async (signal) =>
      this.turns.send(await this.requireSession(pathId, sessionId), content, [], this.prepare, signal, onMessage));
  }

  async retry(pathId: string, sessionId: string, replyId: string, onMessage?: MessageObserver) {
    return this.withPath(pathId, sessionId, async (signal) =>
      this.turns.repeat(await this.requireSession(pathId, sessionId), replyId, "retry", this.prepare, signal, onMessage));
  }

  async submitAnswer(pathId: string, sessionId: string, interactionId: string, answers: Answers,
    submissionId: string): Promise<SubmitAnswerResult> {
    return this.withPath(pathId, sessionId, async (signal) => {
      const session = await this.practiceSession(pathId, sessionId);
      const submitted = await this.study.submit({ pathId, sessionId }, interactionId, answers, submissionId);
      if (submitted.kind === "receipt") return submitted;
      return { kind: "turn", message: await this.sendAnswer(session, submitted.row, signal) };
    });
  }

  async retryAnswer(pathId: string, sessionId: string, interactionId: string) {
    return this.withPath(pathId, sessionId, async (signal) => {
      const session = await this.practiceSession(pathId, sessionId);
      const row = await this.study.requireCard({ pathId, sessionId }, interactionId);
      if (row.status !== "answered" || !row.raw_answer) {
        throw new StaleInteractionError("该题当前无需重试批改，请查看最新题卡。");
      }
      return this.sendAnswer(session, row, signal);
    });
  }

  private sendAnswer(session: StoredSession, row: StoredInteraction, signal: AbortSignal) {
    return this.turns.send(session, displayStudyAnswer(row), [], this.prepare, signal, undefined, {
      mastery_answer: { interaction_id: row.interaction_id, submission_id: row.submission_id, answers: savedAnswers(row) },
    });
  }

  async skipQuestion(pathId: string, sessionId: string, interactionId: string) {
    return this.withPath(pathId, sessionId, async (signal) => {
      const session = await this.practiceSession(pathId, sessionId);
      await this.study.skip({ pathId, sessionId }, interactionId);
      this.publish(pathId);
      return this.turns.send(session, "跳过这道题吧。", [], this.prepare, signal, undefined, { mastery_skip: interactionId });
    });
  }

  async challengeQuestion(pathId: string, sessionId: string, interactionId: string, comment: string) {
    return this.withPath(pathId, sessionId, async (signal) => {
      const session = await this.practiceSession(pathId, sessionId);
      const row = await this.study.requireCard({ pathId, sessionId }, interactionId);
      if (row.status !== "graded") throw new ChatTurnError("只有已评分的题卡可以申诉");
      return this.turns.send(session, comment.trim() || "请复核这道题的判定。", [], this.prepare, signal, undefined,
        { mastery_challenge: interactionId });
    });
  }

  async objectiveEvidence(pathId: string, pointId: string) {
    const progress = await this.requirePath(pathId);
    const report = objectiveReport(progress, pointId, this.clock.nowSeconds());
    if (!report) throw new ChatTurnError("找不到该知识点");
    return { ...report, learnerOverride: Boolean(progress.learner_mastery_overrides[pointId]),
      attempts: progress.quiz_attempts.filter((item) => item.knowledge_point_id === pointId).map((item) => ({
      questionId: item.question_id, answer: String(item.user_answer ?? ""), result: item.result,
      independent: item.independent, voided: item.voided, at: item.timestamp,
    })), qualitative: progress.learning_evidence.filter((item) => item.knowledge_point_id === pointId &&
      item.assessment_type === "qualitative").map((item) => ({ id: item.evidence_id, answer: item.learner_answer,
      feedback: item.feedback, result: item.result, independent: !item.hints_used, confidence: item.confidence,
      criteria: progress.assessment_evidence[item.evidence_id]?.criteria_met as string[] | undefined ?? [],
      model: String(progress.assessment_evidence[item.evidence_id]?.model_id ?? ""),
    })) };
  }

  async setObjectiveMastery(pathId: string, pointId: string, mastered: boolean, note = "") {
    return this.withPath(pathId, "", async () => {
      const progress = await this.requirePath(pathId);
      const point = findKnowledgePoint(progress, pointId).kp;
      if (!point) throw new ChatTurnError("找不到该知识点");
      if (mastered && isAssessedMastered(progress, point)) throw new ChatTurnError("该知识点已通过测评");
      await this.persist(setLearnerMasteryOverride(progress, pointId, mastered, note, this.clock.nowSeconds()));
    });
  }

  private async resolveSource(material: TopicMaterial, now: number): Promise<TopicSource> {
    const id = this.makeId();
    if (material.kind === "text_note") {
      if (!material.text.trim()) throw new ChatTurnError("文本笔记不能为空");
      return { id, kind: "text_note", label: limitText(material.label?.trim() || "文本笔记", 80),
        excerpt: material.text.trim(), created_at: now };
    }
    const session = await this.requireSourceSession(material.sessionId);
    const messages = await this.listMaterialMessages(material.sessionId);
    if (material.messageId) {
      const message = messages.find(({ message_id }) => message_id === material.messageId);
      const excerpt = material.excerpt?.trim() || message?.content;
      if (!message || !excerpt || !message.content.includes(excerpt)) throw new ChatTurnError("选文已找不到，请重新选择资料");
      return { id, kind: "chat", label: session.title, excerpt, source_session_id: session.session_id,
        source_message_id: message.message_id, created_at: now };
    }
    if (!messages.length) throw new ChatTurnError("该问答会话没有可用资料");
    return { id, kind: "chat", label: session.title, source_session_id: session.session_id,
      excerpt: messages.map(({ role, content }) => (role === "user" ? "学习者" : "导师") + "：" + content).join("\n\n"),
      created_at: now };
  }

  private async requireSourceSession(sessionId: string) {
    const session = await this.store.getSession(sessionId);
    if (!session || (session.kind !== "lf01" && session.kind !== "little_tutor")) {
      throw new ChatTurnError("找不到该问答会话");
    }
    return session;
  }

  private async requirePath(pathId: string, store = this.store) {
    const progress = await store.get(pathId);
    if (!progress) throw new ChatTurnError("找不到该精通目标");
    return progress;
  }

  private async requireSession(pathId: string, sessionId: string) {
    const session = await this.store.getSession(sessionId);
    if (session?.kind !== "mastery" || session.path_id !== pathId || !session.mode) {
      throw new ChatTurnError("找不到该精通会话");
    }
    return session;
  }

  private async practiceSession(pathId: string, sessionId: string) {
    const session = await this.requireSession(pathId, sessionId);
    if (session.mode === "outline") throw new ChatTurnError("请切到学习或复习模式处理题卡");
    return session;
  }

  private assertAdmission(mode: SessionMode, progress: LearningProgress, Failure = ChatTurnError) {
    if (mode === "study" && derivePathStatus(progress) === "draft") throw new Failure(emptyOutline);
  }

  private async persistMode(session: StoredSession, mode: SessionMode) {
    this.assertAdmission(mode, await this.requirePath(session.path_id!), ToolRefusal);
    if (session.mode !== mode) {
      await this.store.updateSession({ ...session, mode, updated_at: this.clock.nowSeconds() });
    }
  }

  private async persist(progress: LearningProgress, outline?: OutlineCommit) {
    const now = this.clock.nowSeconds();
    await this.store.runInTransaction(async (tx) => {
      await saveProgress(tx, progress, now);
      if (!outline) return;
      const locations = new Map(progress.modules.flatMap((module) => module.knowledge_points)
        .map(({ id, module_id }) => [id, module_id]));
      const abandoned = [];
      for (const card of await tx.listOpenInteractionsByPath(progress.book_id)) {
        if (!rebindOutlineQuestion(card.question, locations)) {
          await tx.abandonInteraction(card.interaction_id, now);
          abandoned.push(card.interaction_id);
        }
      }
      await tx.appendDomainEvent({ event_id: this.makeId(), path_id: progress.book_id,
        session_id: outline.sessionId, turn_id: outline.turnId, event_type: "OutlineCommitted", created_at: now,
        payload: { version: progress.version + 1, abandoned_interaction_ids: abandoned } });
    });
  }

  private clearPreviews(pathId: string) {
    for (const [id, preview] of this.previews) if (preview.path_id === pathId) this.previews.delete(id);
  }

  private publish(pathId: string) {
    for (const notify of this.observers.get(pathId) ?? []) notify();
  }

  private async withPath<T>(pathId: string, sessionId: string, action: (signal: AbortSignal) => Promise<T>) {
    try {
      return await this.turns.exclusively(pathId, sessionId, (signal) => {
        this.publish(pathId);
        return action(signal);
      }, blocked);
    } finally {
      this.publish(pathId);
      for (const notify of this.changeObservers) notify();
    }
  }

  private readonly prepare: PrepareTurn = async (session, config, turn) => {
    const pathId = session.path_id!;
    let mode = session.mode!;
    const runtime = new PiDurableRuntime({ ...config, reasoning: config.reasoning ?? "high" }, undefined, this.fetch);
    const scope = { pathId, sessionId: session.session_id, config: { ...config, reasoning: config.reasoning ?? "high" as const },
      turn, mode: () => mode };
    const receipt = mode === "outline" ? undefined : await this.study.pregrade(scope);
    if (receipt) this.publish(pathId);
    const challengeId = turn.user.metadata?.mastery_challenge;
    const challenge = typeof challengeId === "string" ? projectStudyCard(await this.study.requireCard(scope, challengeId)) : undefined;
    const handoffModuleId = turn.user.metadata?.mastery_module_id;
    const status = async () => {
      const progress = await this.requirePath(pathId);
      const now = this.clock.nowSeconds();
      const open = await this.store.getOpenInteraction(pathId);
      const snapshot = masteryStatus(progress, mode, now, open, session.session_id);
      const current = [...this.previews].reverse().find(([, preview]) =>
        preview.session_id === session.session_id && preview.path_id === pathId &&
        preview.expires_at > now && preview.base_revision === progress.version && preview.before_digest === stateDigest(progress));
      return current ? { ...snapshot, outline_preview: { preview_id: current[0],
        base_revision: current[1].base_revision, expires_at: current[1].expires_at } } : snapshot;
    };
    const allowedTools = registerMasteryTools(runtime, {
      pathId, sessionId: session.session_id, mode: () => mode, status,
      switchMode: async (next) => {
        await this.persistMode(await this.requireSession(pathId, session.session_id), next);
        mode = next;
      },
      read: () => this.requirePath(pathId), save: (progress, outline) => this.persist(progress,
        outline ? { sessionId: session.session_id, turnId: turn.turnId } : undefined),
      now: () => this.clock.nowSeconds(), makeId: this.makeId, previews: this.previews,
      study: { cards: this.study, scope },
    });
    const snapshot = await status();
    const handoffModule = snapshot.map.modules.find(({ id }) => id === handoffModuleId);
    const activeTools = new Map<string, string>();
    return { runtime, allowedTools, measure: true, options: {
      mode, pathId, instructions: masteryInstructions(mode, {
        ...snapshot, ...(receipt && { pending_interaction: receipt }),
        ...(challenge && { challenged_interaction: challenge }),
      }) + (receipt ? "\n\n学习者刚提交了作答。以上题卡数据为引擎的批改结果。先回复已有结果，无需再次批改。若 grading_failed 为真，请说明批改未完成并请其点重试。" : "")
        + (challenge ? "\n\n学习者要求复核上述题卡。先核实问题与判定依据，确认确有题目或答案错误时再使用 mastery_repair_question。" : "")
        + (handoffModule ? `\n\n这次会话由学习者从问答打开，所选模块：${JSON.stringify({ id: handoffModule.id, name: handoffModule.name })}。` : ""),
      maxTurns: 8,
    }, toolSettled: () => this.publish(pathId), onToolActivity: (activity) => {
      if (!activity) activeTools.clear();
      else if (activity.phase === "started") activeTools.set(activity.callId, activity.toolName);
      else activeTools.delete(activity.callId);
      this.publishActivity(session.session_id, [...activeTools.values()].at(-1) ?? null);
    } };
  };
}

export { ChatTurnError as MasterySessionError };
