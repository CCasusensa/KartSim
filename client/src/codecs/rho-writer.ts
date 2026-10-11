/**
 * Rho 1.0 archive packer: the inverse of rho-index-scan.ts for the subset of
 * the format the browser codec reads. The output is scanned with the
 * name-derived key (`scanRhoArchiveIndex(source)` without an explicit key)
 * and read back by RhoReader, so a packed container can be registered in the
 * resource manifest / archive index like an original one.
 *
 * Layout: 256-byte header (UTF-16 signature, then 128 header bytes XORed with
 * the archive key), 32-byte block records XORed with the legacy block mask
 * kept in the header, then 256-byte aligned blocks: the root directory
 * (index 0xffffffff), one directory block per nested folder, and one data
 * block per file. Directory blocks use flags 5 (Adler32 + XOR with the
 * directory key); data blocks use flags 3 (Adler32 + zlib) when deflating
 * helps and flags 1 (Adler32 only) otherwise. No Node modules are imported:
 * deflate goes through CompressionStream, which browsers and Node 18+ share.
 */

import { checkVirtualPath, requireValue, rhoAdler32 } from "./common";
import { rhoXor } from "./mount-manifest";

const HEADER_BYTES = 256;
const BLOCK_RECORD_BYTES = 32;
const BLOCK_ALIGNMENT = 256;
const ROOT_FOLDER_INDEX = 0xffffffff;
const HEADER_MAGIC = 4229928824;
const DIRECTORY_KEY_OFFSET = 630434289;
const DATA_KEY_OFFSET = 1970136660;
const SOURCE_KEY_OFFSET = 2800645477;
const SIGNATURE = "Rh layer spec 1.0";

export interface RhoPackFile {
  /** Virtual path inside the archive, e.g. `track_/kartcity/track.1s`. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface RhoPackOptions {
  /** Deflate data blocks when that makes them smaller (default true). */
  readonly compress?: boolean;
}

function utf16Bytes(text: string): Uint8Array {
  const result = new Uint8Array(text.length * 2);
  const view = new DataView(result.buffer);
  for (let index = 0; index < text.length; index++)
    view.setUint16(index * 2, text.charCodeAt(index), true);
  return result;
}

/** The key rho-index-scan derives from an archive's file name. */
export function rhoSourceKey(name: string): number {
  return (rhoAdler32(utf16Bytes(name.replaceAll(".rho", ""))) - SOURCE_KEY_OFFSET) >>> 0;
}

/** Up to four printable ASCII bytes packed little-endian, as the directory stores them. */
export function rhoExtensionCode(extension: string): number {
  requireValue(extension.length <= 4, `Rho 扩展名 ${extension} 超过 4 个字符。`);
  let code = 0;
  for (let index = 0; index < extension.length; index++) {
    const byte = extension.charCodeAt(index);
    requireValue(byte >= 32 && byte <= 126, `Rho 扩展名 ${extension} 含非 ASCII 字符。`);
    code |= byte << (index * 8);
  }
  return code >>> 0;
}

/** Per-file XOR key, matching the scanner's formula (unused unless flag 4 is set). */
export function rhoDataKey(baseName: string, extensionCode: number, key: number): number {
  return (rhoAdler32(utf16Bytes(baseName)) + extensionCode + key - DATA_KEY_OFFSET) >>> 0;
}

function splitName(name: string): { baseName: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { baseName: name, extension: "" };
  return { baseName: name.slice(0, dot), extension: name.slice(dot + 1) };
}

