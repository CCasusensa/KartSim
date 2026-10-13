import assert from "node:assert/strict";
import { test } from "node:test";

import { newDesign, validateDesign, type StartArch } from "./design";
import { pointAtDistance, sampleRoad } from "./road-geometry";
import { START_ARCH_ID, startArchPiece, startLineDepth, startLineFor } from "./start-line";
import { TRACK_TEMPLATES, templateRoad } from "./templates";

const arch: StartArch = { track: "village_I12", path: [0, 66], label: "起点拱门", origin: [10, 20, 0], min: [5, -3, 0], max: [15, 43, 24] };

test("起点拱门：立在起跑线中间，长边横跨路面，按路宽缩放", () => {
  const design = newDesign("拱门");
  design.roads.push(templateRoad(TRACK_TEMPLATES[0]!, "r1"));
  design.start = { offset: 120, arch };
  assert.deepEqual(validateDesign(design), []);
  const piece = startArchPiece(design)!;
  assert.equal(piece.id, START_ARCH_ID);
  assert.deepEqual(piece.path, arch.path);
  const sample = sampleRoad(design.roads[0]!, 2);
  const at = pointAtDistance(sample, 120);
  assert.ok(Math.hypot(piece.position[0] - at.position[0], piece.position[1] - at.position[1]) < 0.02, "在起跑线上");
  // 长边沿 y（46 米）：本来就横着，朝向等于路的方向
  const tangent = sample.tangents[at.index]!;
  const heading = ((Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI + 360) % 360;
  assert.ok(Math.abs(((piece.rotation[0] - heading + 540) % 360) - 180) < 0.1, `${piece.rotation[0]} vs ${heading}`);
  // 路宽 24 → 跨度 34 米 / 46 米
  assert.ok(Math.abs(piece.scale[0] - 34 / 46) < 0.01, String(piece.scale[0]));
  // 长边沿 x 时转 90°
  const wide = startArchPiece({ ...design, start: { offset: 120, arch: { ...arch, min: [-3, 5, 0], max: [43, 15, 24] } } })!;
  assert.ok(Math.abs(((wide.rotation[0] - heading - 90 + 720) % 360)) < 0.1 || Math.abs(((wide.rotation[0] - heading - 90 + 720) % 360) - 360) < 0.1);
});

test("起点拱门：不要拱门、没有闭合路线时不放；拱门设置坏了会报出来", () => {
  const design = newDesign("拱门");
  design.start = { offset: 0, arch };
  assert.equal(startArchPiece(design), undefined, "还没有赛道");
  design.roads.push(templateRoad(TRACK_TEMPLATES[0]!, "r1"));
  design.start.arch = null;
  assert.equal(startArchPiece(design), undefined, "不要拱门");
  design.start.arch = { ...arch, path: [] };
  assert.ok(validateDesign(design).some(issue => issue.includes("拱门")));
});

test("起跑线：主题贴图与长度", () => {
  assert.equal(startLineFor("village").name, "cement06_start");
  assert.equal(startLineFor("没有这个主题").name, "cement_start");
  assert.ok(startLineDepth(22, startLineFor("mine")) <= 8);
  assert.ok(startLineDepth(4, startLineFor("village")) >= 2);
});
