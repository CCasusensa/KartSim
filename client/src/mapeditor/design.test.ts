import assert from "node:assert/strict";
import { test } from "node:test";

import {
  customTrackId, draftTrackId, isCustomTrackId, isDraftTrackId, mapIdOfTrack, newDesign, parseDesign, rotatePiecesAboutCenter,
  validateDesign, type MapDesign,
} from "./design";
import { parseMapSummary } from "./map-service";

function loopDesign(): MapDesign {
  const design = newDesign("测试");
  design.id = "abcdef1234";
  design.roads.push({
    id: "r1", name: "主赛道", closed: true, route: true, width: 20, uvLength: 20, thickness: 0,
    surface: { track: "village_R01", name: "cement_00", road: [] },
    walls: { left: null, right: null },
    points: [{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }, { x: 200, y: 200, z: 5 }, { x: 0, y: 200, z: 0 }],
  });
  return design;
}

test("地图设计：合法的环线没有问题，缺路线、未闭合、越界都会报出来", () => {
  assert.deepEqual(validateDesign(loopDesign()), []);
  const noRoute = loopDesign();
  noRoute.roads[0]!.route = false;
  assert.ok(validateDesign(noRoute).some(issue => issue.includes("比赛路线")));
  const open = loopDesign();
  open.roads[0]!.closed = false;
  assert.ok(validateDesign(open).some(issue => issue.includes("必须闭合")));
  const far = loopDesign();
  far.roads[0]!.points[1]!.x = 99999;
  assert.ok(validateDesign(far).some(issue => issue.includes("超出")));
  const badLaps = loopDesign();
  badLaps.laps = 12;
  assert.ok(validateDesign(badLaps).some(issue => issue.includes("圈数")));
  const badPiece = loopDesign();
  badPiece.pieces.push({ id: "p1", track: "village_R01", path: [0, -1], label: "x", origin: [0, 0, 0],
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  assert.ok(validateDesign(badPiece).some(issue => issue.includes("摆件")));
});

test("地图设计：读档补全缺省字段，不是设计文件就拒绝", () => {
  const design = loopDesign();
  const text = JSON.stringify({ ...design, difficulty: undefined, start: undefined,
    roads: design.roads.map(road => ({ ...road, walls: undefined, thickness: undefined })) });
  const parsed = parseDesign(text);
  assert.equal(parsed.difficulty, 2);
  assert.deepEqual(parsed.start, { offset: 0 });
  assert.deepEqual(parsed.roads[0]!.walls, { left: null, right: null });
  assert.throws(() => parseDesign(JSON.stringify({ format: "other" })), /不是地图工坊/);
});

test("自制地图的赛道 id：发布版与草稿分开，服务端认得这种 id", () => {
  assert.equal(customTrackId("abcdef1234"), "custom_abcdef1234");
  assert.equal(draftTrackId("abcdef1234"), "custom_abcdef1234_draft");
  assert.ok(isCustomTrackId("custom_abcdef1234") && isCustomTrackId("custom_abcdef1234_draft"));
  assert.ok(!isCustomTrackId("village_R01") && !isCustomTrackId("custom_ABC"));
  assert.ok(isDraftTrackId("custom_abcdef1234_draft") && !isDraftTrackId("custom_abcdef1234"));
  assert.equal(mapIdOfTrack("custom_abcdef1234"), "abcdef1234");
  assert.equal(mapIdOfTrack("custom_abcdef1234_draft"), undefined);
  // 游戏节点 lobby identifierPattern：^[A-Za-z][A-Za-z0-9_]{0,63}$
  assert.match(customTrackId("abcdef1234"), /^[A-Za-z][A-Za-z0-9_]{0,63}$/);
});

test("服务端地图摘要：坏 id、坏文件名和缺 track.1s 的摘要被拒绝", () => {
  const good = { id: "abcdef1234", name: "环线", theme: "village", laps: 3, difficulty: 2, roadExtent: 900,
    sha256: "aa", size: 10, files: [{ path: "track.1s", size: 5 }, { path: "x.dds", size: 5 }], updatedAt: 1 };
  const summary = parseMapSummary(good);
  assert.equal(summary.source, "server");
  assert.equal(summary.files.length, 2);
  assert.throws(() => parseMapSummary({ ...good, id: "../x" }));
  assert.throws(() => parseMapSummary({ ...good, files: [{ path: "x.dds", size: 1 }] }));
  assert.equal(parseMapSummary({ ...good, files: [...good.files, { path: "../evil", size: 1 }] }).files.length, 2);
});

test("多选旋转：绕选中摆件的中心整体转，相对位置不变，转一整圈回到原处", () => {
  const pieces = () => [
    { position: [10, 0, 1] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
    { position: [30, 0, 2] as [number, number, number], rotation: [350, 5, 0] as [number, number, number] },
  ];
  const turned = pieces();
  rotatePiecesAboutCenter(turned, 90);
  // 中心 (20, 0)：两件绕它逆时针转 90°，不是各自原地转
  assert.deepEqual(turned.map(piece => piece.position), [[20, -10, 1], [20, 10, 2]]);
  assert.deepEqual(turned.map(piece => piece.rotation), [[90, 0, 0], [80, 5, 0]]);
  const circle = pieces();
  for (let i = 0; i < 24; i++) rotatePiecesAboutCenter(circle, 15);
  assert.deepEqual(circle, pieces());
  // 只选一个时原地转
  const single = [{ position: [5, 6, 7] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }];
  rotatePiecesAboutCenter(single, -15);
  assert.deepEqual(single, [{ position: [5, 6, 7], rotation: [345, 0, 0] }]);
});