async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  requireValue(typeof CompressionStream !== "undefined", "当前环境不支持 CompressionStream。");
  const copy = new Uint8Array(bytes);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream()
    .pipeThrough(new CompressionStream("deflate") as unknown as
      ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class ByteBuilder {
  private chunks: Uint8Array[] = [];
  length = 0;

  uint32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.push(bytes);
  }

  utf16Null(text: string): void {
    this.push(utf16Bytes(text));
    this.push(new Uint8Array(2));
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  finish(): Uint8Array {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
}

interface Folder {
  index: number;
  subfolders: Map<string, Folder>;
  files: { baseName: string; extensionCode: number; fileProperty: number;
    dataIndex: number; size: number }[];
}

interface PendingBlock {
  index: number;
  stored: Uint8Array;
  logicalSize: number;
  flags: number;
  checksum: number;
}

function alignUp(value: number): number {
  return Math.ceil(value / BLOCK_ALIGNMENT) * BLOCK_ALIGNMENT;
}

/** A 32-byte legacy block mask derived from the key, so output is deterministic. */
function legacyBlockMask(key: number): Uint8Array {
  const mask = new Uint8Array(32);
  let word = (key ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < mask.length; index++) {
    word = (Math.imul(word, 1664525) + 1013904223) >>> 0;
    mask[index] = (word >>> 24) & 255;
  }
  return mask;
}

/**
 * Pack `files` into a Rho 1.0 archive that must be stored under exactly
 * `name` (e.g. `track_kartcity.rho`): the header and directory keys derive
 * from that name, as `scanRhoArchiveIndex` expects without a manifest key.
 */
export async function packRhoArchive(
  name: string,
  files: ReadonlyArray<RhoPackFile>,
  options: RhoPackOptions = {},
): Promise<Uint8Array> {
  requireValue(/^[^/\\\0-\x1f]+\.rho$/i.test(name) && name !== "." && name !== "..",
    `Rho 档案名无效：${name}。`);
  const compress = options.compress ?? true;
  const key = rhoSourceKey(name);
  const directoryKey = (key + DIRECTORY_KEY_OFFSET) >>> 0;

  let nextIndex = 1;
  const root: Folder = { index: ROOT_FOLDER_INDEX, subfolders: new Map(), files: [] };
  const folders: Folder[] = [root];
  const blocks: PendingBlock[] = [];
  const seenPaths = new Set<string>();

  // Directory tree first, so folder block indices precede data blocks.
  const placements: { folder: Folder; file: RhoPackFile }[] = [];
  for (const file of files) {
    checkVirtualPath(file.path);
    requireValue(!seenPaths.has(file.path.toLowerCase()), `Rho 路径重复：${file.path}。`);
    seenPaths.add(file.path.toLowerCase());
    const parts = file.path.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let child = folder.subfolders.get(part);
      if (!child) {
        child = { index: nextIndex++, subfolders: new Map(), files: [] };
        folder.subfolders.set(part, child);
        folders.push(child);
      }
      folder = child;
    }
    placements.push({ folder, file });
  }

  for (const { folder, file } of placements) {
    const fileName = file.path.slice(file.path.lastIndexOf("/") + 1);
    const { baseName, extension } = splitName(fileName);
    requireValue(baseName.length > 0, `Rho 文件名无效：${file.path}。`);
    const extensionCode = rhoExtensionCode(extension);
    const bytes = file.bytes;
    requireValue(bytes.length <= 256 * 1024 * 1024, `${file.path} 超过 256 MiB。`);
    const dataIndex = nextIndex++;
    let stored = bytes;
    let flags = 1;
    if (compress && bytes.length > 0) {
      const deflated = await deflateZlib(bytes);
      if (deflated.length < bytes.length) { stored = deflated; flags = 3; }
    }
    blocks.push({ index: dataIndex, stored, logicalSize: bytes.length, flags,
      checksum: rhoAdler32(bytes) });
    // Originals mark deflated entries with property 1 (XORed ones with 4).
    folder.files.push({ baseName, extensionCode, fileProperty: flags & 2 ? 1 : 0,
      dataIndex, size: bytes.length });
  }

  const directoryBlocks: PendingBlock[] = folders.map(folder => {
    const builder = new ByteBuilder();
    builder.uint32(folder.subfolders.size);
    for (const [childName, child] of folder.subfolders) {
      builder.utf16Null(childName);
      builder.uint32(child.index);
    }
    builder.uint32(folder.files.length);
    for (const file of folder.files) {
      builder.utf16Null(file.baseName);
      builder.uint32(file.extensionCode);
      builder.uint32(file.fileProperty);
      builder.uint32(file.dataIndex);
      builder.uint32(file.size);
    }
    const plain = builder.finish();
    return { index: folder.index, stored: rhoXor(plain, directoryKey),
      logicalSize: plain.length, flags: 5, checksum: rhoAdler32(plain) };
  });

  const ordered = [...directoryBlocks, ...blocks];
  const tableEnd = HEADER_BYTES + ordered.length * BLOCK_RECORD_BYTES;
  let offset = alignUp(tableEnd);
  const placed = ordered.map(block => {
    const result = { ...block, offset };
    offset = alignUp(offset + block.stored.length);
    return result;
  });
  const totalSize = Math.max(offset, alignUp(tableEnd));
  const archive = new Uint8Array(totalSize);

  // Header: signature, then 128 bytes XORed with the archive key.
  archive.set(utf16Bytes(SIGNATURE), 0);
  const header = new Uint8Array(128);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(4, 65536, true);
  headerView.setUint32(8, placed.length, true);
  headerView.setUint32(12, (key ^ 0x5bd1e995) >>> 0, true);
  const mask = legacyBlockMask(key);
  header.set(mask, 16);
  headerView.setUint32(48, HEADER_MAGIC, true);
  headerView.setUint32(0, rhoAdler32(header.subarray(4)), true);
  archive.set(rhoXor(header, key), 128);

  placed.forEach((block, ordinal) => {
    const record = new Uint8Array(BLOCK_RECORD_BYTES);
    const view = new DataView(record.buffer);
    view.setUint32(0, block.index, true);
    view.setUint32(4, block.offset / BLOCK_ALIGNMENT, true);
    view.setUint32(8, block.stored.length, true);
    view.setUint32(12, block.logicalSize, true);
    view.setUint32(16, block.flags, true);
    view.setUint32(20, block.checksum, true);
    archive.set(record.map((byte, index) => byte ^ mask[index]!),
      HEADER_BYTES + ordinal * BLOCK_RECORD_BYTES);
    archive.set(block.stored, block.offset);
  });
  return archive;
}
