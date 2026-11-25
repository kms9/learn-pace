import { publicPendingQuestion, type PendingInteractionView } from "@learn-pace/domain";
import { systemClock, type AppStore, type PathSummaryRecord, type SecretStore, type StoredSession } from "@learn-pace/infra";
import { loadModelConfigFromEnv, PiDurableRuntime, type ModelConfig } from "@learn-pace/runtime";
import { StudyWorkbench } from "./study-workbench.js";
import { Lf01ChatService } from "./lf01-chat.js";
import { MasterySessionService } from "./mastery/session-service.js";

const modelSetting = "deepseek-model-config";
const legacyKey = "deepseek-api-key";

export type PublicModelSettings = Omit<ModelConfig, "apiKey">;
type StoredModelSettings = PublicModelSettings & { credentialRef: string };
type ModelSettingsInput = Pick<ModelConfig, "baseUrl"> &
  Partial<Pick<ModelConfig, "model" | "reasoning" | "apiKey" | "contextWindow" | "maxTokens">>;

export interface BootstrapSnapshot {
  model: { settings: PublicModelSettings | null; configured: boolean };
  paths: PathSummaryRecord[];
  sessions: StoredSession[];
  pending: PendingInteractionView | null;
}

type ProbeResult = { ok: true; elapsedMs: number } | { ok: false; message: string };
type BootstrapTransport = { makeId: () => string; fetch?: typeof globalThis.fetch };

export class ModelSettingsError extends Error {}

function parseSettings(input: ModelSettingsInput): PublicModelSettings {
  try {
    const { apiKey: _unused, ...settings } = loadModelConfigFromEnv({
      PI_OPENAI_BASE_URL: input.baseUrl,
      PI_MODEL: input.model,
      PI_REASONING: input.reasoning ?? "high",
      PI_CONTEXT_WINDOW: input.contextWindow?.toString(),
      PI_MAX_TOKENS: input.maxTokens?.toString(),
      OPENAI_API_KEY: "validation-placeholder",
    });
    return settings;
  } catch {
    throw new ModelSettingsError("请检查网关地址和模型参数");
  }
}

function probeFailure(runtimeError: string | undefined): string {
  const status = /^DeepSeek request failed \(HTTP ([45]\d{2})\)$/.exec(runtimeError ?? "")?.[1];
  if (status === "401" || status === "403") return `网关拒绝认证（HTTP ${status}），请检查 Key 和模型权限`;
  if (status) return `网关返回 HTTP ${status}`;
  return "未收到有效模型响应，请检查网络、网关地址和模型 ID";
}

export class AppBootstrapService {
  private mastery?: MasterySessionService;
  constructor(
    private readonly store: AppStore,
    private readonly secrets: SecretStore,
    private readonly transport: BootstrapTransport,
  ) {}

  async snapshot(): Promise<BootstrapSnapshot> {
    const [model, paths, sessions, pending] = await Promise.all([
      this.modelSettings(),
      this.store.listPathSummaries(),
      this.store.listSessions(),
      this.store.getLatestOpenInteraction(),
    ]);
    return {
      model,
      paths,
      sessions,
      pending: pending && {
        interaction_id: pending.interaction_id,
        path_id: pending.path_id,
        session_id: pending.session_id,
        status: pending.status,
        updated_at: pending.updated_at,
        question: publicPendingQuestion(pending.question),
      },
    };
  }

  async readSessionHistory(sessionId: string) {
    const messages = await this.store.listMessages(sessionId);
    return messages.map(({ message_id, role, content, status }) => ({ message_id, role, content, status }));
  }

  private async readModelRecord(): Promise<StoredModelSettings | null> {
    const raw = await this.store.readSetting(modelSetting);
    if (!raw) return null;
    try {
      const input = JSON.parse(raw) as StoredModelSettings;
      const credentialRef = input.credentialRef ?? legacyKey;
      if (typeof credentialRef !== "string" ||
          !/^deepseek-api-key(?:\.[\w-]+)?$/.test(credentialRef)) return null;
      return { ...parseSettings(input), credentialRef };
    } catch {
      return null;
    }
  }

