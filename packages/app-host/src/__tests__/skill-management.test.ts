import { MemoryAppStore } from "@learn-pace/infra";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { SkillConflictError, SkillService } from "../extensions/skills/skill-service.js";

const text = (body = "Try one problem.", name = "focus-coach", declaration = "") =>
  `---\nname: ${name}\ndescription: Reason slowly\n${declaration}---\n${body}`;
const bytes = (body: string) => new TextEncoder().encode(body);
const zip = (body: string) => zipSync({ "SKILL.md": bytes(text(body)), "refs/example.md": bytes(body) });
const candidateUrl = "https://github.com/example/skills/blob/main/SKILL.md";
const sha = "a".repeat(40);
const tree = "b".repeat(40);

function harness() {
  const store = new MemoryAppStore();
  let active = false;
  let githubDoc = text("Original");
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("/commits/main")) return Response.json({ sha, commit: { tree: { sha: tree } } });
    if (url.includes("/git/trees/")) return Response.json({ tree: [
      { path: "SKILL.md", mode: "100644", type: "blob", size: bytes(githubDoc).length },
    ] });
    if (url.includes("raw.githubusercontent.com")) return new Response(githubDoc);
    return Response.json({ private: false, default_branch: "main" });
  });
  const service = new SkillService(store, { nowSeconds: () => 1 }, () => active, fetch);
  return { store, service, setActive: (value: boolean) => { active = value; },
    renameUpstream: () => { githubDoc = text("Renamed", "new-name"); } };
}

it("installs disabled and independently surfaces scope and missing capabilities", async () => {
  const { service } = harness();
  const preview = await service.previewLocal(bytes(text("Learn carefully.", "focus-coach", "allowed-tools: mastery_topics\n")), "local_file");
  await service.confirm(preview);
  expect(await service.detail("focus-coach")).toMatchObject({ state: "valid", skill: { enabled: 0 },
    scopes: { lf01: false, little_tutor: false }, compatibility: { readiness: "ready" } });
  await service.setScope("focus-coach", "lf01", true);
  await service.setScope("focus-coach", "little_tutor", true);
  expect((await service.detail("focus-coach"))?.availability).toEqual({ lf01: false, little_tutor: false });
  await service.setEnabled("focus-coach", true);
  expect((await service.list("reason"))[0]?.availability).toEqual({ lf01: true, little_tutor: false });
  const fake = await service.previewLocal(bytes(text("Teach slowly.", "fake", "metadata: {connector: ima}\n")), "local_file");
  expect(fake.compatibility).toMatchObject({ readiness: "missing_tools", missingTools: ["ima"] });
  await service.confirm(fake);
  await service.setEnabled("fake", true);
  await service.setScope("fake", "lf01", true);
  expect((await service.detail("fake"))?.availability.lf01).toBe(false);
});

it("rejects the second of two local ZIP updates, retains the pinned revision while busy and later reclaims it", async () => {
  const { store, service, setActive } = harness();
  const initial = await service.previewLocal(bytes(text()), "local_file");
  await service.confirm(initial);
  const one = await service.previewLocal(zip("A"), "local_zip");
  const two = await service.previewLocal(zip("B"), "local_zip");
  expect(one).toMatchObject({ expectedActiveRevision: initial.revision, changes: { added: ["refs/example.md"], changed: ["SKILL.md"] } });
  setActive(true);
  await service.confirm(one);
  const before = await store.exportSnapshot();
  await expect(service.confirm(two)).rejects.toBeInstanceOf(SkillConflictError);
  expect(await store.exportSnapshot()).toEqual(before);
  expect(await store.getSkillRevision("focus-coach", initial.revision)).not.toBeNull();
  expect(await service.reference("focus-coach", "refs/example.md")).toBe("A");
  setActive(false);
  await service.setEnabled("focus-coach", true);
  expect(await store.getSkillRevision("focus-coach", initial.revision)).toBeNull();
  expect((await service.detail("focus-coach"))?.skill.origin_kind).toBe("local_zip");
});

it("commits only one concurrent installation of the same name", async () => {
  const { store, service } = harness();
  const [first, second] = await Promise.all([service.previewLocal(bytes(text("One")), "local_file"), service.previewLocal(zip("Two"), "local_zip")]);
  const results = await Promise.allSettled([service.confirm(first), service.confirm(second)]);
  expect(results.map((item) => item.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect((await store.exportSnapshot()).skill_revisions).toHaveLength(1);
});

it("installs pinned GitHub packages and rejects a local collision or renamed upstream with no writes", async () => {
  const { store, service, renameUpstream } = harness();
  const [candidate] = await service.github.candidates(candidateUrl);
  const preview = await service.previewGithub(candidate!);
  expect(await service.confirm(preview)).toMatchObject({ origin_kind: "github", pinned_ref: sha, enabled: 0 });
  const before = await store.exportSnapshot();
  await expect(service.previewLocal(bytes(text("Local")), "local_file")).rejects.toThrow("同名技能");
  renameUpstream();
  await expect(service.previewUpdate("focus-coach")).rejects.toThrow("上游已改名");
  expect(await store.exportSnapshot()).toEqual(before);
});
