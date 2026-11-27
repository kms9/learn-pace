import { databaseSchemaVersion, type AppStore, type Clock, type DatabaseSnapshot, type SecretStore } from "@learn-pace/infra";
import {
  BackupError, backupCounts, canonicalJson, checkBackupSize, readBackup, type BackupDigest, type BackupEnvelope, type BackupManifest,
} from "./backup-format.js";
import { decodeModelRecord, decodeRetiredRefs, isCredentialRef, modelSetting, publicModelSettings, retiredCredentialSetting } from "./model-settings.js";
import { RecoveryService } from "./recovery.js";
import { restoreGateFor } from "./restore-gate.js";
import { decodeImaRetiredRefs, imaRetiredCredentialSetting, isImaCredentialRef } from "./extensions/knowledge/ima-credentials.js";

export interface BackupPreview {
  exportedAt: number;
  counts: BackupManifest["counts"];
  model: { baseUrl: string; model: string } | null;
  formatVersion: BackupManifest["format_version"];
}

type BackupEnvironment = { appVersion: string; sha256: BackupDigest; clock: Clock; makeId: () => string };

function portableSettings(settings: DatabaseSnapshot["settings"]): DatabaseSnapshot["settings"] {
  return settings.flatMap((setting) => {
    if (setting.name === retiredCredentialSetting || setting.name === imaRetiredCredentialSetting ||
        isCredentialRef(setting.name) || isImaCredentialRef(setting.name)) return [];
    if (setting.name !== modelSetting) return [setting];
    const model = decodeModelRecord(setting.value);
    return model ? [{ name: modelSetting, value: JSON.stringify({ ...publicModelSettings(model), credentialRef: null }) }] : [];
  });
}

export class BackupRestoreService {
  constructor(private readonly store: AppStore, private readonly secrets: SecretStore, private readonly environment: BackupEnvironment,
    private readonly afterRestore?: () => void) {}

  async exportBackup(): Promise<BackupEnvelope> {
    const snapshot = await this.store.exportSnapshot();
    const active = new Map(snapshot.skills.map(({ skill_id, active_revision }) => [skill_id, active_revision]));
    const payload = { ...snapshot, settings: portableSettings(snapshot.settings),
      skill_revisions: snapshot.skill_revisions.filter(({ skill_id, revision }) => active.get(skill_id) === revision),
      provider_connections: snapshot.provider_connections.map(connection => ({
        ...connection, status: "disconnected" as const, credential_ref: null, last_error: null,
      })) };
    const manifest: BackupManifest = { format_version: 2, app_version: this.environment.appVersion,
      schema_version: databaseSchemaVersion, exported_at: this.environment.clock.nowSeconds(), counts: backupCounts(payload),
      includes_credentials: false };
    const digest = await this.environment.sha256(canonicalJson({ manifest, payload }));
    const envelope: BackupEnvelope = { manifest, payload, integrity: { algorithm: "sha256", digest } };
    checkBackupSize(JSON.stringify(envelope));
    return envelope;
  }

  async inspectBackup(raw: string): Promise<BackupPreview> {
    const { manifest, payload } = await readBackup(raw, this.environment.sha256);
    const model = decodeModelRecord(payload.settings.find(({ name }) => name === modelSetting)?.value ?? null);
    return { exportedAt: manifest.exported_at, counts: manifest.counts, formatVersion: manifest.format_version,
      model: model && { baseUrl: model.baseUrl, model: model.model } };
  }

  async restoreBackup(raw: string): Promise<void> {
    await restoreGateFor(this.store).restore(async () => {
      try {
        const { payload } = await readBackup(raw, this.environment.sha256);
        const disabled = {
          skills: payload.skills.map((item) => ({ ...item, enabled: 0 as const })),
          skill_bindings: payload.skill_bindings.map((item) => ({ ...item, enabled: 0 as const })),
          source_bindings: payload.source_bindings.map((item) => ({ ...item, enabled: 0 as const })),
        };
        await this.store.runInTransaction(async (tx) => {
          const settings = await this.restoreSettings(tx, payload.settings);
          const imaRetired = new Set(decodeImaRetiredRefs(await tx.readSetting(imaRetiredCredentialSetting)));
          for (const { credential_ref } of await tx.listProviderConnections()) {
            if (isImaCredentialRef(credential_ref)) imaRetired.add(credential_ref);
          }
          if (imaRetired.size) settings.push({ name: imaRetiredCredentialSetting, value: JSON.stringify([...imaRetired]) });
          const recovery = new RecoveryService(tx, this.environment.clock, this.environment.makeId);
          await tx.replaceSnapshot({ ...payload, ...disabled, settings }, async (replaced) => {
            await recovery.reconcileInTransaction(replaced);
          });
        });
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError("恢复失败，原有本地数据已保留。");
      }
    });
    this.afterRestore?.();
  }

  private async restoreSettings(tx: AppStore, source: DatabaseSnapshot["settings"]): Promise<DatabaseSnapshot["settings"]> {
    const local = decodeModelRecord(await tx.readSetting(modelSetting));
    const detached = decodeRetiredRefs(await tx.readSetting(retiredCredentialSetting));
    const restored = decodeModelRecord(source.find(({ name }) => name === modelSetting)?.value ?? null);
    const settings = source.filter(({ name }) => name !== modelSetting);
    let credentialRef: string | null = null;
    if (restored && local?.credentialRef && new URL(local.baseUrl).origin === new URL(restored.baseUrl).origin &&
        (await this.secrets.getItem(local.credentialRef).catch(() => null))?.trim()) {
      credentialRef = local.credentialRef;
    }
    const retired = new Set([...detached, ...(local?.retiredCredentialRefs ?? [])]);
    if (local?.credentialRef) retired.add(local.credentialRef);
    if (credentialRef) retired.delete(credentialRef);
    const retiredCredentialRefs = [...retired];
    if (restored) {
      settings.push({ name: modelSetting, value: JSON.stringify({ ...publicModelSettings(restored), credentialRef,
        ...(retiredCredentialRefs.length && { retiredCredentialRefs }) }) });
    } else if (retiredCredentialRefs.length) {
      settings.push({ name: retiredCredentialSetting, value: JSON.stringify(retiredCredentialRefs) });
    }
    return settings;
  }
}
