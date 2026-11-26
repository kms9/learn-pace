import type { PublicPendingQuestion, SessionMode } from "@learn-pace/domain";

export { loadModelConfigFromEnv, requestModelId, type ModelConfig } from "./model-config.js";
export { PiDurableRuntime, type RegisterQuestionHandler, type RuntimeTool } from "./pi-durable-runtime.js";
export { gradeQualitatively, type QualitativeGradingRequest, type QualitativeGrade } from "./qualitative-grading.js";
export { generateQuickCheck, QuickCheckGenerationError, type QuickCheckRequest, type GeneratedQuickCheck } from "./quick-check.js";

export type RuntimeEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; callId: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; callId: string; output: unknown }
  | { type: "question_presented"; question: PublicPendingQuestion }
  | { type: "turn_completed"; stopReason: "end_turn" | "question_presented" | "tool_terminated" | "cancelled" }
  | { type: "turn_failed"; error: string };

export interface RuntimeModelRound {
  httpStatus?: number;
  promptTokens?: number;
  completionTokens?: number;
  stopReason?: string;
  toolCalls: readonly { id: string; name: string }[];
}

export interface RuntimeTurnRequest {
  sessionId: string;
  turnId: string;
  pathId?: string;
  mode?: SessionMode;
  prompt: string;
  instructions?: string;
  history?: readonly { role: "user" | "assistant"; content: string }[];
  maxTurns?: number;
  onModelRound?: (round: RuntimeModelRound) => void;
  allowedTools: readonly string[];
  signal?: AbortSignal;
}

export interface AgentRuntime {
  readonly kind: "pi-durable";
  runTurn(
    request: RuntimeTurnRequest,
    onEvent: (event: RuntimeEvent) => void,
  ): Promise<void>;
  cancelTurn(turnId: string): Promise<void>;
}

export { assessSemantically, exactVerdict, type AssessmentVerdict, type SemanticAssessmentRequest } from "./semantic-assessment.js";
export { studyQuestionParameters, validateStudyQuestion } from "./register-question.js";
