import { expect, it } from "vitest";
import { renderedChatSelections } from "../chat-selection.js";

it("preserves the original range of a unique passage across emphasis and a rendered formula", () => {
  const content = "前言。\n先看 **等价分数**，例如 $6/8$，然后约分。";
  const selected = renderedChatSelections(content, "先看 等价分数，例如 \ufffc");
  expect(selected).toEqual([{ text: "先看 **等价分数**，例如 $6/8$", start: 4, end: content.indexOf("，然后") }]);
  const escaped = String.raw`例子是 \(6/8\)。`;
  expect(renderedChatSelections(escaped, "例子是 \ufffc")[0]?.text).toBe(escaped.slice(0, -1));
});

it("does not choose between duplicates in distinct rendered blocks", () => {
  const content = "约分的含义\n\n约分的**含义**";
  expect(renderedChatSelections(content, "约分的含义").map(({ start }) => start)).toEqual([0, 7]);
  expect(renderedChatSelections("两个公式 $x$ 和 $y$", "\ufffc")).toHaveLength(2);
  expect(renderedChatSelections(content, "找不到")).toEqual([]);
});
