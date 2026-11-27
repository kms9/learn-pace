import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { GithubSkillSource } from "./github-source.js";
import {
  checkedSkillPath, decodeSkillText, maxSkillFileBytes, maxSkillFiles, maxSkillPackageBytes,
  SkillPackageError, skillEntry, validateSkillPackage, verifySkillPaths,
} from "./package-validator.js";
import { readSkillZip } from "./zip-reader.js";
import {
  registryPublisherPattern, registrySlugPattern, skillRegistries, validRegistryVersion,
  type RegistryIdentity, type SkillRegistry,
} from "./registry-origin.js";

type ObjectValue = Record<string, unknown>;
type ArtifactFile = { path: string; size: number; sha256: string };

export interface RegistrySkill {
  registry: SkillRegistry;
  slug: string;
  publisher: string | null;
  title: string;
  summary: string;
  version: string | null;
}

export interface RegistrySkillPage {
  skills: RegistrySkill[];
  next: string | null;
}

export interface RegistryVersion extends RegistryIdentity {
  version: string;
}

const pageSize = 25;
const maxMetadataBytes = 2 * 1024 * 1024;
const maxArchiveBytes = 3 * 1024 * 1024;
const skillHubDownloadOrigin = "https://skillhub-1388575217.cos.accelerate.myqcloud.com";

function badResponse() {
  return new SkillPackageError("技能市场返回的包信息无效或已变化，请刷新后重试。");
}

function checkRequestSignal(signal: AbortSignal): void {
  if (signal.aborted && signal.reason?.name === "TimeoutError") {
    throw new SkillPackageError("连接技能市场超时，请重试。");
  }
  signal.throwIfAborted();
}

function row(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}

function publisher(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.toLowerCase();
  return registryPublisherPattern.test(handle) ? handle : null;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function artifactFiles(value: unknown): ArtifactFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxSkillFiles) throw badResponse();
  let total = 0;
  const files = value.map((value) => {
    const { path, size, sha256 } = row(value);
    if (typeof path !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) ||
        size < 0 || size > maxSkillFileBytes || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) throw badResponse();
    total += size;
    return { path, size, sha256: sha256.toLowerCase() };
  });
  verifySkillPaths(files);
  if (total > maxSkillPackageBytes || !files.some(({ path }) => path === skillEntry)) throw badResponse();
  return files;
}

