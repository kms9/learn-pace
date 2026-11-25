import {
  computeMastery,
  createKnowledgePoint,
  createLearningEvidence,
  createLearningModule,
  createLearningProgress,
  createQuizAttempt,
  displayMastery,
  objectiveStatus,
  publicPendingQuestion,
  resolveChoiceSubmission,
  SpacedRepetitionScheduler,
  type ApplicationCommand,
  type DomainEvent,
  type AssessmentResultKind,
} from "@learn-pace/domain";
import type { Clock, InteractionStore, LearningProgressStore } from "@learn-pace/infra";
import { PiDurableRuntime, type ModelConfig, type RuntimeEvent } from "@learn-pace/runtime";
import type { ApplicationHost, CommandReceipt } from "./index.js";

const pathId = "m1-ratios";
const sessionId = "m1-study";
const objective = createKnowledgePoint({
  id: "reduce-ratio",
  name: "Reduce a ratio",
  type: "procedure",
  module_id: "ratios",
});

export class StudyWorkbench implements ApplicationHost {
  readonly runtime: PiDurableRuntime;

  constructor(
    config: ModelConfig,
    private readonly store: Pick<LearningProgressStore, "get" | "save"> &
      Pick<InteractionStore, "getOpenInteraction" | "getInteraction" | "insertInteraction" | "saveAnswer" | "markGraded">,
    private readonly clock: Clock,
    private readonly makeId: () => string,
    fetch?: typeof globalThis.fetch,
  ) {
    this.runtime = new PiDurableRuntime(config, async (command, signal) => {
      this.validateRegistration(command);
      if (await this.store.getOpenInteraction(pathId)) throw new Error("A question is already pending");
      signal.throwIfAborted();
      await this.store.insertInteraction({
        interaction_id: this.makeId(),
        path_id: pathId,
        session_id: sessionId,
        turn_id: command.turn_id,
        status: "awaiting_input",
        question: { ...command.question, module_id: objective.module_id },
        raw_answer: null,
        submission_id: null,
        updated_at: this.clock.nowSeconds(),
      });
    }, fetch);
  }

  private validateRegistration(command: Extract<ApplicationCommand, { type: "RegisterQuestion" }>): void {
    if (command.path_id !== pathId || command.session_id !== sessionId ||
        command.question.knowledge_point_id !== objective.id || command.question.question_type !== "choice") {
      throw new Error("Question is outside the active practice objective");
    }
  }

