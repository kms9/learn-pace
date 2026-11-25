import {
  applyGrade, correctAnswerKey, findKnowledgePoint, isMastered, isReadableChoiceAnswer,
  publicPendingQuestion, QUALITATIVE_TYPES, qualitativeEvidenceId, questionWithAnswerKey,
  recordQualitativeAssessment, schedulerForProgress, voidAttempt,
  type FinalGrade, type KnowledgePoint, type LearningProgress, type PendingQuestion, type SessionMode,
} from "@learn-pace/domain";
import type { AppStore, InteractionGrade, QuestionGrade, StoredInteraction } from "@learn-pace/infra";
import {
  assessSemantically, requestModelId, validateStudyQuestion, type AssessmentVerdict, type ModelConfig,
} from "@learn-pace/runtime";
import { ChatTurnError, limitText, type TurnContext } from "../chat-turns.js";

export type Answers = Record<string, string>;
export interface MasteryAnswer {
  interaction_id: string;
  submission_id: string;
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
const evidenceKey = (row: StoredInteraction, question: PendingQuestion) =>
  row.question.questions.length ? `${row.interaction_id}:${question.question_id}` : row.interaction_id;

function partReceipt(question: PendingQuestion, verdict: AssessmentVerdict): QuestionGrade {
  if (!verdict.final) return verdict;
  return { ...verdict, ...(question.explanation && { explanation: question.explanation }),
    ...(question.question_type === "choice" && { correct_option: question.expected_answer }),
    reference_answer: verdict.reference_answer ?? question.expected_answer };
}

function ready(row: StoredInteraction, grades: InteractionGrade["questions"]) {
  return questionLeaves(row.question).every(({ question_id }) => grades[question_id]?.final || grades[question_id]?.voided);
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

  async requireCard(scope: Scope, id?: string) {
    const row = id ? await this.store.getInteraction(id) : await this.store.getOpenInteraction(scope.pathId);
    if (!row || row.path_id !== scope.pathId || row.session_id !== scope.sessionId) {
      throw new ChatTurnError("找不到本会话的题卡，请返回出题会话处理");
    }
    return row;
  }

  async stage(row: StoredInteraction, answers: Answers) {
    if (!exists(row)) throw new ChatTurnError("该题卡已结束");
    const leaves = questionLeaves(row.question);
    const previous = savedAnswers(row);
    const draft: Answers = { ...previous };
    for (const [id, value] of Object.entries(answers)) {
      if (!leaves.some(({ question_id }) => question_id === id) || typeof value !== "string") throw new ChatTurnError("作答不属于这张题卡");
      const grade = row.grade?.questions[id];
      if (grade?.voided) continue;
      if (grade?.final && value !== previous[id]) throw new ChatTurnError("已批改的小题需通过复核调整");
      draft[id] = value;
    }
    if (!Object.values(draft).some((value) => value.trim())) throw new ChatTurnError("请先填写作答");
    const next: StoredInteraction = { ...row, status: "answered", submission_id: this.makeId(), updated_at: this.now(),
      raw_answer: row.question.questions.length ? JSON.stringify(draft) : draft[row.question.question_id]! };
    await this.store.updateInteraction(next);
    return next;
  }

  async pregrade(context: StudyTurn) {
    const submission = context.turn.user.metadata?.mastery_answer as MasteryAnswer | undefined;
    if (!submission) return undefined;
    const row = await this.requireCard(context, submission.interaction_id);
    if (row.submission_id !== submission.submission_id || row.status === "abandoned") return undefined;
    if (row.status !== "answered") return turnReceipt(row);
    return turnReceipt(await this.grade(row, context));
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
    return turnReceipt(await this.grade(await this.stage(row, answers), context));
  }

  private async pregradedReceipt(context: StudyTurn, attempt: MasteryAnswer) {
    const row = await this.requireCard(context, attempt.interaction_id);
    if (row.submission_id !== attempt.submission_id) throw new ChatTurnError("这轮作答已被更新");
    return turnReceipt(row);
  }

  private async grade(row: StoredInteraction, context: StudyTurn): Promise<StoredInteraction> {
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
        const verdict: AssessmentVerdict = evidence ? { final: true, result: evidence.result,
          confidence: evidence.confidence ?? 1, feedback: evidence.feedback, reference_answer: evidence.reference_answer } :
          await assessSemantically(context.config, { question, learner_answer: answer, signal: context.turn.signal }, this.fetch);
        grades[id] = partReceipt(question, verdict);
        if (verdict.final && !evidence) final.push({ question, verdict });
      }
    } catch {
      const failed = { ...row, grade: { questions: row.grade?.questions ?? {},
        grading_failed: true, elapsed_ms: Math.round(performance.now() - start) } };
      await this.store.updateInteraction(failed);
      return failed;
    }
    const now = this.now();
    const scheduler = schedulerForProgress(prior);
    const next = final.reduce((value, { question, verdict }) => applyGrade(value, {
      evidence_id: evidenceKey(row, question), question_id: question.question_id, knowledge_point_id: question.knowledge_point_id,
      learner_answer: answers[question.question_id]!, session_id: row.session_id, turn_id: context.turn.turnId,
      verdict, assistance_used: question.assistance_used,
      visual_context: { ...question.visual_context, session_mode: context.mode() },
    }, scheduler, now), prior);
    if (next !== prior) await this.save(next);
    const graded: StoredInteraction = { ...row, updated_at: now,
      status: ready(row, grades) ? "graded" : "awaiting_input",
      grade: { questions: grades, elapsed_ms: Math.round(performance.now() - start) } };
    await this.store.updateInteraction(graded);
    return graded;
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
    const answersForPoint = cardInput && questionLeaves((await this.requireCard(context, cardInput.interaction_id)).question)
      .filter(({ knowledge_point_id }) => knowledge_point_id === pointId).map(({ question_id }) => cardInput.answers[question_id] ?? "");
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
    const assessed = verdict.final
      ? recordQualitativeAssessment(progress, { evidence_id: id, knowledge_point_id: pointId,
        learner_answer: combined, session_id: context.sessionId,
        turn_id: context.turn.turnId, verdict, model_id: requestModelId(context.config),
        assistance_used: Boolean(cardInput && latest?.assistance_used),
        visual_context: { session_mode: context.mode() },
      }, schedulerForProgress(progress), this.now())
      : progress;
    if (assessed !== progress) await this.save(assessed);
    await this.store.saveMessage({ ...current, metadata: { ...current.metadata, [metaKey]: {
      ...own, [pointId]: verdict.final ? null : combined,
    } } });
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
    if (!exists(row)) throw new ChatTurnError("该题卡已结束");
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
    if (next !== progress) await this.save(next);
    const updated: StoredInteraction = { ...card, updated_at: now, grade: { questions: grades },
      status: card.status === "abandoned" ? "abandoned" : ready(card, grades) ? "graded" : "awaiting_input" };
    await this.store.updateInteraction(updated);
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
