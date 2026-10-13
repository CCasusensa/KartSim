import assert from "node:assert/strict";
import { test } from "node:test";

import { newDesign, validateDesign } from "./design";
import { sampleRoad } from "./road-geometry";
import { TRACK_TEMPLATES, templateRoad } from "./templates";

test("赛道模板：都是能直接试跑的闭合比赛路线，长度适中", () => {
  for (const template of TRACK_TEMPLATES) {
    const design = newDesign(template.title);
    design.roads.push(templateRoad(template, "r1"));
    assert.deepEqual(validateDesign(design), [], template.id);
    const sample = sampleRoad(design.roads[0]!, 2);
    assert.ok(sample.total > 900 && sample.total < 3200, `${template.id} 长 ${sample.total.toFixed(0)} 米`);
  }
});

test("赛道模板：路不会压到自己身上（8 字立交的交叉处上下差够高）", () => {
  for (const template of TRACK_TEMPLATES) {
    const road = templateRoad(template, "r1");
    const sample = sampleRoad(road, 4);
    const points = sample.points;
    const along = (i: number, j: number) => {
      const d = Math.abs(sample.s[i]! - sample.s[j]!);
      return Math.min(d, sample.total - d);
    };
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (along(i, j) < road.width * 3) continue;
        const a = points[i]!, b = points[j]!;
        const flat = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (flat >= road.width + 4) continue;
        // 只有立交允许平面上重叠，而且上下层要错开 20 米以上
        assert.equal(template.id, "eight", `${template.id} 在 ${a.map(v => v.toFixed(0))} 处压到自己`);
        assert.ok(Math.abs(a[2] - b[2]) >= 20, `立交上下层只差 ${Math.abs(a[2] - b[2]).toFixed(1)} 米`);
      }
    }
  }
});
