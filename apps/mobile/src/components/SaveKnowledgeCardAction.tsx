import { KnowledgeCardError, RestoreGateError } from "@learn-pace/app-host";
import { useRef, useState } from "react";
import { Text } from "react-native";
import { ChatAction } from "./chat-controls";
import { styles } from "./Shell";

export function SaveKnowledgeCardAction({ save }: { save: () => Promise<unknown> }) {
  const [status, setStatus] = useState<"saving" | "saved">();
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  async function saveCard() {
    if (busy.current || status === "saved") return;
    busy.current = true;
    setStatus("saving");
    setError(undefined);
    try {
      await save();
      setStatus("saved");
    } catch (cause) {
      setStatus(undefined);
      setError(cause instanceof KnowledgeCardError || cause instanceof RestoreGateError ? cause.message : "无法收藏解析，请重试");
    } finally {
      busy.current = false;
    }
  }
  return <>
    <ChatAction label={status === "saved" ? "已收藏解析" : status === "saving" ? "正在收藏…" : "收藏解析"}
      disabled={!!status} onPress={() => void saveCard()} />
    {error && <Text accessibilityRole="alert" style={styles.body}>{error}</Text>}
  </>;
}
