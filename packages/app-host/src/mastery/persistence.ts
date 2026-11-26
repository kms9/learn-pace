import { derivePathStatus, type LearningProgress } from "@learn-pace/domain";
import { VersionConflictError, type AppStore } from "@learn-pace/infra";

export async function requireProgressVersion(tx: AppStore, base: LearningProgress): Promise<LearningProgress> {
  const current = await tx.get(base.book_id);
  if (!current || current.version !== base.version) throw new VersionConflictError();
  return current;
}

export async function saveProgress(tx: AppStore, progress: LearningProgress, now: number): Promise<void> {
  const next = { ...progress, version: progress.version + 1, updated_at: now };
  await tx.saveWithCas(next, progress.version, derivePathStatus(next));
}
