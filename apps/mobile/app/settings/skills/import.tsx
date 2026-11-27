import { SkillConflictError, SkillPackageError, skillRegistries, type GithubSkillCandidate, type SkillPreview, type SkillRegistry } from "@learn-pace/app-host";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { Action, Card, Page, styles } from "../../../src/components/Shell";
import { SkillCompatibilityInfo, skillShortVersion, skillSourceLabel } from "../../../src/components/SkillDetails";
import { useApp } from "../../../src/context/AppContext";
import { pickSkillFile, skillErrorMessage } from "../../../src/skill-io";
import { colors, spacing } from "../../../src/theme";

export default function SkillImport() {
  const { update, source, registry, slug, publisher, version } = useLocalSearchParams<{
    update?: string; source?: string; registry?: string; slug?: string; publisher?: string; version?: string;
  }>();
  const { skills } = useApp();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [candidates, setCandidates] = useState<GithubSkillCandidate[]>([]);
  const [preview, setPreview] = useState<SkillPreview>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"preview" | "confirm">();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);

  const perform = useCallback(async (action: (signal: AbortSignal) => Promise<void>, phase: "preview" | "confirm" = "preview") => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(phase);
    setFeedback("");
    try { await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setFeedback(skillErrorMessage(error)); }
    finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(undefined);
      }
    }
  }, []);

  const applyPreview = useCallback((next: SkillPreview, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (update && next.skillId !== update) throw new SkillPackageError("所选文件的技能名称与要更新的技能不一致。");
    setPreview(next);
    setCandidates([]);
  }, [update]);

  const previewFromMarket = useCallback(() => void perform(async (signal) => {
    if (update) {
      applyPreview(await skills.previewUpdate(update, signal), signal);
      return;
    }
    if (typeof registry !== "string" || !Object.hasOwn(skillRegistries, registry) || typeof slug !== "string") {
      throw new SkillPackageError("请返回技能市场重新选择技能。");
    }
    const item = { registry: registry as SkillRegistry, slug, publisher: publisher || null, version: version || null };
    applyPreview(await skills.previewRegistry(item, signal), signal);
  }), [applyPreview, perform, publisher, registry, skills, slug, update, version]);

  useEffect(() => { if (source === "registry" && !update) previewFromMarket(); }, [source, update, previewFromMarket]);

  const choose = (item: GithubSkillCandidate) => void perform(async (signal) => {
    applyPreview(await skills.previewGithub(item, signal), signal);
  });
  const fetchCandidates = () => void perform(async (signal) => {
    setCandidates([]);
    const found = await skills.github.candidates(url, signal);
    signal.throwIfAborted();
    if (found.length === 1) applyPreview(await skills.previewGithub(found[0]!, signal), signal);
    else setCandidates(found);
  });

  function confirm(item: SkillPreview) {
    void perform(async (signal) => {
      try {
        const installed = await skills.confirm(item);
        router.replace({ pathname: "/settings/skills/[skillId]", params: { skillId: installed.skill_id } });
      } catch (error) {
        if (!(error instanceof SkillConflictError)) throw error;
        setFeedback("技能已被更新，请重新预览。");
        setPreview(undefined);
        applyPreview(await skills.refreshPreview(item), signal);
      }
    }, "confirm");
  }

  function cancel() {
    pending.current?.abort();
    pending.current = null;
    setBusy(undefined);
    setPreview(undefined);
    setCandidates([]);
    setFeedback("");
  }

  return <Page title={update ? `更新 ${update}` : "添加技能"} secondary keyboard>
    {feedback && <Text accessibilityRole="alert" style={local.error}>{feedback}</Text>}
    {!preview && <>
      {source !== "github" && source !== "registry" && <Card title="本地文件">
        <Text style={styles.body}>选择 SKILL.md 或包含 SKILL.md 的 ZIP 文件。</Text>
        <Action label="选择本地文件" disabled={!!busy} onPress={() => void perform(async (signal) => {
          const file = await pickSkillFile(signal);
          if (file) applyPreview(await skills.previewLocal(file.bytes, file.kind, signal), signal);
        })} />
      </Card>}
      {source !== "local" && source !== "registry" && <Card title="公开 GitHub">
        {update ? <Action label="检查上游更新" disabled={!!busy} onPress={() => void perform(async (signal) =>
          applyPreview(await skills.previewUpdate(update, signal), signal))} /> : <>
          <TextInput accessibilityLabel="GitHub 链接" placeholder="https://github.com/…" value={url}
            onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} style={local.input} />
          <Action label="查找技能" disabled={!!busy || !url.trim()} onPress={fetchCandidates} />
        </>}
      </Card>}
      {source === "registry" && !busy && <Action label={update ? "检查上游更新" : "读取市场版本"} onPress={previewFromMarket} />}
    </>}
    {!preview && candidates.length > 1 && <Card title="选择一个技能目录">
      {candidates.map((item) => <Action key={item.originLocator}
        label={item.directory || "仓库根目录"} secondary disabled={!!busy} onPress={() => choose(item)} />)}
    </Card>}
    {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>{busy === "confirm" ? "正在保存…" : "正在读取并校验…"}</Text>}
    {preview && <Card title={preview.skillId}>
      <Text style={styles.body}>{preview.description}</Text>
      <Text style={styles.body}>{skillSourceLabel(preview.origin.origin_kind, preview.origin.origin_locator)} · {skillShortVersion(preview.revision)} · {(preview.rawBytes / 1024).toFixed(1)} KiB</Text>
      {preview.origin.source_url && <Text style={styles.body} selectable>{preview.origin.source_url}</Text>}
      {preview.origin.pinned_ref && <Text style={styles.body} selectable>{preview.origin.origin_kind === "registry" ? "发布版本" : "固定提交"} {preview.origin.pinned_ref}</Text>}
      <SkillCompatibilityInfo compatibility={preview.compatibility} />
      {preview.origin.origin_kind === "registry" && preview.compatibility.readiness === "ready" &&
        <Text style={styles.body}>移动端运行效果待验证。</Text>}
      {preview.expectedActiveRevision ? <>
        <Text style={styles.body}>当前版本 {skillShortVersion(preview.expectedActiveRevision)}</Text>
        <Text style={styles.body}>{preview.changes.added.length + preview.changes.changed.length + preview.changes.removed.length === 0
          ? "文件内容与当前版本一致。" : "文件变更"}</Text>
        {Object.entries(preview.changes).flatMap(([kind, paths]) => paths.map((path) =>
          <Text style={styles.body} key={kind + path}>{kind === "added" ? "新增" : kind === "removed" ? "移除" : "修改"} · {path}</Text>))}
      </> : <Text style={styles.body}>安装后默认停用。可在详情中启用并选择场景。</Text>}
      <Text style={styles.heading}>文件清单 · {preview.manifest.length}</Text>
      {preview.manifest.map((file) => <Text style={styles.body} key={file.path}>{file.path} · {file.bytes} B</Text>)}
      <Action label={preview.expectedActiveRevision ? "确认更新" : "确认安装"} disabled={!!busy}
        onPress={() => confirm(preview)} />
    </Card>}
    {(preview || busy === "preview" || candidates.length > 0) &&
      <Action label="取消导入" secondary disabled={busy === "confirm"} onPress={cancel} />}
  </Page>;
}

const local = StyleSheet.create({
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.sm, color: colors.text },
  error: { color: colors.danger },
});
