import { maxSkillArchiveBytes, maxSkillFileBytes, RestoreGateError, SkillConflictError, SkillPackageError } from "@learn-pace/app-host";
import { getDocumentAsync } from "expo-document-picker";
import { File, Paths } from "expo-file-system";

export async function pickSkillFile(signal?: AbortSignal) {
  const picked = await getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    signal?.throwIfAborted();
    const name = asset.name.toLowerCase();
    const kind = name.endsWith(".zip") ? "local_zip" : name === "skill.md" ? "local_file" : null;
    if (!kind) throw new SkillPackageError("请选择 SKILL.md 或 .zip 技能包。");
    const limit = kind === "local_zip" ? maxSkillArchiveBytes : maxSkillFileBytes;
    if ((asset.size ?? 0) > limit || file.size > limit) {
      throw new SkillPackageError(kind === "local_zip" ? "ZIP 文件超过 32 MiB。" : "SKILL.md 超过 512 KiB。");
    }
    const bytes = await file.bytes();
    signal?.throwIfAborted();
    return { kind, bytes } as const;
  } finally {
    if (file.uri.startsWith(Paths.cache.uri.replace(/\/$/, "") + "/")) {
      try { file.delete(); } catch { /* 缓存副本可能已被系统移除。 */ }
    }
  }
}

export function skillErrorMessage(error: unknown): string {
  if (error instanceof SkillPackageError || error instanceof SkillConflictError || error instanceof RestoreGateError) return error.message;
  return "技能操作失败，请重试。";
}
