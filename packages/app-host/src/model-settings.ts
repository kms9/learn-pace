import { loadModelConfigFromEnv, type ModelConfig } from "@learn-pace/runtime";

export const modelSetting = "deepseek-model-config";
export const legacyKey = "deepseek-api-key";
// 没有模型配置的快照也需要保留本机的退役槽位，直到用户保存新密钥。
export const retiredCredentialSetting = "deepseek-retired-credential-refs";

export type PublicModelSettings = Omit<ModelConfig, "apiKey">;
export type StoredModelSettings = PublicModelSettings & { credentialRef: string | null; retiredCredentialRefs?: string[] };
export type ModelSettingsInput = Pick<ModelConfig, "baseUrl"> &
  Partial<Pick<ModelConfig, "model" | "reasoning" | "apiKey" | "contextWindow" | "maxTokens">>;

export class ModelSettingsError extends Error {}

export function isCredentialRef(value: unknown): value is string {
  return typeof value === "string" && /^deepseek-api-key(?:\.[\w-]+)?$/.test(value);
}

export function retiredRefs(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isCredentialRef))] : [];
}

export function decodeRetiredRefs(raw: string | null): string[] {
  try { return raw ? retiredRefs(JSON.parse(raw)) : []; }
  catch { return []; }
}

export function parseSettings(input: ModelSettingsInput): PublicModelSettings {
  try {
    const { apiKey: _unused, ...settings } = loadModelConfigFromEnv({
      PI_OPENAI_BASE_URL: input.baseUrl,
      PI_MODEL: input.model,
      PI_REASONING: input.reasoning ?? "high",
      PI_CONTEXT_WINDOW: input.contextWindow?.toString(),
      PI_MAX_TOKENS: input.maxTokens?.toString(),
      OPENAI_API_KEY: "validation-placeholder",
    });
    return settings;
  } catch {
    throw new ModelSettingsError("请检查网关地址和模型参数");
  }
}

export function decodeModelRecord(raw: string | null): StoredModelSettings | null {
  if (!raw) return null;
  try {
    const input = JSON.parse(raw) as StoredModelSettings;
    const credentialRef = input.credentialRef === undefined ? legacyKey : input.credentialRef;
    if (credentialRef !== null && !isCredentialRef(credentialRef)) return null;
    const retired = retiredRefs(input.retiredCredentialRefs).filter((ref) => ref !== credentialRef);
    return { ...parseSettings(input), credentialRef, ...(retired.length && { retiredCredentialRefs: retired }) };
  } catch {
    return null;
  }
}

export function publicModelSettings({ credentialRef: _ref, retiredCredentialRefs: _retired, ...settings }: StoredModelSettings): PublicModelSettings {
  return settings;
}
