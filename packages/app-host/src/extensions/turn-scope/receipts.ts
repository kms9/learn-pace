import type { StoredMessage } from "@learn-pace/infra";
import { skillNamePattern, skillRevisionPattern } from "../skills/package-validator.js";

export interface SkillSelection { skillId: string; revision: string }

const modes = ["explicit", "automatic"] as const;
const statuses = ["started", "explicit_loaded", "loaded", "succeeded", "failed", "interrupted", "unknown"] as const;

export interface SkillReceipt extends SkillSelection {
  turnId: string;
  name: string;
  mode: (typeof modes)[number];
  status: (typeof statuses)[number];
  tool?: string;
  path?: string;
  errorCode?: string;
}

export function messageSkillSelection(message: StoredMessage): SkillSelection[] {
  const source = message.metadata?.skill_selection;
  if (!Array.isArray(source)) return [];
  return source.filter((item) => item && typeof item.skillId === "string" && typeof item.revision === "string");
}

export function messageSkillReceipts(message: StoredMessage): SkillReceipt[] {
  const source = message.metadata?.skill_receipts;
  if (!Array.isArray(source)) return [];
  return source.filter((item): item is SkillReceipt => item && typeof item.skillId === "string" && skillNamePattern.test(item.skillId) &&
    typeof item.revision === "string" && skillRevisionPattern.test(item.revision) && typeof item.turnId === "string" &&
    typeof item.name === "string" && modes.includes(item.mode) && statuses.includes(item.status));
}

export function finalizeTurnReceipts(metadata: StoredMessage["metadata"], status: "interrupted" | "unknown"): StoredMessage["metadata"] {
  const fields = ["skill_receipts", "knowledge_receipts"] as const;
  for (const field of fields) {
    const receipts = metadata?.[field];
    if (Array.isArray(receipts) && receipts.some(receipt => receipt?.status === "started")) {
      metadata = { ...metadata, [field]: receipts.map(receipt => receipt?.status === "started" ? { ...receipt, status } : receipt) };
    }
  }
  return metadata;
}
