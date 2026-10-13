import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";

import { packRhoArchive } from "../codecs/rho-writer";
import { newDesign } from "./design";
import type { CustomMapSummary } from "./custom-tracks";
import { containerName, decodeMapPackage, encodeMapPackage, isZip } from "./map-package";

async function samplePackage() {
  const design = newDesign("包测试");
  design.id = "pack000001";
  design.items.rows.push({ id: "i1", road: "r1", distance: 50, count: 4 });
  const files = [
    { path: "track.1s", bytes: new Uint8Array([1, 2, 3, 4, 5]) },
    { path: "xt_minimap.png", bytes: new Uint8Array([9, 9]) },
    { path: "cement_00.dds", bytes: new Uint8Array(300).fill(7) },
  ];
  const container = await packRhoArchive(containerName(design.id), files);
  const summary: CustomMapSummary = {
    id: design.id, name: design.name, author: "作者", theme: "village", laps: 3, difficulty: 2, roadExtent: 900,
    sha256: "forged", size: 1, items: 99, files: [{ path: "fake.txt", size: 1 }], updatedAt: 1, source: "local",
  };
  return { design, container, summary, card: new Uint8Array([0x89, 0x50]), thumb: new Uint8Array([0x89, 0x51]) };
}

test("地图包：导出后能原样导入，文件表与哈希从赛道包本身重新算", async () => {
  const pack = await samplePackage();
  const bytes = encodeMapPackage(pack);
  assert.ok(isZip(bytes));
  assert.deepEqual(Object.keys(unzipSync(bytes)).sort(),
    ["card.png", "design.json", "map.json", "thumb.png", "track_custom_pack000001.rho"]);
  const back = await decodeMapPackage(bytes);
  assert.equal(back.design.id, pack.design.id);
  assert.equal(back.design.name, "包测试");
  assert.deepEqual(back.container, pack.container);
  assert.deepEqual(back.card, pack.card);
  assert.equal(back.summary.author, "作者");
  assert.equal(back.summary.items, 4, "道具箱数按设计算，不信清单");
  assert.equal(back.summary.size, pack.container.length);
  assert.match(back.summary.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(back.summary.files.map(file => file.path).sort(), ["cement_00.dds", "track.1s", "xt_minimap.png"]);
  assert.equal(back.summary.files.find(file => file.path === "cement_00.dds")?.size, 300);
});

test("地图包：不是 zip、不是地图包、缺赛道包或赛道包损坏都给出中文错误", async () => {
  const pack = await samplePackage();
  await assert.rejects(decodeMapPackage(strToU8("{}")), /不是地图包/);
  await assert.rejects(decodeMapPackage(zipSync({ "map.json": strToU8("{\"format\":\"other\"}"), "design.json": strToU8("{}") })), /不是地图工坊的地图包/);
  const files = unzipSync(encodeMapPackage(pack));
  const withoutContainer = { ...files };
  delete withoutContainer["track_custom_pack000001.rho"];
  await assert.rejects(decodeMapPackage(zipSync(withoutContainer)), /没有赛道包/);
  const broken = { ...files, "track_custom_pack000001.rho": new Uint8Array(64).fill(3) };
  await assert.rejects(decodeMapPackage(zipSync(broken)), /损坏/);
});
