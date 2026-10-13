/**
 * 素材目录（tools/mapeditor-catalog 生成）：引用都对得上，缩略图格子不重叠；
 * 向导生成的地图能直接试跑，路边装饰不压在路上。有 mirror/p3553 时再抽查
 * 目录里的物件在官方赛道里还找得到、尺寸没变。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PIECE_CATEGORIES, filterPieces, spriteStyle, textureLabel, type CatalogData } from "./catalog";
import { decorateRoute, wizardDesign } from "./decorate";
import { validateDesign } from "./design";
import { sampleRoad } from "./road-geometry";
import { TRACK_TEMPLATES } from "./templates";

const data = JSON.parse(readFileSync(new URL("./catalog/catalog.json", import.meta.url), "utf8")) as CatalogData;
const sheetFiles = readFileSync(new URL("./catalog/sheets.ts", import.meta.url), "utf8").match(/sheet-\d+\.webp/g) ?? [];

test("素材目录：分类、主题套装、雪碧图格子都对得上", () => {
  assert.ok(data.pieces.length > 500, `物件 ${data.pieces.length}`);
  const categories = new Set(PIECE_CATEGORIES.map(category => category.id));
  for (const category of categories) assert.ok(data.pieces.some(piece => piece.category === category), `${category} 没有物件`);
  const slots = new Set<number>();
  const ids = new Set<string>();
  const perSheet = data.columns * data.rows;
  for (const item of [...data.pieces, ...data.textures, ...data.skies]) {
    assert.ok(!slots.has(item.slot), `格子 ${item.slot} 重复`);
    slots.add(item.slot);
    assert.ok(item.slot >= 0 && item.slot < sheetFiles.length * perSheet, `格子 ${item.slot} 超出雪碧图`);
    assert.ok(!ids.has(item.id), `id ${item.id} 重复`);
    ids.add(item.id);
  }
  for (const file of sheetFiles) assert.ok(existsSync(new URL(`./catalog/${file}`, import.meta.url)), file);
  for (const piece of data.pieces) {
    assert.ok(categories.has(piece.category), piece.id);
    assert.ok(piece.max.every((v, i) => v >= piece.min[i]!), `${piece.id} 包围盒`);
    assert.ok(piece.label.length > 0);
  }
  assert.ok(data.presets.length >= 10);
  for (const preset of data.presets) {
    assert.ok(ids.has(preset.sky) && ids.has(preset.surface), preset.theme);
    if (preset.wall) assert.ok(ids.has(preset.wall));
    if (preset.ground) assert.ok(ids.has(preset.ground));
    assert.equal(data.textures.find(texture => texture.id === preset.surface)?.kind, "surface");
  }
  // 路面不能带掉落重置、减速之类的 surface 属性
  for (const texture of data.textures.filter(item => item.kind === "surface"))
    assert.ok(!texture.road?.some(([key]) => key === "surface" || key === "movable"), texture.id);
});

test("素材目录：筛选、名字和雪碧图位置", () => {
  const trees = filterPieces(data, "tree", "", "");
  assert.ok(trees.length > 20 && trees.every(piece => piece.category === "tree"));
  assert.ok(filterPieces(data, "tree", "ice", "").every(piece => piece.theme === "ice"));
  assert.deepEqual(filterPieces(data, "tree", "", "没有这种东西"), []);
  assert.equal(textureLabel({ kind: "surface", name: "x_road", road: [["sound", "모래바닥"]] }), "沙地");
  assert.equal(textureLabel({ kind: "surface", name: "cement_00", road: [] }), "水泥");
  assert.equal(textureLabel({ kind: "wall", name: "handrail" }), "扶手");
  const style = spriteStyle(data, ["a.webp", "b.webp"], data.columns * data.rows + data.columns + 2, 48);
  assert.match(style, /url\("b\.webp"\)/);
  assert.match(style, /background-position:-96px -48px/);
  assert.match(style, new RegExp(`background-size:${data.columns * 48}px auto`));
});

test("新建向导：每种主题 × 形状生成的地图都能直接生成赛道，装饰不压路", () => {
  for (const [index, template] of TRACK_TEMPLATES.entries()) {
    const preset = data.presets[index % data.presets.length]!;
    const design = wizardDesign(data, { name: template.title, preset, template, decorate: true, items: true });
    assert.deepEqual(validateDesign(design), [], `${preset.theme}/${template.id}`);
    assert.equal(design.theme, preset.theme);
    assert.ok(design.items.rows.length >= 3, "道具箱");
    assert.ok(design.pieces.length > 10, `${template.id} 只装饰了 ${design.pieces.length} 个`);
    const road = design.roads[0]!;
    const sample = sampleRoad(road, 4);
    for (const piece of design.pieces) {
      const near = Math.min(...sample.points.map(p => Math.hypot(p[0] - piece.position[0], p[1] - piece.position[1])));
      assert.ok(near >= road.width / 2 + 1.5, `${template.id} 的「${piece.label}」离路中线只有 ${near.toFixed(1)} 米`);
    }
    // 地面盖住整条路
    const extent = Math.max(...road.points.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
    assert.ok(design.ground!.size / 2 > extent + 100);
  }
  const blank = wizardDesign(data, { name: "空白", decorate: true, items: true });
  assert.equal(blank.roads.length, 0);
  assert.equal(blank.pieces.length, 0);
  assert.deepEqual(decorateRoute(blank, data), []);
});

const root = fileURLToPath(new URL("../../../", import.meta.url));
const mirrorReady = existsSync(`${root}mirror/p3553/track_village_R01.rho`);

test("真实 p3553：目录里的物件在官方赛道里还在，包围盒一致（抽查）", { skip: !mirrorReady }, async () => {
  const { loadResourceLibrary } = await import("../../tools/economy-export/resource-library.mjs");
  const { library, formats } = await loadResourceLibrary(root, "p3553", root);
  const { listPieces, loadSourceModel } = await import("./source-tracks");
  const tracks = [...new Set(data.pieces.map(piece => piece.track))].sort();
  const sample = tracks.filter((_, i) => i % Math.ceil(tracks.length / 24) === 0);
  for (const track of sample) {
    const pieces = listPieces(await loadSourceModel(library, formats, track));
    for (const entry of data.pieces.filter(piece => piece.track === track)) {
      const found = pieces.find(piece => piece.path.join(".") === entry.path.join("."));
      assert.ok(found, `${entry.id} 找不到`);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(found.min[i]! - entry.min[i]!) < 0.05 && Math.abs(found.max[i]! - entry.max[i]!) < 0.05, `${entry.id} 包围盒变了`);
      }
    }
  }
});
