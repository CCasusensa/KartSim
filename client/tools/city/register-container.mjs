#!/usr/bin/env node
// Register a (generated) Rho container in a resource mirror: copy it under
// mirror/<version>/, add or replace its entry in the manifest
// (mirror/__<version>/resources) and in the deflated archive index
// (mirror/__<version>/archive-index). The manifest revision and every other
// entry are left untouched; the browser's validateArchiveIndex then accepts
// the new container like an original one.
//
// Usage, from client/:
//   node --import tsx tools/city/register-container.mjs --mirror <mirrorRoot> --container <path/to/track_kartcity.rho>
//   node --import tsx tools/city/register-container.mjs --mirror <mirrorRoot> --container <...> --check
//   options: --version p3553 (default)
//
// <mirrorRoot> is the checkout that holds mirror/ (for example
// /Users/zhangwang/kartSim/KartSim); the container lands at
// <mirrorRoot>/mirror/<version>/<basename>. --check only verifies that the
// manifest and index already describe the container (size, SHA-256, index
// records equal to a fresh scan) and exits 1 otherwise.
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

import { scanRhoArchiveIndex } from "../../src/codecs/rho-index-scan.ts";
import { decodeArchiveIndex } from "../../src/resources/archive-index.ts";
import { parseResourceManifest } from "../../src/resources/manifest.ts";

const CONTAINER_NAME = /^[^/\\]+\.rho$/i;

/** A lazy ArchiveSource over one file on disk, like the browser's ContainerStore source. */
export function diskSource(file, name = path.basename(file)) {
  const size = statSync(file).size;
  const read = (start, end) => {
    const from = Math.max(0, Math.min(start, size));
    const to = Math.max(from, Math.min(end, size));
    const buffer = Buffer.alloc(to - from);
    const fd = openSync(file, "r");
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const count = readSync(fd, buffer, offset, buffer.length - offset, from + offset);
        if (count <= 0) throw new Error(`${name}: short read at ${from + offset}`);
        offset += count;
      }
    } finally {
      closeSync(fd);
    }
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
  };
  return {
    name, size,
    arrayBuffer: async () => read(0, size),
    slice: (start = 0, end = size) => ({ arrayBuffer: async () => read(start, end) }),
  };
}

/** The archive-index JSON codec: `$u8` objects stand for byte arrays. */
export function decodeIndexJson(compressed) {
  return JSON.parse(inflateSync(compressed).toString("utf8"), (_key, value) =>
    value && typeof value === "object" && typeof value.$u8 === "string" &&
    Object.keys(value).length === 1
      ? Uint8Array.from(Buffer.from(value.$u8, "base64")) : value);
}

export function indexJson(index) {
  return JSON.stringify(index, (_key, value) =>
    value instanceof Uint8Array ? { $u8: Buffer.from(value).toString("base64") } : value);
}

