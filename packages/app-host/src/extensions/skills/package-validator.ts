import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { isMap, isScalar, parseDocument, visit } from "yaml";

export const skillEntry = "SKILL.md";
export const maxSkillFileBytes = 512 * 1024;
export const maxSkillPackageBytes = 2 * 1024 * 1024;
export const maxSkillLibraryBytes = 4 * 1024 * 1024;
export const maxSkillFiles = 100;
export const maxSkillInstructions = 24_000;
export const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const skillRevisionPattern = /^directory-sha256:[a-f0-9]{64}$/;

export type SkillPackageFiles = ReadonlyMap<string, Uint8Array>;

export interface SkillManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  kind: "text" | "script" | "binary";
}

export interface ValidatedSkillPackage {
  name: string;
  description: string;
  userInvocable: boolean;
  modelInvocable: boolean;
  compatibility: string | null;
  allowedTools: readonly string[];
  metadata: Record<string, string>;
  instructions: string;
  instructionsChars: number;
  rawBytes: number;
  revision: string;
  manifest: readonly SkillManifestFile[];
  files: SkillPackageFiles;
}

export class SkillPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillPackageError";
  }
}

const encoder = new TextEncoder();
const scriptPath = /(?:^|\/)scripts\/|\.(?:[cm]?[jt]sx?|pyw?|sh|bash|zsh|fish|rb|pl|php|lua|bat|cmd|ps1)$/i;
const textPath = /\.(?:md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|css|toml|ini|rst|adoc|log)$/i;
const concealedFile = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.ssh|id_(?:rsa|ed25519|ecdsa|dsa)|credentials(?:\.[^/]*)?)(?:\/|$)|\.(?:pem|p12|pfx|key)$/i;
const credential = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b[\s"']*[:=]\s*["']?[A-Za-z0-9_+/=-]{20,}/i;

export function decodeSkillText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function checkedSkillPath(path: string): string {
  if (!path || path.length > 512 || /[\\\u0000-\u001f\u007f]/.test(path) ||
      /^[a-z]:/i.test(path) || path.split("/").some((part) => !part || part === "." || part === "..") ||
      concealedFile.test(path)) {
    throw new SkillPackageError("包含越界、凭据或无效路径。请检查包内文件名。");
  }
  return path.normalize("NFC").toLowerCase();
}

/** Checks both full paths and common parent directories before opening files. */
export function verifySkillPaths(entries: Iterable<{ path: string; directory?: boolean }>): void {
  const seen = new Map<string, { path: string; directory: boolean; listed: boolean }>();
  for (const { path, directory = false } of entries) {
    checkedSkillPath(path);
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join("/");
      const folded = prefix.normalize("NFC").toLowerCase();
      const listed = index === parts.length;
      const isDirectory = !listed || directory;
      const previous = seen.get(folded);
      if (previous && (previous.path !== prefix || previous.directory !== isDirectory || (listed && previous.listed))) {
        throw new SkillPackageError("包内有重复路径、大小写或 Unicode 路径冲突。");
      }
      if (!previous || listed) seen.set(folded, { path: prefix, directory: isDirectory, listed });
    }
  }
}

