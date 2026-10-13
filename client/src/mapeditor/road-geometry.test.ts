import assert from "node:assert/strict";
import { test } from "node:test";

import { pointAtDistance, roadEdge, rotateClosedSample, sampleRoad } from "./road-geometry";

const square = {
  closed: true, width: 20,
  points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 100, z: 0 }, { x: 0, y: 100, z: 0 }],
};

test("样条道路：曲线经过每个控制点，闭合环不重复首点，长度接近外接多边形", () => {
  const sample = sampleRoad(square, 2);
  assert.ok(sample.closed);
  for (const point of square.points)
    assert.ok(sample.points.some(p => Math.hypot(p[0] - point.x, p[1] - point.y) < 1e-6), `经过 ${point.x},${point.y}`);
  const first = sample.points[0]!, last = sample.points[sample.points.length - 1]!;
  assert.ok(Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.5);
  assert.ok(sample.total > 300 && sample.total < 450, `周长 ${sample.total}`);
  // 逆时针走：南边那条边的中段前向朝 +x，左侧朝 +y
  let middle = 0;
  sample.points.forEach((p, i) => { if (Math.hypot(p[0] - 50, p[1]) < Math.hypot(sample.points[middle]![0] - 50, sample.points[middle]![1])) middle = i; });
  assert.ok(sample.lefts[middle]![1] > 0.9);
  const edge = roadEdge(sample, middle, 10);
  assert.ok(Math.abs(edge[1] - sample.points[middle]![1] - 10) < 0.5, "左边缘在中线北侧 10 米");
});

test("样条道路：倾斜抬高左边缘，宽度按控制点插值", () => {
  const banked = sampleRoad({ ...square, points: square.points.map(p => ({ ...p, bank: 20, width: 30 })) }, 2);
  const left = roadEdge(banked, 0, banked.widths[0]! / 2), right = roadEdge(banked, 0, -banked.widths[0]! / 2);
  assert.ok(left[2] > right[2] + 5, "左高右低");
  assert.equal(banked.widths[0], 30);
  assert.ok(banked.normals.every(n => n[2] > 0.8), "路面法线朝上");
});

test("样条道路：按距离取点与旋转起点", () => {
  const sample = sampleRoad(square, 2);
  const half = pointAtDistance(sample, sample.total / 2);
  assert.ok(Math.hypot(half.position[0] - 100, half.position[1] - 100) < 30, "半圈在对角附近");
  const rotated = rotateClosedSample(sample, 50);
  assert.equal(rotated.points.length, sample.points.length);
  assert.ok(Math.abs(rotated.points[0]![0] - pointAtDistance(sample, 50).position[0]) < 3);
  assert.equal(rotated.s[0], 0);
  const open = sampleRoad({ ...square, closed: false }, 2);
  assert.ok(!open.closed);
  assert.deepEqual(open.points[open.points.length - 1], [0, 100, 0]);
});
