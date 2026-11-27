import { MemoryAppStore, type StoredSession } from "@learn-pace/infra";
import { PiDurableRuntime } from "@learn-pace/runtime";
import { expect, it, vi } from "vitest";
import { completion, modelConfig, text, toolCall } from "../../../runtime/src/__tests__/deepseek-fixture.js";
import { ChatTurns, type PrepareTurn } from "../chat-turns.js";

async function setup(...responses: Response[]) {
  const store = new MemoryAppStore();
  const session: StoredSession = {
    session_id: "chat", path_id: null, kind: "lf01", title: "问答", mode: null,
    model_id: null, created_at: 1, updated_at: 1,
  };
  await store.saveSession(session);
  let id = 0;
  const turns = new ChatTurns(store, { nowSeconds: () => 10 }, () => String(++id), async () => modelConfig);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  const runtime = new PiDurableRuntime(modelConfig, undefined, fetch);
  const observe = vi.fn();
  const onMessage = vi.fn();
  const writes = vi.spyOn(store, "saveMessage");
  turns.observeMessages(session.session_id, observe);
  return {
    runtime, fetch, observe, writes, onMessage,
    send: (prepare: PrepareTurn) => turns.send(session, "问题", [], prepare, new AbortController().signal, onMessage),
  };
}

it.each([true, false])("applies the text gate across model rounds (holdText enabled: %s)", async (gated) => {
  const early = "读前猜测。";
  const answer = "依据原文回答。";
  const h = await setup(
    completion([text(early), toolCall("read_fixture", {})], "tool_calls"),
    completion([text("依据原文"), text("回答。")]),
  );
  let sourceReady = false;
  h.runtime.registerTool({
    name: "read_fixture", description: "Read the synthetic source", parameters: { type: "object", properties: {} },
    execute: async () => {
      sourceReady = true;
      return { content: "可读正文" };
    },
  });

  const reply = await h.send(async () => ({
    runtime: h.runtime, allowedTools: ["read_fixture"],
    auditMetadata: () => ({ readReady: sourceReady }),
    ...(gated && { holdText: () => !sourceReady }),
  }));

  expect(h.fetch).toHaveBeenCalledTimes(2);
  expect(reply).toMatchObject({ status: "committed", content: gated ? answer : early + answer });
  for (const { mock } of [h.observe, h.onMessage, h.writes]) {
    const contents = mock.calls.map(([message]) => message).filter(({ role }) => role === "assistant")
      .map(({ content }) => content);
    expect(contents.some(content => content.includes(early))).toBe(!gated);
    expect(contents.at(-1)).toBe(reply.content);
  }
  expect(h.onMessage.mock.calls.map(([message]) => message.content)).toContain(gated ? "依据原文" : early + "依据原文");
  expect(h.writes.mock.calls.some(([message]) => message.role === "assistant" && message.status === "generating" &&
    message.content && message.metadata?.readReady === true)).toBe(true);
});

it("keeps streamed guesses out of every write and observer when the gate never opens", async () => {
  const h = await setup(completion([text("无依据猜测。"), text("更多猜测。")]));
  const reply = await h.send(async () => ({ runtime: h.runtime, holdText: () => true }));

  expect(reply.content).toBe("");
  for (const { mock } of [h.observe, h.onMessage, h.writes]) {
    expect(mock.calls.map(([message]) => message).filter(({ role }) => role === "assistant")
      .every(({ content }) => content === "")).toBe(true);
  }
});
