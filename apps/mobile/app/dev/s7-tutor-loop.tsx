import { openDatabaseAsync } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { deviceBuild, deviceEnter, deviceQuiz, subjects, type Step } from "../../../../scripts/s7-verify/scenarios";
import { grade, newTutor, statusSnapshot, switchMode, type TutorState } from "../../../../scripts/s7-verify/tools";
import { runTutorTurn, type History, type TurnLog } from "../../../../scripts/s7-verify/tutor-loop";
import { Action, Card, Page, styles } from "../../src/components/Shell";
import { useApp } from "../../src/context/AppContext";

type DeviceState = {
  group: number;
  tutor: TutorState;
  history: History;
  records: TurnLog[];
  manualSwitch: boolean;
};

let database: ReturnType<typeof openDatabaseAsync> | undefined;
async function store() {
  return database ??= openDatabaseAsync("learn-pace-s7.db").then(async (db) => {
    await db.execAsync("CREATE TABLE IF NOT EXISTS s7_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);");
    return db;
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
}
async function save(value: DeviceState) {
  const db = await store();
  await db.runAsync("INSERT OR REPLACE INTO s7_runs (id, payload) VALUES (?, ?)", value.tutor.id, JSON.stringify(value));
}

export default function S7TutorLoopRoute() {
  if (!__DEV__) return null;
  return <TutorScreen />;
}

function TutorScreen() {
  const { service, snapshot } = useApp();
  const [value, setValue] = useState<DeviceState | null>(null);
  const [text, setText] = useState("");
  const [calls, setCalls] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const row = await (await store()).getFirstAsync<{ payload: string }>("SELECT payload FROM s7_runs ORDER BY rowid DESC LIMIT 1");
      if (row && mounted) setValue(JSON.parse(row.payload) as DeviceState);
    })().catch(() => { if (mounted) setNotice("无法读取 S7 验证数据"); });
    return () => { mounted = false; };
  }, []);

  async function perform(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch {
      setNotice("S7 验证操作失败");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function execute(current: DeviceState, step: Step) {
    const host = await service.openStudyWorkbench();
    if (!host) {
      setNotice("请先在「我的」配置 DeepSeek Flash");
      return;
    }
    setText("");
    setCalls([]);
    await save(current);
    const { record } = await runTutorTurn({
      runtime: host.runtime, state: current.tutor, history: current.history,
      learnerText: step.text, receipt: step.receipt, stage: "device", env: "android-86ceabbf",
      index: current.records.length + 1, scenario: step.label, maxTurns: 8,
      reasoning: snapshot.model.settings?.reasoning ?? "off", onText: setText,
      onTool: (name) => setCalls((items) => [...items, name]),
    });
    if (!step.check(current.tutor) || record.quiz_terminated_immediately === false || record.answer_leaked_in_text ||
        (step.label === "study-explain-and-quiz" && !record.pre_quiz_streamed_live)) {
      record.passed = false;
      record.notes = [record.notes, "scenario_assertion"].filter(Boolean).join(",");
    }
    current.records.push(record);
    await save(current);
    setValue({ ...current });
  }

  function start(group: number) {
    void perform(async () => {
      const subject = subjects[group]!;
      const initial = { group, tutor: newTutor("device-" + (group + 1) + "-" + Date.now(), subject.goal),
        history: [], records: [], manualSwitch: false };
      setValue(initial);
      await execute(initial, deviceBuild(group));
    });
  }

  function runStep(step: Step) {
    if (!value) return;
    const current = JSON.parse(JSON.stringify(value)) as DeviceState;
    void perform(() => execute(current, step));
  }

  function manualStudy() {
    if (!value) return;
    void perform(async () => {
      const current = JSON.parse(JSON.stringify(value)) as DeviceState;
      const outcome = switchMode(current.tutor, "study");
      if (!outcome.ok) {
        setNotice(outcome.message);
        return;
      }
      current.manualSwitch = true;
      await save(current);
      setValue(current);
    });
  }

  function submit(raw: string) {
    if (!value) return;
    void perform(async () => {
      const current = JSON.parse(JSON.stringify(value)) as DeviceState;
      const result = grade(current.tutor, raw, current.tutor.pending?.question_id);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setAnswer("");
      await save(current);
      setValue({ ...current });
      await execute(current, {
        label: "device-host-grade-feedback",
        text: "我已从题卡提交作答：" + raw + "。请根据批改回执给我简短反馈，不要再出题。",
        receipt: result,
        check: (state) => !state.pending && state.lastGrade?.result === result.result,
      });
    });
  }

  const state = value?.tutor;
  const card = state ? statusSnapshot(state).pending_interaction : null;
  const recent = value?.records.at(-1);
  return (
    <Page title="S7 导师循环验证" secondary>
      <Card title="启动验证">
        <Action label="新建比例化简验证" disabled={busy} onPress={() => start(0)} />
        <Action label="新建 TCP 验证" disabled={busy} onPress={() => start(1)} secondary />
        <Text style={styles.body}>{notice || (busy ? "本轮运行中" : "验证页就绪")}</Text>
      </Card>
      {state && <Card title={state.goal}>
        <Text style={styles.body}>{"模式 " + state.mode + " · 大纲 v" + state.revision + " · " + state.modules.length + " 个模块"}</Text>
        {state.mode === "outline" && state.modules.length > 0 && <>
          <Action label="请导师切到学习" disabled={busy} onPress={() => runStep(deviceEnter)} />
          <Action label="手动切到学习" disabled={busy} onPress={manualStudy} secondary />
        </>}
        {state.mode === "study" && !card && !state.lastGrade &&
          <Action label="请导师讲解并出题" disabled={busy} onPress={() => runStep(deviceQuiz(value!.group))} />}
        {state.lastGrade &&
          <Text style={styles.body}>{(state.lastGrade.result === "correct" ? "批改正确" : "批改有误")
            + " · 掌握度 " + Math.round(state.lastGrade.mastery_level * 100) + "%"}</Text>}
      </Card>}
      {(text || calls.length > 0 || recent) && <Card title="流式回复与工具">
        {!!text && <Text accessibilityLiveRegion="polite" style={styles.body}>{text}</Text>}
        {calls.map((name, index) => <Text key={index} style={styles.body}>{name}</Text>)}
        {recent && <Text style={styles.body}>{"回合 " + recent.turn_index + " · " + recent.turn_status
          + " · " + (recent.passed ? "通过" : "失败") + " · TTFT " + (recent.ttft_ms ?? "缺失")
          + " ms · " + recent.total_ms + " ms · 输入 " + (recent.prompt_tokens ?? "缺失")
          + " · 输出 " + (recent.completion_tokens ?? "缺失")}</Text>}
      </Card>}
      {card && <Card title="待答题卡">
        <Text style={styles.body}>{"题卡 ID " + card.question_id}</Text>
        <Text style={styles.body}>{card.prompt}</Text>
        {card.options.map(({ label, body }) => (
          <Action key={label} label={label + "．" + body} disabled={busy} onPress={() => submit(label)} secondary />
        ))}
        {card.options.length === 0 && <>
          <TextInput accessibilityLabel="题卡作答" value={answer} onChangeText={setAnswer}
            style={styles.body} editable={!busy} placeholder="输入答案" />
          <Action label="提交作答" disabled={busy || !answer.trim()} onPress={() => submit(answer.trim())} />
          {value?.group === 1 && <Action label="提交预设错答" disabled={busy}
            onPress={() => submit("TCP 握手只需要互相发送一个普通数据包。")} secondary />}
        </>}
      </Card>}
    </Page>
  );
}
