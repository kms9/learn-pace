import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { skillEntry, validateSkillPackage } from "../extensions/skills/package-validator.js";
import { readSkillZip } from "../extensions/skills/zip-reader.js";

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const entry = (extra = "", body = "先提问，再讲解。") =>
  bytes(`---\nname: focus-coach\ndescription: 分步练习\n${extra}---\n${body}`);
const packageFiles = (extras: [string, Uint8Array][] = []) =>
  new Map<string, Uint8Array>([[skillEntry, entry()], ...extras]);

it.each([
  "name: duplicate\n",
  "metadata: &anchor { author: someone }\n",
  "metadata: *unknown\n",
  "metadata: { <<: other }\n",
  "metadata: { constructor: value }\n",
  "compatibility: !tag macOS\n",
  "extra: [invalid\n",
])("rejects malformed or unsupported YAML %j", async (extra) => {
  await expect(validateSkillPackage(packageFiles([[skillEntry, entry(extra)]]))).rejects.toThrow("YAML");
});

it.each(["../x.md", "/etc.txt", "assets/../../x", "C:/x", "a\\b", ".env", "references/bad\u0000"])(
  "rejects an unsafe or credential path %j", async (path) => {
    await expect(validateSkillPackage(packageFiles([[path, bytes("x")]]))).rejects.toThrow("路径");
  },
);

it.each([
  ["ref/Café.md", "ref/Cafe\u0301.md"], ["Ref/a.md", "ref/b.md"], ["REF", "ref/readme.md"],
])("rejects colliding paths %j and %j", async (left, right) => {
  await expect(validateSkillPackage(packageFiles([[left, bytes("a")], [right, bytes("b")]]))).rejects.toThrow("冲突");
});

it("checks name, invocation flags, Shell interpolation and credential indicators", async () => {
  await expect(validateSkillPackage(packageFiles([[skillEntry, bytes("---\nname: BAD--NAME\ndescription: A\n---\nBody")]])))
    .rejects.toThrow("名称");
  await expect(validateSkillPackage(packageFiles([[skillEntry, entry("user-invocable: 'false'\n")]]))).rejects.toThrow("调用标志");
  await expect(validateSkillPackage(packageFiles([[skillEntry, entry("", "执行 !" + "`placeholder`")]]))).rejects.toThrow("Shell");
  await expect(validateSkillPackage(packageFiles([["notes.txt", bytes("api_key = exampleexampleexampleexample")]])))
    .rejects.toThrow("疑似硬编码密钥");
});

it("enforces body, file, package and count limits from the actual input", async () => {
  await expect(validateSkillPackage(packageFiles([[skillEntry, entry("", "学".repeat(24_001))]]))).rejects.toThrow("24,000");
  await expect(validateSkillPackage(packageFiles([["large.bin", new Uint8Array(512 * 1024 + 1)]]))).rejects.toThrow("512 KiB");
  await expect(validateSkillPackage(packageFiles(Array.from({ length: 4 }, (_, n) => [`${n}.bin`, new Uint8Array(512 * 1024)]))))
    .rejects.toThrow("2 MiB");
  await expect(validateSkillPackage(packageFiles(Array.from({ length: 100 }, (_, n) => [`${n}.bin`, new Uint8Array()]))))
    .rejects.toThrow("100");
});

it("uses the upstream directory digest and distinguishes safe references from scripts and binaries", async () => {
  const input = packageFiles([["refs/é.md", bytes("例子")], ["example.sh", bytes("#!/bin/sh")], ["file.bin", Uint8Array.of(0xff)]]);
  const result = await validateSkillPackage(input);
  const hash = createHash("sha256");
  for (const path of [skillEntry, "example.sh", "file.bin", "refs", "refs/é.md"]) {
    const data = input.get(path);
    hash.update(`${data ? "F" : "D"}:${bytes(path).length}:${path}`);
    if (data) hash.update(`:${data.length}:`).update(data);
  }
  expect(result.revision).toBe("directory-sha256:" + hash.digest("hex"));
  expect((await validateSkillPackage(new Map([...input].reverse()))).revision).toBe(result.revision);
  expect(result.manifest.map(({ path, kind }) => [path, kind])).toEqual([
    ["SKILL.md", "text"], ["example.sh", "script"], ["file.bin", "binary"], ["refs/é.md", "text"],
  ]);
});