export function encodeIndexJson(index) {
  return deflateSync(Buffer.from(indexJson(index), "utf8"), { level: 9 });
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeAtomic(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}

function sameFile(left, right) {
  try {
    const a = statSync(left), b = statSync(right);
    return a.ino === b.ino && a.dev === b.dev;
  } catch {
    return false;
  }
}

function mirrorPaths(mirrorRoot, version) {
  const mirror = path.join(mirrorRoot, "mirror");
  return {
    mirror,
    containers: path.join(mirror, version),
    manifest: path.join(mirror, `__${version}`, "resources"),
    index: path.join(mirror, `__${version}`, "archive-index"),
  };
}

async function validate(manifestPath, indexPath, version) {
  const manifest = parseResourceManifest(JSON.parse(readFileSync(manifestPath, "utf8")), version);
  const bytes = readFileSync(indexPath);
  const index = await decodeArchiveIndex(new Blob([bytes]).stream(), manifest);
  return { manifest, index };
}

/**
 * Add or replace `containerPath` in the mirror at `mirrorRoot`. Returns a
 * summary of what changed. With `check: true` nothing is written; the result
 * lists every mismatch found in `problems`.
 */
export async function registerContainer({ mirrorRoot, containerPath, version = "p3553", check = false, now = Date.now() }) {
  const name = path.basename(containerPath);
  if (!CONTAINER_NAME.test(name)) throw new Error(`容器名无效（需要 *.rho）：${name}`);
  const paths = mirrorPaths(path.resolve(mirrorRoot), version);
  for (const file of [paths.manifest, paths.index])
    if (!existsSync(file)) throw new Error(`找不到 ${file}`);
  const target = path.join(paths.containers, name);
  const source = path.resolve(containerPath);
  const log = [];

  if (check) {
    const problems = [];
    if (!existsSync(target)) problems.push(`${target} 不存在`);
    const bytes = existsSync(target) ? readFileSync(target) : undefined;
    if (bytes && !sameFile(source, target) && existsSync(source) &&
        sha256Hex(readFileSync(source)) !== sha256Hex(bytes))
      problems.push(`${source} 与 ${target} 内容不同`);
    const manifestJson = JSON.parse(readFileSync(paths.manifest, "utf8"));
    const entry = manifestJson.files.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!entry) problems.push(`清单缺少 ${name}`);
    else if (bytes) {
      if (entry.size !== bytes.length) problems.push(`清单 size ${entry.size} != ${bytes.length}`);
      const sha = sha256Hex(bytes);
      if (entry.sha256.toLowerCase() !== sha) problems.push(`清单 sha256 ${entry.sha256} != ${sha}`);
    }
    const index = decodeIndexJson(readFileSync(paths.index));
    if (index.version !== manifestJson.version || index.revision !== manifestJson.revision)
      problems.push("档案索引版本或修订号与清单不一致");
    const stored = index.rho.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!stored) problems.push(`档案索引缺少 ${name}`);
    else if (bytes) {
      if (stored.mediaSize !== bytes.length) problems.push(`索引 mediaSize ${stored.mediaSize} != ${bytes.length}`);
      const fresh = await scanRhoArchiveIndex(diskSource(target, name));
      if (indexJson(stored) !== indexJson(fresh)) problems.push(`索引记录与 ${name} 的重新扫描结果不同`);
    }
    if (problems.length === 0) {
      try { await validate(paths.manifest, paths.index, version); }
      catch (error) { problems.push(`清单/索引校验失败：${error.message}`); }
    }
    return { name, target, checked: true, problems, log };
  }

  if (!existsSync(source)) throw new Error(`找不到容器 ${source}`);
  mkdirSync(paths.containers, { recursive: true });
  if (sameFile(source, target)) {
    log.push(`容器已在 ${target}`);
  } else {
    copyFileSync(source, target);
    log.push(`已复制 ${source} -> ${target}`);
  }
  const bytes = readFileSync(target);
  const sha256 = sha256Hex(bytes);

  // Manifest: replace in place or append; revision and other entries untouched.
  const manifestJson = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const entry = { name, size: bytes.length, mtimeMs: now, sha256 };
  const manifestIndex = manifestJson.files.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
  if (manifestIndex >= 0) {
    manifestJson.files[manifestIndex] = entry;
    log.push(`清单已替换 ${name}（size ${bytes.length}, sha256 ${sha256}）`);
  } else {
    manifestJson.files.push(entry);
    log.push(`清单已新增 ${name}（size ${bytes.length}, sha256 ${sha256}）`);
  }
  parseResourceManifest(manifestJson, version);

  // Archive index: scan the container exactly as the browser's codec would.
  const index = decodeIndexJson(readFileSync(paths.index));
  if (index.version !== manifestJson.version || index.revision !== manifestJson.revision)
    throw new Error("档案索引版本或修订号与清单不一致，拒绝修改。");
  const scanned = await scanRhoArchiveIndex(diskSource(target, name));
  const indexPosition = index.rho.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
  if (indexPosition >= 0) {
    index.rho[indexPosition] = scanned;
    log.push(`档案索引已替换 ${name}（Rho ${scanned.version}，${scanned.files.length} 个文件，${scanned.blocks.length} 个数据块）`);
  } else {
    index.rho.push(scanned);
    log.push(`档案索引已新增 ${name}（Rho ${scanned.version}，${scanned.files.length} 个文件，${scanned.blocks.length} 个数据块）`);
  }

  writeAtomic(paths.manifest, `${JSON.stringify(manifestJson, null, 2)}\n`);
  writeAtomic(paths.index, encodeIndexJson(index));
  const { manifest } = await validate(paths.manifest, paths.index, version);
  log.push(`已写入 ${paths.manifest}（${manifest.files.length} 个容器）和 ${paths.index}`);
  return { name, target, checked: false, problems: [], log, entry, files: scanned.files.map(file => file.path) };
}

function parseArgs(argv) {
  const options = { version: "p3553", check: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--mirror" || argument === "--container" || argument === "--version") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${argument} 缺少参数`);
      options[argument.slice(2)] = value;
    } else throw new Error(`未知参数 ${argument}`);
  }
  if (!options.mirror || !options.container)
    throw new Error("用法：register-container.mjs --mirror <mirrorRoot> --container <file.rho> [--check] [--version p3553]");
  return options;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await registerContainer({
      mirrorRoot: options.mirror, containerPath: options.container,
      version: options.version, check: options.check,
    });
    for (const line of result.log) console.log(line);
    if (result.checked) {
      if (result.problems.length > 0) {
        for (const problem of result.problems) console.error(`不一致：${problem}`);
        process.exit(1);
      }
      console.log(`${result.name} 已正确登记于 ${path.dirname(result.target)} 的清单和档案索引。`);
    } else {
      console.log(`${result.name} 内文件：${result.files.join(", ")}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
