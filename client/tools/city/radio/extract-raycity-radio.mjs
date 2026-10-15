#!/usr/bin/env node
/**
 * 卡丁城收音机的歌：从光线飞车（RayCity v1.325）客户端解出车载电台的韩国歌曲。
 *
 * 光线飞车的资源是 J2M 的 .jmd 包（文件头 "J2m Data Format 1.0"）。解法参考
 * github.com/minhducck/JMDEasyPacker（Unpacker.py）：包名（不含扩展名）的 UTF-16LE
 * 做 adler32（初值 0）加 0x3DE90DC3 得包密钥；密钥展开成 64 字节循环异或；0x80 起
 * 0x80 字节是包头（adler32 校验、数据块个数、32 字节块表密钥），0x100 起每 32 字节
 * 一条块记录（序号、偏移 >> 8、长度、原长、属性、校验）；属性 2/7 先 zlib 解压，
 * 带 4 位的再异或；目录块用包密钥 − 0x41014EBF，文件块用文件名 adler32 + 扩展名
 * 四字节 + 包密钥 − 0x7E2AF33D。
 *
 * 电台曲目表是 Data/sound/bgm/main/list.jmd 里的 list.xml（22 首，圣诞两首在原版里
 * 被注释掉了）；每首歌是同目录下同名的 .jmd，里面是一个 112 kbps 的 Ogg Vorbis。
 *
 *   node client/tools/city/radio/extract-raycity-radio.mjs <RayCity 客户端目录> [--check]
 *
 * 写 mirror/ui/radio/<名字>.ogg 和 client/src/city/city-radio-songs.json；--check 只比较。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT_DIR = join(repo, "mirror/ui/radio");
const SONGS_JSON = join(repo, "client/src/city/city-radio-songs.json");

const u32 = n => n >>> 0;

/** zlib adler32 with the given start value (the client starts from 0, not 1). */
export function adler32(bytes, start = 1) {
  let a = start & 0xffff, b = (start >>> 16) & 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return u32((b << 16) | a);
}

const utf16 = text => new Uint8Array(Buffer.from(text, "utf16le"));

export function jmdKey(name) {
  return u32(adler32(utf16(name), 0) + 0x3de90dc3);
}

function expandKey(key) {
  const out = new Uint8Array(64);
  const view = new DataView(out.buffer);
  let current = u32(key ^ 0x8473fbc1);
  for (let i = 0; i < 16; i++) {
    view.setUint32(i * 4, current, true);
    current = u32(current - 0x7b8c043f);
  }
  return out;
}

function xor64(key, data) {
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ expanded[i & 63];
  return out;
}

/** Every file in a .jmd, as { path, bytes }. */
export function unpackJmd(file) {
  const bytes = new Uint8Array(readFileSync(file));
  const key = jmdKey(basename(file).replace(/\.[^.]*$/, ""));
  const header = xor64(key, bytes.subarray(0x80, 0x100));
  const headerView = new DataView(header.buffer);
  if (headerView.getUint32(0, true) !== adler32(header.subarray(4), 0))
    throw new Error(`${file}：包头校验不对（不是光线飞车的 .jmd，或者包名被改过）`);
  const count = headerView.getInt32(8, true);
  const infoKey = header.subarray(16, 48);
  const blocks = new Map();
  for (let i = 0; i < count; i++) {
    const raw = bytes.subarray(0x100 + i * 32, 0x120 + i * 32);
    const info = new DataView(raw.map((value, j) => value ^ infoKey[j]).buffer);
    blocks.set(info.getUint32(0, true), {
      offset: info.getInt32(4, true) * 256, size: info.getInt32(8, true), property: info.getInt32(16, true),
    });
  }
  const block = (index, blockKey, fileProperty) => {
    const entry = blocks.get(index);
    if (!entry) throw new Error(`${file}：没有数据块 ${index}`);
    let data = bytes.subarray(entry.offset, entry.offset + entry.size);
    if (entry.property === 2 || entry.property === 7) data = new Uint8Array(inflateSync(data));
    if (entry.property & 4) {
      data = xor64(blockKey, data);
      // Partly encrypted files go on, unencrypted, in the next block.
      const next = fileProperty === 5 ? blocks.get(index + 1) : undefined;
      if (next) data = Buffer.concat([data, bytes.subarray(next.offset, next.offset + next.size)]);
    }
    return data;
  };
  const files = [];
  const queue = [[0xffffffff, ""]];
  while (queue.length) {
    const [index, folder] = queue.shift();
    const data = block(index, u32(key - 0x41014ebf));
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0;
    const text = () => {
      const from = at;
      while (view.getUint16(at, true) !== 0) at += 2;
      const value = Buffer.from(data.subarray(from, at)).toString("utf16le");
      at += 2;
      return value;
    };
    const folders = view.getInt32(at, true); at += 4;
    for (let i = 0; i < folders; i++) {
      const name = text();
      queue.push([view.getUint32(at, true), folder ? `${folder}/${name}` : name]);
      at += 4;
    }
    const fileCount = view.getInt32(at, true); at += 4;
    for (let i = 0; i < fileCount; i++) {
      const name = text();
      const extension = view.getUint32(at, true), property = view.getInt32(at + 4, true);
      const dataIndex = view.getUint32(at + 8, true), size = view.getInt32(at + 12, true);
      at += 16;
      const ext = Buffer.from(data.subarray(at - 16, at - 12)).toString("latin1").replace(/\0+$/, "");
      const fileKey = u32(u32(adler32(utf16(name), 0) + extension) + u32(key - 0x7e2af33d));
      const content = block(dataIndex, fileKey, property);
      files.push({ path: `${folder ? `${folder}/` : ""}${name}${ext ? `.${ext}` : ""}`,
        bytes: size > 0 && content.length >= size ? content.subarray(0, size) : content });
    }
  }
  return files;
}

