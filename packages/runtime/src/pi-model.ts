import type { AssistantMessage, Model, ProviderStreams } from "@earendil-works/pi-ai";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import type { RuntimeModelRound } from "./index.js";
import { requestModelId, type ModelConfig } from "./model-config.js";

export function toPiModel(config: ModelConfig): Model<"openai-completions"> {
  return {
    provider: "deepseek",
    // The configured openai/ prefix is a namespace. This gateway lists the bare model ID.
    id: requestModelId(config),
    name: config.model,
    api: config.apiType,
    baseUrl: config.baseUrl,
    input: ["text"],
    reasoning: true,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsStrictMode: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    },
  };
}

export function createTurnModels(
  model: Model<"openai-completions">,
  apiKey: string,
  onDelta: (delta: string) => void,
  onProviderFailure: (message: string) => void,
  fetch?: typeof globalThis.fetch,
  onModelRound?: (round: RuntimeModelRound) => void,
) {
  // Bind the credential only at the request boundary. The model and transcript carry no key.
  const stream: ProviderStreams["streamSimple"] = (_model, context, options) =>
    lazyStream(model, async () => {
      const transport = fetch ?? options?.fetch;
      let httpStatus: number | undefined;
      const observedFetch: typeof globalThis.fetch = async (input, init) => {
        const response = await (transport ?? globalThis.fetch)(input, init);
        httpStatus = response.status;
        return response;
      };
      const source = streamSimple(model, context, {
        ...options, apiKey, fetch: onModelRound ? observedFetch : transport, maxRetries: 0,
      });
      return (async function* () {
        let last: AssistantMessage | undefined;
        try {
          for await (const event of source) {
            if (event.type === "text_delta" && !options?.signal?.aborted) onDelta(event.delta);
            if (event.type === "done") last = event.message;
            if (event.type === "error") {
              last = event.error;
              const message = providerFailure(event.error);
              onProviderFailure(message);
              yield { ...event, error: { ...event.error, errorMessage: message, diagnostics: undefined } };
            } else {
              yield event;
            }
          }
        } finally {
          onModelRound?.({
            httpStatus,
            promptTokens: last?.usage.totalTokens ? last.usage.input + last.usage.cacheRead + last.usage.cacheWrite : undefined,
            completionTokens: last?.usage.totalTokens ? last.usage.output : undefined,
            stopReason: last?.stopReason,
            toolCalls: last?.content.flatMap((part) => part.type === "toolCall" ? [{ id: part.id, name: part.name }] : []) ?? [],
          });
        }
      })();
    }, undefined, options?.signal);

  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(createProvider({
    id: model.provider,
    models: [model],
    auth: { apiKey: { name: "Host API key", resolve: async () => ({ auth: {} }) } },
    api: { stream, streamSimple: stream },
  }));
  return models;
}

export function providerFailure(message: AssistantMessage): string {
  // Provider bodies can echo request data. Surface only a numeric status if available.
  const status = /^(?:HTTP )?([45]\d{2})(?:[: ]|$)/.exec(message.errorMessage ?? "")?.[1];
  return status ? `DeepSeek request failed (HTTP ${status})` : "DeepSeek request failed";
}
