import {
  checkedSkillPath, decodeSkillText, maxSkillFileBytes, maxSkillFiles, maxSkillPackageBytes,
  SkillPackageError, skillEntry, verifySkillPaths,
} from "./package-validator.js";

const commitPattern = /^[a-f0-9]{40}$/;
type FileInfo = { path: string; size: number };
export interface GithubSkillCandidate {
  owner: string;
  repo: string;
  directory: string;
  sourceUrl: string;
  originLocator: string;
  pinnedRef: string;
  files: readonly FileInfo[];
}

interface GithubLocation {
  owner: string;
  repo: string;
  kind: "root" | "tree" | "blob";
  segments: string[];
}

function invalidUrl() {
  return new SkillPackageError("请输入公开 GitHub 仓库、tree 目录或 SKILL.md 文件链接。");
}

function parseGitHubUrl(input: string): GithubLocation {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)(?:\/(tree|blob)\/(.+?))?\/?$/i.exec(input.trim());
  if (!match) throw invalidUrl();
  const [, owner = "", repo = "", rawKind, tail] = match;
  const kind = rawKind?.toLowerCase() as GithubLocation["kind"] | undefined;
  if (repo === "." || repo === "..") throw invalidUrl();
  let segments: string[];
  try {
    segments = tail?.split("/").map(decodeURIComponent) ?? [];
  } catch {
    throw invalidUrl();
  }
  if (segments.some((part) => !part || part === "." || part === ".." || /[\\?#\u0000-\u001f\u007f]/.test(part)) ||
      (kind === "blob" && segments.at(-1) !== skillEntry)) throw invalidUrl();
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase(), kind: kind ?? "root", segments };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SkillPackageError("GitHub 返回的响应格式无效。");
  return value as Record<string, unknown>;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

class GithubNotFound extends SkillPackageError {}

export class GithubSkillSource {
  constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}

  private async read(url: string, max: number, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetch(url, { signal, credentials: "omit", redirect: "error", headers: { Accept: "*/*" } });
    } catch {
      signal?.throwIfAborted();
      throw new SkillPackageError("无法连接 GitHub，请检查网络后重试。");
    }
    if (response.status === 403 || response.status === 429) {
      throw new SkillPackageError("GitHub 匿名请求已限流，请稍后重试或改用本地 ZIP。");
    }
    if (response.status === 404 || response.status === 401) throw new GithubNotFound("GitHub 公开仓库、版本或文件不存在。");
    if (!response.ok || response.redirected || !response.body) throw new SkillPackageError("GitHub 返回了无法读取的响应。");
    const tooLarge = () => new SkillPackageError("GitHub 响应超过读取上限，请改用有效的本地 ZIP。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let finished = false;
    const cancelled = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", cancelled, { once: true });
    try {
      signal?.throwIfAborted();
      if (Number(response.headers.get("content-length")) > max) throw tooLarge();
      for (;;) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) { finished = true; break; }
        length += value.length;
        if (length > max) throw tooLarge();
        chunks.push(value);
      }
    } finally {
      signal?.removeEventListener("abort", cancelled);
      if (!finished) cancelled();
      reader.releaseLock();
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  private async json(path: string, max: number, signal?: AbortSignal) {
    const bytes = await this.read("https://api.github.com" + path, max, signal);
    try {
      return record(JSON.parse(decodeSkillText(bytes) ?? ""));
    } catch {
      throw new SkillPackageError("GitHub 返回的响应格式无效。");
    }
  }

  async candidates(url: string, signal?: AbortSignal): Promise<GithubSkillCandidate[]> {
    const { owner, repo, kind, segments } = parseGitHubUrl(url);
    const repoPath = `/repos/${owner}/${repo}`;
    const info = await this.json(repoPath, 256 * 1024, signal);
    if (info.private !== false || typeof info.default_branch !== "string") {
      throw new SkillPackageError("仅支持公开的 GitHub 仓库。");
    }
    const commit = async (ref: string) => {
      const body = await this.json(`${repoPath}/commits/${encodeURIComponent(ref)}`, 256 * 1024, signal);
      const tree = record(record(body.commit).tree).sha;
      if (typeof body.sha !== "string" || !commitPattern.test(body.sha) ||
          typeof tree !== "string" || !commitPattern.test(tree)) throw new SkillPackageError("GitHub 未返回有效的固定提交。");
      return { sha: body.sha, tree, ref };
    };

    let pinned;
    let prefix = "";
    if (kind === "root") {
      pinned = await commit(info.default_branch);
    } else {
      const paths = kind === "blob" ? segments.slice(0, -1) : segments;
      if (paths.length === 0) throw invalidUrl();
      // 标准 URL 的 ref 段可编码斜杠。未编码时先尝试常见的单段分支，再逐步延长。
      for (let end = 1; end <= paths.length; end++) {
        if (paths.slice(end).some((segment) => segment.includes("/"))) continue;
        try {
          pinned = await commit(paths.slice(0, end).join("/"));
          prefix = paths.slice(end).join("/");
          if (prefix) checkedSkillPath(prefix);
          break;
        } catch (error) {
          if (!(error instanceof GithubNotFound)) throw error;
        }
      }
      if (!pinned) throw new GithubNotFound("找不到该公开 GitHub 分支或版本。");
    }
    const result = await this.json(`${repoPath}/git/trees/${pinned.tree}?recursive=1`, 8 * 1024 * 1024, signal);
    if (result.truncated === true || !Array.isArray(result.tree)) {
      throw new SkillPackageError("GitHub 仓库目录无法完整读取。请改用本地 ZIP。");
    }
    const entries = result.tree.map(record);
    const possibleDirs = new Set<string>();
    for (const entry of entries) {
      if (typeof entry.path !== "string" || entry.type !== "blob" || !entry.path.endsWith("/" + skillEntry) && entry.path !== skillEntry) continue;
      const dir = entry.path.slice(0, Math.max(0, entry.path.length - skillEntry.length - 1));
      if (kind === "blob" ? dir === prefix : !prefix || dir === prefix || dir.startsWith(prefix + "/")) possibleDirs.add(dir);
    }
    if (possibleDirs.size === 0) throw new SkillPackageError("该 GitHub 范围内未找到 SKILL.md。");
    let invalid: SkillPackageError | undefined;
    const candidates: GithubSkillCandidate[] = [];
    for (const directory of [...possibleDirs].sort()) {
      signal?.throwIfAborted();
      try {
        const folder = directory ? directory + "/" : "";
        const path = folder + skillEntry;
        let raw = 0;
        const files: FileInfo[] = [];
        const selectedEntries: { path: string; directory?: boolean }[] = [];
        // 打开候选时重验实际下载字节。
        for (const item of entries) {
          if (typeof item.path !== "string" || !item.path.startsWith(folder) || item.path === directory) continue;
          const relative = item.path.slice(folder.length);
          if (item.type === "tree") {
            selectedEntries.push({ path: relative, directory: true });
            continue;
          }
          if (item.type !== "blob" || (item.mode !== "100644" && item.mode !== "100755")) {
            throw new SkillPackageError("GitHub 技能目录含链接或子模块。");
          }
          const size = item.size;
          if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > maxSkillFileBytes) {
            throw new SkillPackageError("GitHub 技能目录中的文件超过 512 KiB 或大小无效。");
          }
          raw += size;
          files.push({ path: relative, size });
          selectedEntries.push({ path: relative });
          if (files.length > maxSkillFiles || raw > maxSkillPackageBytes) {
            throw new SkillPackageError("GitHub 技能目录超过 100 个文件或 2 MiB。");
          }
        }
        verifySkillPaths(selectedEntries);
        candidates.push({
          owner, repo, directory, pinnedRef: pinned.sha, files,
          originLocator: `github:${owner}/${repo}/${directory}`,
          sourceUrl: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(pinned.ref)}/${encodePath(path)}`,
        });
      } catch (error) {
        if (!(error instanceof SkillPackageError)) throw error;
        invalid ??= error;
      }
    }
    if (!candidates.length && invalid) throw invalid;
    return candidates;
  }

  async acquire(candidate: GithubSkillCandidate, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
    const { owner, repo, directory, pinnedRef, files } = candidate;
    if (!/^[a-z0-9-]+$/.test(owner) || !/^[a-z0-9_.-]+$/.test(repo) || repo === "." || repo === ".." ||
        !commitPattern.test(pinnedRef)) throw invalidUrl();
    if (directory) checkedSkillPath(directory);
    if (files.length > maxSkillFiles) throw new SkillPackageError("GitHub 技能包超过 100 个文件。");
    verifySkillPaths(files);
    const contents = new Map<string, Uint8Array>();
    let total = 0;
    for (const { path, size } of files) {
      const absolute = directory ? directory + "/" + path : path;
      const data = await this.read(
        `https://raw.githubusercontent.com/${owner}/${repo}/${pinnedRef}/${encodePath(absolute)}`,
        maxSkillFileBytes, signal);
      total += data.length;
      if (total > maxSkillPackageBytes || data.length !== size) throw new SkillPackageError("GitHub 文件字节与固定提交不一致或超过上限。");
      contents.set(path, data);
    }
    return contents;
  }
}
