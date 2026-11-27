import { createHash } from "node:crypto";
import { MemoryAppStore, MemorySecretStore } from "@learn-pace/infra";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { AppBootstrapService, SkillService, type RegistrySkill } from "../index.js";
import { canonicalJson } from "../backup-format.js";

const slug = "study-coach";
const publisher = "teacher";
const version = "1.0.0";
const entry = "SKILL.md";
const skillMd = "---\nname: study-coach\ndescription: Explain one concept at a time.\n---\nTeach with questions.";
const bytes = (text: string) => new TextEncoder().encode(text);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const archive = (resources: Record<string, string>) =>
  new Response(zipSync(Object.fromEntries(Object.entries(resources).map(([path, text]) => [path, bytes(text)]))).buffer as ArrayBuffer);
const artifact = (path: string, content: string) => ({ path, size: bytes(content).length, sha256: digest(content) });
const missing = () => new Response(null, { status: 404 });

type Fixture = {
  latest: string;
  content: string;
  owner: string;
  verified: boolean;
  artifactContent?: string;
  extra?: Record<string, string>;
  redirect?: string;
  card?: string;
  handoff?: Record<string, string>;
};

function harness(meta: Partial<Fixture> = {}) {
  const fixture: Fixture = { latest: version, owner: publisher, content: skillMd, verified: true, ...meta };
  const store = new MemoryAppStore();
  const clock = { nowSeconds: () => 1 };
  const fetch = vi.fn<typeof globalThis.fetch>(async (address) => {
    const url = new URL(String(address));
    const path = url.pathname;
    const targetVersion = url.searchParams.get("version") ?? fixture.latest;
    const files = [artifact(entry, fixture.artifactContent ?? fixture.content)];
    if (url.hostname === "api.github.com") {
      if (path.includes("/commits/")) return Response.json({ sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } });
      if (path.includes("/git/trees/")) return Response.json({ tree: [
        { path: "skills/demo/SKILL.md", type: "blob", mode: "100644", size: bytes(fixture.content).length },
      ] });
      return Response.json({ private: false, default_branch: "main" });
    }
    if (url.hostname === "raw.githubusercontent.com") return new Response(fixture.content);
    if (url.hostname === "skillhub-1388575217.cos.accelerate.myqcloud.com") return archive({ [entry]: fixture.content });
    if (path.endsWith("/search")) return Response.json({ results: [
      { slug, ownerHandle: fixture.owner, displayName: "Study Coach", version: fixture.latest },
    ] });
    if (path === "/api/v1/skills") return Response.json({ skills: [
      { slug, ownerHandle: fixture.owner, displayName: "Study Coach", version: fixture.latest },
    ] });
    if (path === "/api/skills") return Response.json({ data: { total: 30, skills: [{ slug, version: fixture.latest }] } });
    if (path.endsWith("/verify")) return Response.json({
      version: targetVersion, slug, publisherHandle: fixture.owner, ok: fixture.verified, decision: fixture.verified ? "pass" : "block",
      artifact: { files }, ...(fixture.card && { card: artifact("skill-card.md", fixture.card) }),
    });
    if (path.endsWith("/files")) return Response.json({ version: targetVersion, files });
    if (path.endsWith("/" + slug)) return Response.json({ skill: { slug }, owner: { handle: fixture.owner },
      latestVersion: { version: fixture.latest } });
    if (path.endsWith("/download")) {
      if (fixture.redirect) {
        const response = new Response(null, { status: 302, headers: { Location: fixture.redirect } });
        Object.defineProperty(response, "redirected", { value: true });
        return response;
      }
      if (fixture.handoff) return Response.json(fixture.handoff);
      return archive({ [entry]: fixture.content, "_meta.json": "{}", ...fixture.extra });
    }
    return missing();
  });
  const service = new SkillService(store, clock, () => false, fetch);
  const item: RegistrySkill = { registry: "eduhub", slug, publisher, version, title: slug, summary: "" };
  return { clock, store, service, item, fixture, fetch };
}

it("browses EduHub and pins its install and update to the original publisher", async () => {
  const { store, service, item, fixture, fetch } = harness();
  expect(await service.registry.browse("eduhub", "", null)).toMatchObject({ skills: [{ publisher, slug, version }] });
  expect(await service.registry.browse("eduhub", "study tips", null)).toMatchObject({ skills: [{ publisher, slug }] });
  const preview = await service.previewRegistry(item);
  expect(await store.listSkills()).toEqual([]);
  expect(await service.confirm(preview)).toMatchObject({
    origin_kind: "registry", origin_locator: "eduhub:teacher/study-coach", pinned_ref: version, enabled: 0,
  });
  expect((await service.detail(slug))?.scopes).toEqual({ lf01: false, little_tutor: false });
  fixture.content = skillMd + " Give feedback.";
  await expect(service.previewUpdate(slug)).rejects.toThrow("固定版本");
  fixture.latest = "1.1.0";
  const update = await service.previewUpdate(slug);
  expect(update.changes.changed).toEqual([entry]);
  expect((await service.confirm(update)).pinned_ref).toBe("1.1.0");
  const calls = fetch.mock.calls.map(([address]) => new URL(String(address)));
  expect(calls.some((url) => url.pathname.endsWith("/search") && url.searchParams.get("q") === "study tips")).toBe(true);
  expect(calls.filter((url) => url.pathname.endsWith("/download")).every((url) => url.searchParams.get("ownerHandle") === publisher)).toBe(true);
});

