import type { StoredSkill, StoredSkillRevision } from "@learn-pace/infra";
import type { SkillDeclarations } from "./compatibility.js";
import { maxSkillFileBytes, SkillPackageError, type SkillManifestFile, type SkillPackageFiles } from "./package-validator.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const invalid = () => new SkillPackageError("技能包的存储内容无效。");

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    encoded += alphabet[first >> 2]! + alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]!;
    encoded += second === undefined ? "=" : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]!;
    encoded += third === undefined ? "=" : alphabet[third & 63]!;
    if (encoded.length >= 8192) {
      chunks.push(encoded);
      encoded = "";
    }
  }
  return chunks.join("") + encoded;
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(maxSkillFileBytes / 3) * 4 ||
      value.length % 4 || /[^a-z0-9+/=]/i.test(value) || /=.*[^=]/.test(value) || /={3}/.test(value)) throw invalid();
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const size = value.length / 4 * 3 - padding;
  if (size > maxSkillFileBytes) throw invalid();
  const bytes = new Uint8Array(size);
  for (let offset = 0, index = 0; offset < value.length; offset += 4) {
    const first = alphabet.indexOf(value[offset]!);
    const second = alphabet.indexOf(value[offset + 1]!);
    const third = alphabet.indexOf(value[offset + 2]!);
    const fourth = alphabet.indexOf(value[offset + 3]!);
    bytes[index++] = (first << 2) | (second >> 4);
    if (index < size) bytes[index++] = (second << 4) | (third >> 2);
    if (index < size) bytes[index++] = (third << 6) | fourth;
  }
  if (padding === 1 && (alphabet.indexOf(value.at(-2)!) & 3) ||
      padding === 2 && (alphabet.indexOf(value.at(-3)!) & 15)) throw invalid();
  return bytes;
}

function readRecord(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  return parsed as Record<string, unknown>;
}

export function encodeSkillFiles(files: SkillPackageFiles): string {
  return JSON.stringify(Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, bytes]) => [path, encodeBase64(bytes)])));
}

export function decodeSkillFiles(revision: StoredSkillRevision): Map<string, Uint8Array> {
  return new Map(Object.entries(readRecord(revision.files_json_base64)).map(([path, value]) => [path, decodeBase64(value)]));
}

export function readSkillFileBytes(revision: StoredSkillRevision, path: string): Uint8Array | null {
  const files = readRecord(revision.files_json_base64);
  return Object.hasOwn(files, path) ? decodeBase64(files[path]) : null;
}

export function readSkillManifest(raw: string): SkillManifestFile[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item.path === "string" &&
    typeof item.bytes === "number" && Number.isSafeInteger(item.bytes) && item.bytes >= 0 &&
    typeof item.sha256 === "string" && /^[a-f0-9]{64}$/.test(item.sha256) &&
    ["text", "script", "binary"].includes(item.kind))) throw invalid();
  return parsed as SkillManifestFile[];
}

export function readSkillDeclarations(skill: StoredSkill): SkillDeclarations {
  const { allowedTools, compatibility } = readRecord(skill.compatibility_json);
  const metadata = readRecord(skill.metadata_json);
  if (!Array.isArray(allowedTools) || !allowedTools.every((item) => typeof item === "string") ||
      (compatibility !== null && typeof compatibility !== "string") ||
      !Object.values(metadata).every((item) => typeof item === "string")) throw invalid();
  return { allowedTools, compatibility, metadata: metadata as Record<string, string> };
}
