/**
 * AgentRuntime port & DeepSeek Flash configuration contract.
 *
 * M1 S2/S3 will implement the `@earendil-works/pi-durable` (latest) adapter here,
 * reusing authorized Cherry Studio Mobile RN/Hermes adaptation patterns.
 */

import type { SessionMode } from "@learn-pace/domain";

export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiType: "openai-completions";
  apiKey: string;
  reasoning?: "low" | "medium" | "high";
  contextWindow: number;
  maxTokens: number;
}

export function loadModelConfigFromEnv(
  env: Record<string, string | undefined>,
): ModelConfig {
  const baseUrl = env["PI_OPENAI_BASE_URL"]?.trim();
  const model = env["PI_MODEL"]?.trim() || "openai/deepseek-v4.1-flash";
  const apiKey = env["OPENAI_API_KEY"]?.trim();
  if (!baseUrl) {
    throw new Error("Missing PI_OPENAI_BASE_URL in environment");
  }
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }
  const reasoning = env["PI_REASONING"]?.trim();
  return {
    baseUrl,
    model,
    apiType: "openai-completions",
    apiKey,
    reasoning:
      reasoning === "low" || reasoning === "medium" || reasoning === "high"
        ? reasoning
        : undefined,
    contextWindow: Number(env["PI_CONTEXT_WINDOW"] ?? 1048576),
    maxTokens: Number(env["PI_MAX_TOKENS"] ?? 393216),
  };
}

export type RuntimeEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; callId: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; callId: string; output: unknown }
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
