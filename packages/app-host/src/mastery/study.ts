import {
  applyGrade, correctAnswerKey, findKnowledgePoint, isMastered, isReadableChoiceAnswer,
  publicPendingQuestion, QUALITATIVE_TYPES, qualitativeEvidenceId, questionWithAnswerKey,
  recordQualitativeAssessment, schedulerForProgress, voidAttempt,
  type FinalGrade, type KnowledgePoint, type LearningEvidence, type LearningProgress, type PendingQuestion, type SessionMode,
} from "@learn-pace/domain";
import { SubmissionConflictError, type AppStore, type InteractionGrade, type QuestionGrade, type StoredDomainEvent, type StoredInteraction } from "@learn-pace/infra";
import {
  assessSemantically, requestModelId, validateStudyQuestion, type AssessmentVerdict, type ModelConfig,
} from "@learn-pace/runtime";
import { ChatTurnError, limitText, type TurnContext } from "../chat-turns.js";
import { requireProgressVersion, saveProgress } from "./persistence.js";

export type Answers = Record<string, string>;
export interface MasteryAnswer {
  interaction_id: string;
  submission_id: string | null;
  answers: Answers;
}

type Scope = { pathId: string; sessionId: string };
type StudyTurn = Scope & { config: ModelConfig; turn: TurnContext; mode: () => SessionMode };

export function questionLeaves(question: PendingQuestion) {
  return question.questions.length ? question.questions : [question];
}