async function readBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw badResponse();
  const chunks: Uint8Array[] = [];
  const tooLarge = () => new SkillPackageError("技能市场响应超过读取上限。");
  let total = 0;
  let done = false;
  try {
    if (Number(response.headers.get("content-length")) > maxBytes) throw tooLarge();
    for (;;) {
      checkRequestSignal(signal);
      const chunk = await reader.read();
      if (chunk.done) { done = true; break; }
      total += chunk.value.length;
      if (total > maxBytes) throw tooLarge();
      chunks.push(chunk.value);
    }
  } catch (error) {
    checkRequestSignal(signal);
    throw error;
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function parseJson(bytes: Uint8Array): ObjectValue {
  try {
    const result: unknown = JSON.parse(decodeSkillText(bytes) ?? "");
    if (result && typeof result === "object" && !Array.isArray(result)) return row(result);
  } catch { /* 使用统一的市场响应错误。 */ }
  throw badResponse();
}

export class RegistrySkillSource {
  constructor(private readonly fetch: typeof globalThis.fetch, private readonly github: GithubSkillSource) {}

  async browse(registry: SkillRegistry, input: string, cursor: string | null, signal?: AbortSignal): Promise<RegistrySkillPage> {
    const query = input.trim().slice(0, 160);
    const api = skillRegistries[registry].api;
    const limit = String(pageSize);
    const params = new URLSearchParams();
    let path: string;
    if (registry === "skillhub") {
      path = "/api/skills";
      params.set("pageSize", limit);
      params.set("page", cursor && /^\d{1,6}$/.test(cursor) ? cursor : "1");
      if (query) params.set("keyword", query);
    } else {
      path = query ? "/api/v1/search" : "/api/v1/skills";
      params.set("limit", limit);
      if (query) params.set("q", query);
      else if (cursor) params.set("cursor", cursor);
    }
    const result = await this.json(api + path + "?" + params, signal);
    const data = row(result.data);
    const items = result.results ?? result.skills ?? result.items ?? data.skills;
    if (!Array.isArray(items)) throw badResponse();
    const skills = items.slice(0, pageSize).flatMap((value): RegistrySkill[] => {
      const entry = row(value);
      if (typeof entry.slug !== "string" || !registrySlugPattern.test(entry.slug)) return [];
      const version = entry.version ?? row(entry.latestVersion).version;
      return [{
        registry, slug: entry.slug, publisher: publisher(entry.ownerHandle ?? row(entry.owner).handle),
        title: text(entry.displayName ?? entry.name, 160) || entry.slug,
        summary: text(entry.summary_zh || entry.summary || entry.description, 540),
        version: validRegistryVersion(version) ? version : null,
      }];
    });
    const page = Number(params.get("page") ?? "1");
    const next = registry === "skillhub"
      ? typeof data.total === "number" && items.length > 0 && page * pageSize < data.total ? String(page + 1) : null
      : !query && typeof result.nextCursor === "string" && result.nextCursor.length <= 1024 && result.nextCursor !== cursor
        ? result.nextCursor : null;
    return { skills, next };
  }

  async resolve(skill: Pick<RegistrySkill, "registry" | "slug" | "publisher" | "version">, signal?: AbortSignal): Promise<RegistryVersion> {
    const { registry, slug } = skill;
    if (!registrySlugPattern.test(slug) || (skill.publisher !== null && !registryPublisherPattern.test(skill.publisher)) ||
        (skill.version !== null && !validRegistryVersion(skill.version))) throw badResponse();
    const api = skillRegistries[registry].api;
    const owner = new URLSearchParams();
    if (skill.publisher && registry !== "skillhub") owner.set("ownerHandle", skill.publisher);
    const result = await this.json(api + "/api/v1/skills/" + slug + "?" + owner, signal);
    const info = row(result.skill);
    const handle = publisher(row(result.owner).handle ?? info.ownerHandle);
    const version = skill.version ?? row(result.latestVersion).version;
    if (info.slug !== slug || !handle || (skill.publisher && skill.publisher !== handle) || !validRegistryVersion(version)) {
      throw new SkillPackageError("无法确认该技能的发布者或固定版本。请刷新市场后重试。");
    }
    const moderation = row(result.moderation ?? info.moderation);
    if (moderation.isMalwareBlocked === true || moderation.isSuspicious === true) {
      throw new SkillPackageError("此技能被来源市场标记为不安全。");
    }
    return { registry, slug, publisher: handle, version };
  }

  async acquire(ref: RegistryVersion, signal?: AbortSignal) {
    const { registry, publisher, slug, version } = ref;
    const request = signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
    const api = skillRegistries[registry].api;
    const params = new URLSearchParams({ version });
    if (registry !== "skillhub") params.set("ownerHandle", publisher);
    const skillPath = api + "/api/v1/skills/" + slug;
    const path = registry === "skillhub" ? "/files" : "/verify";
    const info = await this.json(skillPath + path + "?" + params, request);
    if (info.version !== version) throw badResponse();
    if (registry !== "skillhub") {
      if (info.ok !== true || info.decision !== "pass") {
        throw new SkillPackageError("此版本未通过来源市场的安全验证。");
      }
      if (info.slug !== slug || String(info.publisherHandle).toLowerCase() !== publisher) throw badResponse();
    }
    const manifest = artifactFiles(registry === "skillhub" ? info.files : row(info.artifact).files);
    params.set("slug", slug);
    const url = api + "/api/v1/download?" + params;
    const archive = registry === "skillhub" ? await this.skillHubArchive(url, request) : await this.get(url, request);
    const bytes = await readBytes(archive, maxArchiveBytes, request);
    const contentType = archive.headers.get("content-type")?.split(";")[0];
    const files = registry === "clawhub" && contentType === "application/json"
      ? await this.githubHandoff(parseJson(bytes), request)
      : await readSkillZip(bytes, request);
    // 注册表生成的元数据不是用户技能资源，除非它本身属于同版本清单。
    if (!manifest.some(({ path }) => path === "_meta.json")) files.delete("_meta.json");
    const card = row(info.card);
    const generatedCard = files.get("skill-card.md");
    if (generatedCard && !manifest.some(({ path }) => path === "skill-card.md") && registry === "clawhub") {
      if (card.path !== "skill-card.md" || card.size !== generatedCard.length ||
          card.sha256 !== bytesToHex(sha256(generatedCard))) throw badResponse();
      files.delete("skill-card.md");
    }
    const pack = await validateSkillPackage(files, request);
    const downloaded = new Map(pack.manifest.map((entry) => [entry.path, entry]));
    if (downloaded.size !== manifest.length || manifest.some(({ path, size, sha256 }) => {
      const actual = downloaded.get(path);
      return !actual || actual.bytes !== size || actual.sha256 !== sha256;
    })) throw new SkillPackageError("下载文件与市场版本的完整性清单不一致。");
    return pack;
  }

  private async githubHandoff(value: ObjectValue, signal: AbortSignal): Promise<Map<string, Uint8Array>> {
    const { sourceRef, repo, commit, path } = value;
    if (sourceRef !== "public-github" || typeof repo !== "string" || typeof commit !== "string" ||
        !/^[a-f0-9]{40}$/.test(commit) || typeof path !== "string") throw badResponse();
    const repository = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)$/.exec(repo);
    if (!repository) throw badResponse();
    if (path) checkedSkillPath(path);
    const isEntry = path === skillEntry || path.endsWith("/" + skillEntry);
    const directory = isEntry ? path.slice(0, Math.max(0, path.length - skillEntry.length - 1)) : path;
    const entry = directory ? directory + "/" + skillEntry : skillEntry;
    const url = "https://github.com/" + repository[1] + "/blob/" + commit + "/" + entry.split("/").map(encodeURIComponent).join("/");
    const [candidate] = await this.github.candidates(url, signal);
    if (!candidate || candidate.pinnedRef !== commit || candidate.directory !== directory) throw badResponse();
    return this.github.acquire(candidate, signal);
  }

  private async skillHubArchive(url: string, signal: AbortSignal): Promise<Response> {
    const first = await this.get(url, signal, true);
    if (first.status !== 302) return first;
    const location = first.headers.get("location");
    await first.body?.cancel();
    let target: URL;
    try { target = new URL(location ?? ""); }
    catch { throw badResponse(); }
    if (target.origin !== skillHubDownloadOrigin || target.username || target.password) {
      throw new SkillPackageError("SkillHub 下载跳转到未识别的地址，请稍后重试。");
    }
    return this.get(target.toString(), signal);
  }

  private async json(url: string, signal?: AbortSignal): Promise<ObjectValue> {
    const request = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    return parseJson(await readBytes(await this.get(url, request), maxMetadataBytes, request));
  }

  private async get(url: string, signal: AbortSignal, allowSkillHubRedirect = false): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(url, { signal, credentials: "omit", redirect: allowSkillHubRedirect ? "manual" : "error" });
    } catch {
      checkRequestSignal(signal);
      throw new SkillPackageError("无法连接技能市场，请检查网络后重试。");
    }
    // Expo (Android) also marks an unfollowed manual redirect as redirected.
    if (allowSkillHubRedirect && response.status === 302) return response;
    if (!response.redirected && response.ok) return response;
    await response.body?.cancel();
    if (response.status === 429) throw new SkillPackageError("技能市场请求过多，请稍后重试。");
    if (response.status === 409) throw new SkillPackageError("该技能有多个发布者，请在市场中重新选择。");
    if (response.status === 404 || response.status === 410) throw new SkillPackageError("此技能或版本已不可用。");
    throw new SkillPackageError("技能市场暂时无法提供该内容，请稍后重试。");
  }
}