it("reads a ZIP with a single wrapper folder and deflated or stored files", async () => {
  const archive = zipSync({ wrapped: { [skillEntry]: entry(), "notes.txt": [bytes("笔记"), { level: 0 }] } });
  const contents = await readSkillZip(archive);
  expect(contents.get("notes.txt")).toEqual(bytes("笔记"));
  expect((await validateSkillPackage(contents)).name).toBe("focus-coach");
});

it("ignores __MACOSX, OS junk and non-credential hidden directories in ZIP archives while still rejecting secrets", async () => {
  const archive = zipSync({
    __MACOSX: { "._wrapped": bytes("appledouble"), wrapped: { "._SKILL.md": bytes("appledouble") } },
    wrapped: {
      [skillEntry]: entry(),
      ".DS_Store": bytes("junk"),
      "Thumbs.db": bytes("junk"),
      ".history": { "old.md": bytes("old") },
      ".git": { config: bytes("[core]") },
      ".vscode": { "settings.json": bytes("{}") },
      references: { "guide.md": bytes("正文"), ".DS_Store": bytes("junk") },
    },
  });
  const contents = await readSkillZip(archive);
  expect([...contents.keys()].sort()).toEqual(["SKILL.md", "references/guide.md"]);
  expect((await validateSkillPackage(contents)).name).toBe("focus-coach");

  await expect(readSkillZip(zipSync({ wrapped: { [skillEntry]: entry(), ".env": bytes("K=V") } }))).rejects.toThrow("路径");
  await expect(readSkillZip(zipSync({ wrapped: { [skillEntry]: entry(), ".ssh": { id_rsa: bytes("x") } } }))).rejects.toThrow("路径");
  await expect(readSkillZip(zipSync({ wrapped: { [skillEntry]: entry(), "cert.pem": bytes("x") } }))).rejects.toThrow("路径");
  await expect(readSkillZip(zipSync({ "__MACOSX/../evil.md": bytes("x"), [skillEntry]: entry() }))).rejects.toThrow("路径");
});

it.each(["../escape.md", "A/../b.md", "unsafe\\name.md"])("rejects unsafe ZIP entry %j before extraction", async (path) => {
  await expect(readSkillZip(zipSync({ [skillEntry]: entry(), [path]: bytes("text") }))).rejects.toThrow("路径");
});

it.each([
  ["encrypted", (view: DataView, central: number) => view.setUint16(central + 8, 1, true), "加密"],
  ["symlink", (view: DataView, central: number) => view.setUint32(central + 38, 0o120000 << 16, true), "链接"],
  ["ZIP64", (view: DataView, central: number) => view.setUint32(central + 24, 0xffffffff, true), "ZIP64"],
  ["CRC", (view: DataView, central: number) => {
    const wrongCrc = view.getUint32(central + 16, true) ^ 1;
    view.setUint32(central + 16, wrongCrc, true);
    view.setUint32(14, wrongCrc, true);
  }, "CRC"],
] as const)("rejects invalid ZIP metadata (%s)", async (_kind, mutate, message) => {
  const archive = zipSync({ [skillEntry]: entry() });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  mutate(view, view.getUint32(archive.length - 6, true));
  await expect(readSkillZip(archive)).rejects.toThrow(message);
});

it("bounds both declared and actual expanded ZIP sizes", async () => {
  const archive = zipSync({ [skillEntry]: entry(), "large.txt": new Uint8Array(512 * 1024 + 1) });
  await expect(readSkillZip(archive)).rejects.toThrow("512 KiB");
  const small = zipSync({ [skillEntry]: entry() });
  const view = new DataView(small.buffer, small.byteOffset, small.byteLength);
  const central = view.getUint32(small.length - 6, true);
  view.setUint32(22, 1, true);
  view.setUint32(central + 24, 1, true);
  await expect(readSkillZip(small)).rejects.toThrow("实际解压");
});
