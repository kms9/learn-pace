import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Message } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  defineTask,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  hookTask,
  MemoryStorage,
  ToolTask,
} from "@earendil-works/pi-durable";
import { publicPendingQuestion, type PublicPendingQuestion, type RegisterQuestionCommand } from "@learn-pace/domain";
import type { AgentRuntime, RuntimeEvent, RuntimeTurnRequest } from "./index.js";
import type { ModelConfig } from "./model-config.js";
import { createTurnModels, toPiModel } from "./pi-model.js";
import { questionParameters, registerQuestionName, validateQuestion } from "./register-question.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RuntimeTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  privateArgs?: boolean;
  available?: () => boolean;
  termination?(output: JsonValue): { question?: PublicPendingQuestion } | undefined;
  execute(
    args: Record<string, unknown>,
    context: { sessionId: string; turnId: string; pathId?: string; mode?: RuntimeTurnRequest["mode"]; signal: AbortSignal },
  ): Promise<JsonValue>;
}

/** Host commits the private question and resolves once the registration is authoritative. */
export type RegisterQuestionHandler = (
  command: RegisterQuestionCommand,
  signal: AbortSignal,
) => Promise<void>;

type TerminalEvent = Extract<RuntimeEvent, { type: "turn_completed" | "turn_failed" }>;

