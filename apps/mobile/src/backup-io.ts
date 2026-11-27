import { BackupError, maxBackupBytes, type BackupEnvelope } from "@learn-pace/app-host";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { getDocumentAsync } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

export const sha256Backup = (canonical: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, canonical);

export async function shareBackup(backup: BackupEnvelope): Promise<void> {
  if (!await isAvailableAsync()) throw new BackupError("此设备暂不可分享备份文件。");
  try {
    const stamp = new Date(backup.manifest.exported_at * 1000).toISOString().replace(/[:.]/g, "-");
    const file = new File(Paths.cache, `learn-pace-backup-${stamp}.lpbackup.json`);
    file.create({ overwrite: true });
    await file.write(JSON.stringify(backup));
    await shareAsync(file.uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: "分享 Learn Pace 备份" });
  } catch {
    throw new BackupError("无法生成或分享备份文件，请重试。");
  }
}

export async function pickBackup(): Promise<string | null> {
  try {
    const selection = await getDocumentAsync({ type: "*/*", copyToCacheDirectory: false });
    if (selection.canceled) return null;
    const [asset] = selection.assets;
    if (!asset) throw new BackupError("请选择一个备份文件。");
    const file = new File(asset.uri);
    const size = Math.max(asset.size ?? 0, file.size ?? 0);
    if (size > maxBackupBytes) throw new BackupError("备份文件超过 20 MiB。");
    if (!Number.isFinite(size) || size <= 0) throw new BackupError("无法读取备份文件大小，或文件为空。");
    return await file.text();
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("无法读取选中的备份文件，请重新选择。");
  }
}
