import type { PublicPendingQuestion, SessionMode } from "@learn-pace/domain";

export { loadModelConfigFromEnv, type ModelConfig } from "./model-config.js";
export { PiDurableRuntime, type RegisterQuestionHandler, type RuntimeTool } from "./pi-durable-runtime.js";
export { gradeQualitatively, type QualitativeGradingRequest, type QualitativeGrade } from "./qualitative-grading.js";

export type RuntimeEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; callId: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; callId: string; output: unknown }
  | { type: "question_presented"; question: PublicPendingQuestion }
  | { type: "turn_completed"; stopReason: "end_turn" | "question_presented" | "cancelled" }
  | { type: "turn_failed"; error: string };

export interface RuntimeTurnRequest {
  sessionId: string;
  turnId: string;
  pathId?: string;
  mode?: SessionMode;
  prompt: string;
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