/** The <bgm …/> rows of list.xml that are not commented out. */
export function parseBgmList(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, "");
  return [...live.matchAll(/<bgm\b([^>]*)\/>/g)].map(match => {
    const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)\s*=\s*(['"])(.*?)\2/g)].map(m => [m[1], m[3]]));
    return {
      // The archives are named in lower case; list.xml writes some with capitals.
      file: attributes.name.replace(/\.ogg$/i, "").toLowerCase(),
      title: attributes.title.trim(),
      singer: attributes.singer.trim(),
      ...(attributes.town === "true" ? { town: true } : {}),
    };
  });
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const client = args.find(arg => !arg.startsWith("--"));
  if (!client) {
    console.error("用法：node client/tools/city/radio/extract-raycity-radio.mjs <RayCity 客户端目录> [--check]");
    process.exit(2);
  }
  const bgm = join(client, "Data/sound/bgm/main");
  const list = unpackJmd(join(bgm, "list.jmd")).find(file => /list\.xml$/i.test(file.path));
  if (!list) throw new Error("list.jmd 里没有 list.xml");
  const songs = parseBgmList(Buffer.from(list.bytes).toString("utf8"));
  let differ = 0;
  if (!check) mkdirSync(OUT_DIR, { recursive: true });
  for (const song of songs) {
    const ogg = unpackJmd(join(bgm, `${song.file}.jmd`)).find(file => /\.ogg$/i.test(file.path));
    if (!ogg || Buffer.from(ogg.bytes.subarray(0, 4)).toString("latin1") !== "OggS")
      throw new Error(`${song.file}.jmd 里没有 Ogg`);
    const target = join(OUT_DIR, `${song.file}.ogg`);
    const same = existsSync(target) && Buffer.compare(readFileSync(target), ogg.bytes) === 0;
    if (!same) differ++;
    if (!check && !same) writeFileSync(target, ogg.bytes);
    console.log(`${same ? "  " : check ? "≠ " : "→ "}${song.file}.ogg  ${(ogg.bytes.length / 1048576).toFixed(2)} MB  ${song.title} — ${song.singer}`);
  }
  const json = `${JSON.stringify({ source: "RayCity v1.325 Data/sound/bgm/main/list.jmd (list.xml)", songs }, null, 2)}\n`;
  const sameJson = existsSync(SONGS_JSON) && readFileSync(SONGS_JSON, "utf8") === json;
  if (!sameJson) differ++;
  if (!check && !sameJson) writeFileSync(SONGS_JSON, json);
  console.log(`${songs.length} 首；${check ? (differ ? `${differ} 处不一致` : "全部一致") : `更新 ${differ} 个文件`}`);
  if (check && differ) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
