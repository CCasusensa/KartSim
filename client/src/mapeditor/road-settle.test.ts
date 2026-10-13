import assert from "node:assert/strict";
import { test } from "node:test";

import type { RoadPoint } from "./design";
import { sampleRoad } from "./road-geometry";
import { MAX_GRADE, ROAD_CLEARANCE, settleRoad } from "./road-settle";

const ring = (count: number, radius: number, z = 0): RoadPoint[] => Array.from({ length: count }, (_, i) => {
  const a = (i / count) * Math.PI * 2;
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, z };
});

test("路面高度不会在两个路点之间冲到更低的地方（不钻进地面）", () => {
  // 两头高、中间两个点贴地：Catmull-Rom 会在两个低点之间往下冲
  const road = { closed: false, width: 20, points: [
    { x: 0, y: 0, z: 12 }, { x: 40, y: 0, z: 0 }, { x: 80, y: 0, z: 0 }, { x: 120, y: 0, z: 12 }] };
  const sample = sampleRoad(road, 1);
  const lowest = Math.min(...sample.points.map(p => p[2]));
  assert.ok(lowest >= -1e-9, `最低点 ${lowest}`);
  // 单调：从 12 下到 0 的一段不会先往上冲
  for (const p of sample.points) assert.ok(p[2] <= 12 + 1e-9);
});

test("修顺：贴着地面画的点抬到地面上方，太近的点去掉，闭合处落在起点旁边的点去掉", () => {
  const points = ring(10, 200, -0.25);
  points.splice(3, 0, { x: points[2]!.x + 1, y: points[2]!.y + 1, z: -0.25 });
  points.push({ x: points[0]!.x + 2, y: points[0]!.y - 2, z: -0.25 });
  const result = settleRoad({ closed: true, width: 22, points }, -0.3);
  assert.equal(result.points.length, 10);
  assert.equal(result.merged, 2);
  for (const point of result.points) assert.ok(point.z >= -0.3 + ROAD_CLEARANCE - 1e-9);
  assert.equal(result.lifted, 10);
});

test("修顺：急弯修圆到内侧边不翻折，平常的弯不动", () => {
  // 发夹弯：拐点两边很短
  const points: RoadPoint[] = [
    { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 112, y: 6, z: 0 }, { x: 100, y: 12, z: 0 }, { x: 0, y: 30, z: 0 },
  ];
  const result = settleRoad({ closed: false, width: 20, points }, undefined);
  assert.ok(result.rounded > 0);
  const gentle = settleRoad({ closed: true, width: 20, points: ring(16, 260) }, undefined);
  assert.equal(gentle.rounded, 0);
  assert.equal(gentle.merged, 0);
  assert.deepEqual(gentle.points, ring(16, 260));
});

test("修顺：太陡的坡分摊到两头，地面以上", () => {
  const points: RoadPoint[] = [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 30 }, { x: 60, y: 0, z: 30 }];
  const result = settleRoad({ closed: false, width: 20, points }, -0.3);
  for (let i = 0; i + 1 < result.points.length; i++) {
    const a = result.points[i]!, b = result.points[i + 1]!;
    assert.ok(Math.abs(b.z - a.z) <= MAX_GRADE * Math.hypot(b.x - a.x, b.y - a.y) + 0.05, `第 ${i + 1} 段太陡`);
  }
  assert.ok(result.points.every(point => point.z >= 0));
});