it("rejects an unexpected owner, a blocked version and bytes outside the manifest", async () => {
  const { service, store, item, fixture, fetch } = harness({ owner: "another-author" });
  await expect(service.previewRegistry(item)).rejects.toThrow("发布者");
  fixture.owner = publisher;
  fixture.verified = false;
  await expect(service.previewRegistry(item)).rejects.toThrow("未通过");
  expect(fetch.mock.calls.some(([address]) => new URL(String(address)).pathname.endsWith("/download"))).toBe(false);
  fixture.verified = true;
  fixture.artifactContent = skillMd + " changed";
  await expect(service.previewRegistry(item)).rejects.toThrow("完整性清单");
  fixture.artifactContent = skillMd;
  fixture.extra = { "references/extra.md": "Another file" };
  await expect(service.previewRegistry(item)).rejects.toThrow("完整性清单");
  expect(await store.listSkills()).toEqual([]);
});

it("accepts the documented SkillHub object storage hop only", async () => {
  const { service, item, fixture, fetch } = harness({ redirect: "https://other.example/package" });
  const selected = { ...item, registry: "skillhub" as const, publisher: null };
  expect(await service.registry.browse("skillhub", "", null)).toMatchObject({ next: "2", skills: [{ slug }] });
  await expect(service.previewRegistry(selected)).rejects.toThrow("未识别的地址");
  expect(fetch.mock.calls.some(([address]) => new URL(String(address)).hostname === "other.example")).toBe(false);
  fixture.redirect = "https://skillhub-1388575217.cos.accelerate.myqcloud.com/package?content-token=temporary";
  const preview = await service.previewRegistry(selected);
  expect(preview.origin).toMatchObject({
    origin_locator: "skillhub:teacher/study-coach", source_url: "https://skillhub.cn/skills/study-coach", pinned_ref: version,
  });
  expect(JSON.stringify(await service.confirm(preview))).not.toContain("content-token");
});

it("checks ClawHub generated cards and treats legacy CLI dependencies as unavailable", async () => {
  const content = skillMd.replace("\n---\nTeach", "\nmetadata: {clawdbot: {requires: {bins: [example-cli]}}}\n---\nTeach");
  const { service, item, fixture, store } = harness({ content, card: "Verified card", extra: { "skill-card.md": "Verified card" } });
  const clawSkill = { ...item, registry: "clawhub" as const };
  const preview = await service.previewRegistry(clawSkill);
  expect(preview.compatibility).toMatchObject({ readiness: "missing_tools", platformRequirements: ["命令行程序 · example-cli"] });
  expect(preview.manifest.map(({ path }) => path)).toEqual([entry]);
  await service.confirm(preview);
  await service.setEnabled(slug, true);
  await service.setScope(slug, "lf01", true);
  expect((await service.detail(slug))?.availability.lf01).toBe(false);
  fixture.extra = { "skill-card.md": "Tampered card" };
  await expect(service.previewRegistry(clawSkill)).rejects.toThrow("包信息无效");
  expect((await store.getSkill(slug))?.active_revision).toBe(preview.revision);
});

it("uses a fixed public GitHub directory only for a verified ClawHub handoff", async () => {
  const { item, service, fetch, fixture } = harness({
    handoff: { sourceRef: "public-github", repo: "edu/skills", commit: "a".repeat(40), path: "skills/demo",
      archiveUrl: "https://other.example/archive" },
  });
  const selected = { ...item, registry: "clawhub" as const };
  const preview = await service.previewRegistry(selected);
  expect(preview.origin.origin_locator).toBe("clawhub:teacher/study-coach");
  expect(fetch.mock.calls.some(([url]) => String(url).includes("raw.githubusercontent.com/edu/skills/" + "a".repeat(40)))).toBe(true);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("other.example"))).toBe(false);
  fixture.handoff!.commit = "main";
  await expect(service.previewRegistry(selected)).rejects.toThrow("包信息无效");
});

it("preserves marketplace provenance across backup restore and rejects falsified provenance", async () => {
  const { store, item, service, clock } = harness();
  const preview = await service.previewRegistry(item);
  await service.confirm(preview);
  await service.setEnabled(slug, true);
  await service.setScope(slug, "lf01", true);
  const runtime = { makeId: () => "registry-backup" };
  const source = new AppBootstrapService(store, new MemorySecretStore(), runtime);
  const envelope = await source.createBackupRestoreService("0.1.0", async (value) => digest(value), clock).exportBackup();
  expect(envelope.manifest.schema_version).toBe(9);
  const target = harness();
  const backup = new AppBootstrapService(target.store, new MemorySecretStore(), runtime)
    .createBackupRestoreService("0.1.0", async (value) => digest(value), clock);
  await backup.restoreBackup(JSON.stringify(envelope));
  expect(await target.store.getSkill(slug)).toMatchObject({
    enabled: 0, origin_kind: "registry", origin_locator: "eduhub:teacher/study-coach", pinned_ref: version,
  });
  expect((await target.service.detail(slug))?.scopes.lf01).toBe(false);
  const malformed = structuredClone(envelope);
  malformed.payload.skills[0]!.source_url = "https://other.example/skills/study-coach";
  malformed.integrity.digest = digest(canonicalJson({ manifest: malformed.manifest, payload: malformed.payload }));
  await expect(backup.inspectBackup(JSON.stringify(malformed))).rejects.toThrow("来源");
});