function includesShellInterpolation(text: string): boolean {
  return text.split("\n").some((line) => {
    let open = 0;
    for (const match of line.matchAll(/`+/g)) {
      if (open === match[0].length) open = 0;
      else if (!open) {
        if (line[match.index - 1] === "!" && line.includes(match[0], match.index + match[0].length)) return true;
        open = match[0].length;
      }
    }
    return false;
  });
}

export function parseSkillEntry(text: string) {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (!/^---\s*$/.test(lines[0] ?? "") || end < 1) {
    throw new SkillPackageError("SKILL.md 必须以成对的 --- 分隔 YAML 配置。");
  }
  const invalid = new SkillPackageError("SKILL.md 的 YAML 无效，需使用唯一字符串键，且禁止标签、锚点和别名。");
  let frontmatter: Record<string, unknown>;
  try {
    const doc = parseDocument(lines.slice(1, end).join("\n"), { schema: "core", strict: true, uniqueKeys: true, stringKeys: true });
    if (!isMap(doc.contents) || doc.errors.length || doc.warnings.length) throw invalid;
    visit(doc, {
      Alias() { throw invalid; },
      Node(_key, node) { if (node.anchor || node.tag) throw invalid; },
      Pair(_key, pair) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string" || ["<<", "__proto__", "constructor", "prototype"].includes(pair.key.value)) throw invalid;
      },
    });
    frontmatter = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  } catch {
    throw invalid;
  }

  const name = frontmatter.name;
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (typeof name !== "string" || name.length > 64 || !skillNamePattern.test(name)) {
    throw new SkillPackageError("技能名称须为至多 64 个小写字母、数字和单连字符。");
  }
  if (!description || description.length > 1024) throw new SkillPackageError("技能描述必须为 1–1024 个字符。");
  if (["hooks", "context", "agent", "model"].some((key) => Object.hasOwn(frontmatter, key))) {
    throw new SkillPackageError("此技能声明了移动端不支持的执行或上下文配置。");
  }
  const explicit = frontmatter["user-invocable"];
  const automatic = frontmatter["disable-model-invocation"];
  if ([explicit, automatic].some((item) => item !== undefined && typeof item !== "boolean")) {
    throw new SkillPackageError("技能调用标志必须为 true 或 false。");
  }
  const compatibility = frontmatter.compatibility;
  if (compatibility !== undefined && (typeof compatibility !== "string" || compatibility.length > 500)) {
    throw new SkillPackageError("compatibility 必须为至多 500 字符的文本。");
  }
  const tools = frontmatter["allowed-tools"];
  if (tools !== undefined && typeof tools !== "string" &&
      !(Array.isArray(tools) && tools.every((tool) => typeof tool === "string"))) {
    throw new SkillPackageError("allowed-tools 必须为文本或工具名称列表。");
  }
  const allowedTools = (typeof tools === "string" ? [tools] : (tools as string[] | undefined) ?? [])
    .flatMap((tool) => tool.replace(/\([^)]*\)/g, " ").split(/[\s,]+/)).filter(Boolean);
  const metadata = frontmatter.metadata ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new SkillPackageError("metadata 必须为字符串键值对。");
  }
  const metadataEntries = Object.entries(metadata).map(([key, value]) => {
    if (typeof value === "string") return [key, value];
    if ((key === "openclaw" || key === "clawdbot") && value && typeof value === "object" && !Array.isArray(value)) {
      return [key, JSON.stringify(value)];
    }
    throw new SkillPackageError("metadata 必须为字符串键值对，或声明可识别的 OpenClaw 平台需求。");
  });
  const instructions = lines.slice(end + 1).join("\n").trim();
  const instructionsChars = Array.from(instructions).length;
  if (instructionsChars > maxSkillInstructions) throw new SkillPackageError("SKILL.md 正文超过 24,000 字符。");
  return { name, description, instructions, instructionsChars, compatibility: compatibility?.trim() || null,
    allowedTools: [...new Set(allowedTools)], metadata: Object.fromEntries(metadataEntries) as Record<string, string>,
    userInvocable: explicit !== false, modelInvocable: automatic !== true };
}

export async function yieldSkillWork(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}

function hashChunk(hash: ReturnType<typeof sha256.create>, value: string | Uint8Array): void {
  hash.update(typeof value === "string" ? encoder.encode(value) : value);
}

async function hashDirectory(files: SkillPackageFiles, signal?: AbortSignal) {
  // Cherry 的目录摘要使用按名称排序的深度优先遍历，保留原始 UTF-8 路径和字节。
  const children = new Map<string, Set<string>>([["", new Set()]]);
  for (const path of files.keys()) {
    const segments = path.split("/");
    let parent = "";
    for (const segment of segments) {
      const current = parent ? parent + "/" + segment : segment;
      children.get(parent)!.add(current);
      if (!files.has(current) && !children.has(current)) children.set(current, new Set());
      parent = current;
    }
  }
  const directoryHash = sha256.create();
  const digests = new Map<string, string>();
  let sinceYield = 0;
  async function visitDirectory(parent: string): Promise<void> {
    for (const path of [...children.get(parent)!].sort()) {
      signal?.throwIfAborted();
      const pathBytes = encoder.encode(path);
      const bytes = files.get(path);
      hashChunk(directoryHash, `${bytes ? "F" : "D"}:${pathBytes.length}:`);
      hashChunk(directoryHash, pathBytes);
      if (!bytes) {
        await visitDirectory(path);
        continue;
      }
      hashChunk(directoryHash, `:${bytes.length}:`);
      const fileHash = sha256.create();
      for (let offset = 0; offset < bytes.length; offset += 32 * 1024) {
        const chunk = bytes.subarray(offset, offset + 32 * 1024);
        fileHash.update(chunk);
        directoryHash.update(chunk);
        sinceYield += chunk.length;
        if (sinceYield >= 128 * 1024) {
          await yieldSkillWork(signal);
          sinceYield = 0;
        }
      }
      digests.set(path, bytesToHex(fileHash.digest()));
    }
  }
  await visitDirectory("");
  return { revision: "directory-sha256:" + bytesToHex(directoryHash.digest()), digests };
}

export async function validateSkillPackage(input: SkillPackageFiles, signal?: AbortSignal): Promise<ValidatedSkillPackage> {
  signal?.throwIfAborted();
  if (input.size > maxSkillFiles) throw new SkillPackageError("技能包最多包含 100 个文件。");
  verifySkillPaths([...input.keys()].map((path) => ({ path })));
  let rawBytes = 0;
  const files = new Map<string, Uint8Array>();
  const kinds = new Map<string, SkillManifestFile["kind"]>();
  for (const [path, bytes] of input) {
    if (!(bytes instanceof Uint8Array) || bytes.length > maxSkillFileBytes) {
      throw new SkillPackageError(`文件 ${path} 超过 512 KiB 或内容无效。`);
    }
    rawBytes += bytes.length;
    if (rawBytes > maxSkillPackageBytes) throw new SkillPackageError("技能包的原始文件总量超过 2 MiB。");
    const text = decodeSkillText(bytes);
    if (text && credential.test(text)) throw new SkillPackageError("检测到疑似硬编码密钥。移除密钥后重新导入。");
    if (text && includesShellInterpolation(text)) throw new SkillPackageError("技能包包含 Shell 插值，请移除后重新导入。");
    const script = scriptPath.test(path) || text?.startsWith("#!");
    kinds.set(path, script ? "script" : text !== null && !text.includes("\0") && textPath.test(path) ? "text" : "binary");
    files.set(path, new Uint8Array(bytes));
  }
  const entry = files.get(skillEntry);
  const text = entry && decodeSkillText(entry);
  if (!text || kinds.get(skillEntry) !== "text") throw new SkillPackageError("技能包必须包含 UTF-8 编码的 SKILL.md。");
  const parsed = parseSkillEntry(text);
  const { revision, digests } = await hashDirectory(files, signal);
  const manifest = [...files.keys()].sort().map((path) => ({
    path, bytes: files.get(path)!.length, sha256: digests.get(path)!, kind: kinds.get(path)!,
  }));
  return { ...parsed, revision, manifest, rawBytes, files };
}