  private async modelSettings(): Promise<BootstrapSnapshot["model"]> {
    const record = await this.readModelRecord();
    if (!record) return { settings: null, configured: false };
    const { credentialRef, ...settings } = record;
    const key = await this.secrets.getItem(credentialRef).catch(() => null);
    return { settings, configured: Boolean(key?.trim()) };
  }

  private async getModelConfig(): Promise<ModelConfig | null> {
    const record = await this.readModelRecord();
    if (!record) return null;
    const { credentialRef, ...settings } = record;
    const apiKey = (await this.secrets.getItem(credentialRef))?.trim();
    return apiKey ? { ...settings, apiKey } : null;
  }

  createLf01ChatService(clock = systemClock): Lf01ChatService {
    return new Lf01ChatService(this.store, clock, this.transport.makeId, () => this.getModelConfig(), this.transport.fetch);
  }

  createMasterySessionService(clock = systemClock): MasterySessionService {
    return this.mastery ??= new MasterySessionService(
      this.store, clock, this.transport.makeId, () => this.getModelConfig(), this.transport.fetch,
    );
  }

  async saveModelSettings(input: ModelSettingsInput): Promise<void> {
    const current = await this.readModelRecord();
    const settings = parseSettings({ ...current, ...input });
    const provided = input.apiKey?.trim();

    if (!provided) {
      if (!current || new URL(current.baseUrl).origin !== new URL(settings.baseUrl).origin ||
          !(await this.secrets.getItem(current.credentialRef))?.trim()) {
        throw new ModelSettingsError("请输入目标网关的 API Key");
      }
      await this.store.writeSetting(modelSetting, JSON.stringify({ ...settings, credentialRef: current.credentialRef }));
      return;
    }

    // 配置指向独立凭据，避免顺序写入中途故障时将新 Key 配给旧网关。
    const credentialRef = `${legacyKey}.${this.transport.makeId()}`;
    await this.secrets.setItem(credentialRef, provided);
    try {
      await this.store.writeSetting(modelSetting, JSON.stringify({ ...settings, credentialRef }));
    } catch (error) {
      await this.secrets.deleteItem(credentialRef).catch(() => {});
      throw error;
    }
    if (current) await this.secrets.deleteItem(current.credentialRef).catch(() => {});
  }

  async saveImportedModelSettings(env: Record<string, string | undefined>): Promise<void> {
    const config = loadModelConfigFromEnv(env);
    await this.saveModelSettings(config);
  }

  async testModelConnection(): Promise<ProbeResult> {
    try {
      const config = await this.getModelConfig();
      if (!config) return { ok: false, message: "请先保存 DeepSeek Flash 配置" };

      const start = performance.now();
      const signal = AbortSignal.timeout(20_000);
      const runtime = new PiDurableRuntime(
        { ...config, reasoning: undefined, maxTokens: Math.min(config.maxTokens, 64) },
        undefined,
        this.transport.fetch,
      );
      let completed = false;
      let gotText = false;
      let failure: string | undefined;
      await runtime.runTurn({
        sessionId: "model-probe",
        turnId: this.transport.makeId(),
        prompt: "Reply with the single word Ready.",
        allowedTools: [],
        signal,
      }, (event) => {
        if (event.type === "text_delta") gotText ||= Boolean(event.delta.trim());
        if (event.type === "turn_completed") completed = event.stopReason === "end_turn";
        if (event.type === "turn_failed") failure = event.error;
      });
      if (completed && gotText) return { ok: true, elapsedMs: Math.round(performance.now() - start) };
      if (signal.aborted) return { ok: false, message: "连通性测试超时，请重试" };
      return { ok: false, message: probeFailure(failure) };
    } catch {
      return { ok: false, message: "无法完成连通性测试，请检查已保存的配置" };
    }
  }

  async openStudyWorkbench(): Promise<StudyWorkbench | null> {
    const config = await this.getModelConfig();
    return config && new StudyWorkbench(config, this.store, systemClock, this.transport.makeId, this.transport.fetch);
  }
}
