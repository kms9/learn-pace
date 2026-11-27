import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { StudyWorkbench, StudySnapshot } from "@learn-pace/app-host";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../context/AppContext";

const initialPrompt = "Explain how to simplify ratios. Give thirty numbered examples with brief explanations.";
type Busy = "chat" | "question" | "grade";

export function M1WorkbenchScreen() {
  const { service, inspectDatabase: readDatabase, reload } = useApp();
  const router = useRouter();
  const [host, setHost] = useState<StudyWorkbench>();
  const [snapshot, setSnapshot] = useState<StudySnapshot>();
  const [status, setStatus] = useState("Opening study workbench…");
  const [busy, setBusy] = useState<Busy>();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [deltaCount, setDeltaCount] = useState(0);
  const [reply, setReply] = useState("");
  const [database, setDatabase] = useState("");
  const activeTurn = useRef<AbortController>(undefined);
  const actionRunning = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function open() {
      const restoredHost = await service.openStudyWorkbench();
      let current = restoredHost ? await restoredHost.snapshot() : undefined;
      let statusOnLaunch = restoredHost ? "Ready" : "Configure DeepSeek Flash to begin";
      if (restoredHost && current?.pending?.status === "answered") {
        try {
          await restoredHost.grade(current.pending.id);
          current = await restoredHost.snapshot();
        } catch {
          statusOnLaunch = "Saved answer is ready to retry";
        }
      }
      if (!mounted) return;
      if (restoredHost) setHost(restoredHost);
      setSnapshot(current);
      setStatus(statusOnLaunch);
      if (__DEV__) console.info("LearnPace M1 ready", { configured: Boolean(restoredHost), pending: Boolean(current?.pending) });
    }
    void open().catch(() => {
      if (mounted) setStatus("Could not open saved data");
    });
    return () => { mounted = false; };
  }, [service]);

  async function perform(kind: Busy, action: () => Promise<void>, failureMessage: string) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(kind);
    try {
      await action();
    } catch {
      setStatus(failureMessage);
    } finally {
      setBusy(undefined);
      actionRunning.current = false;
    }
  }

  function run(question: boolean, test = false) {
    if (!host) return;
    void perform(question ? "question" : "chat", async () => {
      const id = randomUUID();
      const controller = new AbortController();
      activeTurn.current = controller;
      setStatus("Generating…");
      setReply("");
      setDeltaCount(0);
      let received = 0;
      const startedAt = performance.now();
      try {
        await host.runTurn(id, test ? "Reply with the word Ready." : prompt.trim(), question, (event) => {
          if (event.type === "text_delta") {
            received++;
            if (__DEV__ && received === 1) {
              console.info("LearnPace M1 first text", { elapsedMs: Math.round(performance.now() - startedAt) });
            }
            setReply((current) => current + event.delta);
            setDeltaCount((count) => count + 1);
          } else if (event.type === "turn_completed") {
            setStatus(event.stopReason);
            if (__DEV__) console.info("LearnPace M1 turn terminal", { reason: event.stopReason, deltas: received });
          } else if (event.type === "turn_failed") {
            setStatus(event.error);
          }
        }, controller.signal);
      } finally {
        activeTurn.current = undefined;
        setSnapshot(await host.snapshot());
        await reload();
      }
    }, "Could not run the turn");
  }

  function grade(label?: string) {
    const pending = snapshot?.pending;
    if (!host || !pending) return;
    void perform("grade", async () => {
      if (label === undefined) await host.grade(pending.id);
      else await host.submitAnswer(pending.id, label);
      setStatus("Assessment saved");
    }, "Assessment interrupted. Reopen the saved question to retry.").finally(async () => {
      setSnapshot(await host.snapshot().catch(() => snapshot));
      await reload().catch(() => {});
    });
  }

  async function inspectDatabase() {
    try {
      const { journalMode, paths, questions, answers, graded } = await readDatabase();
      setDatabase(`SQLite ${journalMode} · paths ${paths} · questions ${questions} · answers ${answers} · graded ${graded}`);
    } catch {
      setStatus("Could not read SQLite status");
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Learn Pace</Text>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
      <Text>{host ? "SecureStore key present" : "SecureStore key missing"} · {deltaCount} text deltas</Text>
      <View style={styles.buttons}>
        <Button title="打开模型设置" onPress={() => router.canGoBack() ? router.back() : router.navigate("/me")} />
        <Button title="Test key" disabled={!host || Boolean(busy)} onPress={() => run(false, true)} />
        <Button title="SQLite status" onPress={() => void inspectDatabase()} />
      </View>
      {database ? <Text selectable>{database}</Text> : null}

      <View style={styles.panel}>
        <TextInput style={styles.input} accessibilityLabel="Message" value={prompt} onChangeText={setPrompt} maxLength={4000} multiline />
        <View style={styles.buttons}>
          <Button title="Send" disabled={!host || Boolean(busy) || !prompt.trim()} onPress={() => run(false)} />
          <Button title="Cancel" disabled={busy !== "chat" && busy !== "question"} onPress={() => activeTurn.current?.abort()} />
          <Button title="Generate question" disabled={!host || Boolean(busy) || Boolean(snapshot?.pending)} onPress={() => run(true)} />
        </View>
        {reply ? <Text selectable>{reply}</Text> : null}
      </View>

      {snapshot?.pending && (
        <View style={styles.panel}>
          <Text style={styles.heading}>Pending question</Text>
          <Text selectable>Question ID {snapshot.pending.question.question_id}</Text>
          <Text>{snapshot.pending.status}</Text>
          <Text style={styles.heading}>{snapshot.pending.question.prompt}</Text>
          {snapshot.pending.question.options.map(({ label, body }) => (
            <Button key={label} title={`${label}. ${body}`} disabled={Boolean(busy) || snapshot.pending?.status !== "awaiting_input"} onPress={() => grade(label)} />
          ))}
          {snapshot.pending.status === "answered" && <Button title="Retry grading" disabled={Boolean(busy)} onPress={() => grade()} />}
        </View>
      )}
      {snapshot && (
        <View style={styles.panel}>
          <Text style={styles.heading}>Reduce a ratio</Text>
          <Text>Mastery {Math.round(snapshot.mastery * 100)}% · {snapshot.objectiveStatus}</Text>
          <Text>Next review {snapshot.nextReviewAt === undefined ? "—" : new Date(snapshot.nextReviewAt * 1000).toISOString()}</Text>
          <Text>Assessments {snapshot.assessmentCount} · last result {snapshot.lastResult ?? "—"}</Text>
        </View>
      )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 28, gap: 10, backgroundColor: "#f3f5f6" },
  title: { fontSize: 26, fontWeight: "bold" },
  status: { fontSize: 16, fontWeight: "600" },
  heading: { fontSize: 16, fontWeight: "600" },
  panel: { padding: 12, backgroundColor: "#fff", borderRadius: 8, gap: 8 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  input: { minHeight: 42, borderColor: "#c4cdd2", borderWidth: 1, padding: 8, borderRadius: 4, color: "#18232b" },
});
