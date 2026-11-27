import { vi } from "vitest";
import type { ModelConfig } from "../index.js";

export const modelConfig: ModelConfig = {
  baseUrl: "https://deepseek.example/v1",
  model: "openai/deepseek-v4.1-flash",
  apiType: "openai-completions",
  apiKey: "test-credential",
  reasoning: "high",
  contextWindow: 8192,
  maxTokens: 1024,
};

export function text(content: string) {
  return { content };
}

export function toolCall(name: string, args: Record<string, unknown>, index = 0) {
  return { tool_calls: [{
    index,
    id: `call_${index}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  }] };
}

function sseEvent(delta: object, finishReason: string | null = null) {
  const chunk = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function completion(deltas: object[], finishReason = "stop"): Response {
  const body = deltas.map((delta) => sseEvent(delta)).join("") +
    sseEvent({}, finishReason) + "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

export function mockDeepSeek(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function streamUntilAborted(onAbort: () => void) {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
    new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseEvent(text("first"))));
        init?.signal?.addEventListener("abort", () => {
          onAbort();
          controller.error(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      },
    }), { headers: { "Content-Type": "text/event-stream" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
