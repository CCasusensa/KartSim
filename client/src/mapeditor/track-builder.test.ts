/**
 * 用真实 p3553 资源生成一张自制地图：游戏自己的路线/碰撞解析能读懂它，
 * 挂进资源库后计时赛目录、元数据、贴图查找都能找到（sparse worktree 没有
 * mirror/p3553 时跳过）。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { customTrackId, draftTrackId, newDesign, type MapDesign } from "./design";
import { customTrackChoices, customTrackPath, registerCustomMap, removeCustomMap, type CustomMapSummary } from "./custom-tracks";
import { listPieces, loadSourceModel, placementMatrix, applyAffine } from "./source-tracks";
import { buildCustomTrack } from "./track-builder";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const mirrorReady = existsSync(`${root}mirror/p3553/track_village_R01.rho`) && existsSync(`${root}mirror/p3553/track_common.rho`);

async function sampleDesign(library: any, formats: any): Promise<MapDesign> {
  const design = newDesign("测试环线");
  design.id = "test000001";
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return { x: Math.cos(a) * 220, y: Math.sin(a) * 140, z: i >= 3 && i <= 5 ? 10 : 0 };
  });
  design.roads.push({
    id: "r1", name: "主赛道", closed: true, route: true, points, width: 24, uvLength: 24, thickness: 1.5,
    surface: { track: "village_R01", name: "cement_00", road: [] },
    walls: { left: { texture: { track: "village_R01", name: "handrail", alpha: "test" }, height: 1.2, visible: true },
      right: { texture: { track: "village_R01", name: "handrail", alpha: "test" }, height: 1.2, visible: false } },
  });
  design.ground = { texture: { track: "village_I01", name: "tilegrass_128_03" }, size: 700, z: -0.3, tile: 16, drivable: true };
  design.start.offset = 30;
  const pieces = listPieces(await loadSourceModel(library, formats, "village_R01"));
  const house = pieces.find(piece => piece.name === "Object03")!;
  design.pieces.push({ id: "p1", track: "village_R01", path: house.path, label: house.name, origin: house.origin,
    position: [0, 0, 0], rotation: [45, 0, 0], scale: [1, 1, 1] });
  design.pieces.push({ id: "p2", track: "village_R01", path: house.path, label: house.name, origin: house.origin,
    position: [40, 20, 0], rotation: [0, 0, 0], scale: [2, 2, 2] });
  return design;
}

test("摆件放置矩阵：来源对齐点落在 position，先缩放再绕 z 旋转", () => {
  const matrix = placementMatrix({ origin: [10, 20, 3], position: [100, 0, 5], rotation: [90, 0, 0], scale: [2, 2, 2] });
  assert.deepEqual(applyAffine(matrix, [10, 20, 3]).map(v => Math.round(v * 1e6) / 1e6), [100, 0, 5]);
  const moved = applyAffine(matrix, [11, 20, 3]); // 东 1 米 → 缩放 2 倍后转 90° 到北 2 米
  assert.ok(Math.abs(moved[0] - 100) < 1e-9 && Math.abs(moved[1] - 2) < 1e-9);
});

test("真实 p3553：生成的赛道包能被游戏读成闭合路线，挂进资源库后可选、可读、贴图可查", { skip: !mirrorReady }, async () => {
  const { loadResourceLibrary } = await import("../../tools/economy-export/resource-library.mjs");
  const { library, formats } = await loadResourceLibrary(root, "p3553", root);
  const design = await sampleDesign(library, formats);
  const built = await buildCustomTrack(design, { library, formats });
  assert.deepEqual(built.warnings, []);
  assert.equal(built.stats.pieces, 2);
  assert.equal(built.containerName, "track_custom_test000001.rho");
  for (const name of ["track.1s", "skydome.1s", "track.xml", "xt_minimap.png", "xt_trackCard.png", "xt_trackThumb.png"])
    assert.ok(built.files.some(file => file.path === name), name);

  // 游戏的路线与碰撞解析（formats.YW，与比赛载入相同）
  const trackFile = built.files.find(file => file.path === "track.1s")!;
  const parsed = formats.y9(trackFile.bytes);
  const road = formats.YW(parsed, "speed-individual", { forceReverse: false, roadExtent: built.roadExtent });
  assert.deepEqual(road.roadIssues ?? [], []);
  assert.equal(road.sections.length, built.stats.gates);
  assert.ok(road.collisionTriangles.length > 1000);
  // 起点在路线第一个点之后 30 米处（客户端 → three：x, z, −y）
  const start = road.start.position;
  const expected = [design.roads[0]!.points[0]!.x + built.offset[0], design.roads[0]!.points[0]!.y + built.offset[1]];
  assert.ok(Math.hypot(start.x - expected[0]!, -start.z - (expected[1]! + 30)) < 10, `起点 ${start.x},${-start.z}`);

  // 挂进资源库：计时赛目录、元数据、文件读取和贴图查找
  const summary: CustomMapSummary = {
    id: design.id, name: design.name, author: "", theme: design.theme, laps: design.laps, difficulty: design.difficulty,
    roadExtent: built.roadExtent, sha256: "local", size: built.container.length,
    files: built.files.map(file => ({ path: file.path, size: file.bytes.length })), updatedAt: Date.now(), source: "local",
  };
  const before = library.files.length;
  registerCustomMap(library, summary, { container: async () => built.container });
  try {
    const trackId = draftTrackId(design.id);
    assert.ok(customTrackChoices().some(choice => choice.id === trackId));
    assert.ok(!customTrackChoices(true).some(choice => choice.id === trackId), "草稿不进多人目录");
    const catalog = await library.timeAttackTrackCatalog();
    const choice = catalog.find((entry: { id: string }) => entry.id === trackId);
    assert.equal(choice?.path, customTrackPath(trackId));
    const metadata = await library.trackMetadata(trackId);
    assert.equal(metadata?.cnTitle, "[草稿] 测试环线");
    assert.equal(metadata?.roadExtent, built.roadExtent);
    const entry = library.get(customTrackPath(trackId));
    assert.deepEqual(await entry.bytes(), trackFile.bytes);
    // 贴图在赛道自己的目录里找到（不依赖来源赛道的主题目录）
    const model = formats.y9(await entry.bytes()).root;
    const names = new Set<string>();
    const walk = (node: any) => { const slot = node.slots?.[7]; if (slot?.kind === "texture" && slot.name) names.add(slot.name); node.children.forEach(walk); };
    walk(model.scene);
    assert.ok(names.size >= 4);
    for (const name of names) {
      const found = formats.sn(library, customTrackPath(trackId), metadata, { name });
      assert.equal(found.status, "found", name);
      assert.ok(found.entry.virtualPath.startsWith(`track_${trackId}/`), found.entry.virtualPath);
    }
  } finally {
    removeCustomMap(library, draftTrackId(design.id));
  }
  assert.equal(library.files.length, before);
  assert.equal(library.get(customTrackPath(customTrackId(design.id))), undefined);
});
