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
  const baseUrl = env.PI_OPENAI_BASE_URL?.trim();
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!baseUrl) throw new Error("Missing PI_OPENAI_BASE_URL in environment");
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in environment");
  const url = URL.parse(baseUrl);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) {
    throw new Error("Invalid PI_OPENAI_BASE_URL");
  }

  const apiType = env.PI_OPENAI_API?.trim() || "openai-completions";
  if (apiType !== "openai-completions") throw new Error("Unsupported PI_OPENAI_API");
  const reasoning = env.PI_REASONING?.trim() || undefined;
  if (reasoning !== undefined && reasoning !== "low" && reasoning !== "medium" && reasoning !== "high") {
    throw new Error("Invalid PI_REASONING");
  }
  const contextWindow = positiveInteger(env.PI_CONTEXT_WINDOW, 1048576, "PI_CONTEXT_WINDOW");
  const maxTokens = positiveInteger(env.PI_MAX_TOKENS, 393216, "PI_MAX_TOKENS");
  if (maxTokens >= contextWindow) throw new Error("PI_MAX_TOKENS must be below PI_CONTEXT_WINDOW");

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: env.PI_MODEL?.trim() || "openai/deepseek-v4.1-flash",
    apiType,
    apiKey,
    reasoning,
    contextWindow,
    maxTokens,
  };
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}
