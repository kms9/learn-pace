import { useState } from "react";
import { Text } from "react-native";
import { useApp } from "../../src/context/AppContext";
import { Action, Card, ModelSetup, Page, styles } from "../../src/components/Shell";

export default function Chat() {
  const { service, snapshot } = useApp();
  const [opened, setOpened] = useState<{
    title: string;
    messages: Awaited<ReturnType<typeof service.readSessionHistory>>;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  async function readHistory(sessionId: string, title: string) {
    setFailed(false);
    try {
      setOpened({ title, messages: await service.readSessionHistory(sessionId) });
    } catch {
      setFailed(true);
    }
  }

  return (
    <Page title="问答">
      <ModelSetup />
      {opened ? (
        <>
          <Action label="返回会话列表" onPress={() => setOpened(null)} secondary />
          <Card title={opened.title}>
            {opened.messages.length === 0 && <Text style={styles.body}>此会话暂无消息。</Text>}
            {opened.messages.map((message) => <Text key={message.message_id} selectable style={styles.body}>{message.content}</Text>)}
          </Card>
        </>
      ) : (
        <Card title="历史会话">
          {snapshot.sessions.length === 0 && <Text style={styles.body}>暂无会话。</Text>}
          {snapshot.sessions.map(({ session_id, title }) => (
            <Action key={session_id} label={title || "未命名会话"} onPress={() => void readHistory(session_id, title || "未命名会话")} secondary />
          ))}
          {failed && <Text accessibilityRole="alert" style={styles.body}>无法读取会话，请重试。</Text>}
        </Card>
      )}
    </Page>
  );
}
