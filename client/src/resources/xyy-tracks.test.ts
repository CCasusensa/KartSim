/**
 * 重建的喜羊羊赛道（tools/xyy/build.mjs）：用真实 p3553 资源检查目录、路线
 * 解析，并把原版 7 条 AI 线整场比赛的轨迹喂给游戏的路线状态，每条线（含
 * 走岔路的）都要按原版圈数跑完。sparse worktree 没有 mirror/p3553 时跳过。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resetRouteState, updateRoute } from "../world/route-state";
import { XYY_TRACK_OFFSETS, XYY_TRACK_TITLES } from "./xyy-tracks";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const mirrorReady = ["track_xyy_I01.rho", "track_xyy_R01.rho", "track_xyy_R02.rho", "track_common.rho"]
  .every(name => existsSync(`${root}mirror/p3553/${name}`));

test("真实 p3553：喜羊羊三张赛道可选、路线完整，原版 AI 线按圈数跑完", { skip: !mirrorReady }, async () => {
  const { loadResourceLibrary } = await import("../../tools/economy-export/resource-library.mjs");
  const { decodeKap, splitLaps } = await import("../../tools/xyy/ai-path.mjs");
  const { library, formats } = await loadResourceLibrary(root, "p3553", root);
  const catalog = await library.timeAttackTrackCatalog();
  for (const [id, title] of Object.entries(XYY_TRACK_TITLES)) {
    const choice = catalog.find((entry: { id: string }) => entry.id === id);
    assert.equal(choice?.title, title, id);
    assert.equal(choice?.theme, "xyy");
    const metadata = await library.trackMetadata(id);
    const entry = library.files.find((file: { virtualPath: string }) => file.virtualPath === choice!.path)!;
    const road = formats.YW(formats.y9(await entry.bytes()), "speed-individual", { forceReverse: false });
    assert.deepEqual(road.roadIssues ?? [], [], id);
    // 原版坐标 + 平移 → 游戏世界坐标（x, z 向上 → three：x, y, z = x, z, -y）
    const [dx, dy] = XYY_TRACK_OFFSETS[id]!;
    const world = (p: number[]) => ({ x: p[0]! + dx, y: p[2]!, z: -(p[1]! + dy) });
    const host = { sections: road.sections, data: { firstSection: road.firstSection, lastSection: road.lastSection, lapTarget: metadata.laps },
      routeStates: new WeakMap<object, never>() } as never;
    const kaps = library.files.filter((file: { virtualPath: string }) => new RegExp(`aiPath/${id}_\\d+\\.kap$`, "i").test(file.virtualPath));
    assert.equal(kaps.length, 7, id);
    for (const kap of kaps) {
      const { start, laps } = splitLaps(decodeKap(await kap.bytes()));
      // 发车位在第 0 门的帧附近（起点 = 第 0 段的第一帧）
      const s = road.start.position;
      assert.ok(Math.hypot(s.x - world(start).x, s.z - world(start).z) < 12, `${kap.virtualPath} 起点 ${s.x},${-s.z}`);
      const vehicle = {};
      resetRouteState(host, vehicle, world(start) as never);
      let previous = world(start);
      let state: { lap: number } = { lap: 0 };
      for (const point of laps.flat()) {
        const current = world(point);
        state = updateRoute(host, vehicle, previous as never, current as never);
        previous = current;
      }
      // 整场比赛：起跑过线进第 1 圈，跑完 laps 圈再过线
      assert.ok(state.lap >= metadata.laps, `${kap.virtualPath}: lap ${state.lap} / ${metadata.laps}`);
    }
  }
});
