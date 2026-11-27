import { expect, it, vi } from "vitest";
import { GithubSkillSource } from "../extensions/skills/github-source.js";
import { checkCompatibility } from "../extensions/skills/compatibility.js";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const document = "---\nname: focus-coach\ndescription: Reason about fractions\n---\nTeach slowly.";
const blob = (path: string) => ({ path, type: "blob", mode: "100644", size: new TextEncoder().encode(document).length });
const url = "https://github.com/Example/Skills";
const api = "https://api.github.com/repos/example/skills";
const paths = ["coaches/focus/SKILL.md", "coaches/review/SKILL.md"];

function harness(entries = paths.map(blob)) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const request = String(input);
    if (request === api) return Response.json({ default_branch: "main", private: false });
    if (request === api + "/commits/main" || request === api + "/commits/topic%2Fone") {
      return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
    }
    if (request === api + "/git/trees/" + tree + "?recursive=1") return Response.json({ tree: entries });
    if (request.startsWith("https://raw.githubusercontent.com/example/skills/" + commit + "/")) return new Response(document);
    return new Response(null, { status: 404 });
  });
  return { fetch, source: new GithubSkillSource(fetch) };
}

it.each([
  ["", paths], ["/tree/main/coaches", paths], ["/blob/topic%2Fone/coaches/focus/SKILL.md", paths.slice(0, 1)],
] as const)("resolves %s and downloads only the selected immutable commit", async (suffix, expected) => {
  const { source, fetch } = harness();
  const candidates = await source.candidates(url + suffix);
  expect(candidates.map(({ directory }) => directory + "/SKILL.md")).toEqual(expected);
  const [selected] = candidates;
  expect(selected).toMatchObject({ originLocator: "github:example/skills/coaches/focus", pinnedRef: commit });
  const files = await source.acquire(selected!);
  expect(new TextDecoder().decode(files.get("SKILL.md"))).toBe(document);
  expect(fetch.mock.calls.at(-1)?.[0]).toBe("https://raw.githubusercontent.com/example/skills/" + commit + "/" + expected[0]);
  expect(fetch.mock.calls.every(([, init]) => init?.credentials === "omit" && init.redirect === "error")).toBe(true);
});

it.each([403, 429])("reports rate limiting for status %i", async (status) => {
  const source = new GithubSkillSource(async () => new Response(null, { status }));
  await expect(source.candidates(url)).rejects.toThrow("限流");
});

it("refuses non-public repositories and unsafe entry types", async () => {
  const privateRepo = new GithubSkillSource(async () => Response.json({ private: true, default_branch: "main" }));
  await expect(privateRepo.candidates(url)).rejects.toThrow("公开");
  const { source } = harness([...paths.map(blob), { ...blob("coaches/focus/ref.md"), mode: "120000" }]);
  await expect(source.candidates(url + "/tree/main/coaches/focus")).rejects.toThrow("链接");
  await expect(source.candidates("https://example.test/example/skills")).rejects.toThrow("公开 GitHub");
});

it("cancels an outstanding response body", async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const source = new GithubSkillSource(async () => new Response(new ReadableStream({ cancel })));
  const pending = source.candidates(url, controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("treats declarations as compatibility data and respects scope", () => {
  const declarations = { compatibility: null, metadata: {}, allowedTools: ["mastery_topics"] };
  expect(checkCompatibility(declarations, [], "lf01").readiness).toBe("ready");
  expect(checkCompatibility(declarations, [], "little_tutor").readiness).toBe("missing_tools");
  expect(checkCompatibility({ ...declarations, allowedTools: [], metadata: { connector: "ima" } }, []).missingTools).toEqual(["ima"]);
  expect(checkCompatibility({ ...declarations, allowedTools: [], compatibility: "Python" }, []).readiness).toBe("script_non_executable");
});

it("keeps valid candidates when a different directory is incompatible", async () => {
  const { source } = harness([...paths.map(blob), { ...blob("coaches/focus/link.md"), mode: "120000" }]);
  expect((await source.candidates(url)).map(({ directory }) => directory)).toEqual(["coaches/review"]);
  await expect(source.candidates(url + "/blob/main/coaches/focus/SKILL.md")).rejects.toThrow("链接");
});