export function savedAnswers(row: StoredInteraction): Answers {
  if (!row.raw_answer) return {};
  if (!row.question.questions.length) return { [row.question.question_id]: row.raw_answer };
  try {
    const data = JSON.parse(row.raw_answer) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}

export function projectStudyCard(row: StoredInteraction) {
  return { interaction_id: row.interaction_id, turn_id: row.turn_id, status: row.status, session_id: row.session_id,
    question: publicPendingQuestion(row.question), answers: savedAnswers(row), grade: row.grade ?? null };
}
export type StudyCard = ReturnType<typeof projectStudyCard>;

const exists = (row: StoredInteraction) => row.status === "awaiting_input" || row.status === "answered";
export const evidenceKey = (row: StoredInteraction, question: PendingQuestion) =>
  row.question.questions.length ? `${row.interaction_id}:${question.question_id}` : row.interaction_id;

export class StaleInteractionError extends ChatTurnError {
  constructor(message = "该题卡已结束，请查看最新题卡。") {
    super(message);
    this.name = "StaleInteractionError";
  }
}

function encodeAnswers(row: StoredInteraction, answers: Answers): string {
  if (!row.question.questions.length) return answers[row.question.question_id] ?? "";
  return JSON.stringify(Object.fromEntries(questionLeaves(row.question).flatMap(({ question_id }) =>
    Object.hasOwn(answers, question_id) ? [[question_id, answers[question_id]]] : [])));
}

function mergeAnswers(row: StoredInteraction, answers: Answers): Answers {
  const leaves = questionLeaves(row.question);
  const draft = savedAnswers(row);
  for (const [id, value] of Object.entries(answers)) {
    if (typeof value !== "string" || !leaves.some(({ question_id }) => question_id === id)) {
      throw new ChatTurnError("作答不属于这张题卡");
    }
    if (!row.grade?.questions[id]?.voided) draft[id] = value;
  }
  return draft;
}

export function partReceipt(question: PendingQuestion, verdict: AssessmentVerdict): QuestionGrade {
  if (!verdict.final) return verdict;
  return { ...verdict, ...(question.explanation && { explanation: question.explanation }),
    ...(question.question_type === "choice" && { correct_option: question.expected_answer }),
    reference_answer: verdict.reference_answer ?? question.expected_answer };
}

export function ready(row: StoredInteraction, grades: InteractionGrade["questions"]) {
  return questionLeaves(row.question).every(({ question_id }) => grades[question_id]?.final || grades[question_id]?.voided);
}

export function verdictFromEvidence(evidence: LearningEvidence): AssessmentVerdict {
  return { final: true, result: evidence.result, confidence: evidence.confidence ?? 1,
    feedback: evidence.feedback, reference_answer: evidence.reference_answer || undefined };
}

function sameSubmission(current: StoredInteraction | null, before: StoredInteraction): current is StoredInteraction {
  return !!current && current.status === before.status && current.submission_id === before.submission_id;
}

function turnReceipt(row: StoredInteraction) {
  return { interaction_id: row.interaction_id, status: row.status, ...publicPendingQuestion(row.question),
    grade: row.grade, complete: row.status === "graded",
    remaining_question_ids: questionLeaves(row.question).filter(({ question_id }) =>
      !row.grade?.questions[question_id]?.final && !row.grade?.questions[question_id]?.voided).map(({ question_id }) => question_id) };
}

function clearlyFollowUp(text: string) {
  return /^(?:等等|请解释|能解释|我想问|为什么|什么是|请复核|为什么会|what |how |why |please explain|please review)|(?:是什么意思|为何[？?]|[？?]\s*$)/i.test(text.trim());
}

function requireReviewScope({ mode }: StudyTurn, progress: LearningProgress, point: KnowledgePoint) {
  if (mode() === "review" && !isMastered(progress, point)) {
    throw new ChatTurnError("复习只考已经掌握的知识点，请选择已掌握的知识点或切到学习模式");
  }
}

export class StudyInteractions {
  constructor(
    private readonly store: AppStore,
    private readonly now: () => number,
    private readonly makeId: () => string,
    private readonly read: (pathId: string) => Promise<LearningProgress>,
    private readonly save: (progress: LearningProgress) => Promise<void>,
    private readonly fetch?: typeof globalThis.fetch,
  ) {}

  async postQuiz(context: StudyTurn, input: Parameters<typeof validateStudyQuestion>[0]) {
    if (await this.store.getOpenInteraction(context.pathId)) throw new ChatTurnError("当前路径已有未完成的题卡，请先处理原题");
    const progress = await this.read(context.pathId);
    const now = this.now();
    const candidate = validate(() => validateStudyQuestion(input, this.makeId, now));
    const bind = (question: PendingQuestion): PendingQuestion => {
      const point = findKnowledgePoint(progress, question.knowledge_point_id);
      if (!point.kp) throw new ChatTurnError("题目必须使用大纲里的知识点 ID");
      requireReviewScope(context, progress, point.kp);
      return { ...question, module_id: point.module_id, questions: question.questions.map(bind) };
    };
    const question = bind(candidate);
    context.turn.signal.throwIfAborted();
    const id = this.makeId();
    await this.store.insertInteraction({ interaction_id: id, path_id: context.pathId, session_id: context.sessionId,
      turn_id: context.turn.turnId, question, status: "awaiting_input", raw_answer: null, submission_id: null, updated_at: now });
    return { ok: true, interaction_id: id, question: publicPendingQuestion(question) };
  }

  async requireCard(scope: Scope, id?: string, store = this.store) {
    const row = id ? await store.getInteraction(id) : await store.getOpenInteraction(scope.pathId);
    if (!row || row.path_id !== scope.pathId || row.session_id !== scope.sessionId) {
      throw new StaleInteractionError("找不到本会话的题卡，请返回出题会话查看最新题卡。");
    }
    return row;
  }

  async submit(scope: Scope, interactionId: string, answers: Answers, submissionId: string) {
    if (!submissionId.trim()) throw new ChatTurnError("缺少作答提交编号，请刷新题卡后重试。");
    return this.store.runInTransaction(async (tx) => {
      const row = await this.requireCard(scope, interactionId, tx);
      const existing = await tx.findInteractionBySubmission(submissionId);
      if (existing && existing.interaction_id !== interactionId) throw new SubmissionConflictError();

      if (existing) {
        const previous = savedAnswers(row);
        const draft = mergeAnswers(row, answers);
        if (encodeAnswers(row, draft) !== encodeAnswers(row, previous) || Object.entries(answers).some(([id, value]) =>
          row.grade?.questions[id]?.voided && value !== previous[id])) throw new SubmissionConflictError();
        if (row.status === "graded" || row.status === "awaiting_input" && Object.keys(answers).every((id) =>
          row.grade?.questions[id]?.final || row.grade?.questions[id]?.voided)) {
          return { kind: "receipt" as const, card: projectStudyCard(row) };
        }
        if (row.status === "answered") return { kind: "staged" as const, row };
        if (row.status !== "awaiting_input") throw new StaleInteractionError();
        const pending = { ...row, status: "answered" as const, updated_at: this.now() };
        await tx.updateInteraction(pending);
        return { kind: "staged" as const, row: pending };
      }

      if (!exists(row)) throw new StaleInteractionError();
      const draft = mergeAnswers(row, answers);
      if (questionLeaves(row.question).some(({ question_id }) => {
        const grade = row.grade?.questions[question_id];
        return !grade?.final && !grade?.voided && !draft[question_id]?.trim();
      })) {
        throw new ChatTurnError("请完成所有未批改的小题后再提交");
      }
      return { kind: "staged" as const, row: await this.stage(row, draft, submissionId, tx, row.turn_id) };
    });
  }

  private async stage(row: StoredInteraction, answers: Answers, submissionId: string, tx: AppStore, turnId: string) {
    if (!exists(row)) throw new StaleInteractionError();
    const previous = savedAnswers(row);
    for (const [id, value] of Object.entries(answers)) {
      const grade = row.grade?.questions[id];
      if (grade?.final && value !== previous[id]) throw new ChatTurnError("已批改的小题需通过复核调整");
    }
    if (!Object.values(answers).some((value) => value.trim())) throw new ChatTurnError("请先填写作答");
    const now = this.now();
    const next: StoredInteraction = { ...row, status: "answered", submission_id: submissionId, updated_at: now,
      raw_answer: encodeAnswers(row, answers) };
    await tx.updateInteraction(next);
    await this.appendEvent(tx, { pathId: row.path_id, sessionId: row.session_id }, turnId, "AnswerRecorded", now,
      { interaction_id: row.interaction_id, submission_id: submissionId });
    return next;
  }

  private appendEvent(tx: AppStore, scope: Scope, turnId: string, eventType: StoredDomainEvent["event_type"],
    now: number, payload: StoredDomainEvent["payload"]) {
    return tx.appendDomainEvent({ event_id: this.makeId(), path_id: scope.pathId, session_id: scope.sessionId,
      turn_id: turnId, event_type: eventType, payload, created_at: now });
  }

  async pregrade(context: StudyTurn) {
    const submission = context.turn.user.metadata?.mastery_answer as MasteryAnswer | undefined;
    if (!submission) return undefined;
    const row = await this.requireCard(context, submission.interaction_id);
    if (row.submission_id !== submission.submission_id || row.status === "abandoned") return undefined;
    if (row.status !== "answered") return turnReceipt(row);
    const graded = await this.grade(row, context);
    return graded && turnReceipt(graded);
  }

  async gradeFromTurn(context: StudyTurn, input: { question_id?: string; answer?: string; answers?: Answers }) {
    const attempt = context.turn.user.metadata?.mastery_answer as MasteryAnswer | undefined;
    if (attempt) return this.pregradedReceipt(context, attempt);
    const original = context.turn.user.content.trim();
    if (clearlyFollowUp(original) || context.turn.user.metadata?.mastery_challenge || context.turn.user.metadata?.mastery_skip) {
      throw new ChatTurnError("这是追问或申诉，保留题卡等待明确作答");
    }
    const row = await this.requireCard(context);
    const parts = questionLeaves(row.question);
    const chosen = parts.find(({ question_id }) => question_id === input.question_id) ?? (parts.length === 1 ? parts[0] : undefined);
    if (input.question_id && input.question_id !== row.question.question_id && !parts.some(({ question_id }) => question_id === input.question_id)) {
      throw new ChatTurnError("该题目不是当前待答题");
    }
    let answers: Answers;
    if (input.answers) {
      answers = input.answers;
      if (Object.values(answers).some((value) => typeof value !== "string" || !value.trim() || !original.includes(value.trim()))) {
        throw new ChatTurnError("请传入学习者本轮明确写出的答案");
      }
    } else if (chosen) {
      const value = parts.length === 1 ? original : input.answer?.trim() ?? "";
      if (!value || !original.includes(value)) throw new ChatTurnError("请传入学习者本轮明确写出的答案");
      if (chosen.question_type === "choice" &&
          !isReadableChoiceAnswer(value, Object.fromEntries(chosen.options.map(({ label, body }) => [label, body])))) {
        throw new ChatTurnError("未找到明确选项，保留待答题");
      }
      answers = { [chosen.question_id]: value };
    } else throw new ChatTurnError("题组可按小题 ID 提供已作答的部分");
    const staged = await this.store.runInTransaction(async (tx) => {
      const current = await this.requireCard(context, row.interaction_id, tx);
      if (!sameSubmission(current, row)) throw new StaleInteractionError();
      return this.stage(current, mergeAnswers(current, answers), this.makeId(), tx, context.turn.turnId);
    });
    const graded = await this.grade(staged, context);
    if (!graded) throw new StaleInteractionError();
    return turnReceipt(graded);
  }

  private async pregradedReceipt(context: StudyTurn, attempt: MasteryAnswer) {
    const row = await this.requireCard(context, attempt.interaction_id);
    if (row.submission_id !== attempt.submission_id) throw new ChatTurnError("这轮作答已被更新");
    return turnReceipt(row);
  }

  private async grade(row: StoredInteraction, context: StudyTurn): Promise<StoredInteraction | undefined> {
    const start = performance.now();
    const answers = savedAnswers(row);
    const prior = await this.read(context.pathId);
    const grades = { ...row.grade?.questions };
    const final: { question: PendingQuestion; verdict: FinalGrade }[] = [];
    try {
      for (const question of questionLeaves(row.question)) {
        const id = question.question_id;
        const answer = answers[id];
        if (!answer?.trim() || grades[id]?.final || grades[id]?.voided) continue;
        const evidence = prior.learning_evidence.find((item) => item.evidence_id === evidenceKey(row, question));
        const verdict = evidence ? verdictFromEvidence(evidence) :
          await assessSemantically(context.config, { question, learner_answer: answer, signal: context.turn.signal }, this.fetch);
        grades[id] = partReceipt(question, verdict);
        if (verdict.final && !evidence) final.push({ question, verdict });
      }
    } catch {
      return this.store.runInTransaction(async (tx) => {
        const current = await tx.getInteraction(row.interaction_id);
        if (current?.status !== "answered" || !sameSubmission(current, row)) return undefined;
        await requireProgressVersion(tx, prior);
        const failed = { ...current, grade: { questions: current.grade?.questions ?? {},
          grading_failed: true, elapsed_ms: Math.round(performance.now() - start) } };
        await tx.updateInteraction(failed);
        return failed;
      });
    }
    return this.store.runInTransaction(async (tx) => {
      const current = await tx.getInteraction(row.interaction_id);
      if (current?.status !== "answered" || !sameSubmission(current, row)) return undefined;
      const progress = await requireProgressVersion(tx, prior);
      const now = this.now();
      const scheduler = schedulerForProgress(progress);
      const next = final.reduce((value, { question, verdict }) => applyGrade(value, {
        evidence_id: evidenceKey(row, question), question_id: question.question_id, knowledge_point_id: question.knowledge_point_id,
        learner_answer: answers[question.question_id]!, session_id: row.session_id, turn_id: context.turn.turnId,
        verdict, assistance_used: question.assistance_used,
        visual_context: { ...question.visual_context, session_mode: context.mode() },
      }, scheduler, now), progress);
      const graded: StoredInteraction = { ...current, updated_at: now,
        status: ready(current, grades) ? "graded" : "awaiting_input",
        grade: { questions: grades, elapsed_ms: Math.round(performance.now() - start) } };
      await saveProgress(tx, next, now);
      await tx.updateInteraction(graded);
      await this.appendEvent(tx, context, context.turn.turnId, "AssessmentCommitted", now, {
        interaction_id: row.interaction_id, submission_id: row.submission_id, status: graded.status,
        evidence_ids: final.map(({ question }) => evidenceKey(row, question)),
      });
      return graded;
    });
  }

  async assess(context: StudyTurn, pointId: string) {
    const progress = await this.read(context.pathId);
    const { kp, module_id } = findKnowledgePoint(progress, pointId);
    if (!kp || !QUALITATIVE_TYPES.has(kp.type)) throw new ChatTurnError("只有大纲中的概念和设计知识点可做定性评估");
    requireReviewScope(context, progress, kp);
    const id = qualitativeEvidenceId(context.sessionId, context.turn.turnId, pointId);
    const previous = progress.learning_evidence.find((item) => item.evidence_id === id);
    if (previous) return { ok: true, result: previous.result, mastered: isMastered(progress, kp), feedback: previous.feedback };
    const cardInput = context.turn.user.metadata?.mastery_answer as MasteryAnswer | undefined;
    const sourceCard = cardInput && await this.requireCard(context, cardInput.interaction_id);
    if (sourceCard && (sourceCard.status === "abandoned" || sourceCard.submission_id !== cardInput?.submission_id)) {
      throw new StaleInteractionError();
    }
    const answersForPoint = sourceCard && questionLeaves(sourceCard.question)
      .filter(({ knowledge_point_id }) => knowledge_point_id === pointId).map(({ question_id }) => cardInput?.answers[question_id] ?? "");
    const original = answersForPoint ? answersForPoint.join("\n") : context.turn.user.content;
    if (!original.trim() || clearlyFollowUp(original) || context.turn.user.metadata?.mastery_challenge ||
        context.turn.user.metadata?.mastery_skip) throw new ChatTurnError("请先让学习者用自己的话解释");
    const messages = await this.store.listMessages(context.sessionId);
    const metaKey = "mastery_assessment_pending";
    const current = messages.find(({ message_id }) => message_id === context.turn.user.message_id) ?? context.turn.user;
    const own = current.metadata?.[metaKey] as Record<string, string | null> | undefined;
    const earlier = messages.slice(0, messages.findIndex(({ message_id }) => message_id === current.message_id)).reverse()
      .map((message) => (message.metadata?.[metaKey] as Record<string, string | null> | undefined)?.[pointId])
      .find((value) => value !== undefined);
    const combined = own?.[pointId] ?? (earlier && earlier !== original ? earlier + "\n" + original : original);
    const latest = (await this.store.listInteractionsBySession(context.sessionId)).reverse()
      .flatMap((row) => questionLeaves(row.question)).find((question) => question.knowledge_point_id === pointId);
    let verdict: AssessmentVerdict;
    try {
      verdict = await assessSemantically(context.config, { learner_answer: combined, signal: context.turn.signal,
        criteria: { objective: kp.name, module_objective: progress.modules.find(({ id }) => id === module_id)?.objective ?? "",
          rubric: latest?.explanation } }, this.fetch);
    } catch {
      throw new ChatTurnError("定性判定失败，请稍后用原话重试");
    }
    const now = this.now();
    const assessed = verdict.final
      ? recordQualitativeAssessment(progress, { evidence_id: id, knowledge_point_id: pointId,
        learner_answer: combined, session_id: context.sessionId,
        turn_id: context.turn.turnId, verdict, model_id: requestModelId(context.config),
        assistance_used: Boolean(cardInput && latest?.assistance_used),
        visual_context: { session_mode: context.mode() },
      }, schedulerForProgress(progress), now)
      : progress;
    await this.store.runInTransaction(async (tx) => {
      if (sourceCard && !sameSubmission(await tx.getInteraction(sourceCard.interaction_id), sourceCard)) {
        throw new StaleInteractionError();
      }
      await requireProgressVersion(tx, progress);
      const message = await tx.getMessage(current.message_id);
      if (!message) throw new ChatTurnError("这轮作答已更新，请重新发送解释。");
      if (assessed !== progress) await saveProgress(tx, assessed, now);
      const pending = message.metadata?.[metaKey] as Record<string, string | null> | undefined;
      await tx.saveMessage({ ...message, metadata: { ...message.metadata, [metaKey]: {
        ...pending, [pointId]: verdict.final ? null : combined,
      } } });
      await this.appendEvent(tx, context, context.turn.turnId, "AssessmentCommitted", now, {
        message_id: message.message_id, knowledge_point_id: pointId, result: verdict.result, final: verdict.final,
        ...(verdict.final && { evidence_id: id }),
      });
    });
    return { ok: true, final: verdict.final, result: verdict.result,
      ...(verdict.final && { mastered: isMastered(assessed, kp), criteria_met: verdict.criteria_met }),
      feedback: verdict.feedback };
  }

  async noteExplained(context: StudyTurn, id: string, summary: string, quote: string) {
    const progress = await this.read(context.pathId);
    const excerpt = quote.trim();
    if (!findKnowledgePoint(progress, id).kp || !excerpt || !context.turn.deliveredText().includes(excerpt)) {
      throw new ChatTurnError("请使用大纲里的知识点 ID，以及本轮已展示给学习者的原文");
    }
    await this.save({ ...progress, explained_objectives: { ...progress.explained_objectives, [id]: {
      coverage: "partial", summary: summary.trim(), explanation_quote: excerpt,
      delivery: { session_id: context.sessionId, turn_id: context.turn.turnId },
    } } });
    return { ok: true };
  }

  async defer(context: Scope, id: string, note: string) {
    const progress = await this.read(context.pathId);
    const { kp } = findKnowledgePoint(progress, id);
    if (!kp || isMastered(progress, kp)) throw new ChatTurnError("请选择尚未掌握的知识点");
    await this.save({ ...progress, deferred_objectives: { ...progress.deferred_objectives, [id]: {
      knowledge_point_id: id, note: limitText(note.trim(), 500), created_at: this.now(),
    } } });
    return { ok: true };
  }

  async skip(scope: Scope, id?: string) {
    const row = await this.requireCard(scope, id);
    if (!exists(row)) throw new StaleInteractionError();
    await this.store.abandonInteraction(row.interaction_id, this.now());
    return { ok: true, interaction_id: row.interaction_id };
  }

  async repair(context: StudyTurn, input: { action: "void" | "correct"; reason: string; question_id?: string; expected_answer?: string }) {
    const reason = limitText(input.reason.trim(), 500);
    if (!reason) throw new ChatTurnError("修正题卡需要填写原因");
    const rows = (await this.store.listInteractionsBySession(context.sessionId)).filter(({ path_id }) => path_id === context.pathId);
    const id = input.question_id ?? (context.turn.user.metadata?.mastery_challenge as string | undefined);
    const row = id ? rows.find((entry) => entry.interaction_id === id || entry.question.question_id === id ||
      entry.question.questions.some(({ question_id }) => question_id === id)) : rows.slice().reverse().find(exists) ?? rows.at(-1);
    if (!row || row.status === "abandoned") throw new ChatTurnError("找不到可复核的题目");
    const question = questionLeaves(row.question).find(({ question_id }) => question_id === id) ?? row.question;
    const progress = await this.read(context.pathId);
    const scheduler = schedulerForProgress(progress);
    const now = this.now();
    const grades = { ...row.grade?.questions };
    let next: LearningProgress;
    let card = row;
    if (input.action === "void") {
      next = questionLeaves(question).reduce((value, item) => voidAttempt(value, item, reason, scheduler, now), progress);
      for (const item of questionLeaves(question)) grades[item.question_id] = {
        result: "ungraded", final: false, confidence: 0, feedback: reason, voided: true,
      };
      if (question === row.question) card = { ...row, status: "abandoned" };
    } else {
      const updated = validate(() => questionWithAnswerKey(question, input.expected_answer ?? "", reason));
      const attempts = progress.quiz_attempts.filter((attempt) => attempt.question_id === question.question_id &&
        attempt.knowledge_point_id === question.knowledge_point_id && !attempt.voided);
      const raw = savedAnswers(row)[question.question_id];
      const judge = async (learner_answer: string) => {
        const decision = await assessSemantically(context.config, { question: updated, learner_answer,
          signal: context.turn.signal }, this.fetch).catch(() => { throw new ChatTurnError("更正后的答案暂无法批改"); });
        if (!decision.final) throw new ChatTurnError("更正后的判定仍未定，题卡保持原状态");
        return decision;
      };
      const verdicts = await Promise.all(attempts.map((attempt) => judge(String(attempt.user_answer ?? ""))));
      const latest = verdicts.at(-1) ?? (raw?.trim() ? await judge(raw) : undefined);
      next = verdicts.length ? correctAnswerKey(progress, updated, verdicts, scheduler, now) : progress;
      if (!verdicts.length && latest && raw) next = applyGrade(next, { evidence_id: evidenceKey(row, question),
        question_id: updated.question_id, knowledge_point_id: updated.knowledge_point_id, learner_answer: raw,
        session_id: context.sessionId, turn_id: context.turn.turnId, verdict: latest,
        assistance_used: updated.assistance_used, visual_context: { ...updated.visual_context, session_mode: context.mode() },
      }, scheduler, now);
      if (latest) grades[question.question_id] = partReceipt(updated, latest);
      card = { ...row, question: question === row.question ? updated : { ...row.question,
        questions: row.question.questions.map((leaf) => leaf === question ? updated : leaf) } };
    }
    const updated: StoredInteraction = { ...card, updated_at: now, grade: { questions: grades },
      status: card.status === "abandoned" ? "abandoned" : ready(card, grades) ? "graded" : "awaiting_input" };
    await this.store.runInTransaction(async (tx) => {
      if (!sameSubmission(await tx.getInteraction(row.interaction_id), row)) throw new StaleInteractionError();
      await saveProgress(tx, next, now);
      await tx.updateInteraction(updated);
      await this.appendEvent(tx, context, context.turn.turnId,
        input.action === "void" ? "AssessmentVoided" : "AssessmentCorrected", now,
        { interaction_id: row.interaction_id, submission_id: row.submission_id, question_id: question.question_id, reason });
    });
    return { ok: true, action: input.action, question_id: question.question_id, status: updated.status };
  }
}

function validate<T>(action: () => T): T {
  try { return action(); }
  catch (error) { throw new ChatTurnError(error instanceof Error ? error.message : "题目参数无效"); }
}

export function displayStudyAnswer(row: StoredInteraction): string {
  const answers = savedAnswers(row);
  return questionLeaves(row.question).flatMap((question, i) => {
    const raw = answers[question.question_id];
    if (!raw?.trim()) return [];
    const option = question.options.find(({ label }) => label === raw.trim().toUpperCase());
    const value = option ? `${option.label}. ${option.body}` : raw;
    return [(row.question.questions.length ? `${i + 1}. ` : "") + value];
  }).join("\n");
}
