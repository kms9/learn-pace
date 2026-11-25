import { fetch as expoFetch } from "expo/fetch";
import { expoSecretStore, type ExpoLearningStore } from "@learn-pace/infra/expo";
import { loadModelConfigFromEnv, type ModelConfig } from "@learn-pace/runtime";

const keyName = "deepseek-api-key";
const configName = "deepseek-model-config";
type PublicConfig = Omit<ModelConfig, "apiKey">;

export const nativeFetch = expoFetch as unknown as typeof globalThis.fetch;

export function parseConfiguration(baseUrl: string, apiKey: string): ModelConfig {
  return loadModelConfigFromEnv({
    PI_OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
    PI_REASONING: "high",
  });
}

export async function readConfiguration(store: ExpoLearningStore): Promise<ModelConfig | null> {
  const [settings, apiKey] = await Promise.all([store.readSetting(configName), expoSecretStore.getItem(keyName)]);
  return settings && apiKey ? { ...JSON.parse(settings) as PublicConfig, apiKey } : null;
}

export async function saveConfiguration(store: ExpoLearningStore, config: ModelConfig): Promise<void> {
  const { apiKey, ...settings } = config;
  await expoSecretStore.setItem(keyName, apiKey);
  await store.writeSetting(configName, JSON.stringify(settings));
}

export async function importUsbConfiguration(code: string): Promise<ModelConfig> {
  if (!__DEV__) throw new Error("USB import requires a development build");
  const response = await expoFetch("http://127.0.0.1:18765/config", {
    method: "POST",
    headers: { "X-Learn-Pace-Pairing": code },
  });
  if (!response.ok) throw new Error("USB import was refused");
  return loadModelConfigFromEnv(await response.json() as Record<string, string>);
}
