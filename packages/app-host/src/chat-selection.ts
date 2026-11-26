import type { ChatSelection } from "./lf01-chat.js";

// 原生渲染器的选区以所在文本块为起点。只用可见文字定位，最终仍交给 Host 校验原文区间。
export function renderedChatSelections(content: string, renderedSelection: string): ChatSelection[] {
  const selected = renderedSelection.replace(/\u200b/g, "");
  if (!selected.trim()) return [];

  const matches = new Map<number, ChatSelection>();
  function search(text: string, toSource: (start: number, end: number) => { start: number; end: number }) {
    for (let index = text.indexOf(selected); index !== -1; index = text.indexOf(selected, index + 1)) {
      const { start, end } = toSource(index, index + selected.length);
      matches.set(start, { start, end, text: content.slice(start, end) });
    }
  }
  search(content, (start, end) => ({ start, end }));

  // 内联公式会以对象替代符出现在原生选区。内联强调和行内代码保留文字内容。
  const inline = /(?<!\\)(?:\$(?!\$)[^$\n]+\$|\\\([^\n]*?\\\)|(\*\*|__|~~|[`*_])([^\n]+?)\1)/g;
  const offsets: { start: number; end: number }[] = [];
  const projected: string[] = [];
  function appendPlain(from: number, to: number) {
    projected.push(content.slice(from, to));
    for (let index = from; index < to; index++) offsets.push({ start: index, end: index + 1 });
  }
  let cursor = 0;
  for (const match of content.matchAll(inline)) {
    const start = match.index;
    const end = start + match[0].length;
    appendPlain(cursor, start);
    const marker = match[1];
    if (marker) {
      appendPlain(start + marker.length, end - marker.length);
    } else {
      projected.push("\ufffc");
      offsets.push({ start, end });
    }
    cursor = end;
  }
  if (cursor > 0) {
    appendPlain(cursor, content.length);
    search(projected.join(""), (start, end) => ({ start: offsets[start]!.start, end: offsets[end - 1]!.end }));
  }
  return [...matches.values()].sort((a, b) => a.start - b.start);
}