  async runTurn(
    turnId: string,
    prompt: string,
    askQuestion: boolean,
    onEvent: (event: RuntimeEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (askQuestion && await this.store.getOpenInteraction(pathId)) {
      throw new Error("Finish the current question first");
    }
    await this.runtime.runTurn({
      sessionId,
      turnId,
      pathId,
      mode: "study",
      prompt: askQuestion
        ? `Call register_question with question_id "${turnId}" and knowledge_point_id "${objective.id}". ` +
          "Ask the learner to reduce a ratio to simplest form. Provide exactly three labeled choice options and the correct option label in expected_answer."
        : prompt,
      allowedTools: askQuestion ? ["register_question"] : [],
      signal,
    }, onEvent);
  }

  async snapshot() {
    const progress = await this.readProgress();
    const interaction = await this.store.getOpenInteraction(pathId);
    const lastGrade = progress.learning_evidence.at(-1);
    return {
      pending: interaction && {
        id: interaction.interaction_id,
        status: interaction.status,
        question: publicPendingQuestion(interaction.question),
      },
      mastery: displayMastery(progress, objective),
      objectiveStatus: objectiveStatus(progress, objective),
      nextReviewAt: progress.repetition_states[objective.id]?.next_review_at,
      lastResult: lastGrade?.result,
      assessmentCount: progress.learning_evidence.length,
    };
  }

  async submitAnswer(interactionId: string, answer: string): Promise<void> {
    const receipt = await this.dispatch({
      type: "SubmitAnswer",
      path_id: pathId,
      interaction_id: interactionId,
      submission_id: this.makeId(),
      raw_answer: answer,
    });
    if (!receipt.ok) throw new Error(receipt.error);
    await this.grade(interactionId);
  }

  async dispatch(command: ApplicationCommand): Promise<CommandReceipt> {
    if (command.type !== "SubmitAnswer" || command.path_id !== pathId) {
      return { ok: false, error: "Command is outside this practice session", events: [] };
    }
    const active = await this.store.getOpenInteraction(pathId);
    if (active?.interaction_id !== command.interaction_id || active.status !== "awaiting_input") {
      return { ok: false, error: "There is no matching question awaiting an answer", events: [] };
    }
    const valid = active.question.options.some((option) => option.label === command.raw_answer);
    if (!valid) return { ok: false, error: "Choose an option", events: [] };
    const now = this.clock.nowSeconds();
    await this.store.saveAnswer(active.interaction_id, command.submission_id, command.raw_answer, now);
    const event: DomainEvent = {
      id: command.submission_id,
      path_id: pathId,
      session_id: sessionId,
      turn_id: active.turn_id,
      event_type: "AnswerRecorded",
      payload: { interaction_id: active.interaction_id },
      created_at: now,
    };
    return { ok: true, events: [event] };
  }

  async grade(interactionId: string): Promise<void> {
    const saved = await this.store.getInteraction(interactionId);
    if (!saved || saved.path_id !== pathId || saved.status !== "answered" || saved.raw_answer === null) {
      throw new Error("There is no saved answer to grade");
    }
    const progress = await this.readProgress();
    // The assessment identifier is stable if the process stops between these two sequential writes.
    const evidenceId = saved.interaction_id;
    if (!progress.learning_evidence.some((evidence) => evidence.evidence_id === evidenceId)) {
      const optionMap = Object.fromEntries(saved.question.options.map(({ label, body }) => [label, body]));
      const answer = resolveChoiceSubmission(saved.raw_answer, optionMap);
      const result: AssessmentResultKind = answer === saved.question.expected_answer ? "correct" : "incorrect";
      const correct = result === "correct";
      const now = this.clock.nowSeconds();
      const attempt = createQuizAttempt({
        question_id: saved.question.question_id,
        knowledge_point_id: objective.id,
        module_id: objective.module_id,
        is_correct: correct,
        result,
        user_answer: saved.raw_answer,
        timestamp: saved.updated_at,
      });
      progress.quiz_attempts.push(attempt);
      const mastery = computeMastery(progress.quiz_attempts
        .filter((item) => item.knowledge_point_id === objective.id && !item.voided && item.independent)
        .map((item) => item.is_correct));
      attempt.mastery_estimate = mastery;
      progress.mastery_levels[objective.id] = mastery;
      progress.learning_evidence.push(createLearningEvidence({
        evidence_id: evidenceId,
        question_id: saved.question.question_id,
        knowledge_point_id: objective.id,
        session_id: sessionId,
        turn_id: saved.turn_id,
        assessment_type: "quiz",
        result,
        quality: correct ? 1 : 0,
        learner_answer: saved.raw_answer,
        reference_answer: saved.question.expected_answer,
        timestamp: saved.updated_at,
      }));
      const scheduler = new SpacedRepetitionScheduler({ desired_retention: progress.desired_retention });
      progress.repetition_states[objective.id] ??= scheduler.getInitialState(objective.type, { now });
      scheduler.rebuildFromEvidence(progress, now);
      progress.version++;
      progress.updated_at = now;
      await this.store.save(progress);
    }
    await this.store.markGraded(interactionId, this.clock.nowSeconds());
  }

  private async readProgress() {
    const stored = await this.store.get(pathId);
    if (stored) return stored;
    const progress = createLearningProgress({
      book_id: pathId,
      name: "Ratios",
      current_stage: "practice",
      current_module_id: objective.module_id,
      modules: [createLearningModule({ id: objective.module_id, name: "Ratios", order: 0, knowledge_points: [objective] })],
      knowledge_types: { [objective.id]: objective.type },
    });
    await this.store.save(progress);
    return progress;
  }
}

export type StudySnapshot = Awaited<ReturnType<StudyWorkbench["snapshot"]>>;