const finishQuestionRound = defineTask<null, { phase: "finish" }, { terminate: true }>({
  name: "learn-pace.finish-question",
  version: 1,
  initial: () => ({ phase: "finish" }),
  phases: {
    finish: (_task, runtime, context) =>
      runtime.commit(() => ({
        status: "terminal",
        outcome: { status: "completed", result: { terminate: true } },
      }), context),
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export class PiDurableRuntime implements AgentRuntime {
  readonly kind = "pi-durable" as const;
  private readonly tools = new Map<string, RuntimeTool>();
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly config: ModelConfig,
    private readonly registerQuestion?: RegisterQuestionHandler,
    private readonly fetch?: typeof globalThis.fetch,
  ) {}

  registerTool(tool: RuntimeTool): void {
    if (!/^[\w-]{1,64}$/.test(tool.name) || tool.name === registerQuestionName || this.tools.has(tool.name)) {
      throw new Error("Invalid, reserved or duplicate runtime tool name");
    }
    this.tools.set(tool.name, tool);
  }

  /** Requests cancellation. The turn reports its terminal state through runTurn. */
  async cancelTurn(turnId: string): Promise<void> {
    this.active.get(turnId)?.abort();
  }

  async runTurn(request: RuntimeTurnRequest, onEvent: (event: RuntimeEvent) => void): Promise<void> {
    if (this.active.has(request.turnId)) {
      onEvent({ type: "turn_failed", error: "Turn is already running" });
      return;
    }
    const controller = new AbortController();
    this.active.set(request.turnId, controller);
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    const emit = (event: RuntimeEvent) => {
      if (!signal.aborted) onEvent(event);
    };

    let harness: Harness | undefined;
    let publicQuestion: PublicPendingQuestion | undefined;
    let toolTerminated = false;
    let failure = "Pi Durable turn failed";
    let terminal: TerminalEvent;
    try {
      signal.throwIfAborted();
      const allowed = new Set(request.allowedTools);
      const { pathId, sessionId, turnId, mode } = request;
      const register = allowed.has(registerQuestionName) ? this.registerQuestion : undefined;
      if (allowed.has(registerQuestionName) && (!register || !pathId)) {
        failure = "Question registration requires a path and a trusted Host handler";
        throw new Error(failure);
      }
      const bufferedText: string[] = [];
      let questionCallId: string | undefined;
      let questionAttempted = false;
      let registrationInFlight = false;
      const model = toPiModel(this.config);
      const history = request.history?.map(({ role, content }): Message => role === "user"
        ? { role, content, timestamp: 0 }
        : {
          role, content: [{ type: "text", text: content }], timestamp: 0,
          api: model.api, provider: model.provider, model: model.id, stopReason: "stop",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        }) ?? [];
      const models = createTurnModels(model, this.config.apiKey, (delta) => {
        // A tool call can arrive after text in the same response. Hold text on question-capable
        // turns so an answer printed before a call cannot reach the learner.
        if (!register) emit({ type: "text_delta", delta });
        else if (!questionAttempted) bufferedText.push(delta);
      }, (message) => { failure = message; }, this.fetch, request.onModelRound);
      const offered = [...this.tools.values()].filter((tool) => allowed.has(tool.name));
      const conditional = new Map(offered.flatMap((tool) => tool.available ? [[tool.name, tool.available] as const] : []));
      const hasTerminator = offered.some((tool) => tool.termination);
      let toolQueue: Promise<unknown> = Promise.resolve();
      const tools = offered.map((tool) =>
        defineTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          replay: "unsafe",
          async execute(args: unknown, { callId }, context) {
            const toolSignal = context.abortSignal ? AbortSignal.any([signal, context.abortSignal]) : signal;
            const execute = async () => {
              toolSignal.throwIfAborted();
              if (toolTerminated) throw new Error("A tool already ended the turn");
              const input = args as Record<string, unknown>;
              emit({ type: "tool_call", toolName: tool.name, callId, args: tool.privateArgs ? {} : input });
              toolSignal.throwIfAborted();
              const output = await tool.execute(input, { sessionId, turnId, pathId, mode, signal: toolSignal });
              const termination = tool.termination?.(output);
              if (termination) {
                toolTerminated = true;
                publicQuestion = termination.question;
              } else {
                toolSignal.throwIfAborted();
              }
              emit({ type: "tool_result", toolName: tool.name, callId, output });
              return {
                output: [{ type: "text" as const, text: JSON.stringify(output) }],
                ...(termination ? { control: { terminate: true as const } } : {}),
              };
            };
            if (!hasTerminator) return execute();
            const result = toolQueue.then(execute);
            toolQueue = result.catch(() => {});
            return result;
          },
        }),
      );

      const questionTool = register && pathId ? defineTool({
        name: registerQuestionName,
        description: "Present a single question for the learner to answer. Put the answer only in expected_answer.",
        parameters: questionParameters,
        replay: "unsafe",
        async execute(args, { callId }, context) {
          const toolSignal = context.abortSignal ? AbortSignal.any([signal, context.abortSignal]) : signal;
          toolSignal.throwIfAborted();
          const question = validateQuestion(args);
          const card = publicPendingQuestion(question);
          emit({ type: "tool_call", toolName: registerQuestionName, callId, args: { ...card } });
          toolSignal.throwIfAborted();
          if (registrationInFlight || publicQuestion) throw new Error("Question registration is already claimed");
          registrationInFlight = true;
          try {
            await register({
              type: "RegisterQuestion",
              path_id: pathId,
              session_id: sessionId,
              turn_id: turnId,
              question,
            }, toolSignal);
          } catch {
            throw new Error("Host rejected question registration");
          } finally {
            registrationInFlight = false;
          }
          // A committed registration wins a race with Stop. Returning cancelled would hide a live card.
          publicQuestion = card;
          return { output: [{ type: "text", text: "Question registered." }], control: { terminate: true } };
        },
      }) : undefined;

      const extension = defineExtension({
        name: "learn-pace",
        tools: questionTool ? [...tools, questionTool] : tools,
        tasks: [finishQuestionRound],
        hooks: [
          hook(GenerationTask, {
            beforeRequest({ messages }) {
              if (!history.length && !conditional.size) return;
              const prepared = conditional.size ? messages.map((message) => message.role === "system" && message.toolsAdded
                ? { ...message, toolsAdded: message.toolsAdded.filter(({ name }) => conditional.get(name)?.() !== false) }
                : message) : messages;
              const firstInput = prepared.findIndex(({ role }) => role !== "system");
              return { messages: !history.length || firstInput < 0 ? prepared
                : [...prepared.slice(0, firstInput), ...history, ...prepared.slice(firstInput)] };
            },
            afterResponse(message) {
              const questionCall = register && message.content.find(
                (part) => part.type === "toolCall" && part.name === registerQuestionName,
              );
              questionCallId = questionCall?.type === "toolCall" ? questionCall.id : undefined;
              if (questionCallId !== undefined) {
                questionAttempted = true;
                bufferedText.length = 0;
              }
            },
            afterTools: () => publicQuestion || toolTerminated ? { tasks: [hookTask(finishQuestionRound, null)] } : undefined,
          }),
          hook(ToolTask, {
            beforeTool(call) {
              if (!allowed.has(call.name)) return { block: "Tool is outside the turn allowlist" };
              if (questionCallId !== undefined && (call.name !== registerQuestionName || call.id !== questionCallId)) {
                return { block: "Only the first question can be registered in this round" };
              }
            },
          }),
        ],
      });
      const registry = createRegistry();
      registry.install(extension);
      harness = await Harness.open(new MemoryStorage(), {
        models,
        registry,
        settings: { retry: { enabled: false }, compaction: { enabled: false } },
      }, BACKGROUND_CONTEXT);
      const instructions = [
        request.instructions,
        register ? "When presenting a question, call register_question directly. Keep the answer in expected_answer and wait for learner input." : undefined,
      ].filter(Boolean).join("\n\n");
      const root = await harness.root(BACKGROUND_CONTEXT, {
        agent: {
          model: { provider: model.provider, modelId: model.id },
          thinkingLevel: this.config.reasoning ?? "off",
          extensions: [extension],
          maxTurns: request.maxTurns ?? 8,
          ...(instructions ? { instructions } : {}),
        },
      });
      signal.throwIfAborted();
      const submission = await root.submit({
        type: "input",
        content: request.prompt,
        requestId: turnId,
      }, BACKGROUND_CONTEXT);
      // Aborting the submission wait alone would leave Pi's model and tools running.
      let stopping: Promise<void> | undefined;
      const stop = () => {
        stopping ??= root.abort(BACKGROUND_CONTEXT);
        void stopping.catch(() => {});
      };
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      try {
        const settled = await submission.wait(BACKGROUND_CONTEXT);
        await stopping;
        if (signal.aborted || (settled.status === "unanswered" && settled.reason === "aborted")) {
          terminal = { type: "turn_completed", stopReason: "cancelled" };
        } else if (settled.status !== "done" || settled.type !== "input") {
          terminal = { type: "turn_failed", error: failure };
        } else if (publicQuestion) {
          terminal = { type: "turn_completed", stopReason: "question_presented" };
        } else {
          const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), BACKGROUND_CONTEXT);
          const stopReason = answer?.model?.[0]?.role === "assistant" ? answer.model[0].stopReason : undefined;
          if (questionAttempted) {
            terminal = { type: "turn_failed", error: "Question registration did not complete" };
          } else if (stopReason === "stop") {
            for (const delta of bufferedText) emit({ type: "text_delta", delta });
            terminal = { type: "turn_completed", stopReason: "end_turn" };
          } else {
            terminal = { type: "turn_failed", error: stopReason === "length" ? "Model output reached its token limit" : failure };
          }
        }
      } finally {
        signal.removeEventListener("abort", stop);
      }
    } catch {
      terminal = signal.aborted ? { type: "turn_completed", stopReason: "cancelled" } : { type: "turn_failed", error: failure };
    } finally {
      try {
        await harness?.close(BACKGROUND_CONTEXT);
      } catch {
        if (!signal.aborted) terminal = { type: "turn_failed", error: "Pi Durable failed to close the turn" };
      } finally {
        this.active.delete(request.turnId);
      }
    }
    if (publicQuestion) {
      onEvent({ type: "question_presented", question: publicQuestion });
      terminal = { type: "turn_completed", stopReason: "question_presented" };
    } else if (toolTerminated) {
      terminal = { type: "turn_completed", stopReason: "tool_terminated" };
    } else if (signal.aborted) {
      terminal = { type: "turn_completed", stopReason: "cancelled" };
    }
    onEvent(terminal);
  }
}
