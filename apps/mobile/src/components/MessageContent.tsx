import { Text, StyleSheet } from "react-native";
import { EnrichedMarkdownText, type MarkdownStyle, type TextContextMenuItem } from "react-native-enriched-markdown";
import { colors } from "../theme";

const markdownStyle: MarkdownStyle = {
  paragraph: { fontSize: 16, lineHeight: 25, color: colors.text },
  h1: { color: colors.text, fontSize: 23 },
  h2: { color: colors.text, fontSize: 20 },
  h3: { color: colors.text, fontSize: 18 },
  h4: { color: colors.text },
  h5: { color: colors.text },
  h6: { color: colors.text },
  list: { color: colors.text, markerColor: colors.primary, fontSize: 16, lineHeight: 25 },
  link: { color: colors.primary },
  code: { color: colors.text, backgroundColor: colors.soft, fontFamily: "monospace" },
  codeBlock: { color: colors.text, backgroundColor: colors.soft, borderRadius: 12, fontFamily: "monospace" },
  blockquote: { color: colors.muted, borderColor: colors.border, backgroundColor: colors.soft },
  table: { color: colors.text, borderColor: colors.border, headerBackgroundColor: colors.soft },
  math: { color: colors.text, backgroundColor: colors.background },
  inlineMath: { color: colors.text },
};

// md4c renders an unfinished fence as a code block. Keep the open fragment
// visible as source until its closing delimiter arrives in the stream.
function prepareMarkdown(markdown: string, streaming: boolean) {
  let fence: { token: string; start: number } | undefined;
  let math: { start: number; closing: string } | undefined;
  let code: string | undefined;
  const parts: string[] = [];
  let copied = 0;
  const tokens = /^[ \t]*([\x60]{3,}|~{3,})([^\n]*)|([\x60]+)|(\${1,2}|\\[()[\]])|\n[ \t]*\n/gm;
  for (const match of markdown.matchAll(tokens)) {
    const [whole, block, suffix, ticks, delimiter] = match;
    const index = match.index ?? 0;
    if (fence) {
      if (block?.startsWith(fence.token) && !suffix?.trim()) fence = undefined;
      continue;
    }
    if (block && math?.closing !== "$$" && math?.closing !== "\\]") {
      fence = { token: block, start: index };
      math = undefined;
      code = undefined;
      continue;
    }
    if (whole.startsWith("\n")) {
      code = undefined;
      if (math?.closing === "$" || math?.closing === "\\)") math = undefined;
      continue;
    }
    if (ticks && !math) {
      if (ticks === code) code = undefined;
      else code ??= ticks;
      continue;
    }
    if (!delimiter || code) continue;
    let before = index - 1;
    while (markdown[before] === "\\") before--;
    if ((index - 1 - before) % 2) continue;
    if (math?.closing === delimiter) {
      if (delimiter.startsWith("\\")) {
        const inner = markdown.slice(math.start + 2, index);
        // Keep escaped numbered citations in the rendered Markdown.
        if (delimiter === "\\)" || !/^\s*\d+\s*$/.test(inner)) {
          const marker = delimiter === "\\)" ? "$" : "$$";
          parts.push(markdown.slice(copied, math.start), marker, inner, marker);
          copied = index + delimiter.length;
        }
      }
      math = undefined;
    } else if (!math && delimiter !== "\\)" && delimiter !== "\\]") {
      const closing = delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
      math = { closing, start: index };
    }
  }
  const end = streaming ? fence?.start ?? math?.start ?? markdown.length : markdown.length;
  parts.push(markdown.slice(copied, end));
  return { formatted: parts.join(""), tail: markdown.slice(end) };
}

export function MessageContent({ content, streaming = false, selectionActions, onSelectionChange }: {
  content: string; streaming?: boolean; selectionActions?: TextContextMenuItem[]; onSelectionChange?: (text: string) => void;
}) {
  const { formatted, tail } = prepareMarkdown(content, streaming);
  return (
    <>
      {formatted.length > 0 && (
        <EnrichedMarkdownText
          markdown={formatted}
          markdownStyle={markdownStyle}
          md4cFlags={{ latexMath: true }}
          flavor="github"
          selectable={!!selectionActions?.length || !!onSelectionChange}
          contextMenuItems={selectionActions}
          onRenderedSelectionChange={onSelectionChange && ((event) => onSelectionChange(event.nativeEvent.text))}
          allowTrailingMargin={false}
          streamingAnimation={streaming}
        />
      )}
      {tail.length > 0 && <Text style={styles.source}>{tail}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  source: { color: colors.text, fontFamily: "monospace", fontSize: 14, lineHeight: 22 },
});
