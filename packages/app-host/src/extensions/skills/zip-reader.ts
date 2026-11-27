import { Inflate } from "fflate";
import {
  checkedSkillPath, decodeSkillText, maxSkillFileBytes, maxSkillFiles, maxSkillPackageBytes,
  skillEntry, SkillPackageError, verifySkillPaths, yieldSkillWork,
} from "./package-validator.js";

export const maxSkillArchiveBytes = 32 * 1024 * 1024;

interface ZipEntry {
  path: string;
  directory: boolean;
  ignored: boolean;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  local: number;
}

const sensitiveZipPath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|id_(?:rsa|ed25519|ecdsa|dsa)|credentials(?:\.[^/]*)?)(?:\/|$)|\.(?:pem|p12|pfx|key)$/i;
const systemJunkName = /^(?:\.ds_store|thumbs\.db|desktop\.ini|\._.*)$/i;

function checkZipPathSyntax(path: string): void {
  if (!path || path.length > 512 || /[\\\u0000-\u001f\u007f]/.test(path) ||
      /^[a-z]:/i.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new SkillPackageError("包含越界、凭据或无效路径。请检查包内文件名。");
  }
}

function isIgnoredZipPath(path: string): boolean {
  const parts = path.split("/");
  if (parts[0] === "__MACOSX") return true;
  if (sensitiveZipPath.test(path)) return false;
  return parts.some((part) => part === "__MACOSX" || systemJunkName.test(part) || part.startsWith("."));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

const malformed = () => new SkillPackageError("ZIP 目录、内容或 CRC 校验无效。请重新压缩技能目录。");
const unsupported = () => new SkillPackageError("ZIP 含加密、ZIP64、链接或不支持的压缩方式。");

function checkExtra(u16: (offset: number) => number, start: number, length: number): void {
  const end = start + length;
  for (let offset = start; offset < end;) {
    if (offset + 4 > end) throw malformed();
    const type = u16(offset);
    const size = u16(offset + 2);
    offset += 4 + size;
    if (offset > end) throw malformed();
    if (type === 1 || type === 0x9901) throw unsupported();
  }
}

export async function readSkillZip(archive: Uint8Array, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  signal?.throwIfAborted();
  if (archive.length > maxSkillArchiveBytes) throw new SkillPackageError("ZIP 文件超过 32 MiB。");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  // 中央目录的末尾记录必须紧接整个归档的尾部（含可选注释）。
  let end = archive.length - 22;
  const firstPossible = Math.max(0, end - 0xffff);
  while (end >= firstPossible && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== archive.length)) end--;
  if (end < firstPossible) throw malformed();
  const count = u16(end + 10);
  const start = u32(end + 16);
  if (count === 0xffff || start === 0xffffffff || u32(end + 12) === 0xffffffff) throw unsupported();
  if (!count || u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count ||
      start + u32(end + 12) !== end || start + count * 46 > end) throw malformed();

  const entries: ZipEntry[] = [];
  let expanded = 0;
  let files = 0;
  let offset = start;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw malformed();
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const crc = u32(offset + 16);
    const compressed = u32(offset + 20);
    const size = u32(offset + 24);
    const nameSize = u16(offset + 28);
    const extra = u16(offset + 30);
    const comment = u16(offset + 32);
    const attributes = u32(offset + 38);
    const local = u32(offset + 42);
    const nameStart = offset + 46;
    if (nameStart + nameSize + extra + comment > end || nameSize > 2048 || local + 30 > start ||
        u16(offset + 34) !== 0) throw malformed();
    const name = decodeSkillText(archive.subarray(nameStart, nameStart + nameSize));
    if (!name) throw malformed();
    const directory = name.endsWith("/");
    const path = directory ? name.slice(0, -1) : name;
    checkZipPathSyntax(path);
    const ignored = isIgnoredZipPath(path);
    if (!ignored) checkedSkillPath(path);
    const unixType = (attributes >>> 16) & 0o170000;
    if ((flags & ~0x080e) || (method !== 0 && method !== 8) ||
        size === 0xffffffff || compressed === 0xffffffff ||
        (unixType !== 0 && unixType !== (directory ? 0o040000 : 0o100000))) throw unsupported();
    if ((directory && size !== 0) || (method === 0 && size !== compressed)) throw malformed();
    checkExtra(u16, nameStart + nameSize, extra);
    if (!ignored) {
      if (!directory && ++files > maxSkillFiles) throw new SkillPackageError("技能包最多包含 100 个文件。");
      if (size > maxSkillFileBytes) throw new SkillPackageError("ZIP 中的原始文件超过 512 KiB。");
      expanded += size;
      if (expanded > maxSkillPackageBytes) throw new SkillPackageError("ZIP 解压后超过 2 MiB。");
    }
    entries.push({ path, directory, ignored, flags, method, crc, compressed, size, local });
    offset = nameStart + nameSize + extra + comment;
    if (index % 128 === 127) await yieldSkillWork(signal);
  }
  if (offset !== end) throw malformed();
  verifySkillPaths(entries.filter(({ ignored }) => !ignored));
  entries.sort((a, b) => a.local - b.local);

  const result = new Map<string, Uint8Array>();
  for (const [index, entry] of entries.entries()) {
    signal?.throwIfAborted();
    const { local, flags, method, size, compressed, crc, path, directory, ignored } = entry;
    const next = entries[index + 1]?.local ?? start;
    if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) throw malformed();
    const nameSize = u16(local + 26);
    const extra = u16(local + 28);
    const nameStart = local + 30;
    const data = nameStart + nameSize + extra;
    const dataEnd = data + compressed;
    if (dataEnd > next || decodeSkillText(archive.subarray(nameStart, nameStart + nameSize)) !== path + (directory ? "/" : "")) {
      throw malformed();
    }
    checkExtra(u16, nameStart + nameSize, extra);
    if (flags & 8) {
      const descriptorSize = next - dataEnd;
      if (descriptorSize !== 12 && descriptorSize !== 16) throw malformed();
      const descriptor = dataEnd + (descriptorSize === 16 ? 4 : 0);
      if ((descriptorSize === 16 && u32(dataEnd) !== 0x08074b50) || u32(descriptor) !== crc ||
          u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== size) throw malformed();
    } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size) {
      throw malformed();
    }
    if (ignored) continue;

    const bytes = new Uint8Array(size);
    let written = 0;
    let actualCrc = 0xffffffff;
    const output = (chunk: Uint8Array) => {
      if (written + chunk.length > size) throw new SkillPackageError("ZIP 实际解压内容超过声明大小。");
      bytes.set(chunk, written);
      written += chunk.length;
      for (const value of chunk) actualCrc = (actualCrc >>> 8) ^ crcTable[(actualCrc ^ value) & 255]!;
    };
    const inflater = method === 8 ? new Inflate(output) : undefined;
    const chunkSize = 2048;
    try {
      if (inflater && !compressed) throw malformed();
      let slices = 0;
      for (let position = data; position < dataEnd; position += chunkSize) {
        const to = Math.min(dataEnd, position + chunkSize);
        const chunk = archive.subarray(position, to);
        if (inflater) inflater.push(chunk, to === dataEnd);
        else output(chunk);
        if (++slices % 8 === 0) await yieldSkillWork(signal);
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw error instanceof SkillPackageError ? error : malformed();
    }
    if (written !== size || ((actualCrc ^ 0xffffffff) >>> 0) !== crc) throw malformed();
    if (!directory) result.set(path, bytes);
    if (index % 16 === 15) await yieldSkillWork(signal);
  }

  if (result.has(skillEntry)) return result;
  const first = result.keys().next().value;
  const slash = first?.indexOf("/") ?? -1;
  if (slash > 0) {
    const prefix = first!.slice(0, slash + 1);
    if (result.has(prefix + skillEntry) && [...result.keys()].every((path) => path.startsWith(prefix))) {
      return new Map([...result].map(([path, bytes]) => [path.slice(prefix.length), bytes]));
    }
  }
  throw new SkillPackageError("ZIP 根目录或唯一的外层目录须包含 SKILL.md。");
}
