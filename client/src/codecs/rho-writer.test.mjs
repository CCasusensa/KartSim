import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { rhoAdler32 } from "./common.ts";
import { RhoReader } from "./rho.ts";
import { scanRhoArchiveIndex } from "./rho-index-scan.ts";
import { packRhoArchive, rhoDataKey, rhoExtensionCode, rhoSourceKey } from "./rho-writer.ts";

function memorySource(name, bytes) {
  return {
    name, size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
    slice: (start = 0, end = bytes.length) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer,
    }),
  };
}

const text = (value) => new TextEncoder().encode(value);

const fixtures = [
  { path: "track_/kartcity/track.1s", bytes: text("KartCity track model ".repeat(2000)) },
  { path: "track_/kartcity/skydome.1s", bytes: text("sky ".repeat(500)) },
  { path: "track_/kartcity/xt_minimap.png", bytes: Uint8Array.from(randomBytes(300 * 1024)) },
  { path: "track_/kartcity/empty.bin", bytes: new Uint8Array(0) },
  { path: "track_/kartcity/param@zz.bml", bytes: text("<param@zz/>") },
  { path: "track_/kartcity/@zz.1s", bytes: text("name is only @zz") },
  { path: "readme", bytes: text("no extension at root") },
  { path: "深/层/目录/文件.flac", bytes: text("unicode folders ".repeat(40)) },
];

test("packRhoArchive 输出可被 scanRhoArchiveIndex 以文件名密钥扫描并由 RhoReader 还原", async () => {
  const name = "track_kartcity.rho";
  const archive = await packRhoArchive(name, fixtures);
  assert.equal(archive.length % 256, 0);
  assert.equal(new TextDecoder("utf-16le").decode(archive.subarray(0, 34)), "Rh layer spec 1.0");
  const source = memorySource(name, archive);
  const index = await scanRhoArchiveIndex(source);
  assert.equal(index.version, "1.0");
  assert.equal(index.key, rhoSourceKey(name));
  assert.equal(index.mediaSize, archive.length);
  assert.equal(index.dataHash, undefined);
  assert.deepEqual(index.files.map(file => file.path).sort(), fixtures.map(file => file.path).sort());
  // Directory blocks + one data block per file, every data block checksummed.
  assert.equal(index.blocks.length, fixtures.length + 6);
  const reader = new RhoReader(source, index);
  for (const fixture of fixtures) {
    const bytes = await reader.read(fixture.path);
    assert.deepEqual(bytes, fixture.bytes, fixture.path);
    const record = index.files.find(file => file.path === fixture.path);
    const block = index.blocks.find(block => block.index === record.dataIndex);
    assert.equal(block.logicalSize, fixture.bytes.length);
    assert.equal(block.checksum, rhoAdler32(fixture.bytes));
    assert.ok(block.processingFlags & 1, `${fixture.path} has an Adler32`);
    assert.equal(block.offset % 256, 0);
    assert.equal(block.processingFlags & 4, 0, "data blocks are not XORed");
    const fileName = fixture.path.slice(fixture.path.lastIndexOf("/") + 1);
    const dot = fileName.lastIndexOf(".");
    const baseName = dot <= 0 ? fileName : fileName.slice(0, dot);
    const extension = dot <= 0 ? "" : fileName.slice(dot + 1);
    assert.equal(record.name, fileName);
    assert.equal(record.extension, extension);
    assert.equal(record.dataKey, rhoDataKey(baseName, rhoExtensionCode(extension), index.key));
  }
  const compressed = index.files.find(file => file.path === "track_/kartcity/track.1s");
  const compressedBlock = index.blocks.find(block => block.index === compressed.dataIndex);
  assert.equal(compressedBlock.processingFlags, 3);
  assert.ok(compressedBlock.storedSize < compressed.size);
  const random = index.files.find(file => file.path === "track_/kartcity/xt_minimap.png");
  const randomBlock = index.blocks.find(block => block.index === random.dataIndex);
  assert.equal(randomBlock.processingFlags, 1, "incompressible data stays raw");
  assert.equal(randomBlock.storedSize, random.size);
  const empty = index.files.find(file => file.path === "track_/kartcity/empty.bin");
  assert.equal(index.blocks.find(block => block.index === empty.dataIndex).storedSize, 0);
  // Lower-case lookups work like the release reader.
  assert.deepEqual(await reader.read("TRACK_/KARTCITY/TRACK.1S"), fixtures[0].bytes);
});

test("packRhoArchive 输出确定且 compress:false 保留原始字节块", async () => {
  const name = "stage_demo.rho";
  const first = await packRhoArchive(name, fixtures);
  const second = await packRhoArchive(name, fixtures);
  assert.deepEqual(first, second);
  const raw = await packRhoArchive(name, fixtures, { compress: false });
  const index = await scanRhoArchiveIndex(memorySource(name, raw));
  const dataBlocks = index.files.map(file => index.blocks.find(block => block.index === file.dataIndex));
  assert.ok(dataBlocks.every(block => block.processingFlags === 1));
  const reader = new RhoReader(memorySource(name, raw), index);
  for (const fixture of fixtures) assert.deepEqual(await reader.read(fixture.path), fixture.bytes);
  // A different archive name changes the key, so the old name no longer scans.
  await assert.rejects(scanRhoArchiveIndex(memorySource("stage_other.rho", first)), /密钥/);
});

test("packRhoArchive 拒绝无效路径、重复路径和超长扩展名", async () => {
  await assert.rejects(packRhoArchive("x.rho", [{ path: "../a.1s", bytes: new Uint8Array(1) }]), /虚拟路径/);
  await assert.rejects(packRhoArchive("x.rho", [{ path: "a\\b.1s", bytes: new Uint8Array(1) }]), /虚拟路径/);
  await assert.rejects(packRhoArchive("x.rho", [
    { path: "a/b.1s", bytes: new Uint8Array(1) }, { path: "A/B.1S", bytes: new Uint8Array(1) },
  ]), /重复/);
  await assert.rejects(packRhoArchive("x.rho", [{ path: "a.toolong", bytes: new Uint8Array(1) }]), /扩展名/);
  await assert.rejects(packRhoArchive("x.txt", []), /档案名/);
  assert.equal(rhoExtensionCode("1s"), 0x7331);
  assert.equal(rhoExtensionCode(""), 0);
  assert.equal(rhoExtensionCode("flac"), 0x63616c66);
});

test("空档案只含根目录块", async () => {
  const name = "track_empty.rho";
  const archive = await packRhoArchive(name, []);
  const index = await scanRhoArchiveIndex(memorySource(name, archive));
  assert.deepEqual(index.files, []);
  assert.equal(index.blocks.length, 1);
  assert.equal(index.blocks[0].index, 0xffffffff);
});
