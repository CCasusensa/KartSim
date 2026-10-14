import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { matrixFromQuaternion, setBodyBasis } from "../driving/orientation-math";
import { mirrorArchives } from "../resources/mirror-archives.test-support";
import type { DuelRaceRequest } from "../ui/ready-missions";
import { duelNpcGhost } from "./ready-duel";
import type { DuelStage } from "./timeattack-api";

interface Stamp { time: number; x: number; y: number; w: number; qx: number; qy: number; qz: number }

const missions = JSON.parse(readFileSync(new URL("../../../server-go/internal/data/timeattack/missions.json",
  import.meta.url), "utf8")) as { duels: Array<{ trackId: string; stages: Array<DuelStage & { npcTimeMs: number }> }> };
const library = {
  exactCanonicalCandidates: (path: string) => path.startsWith("zeta_/cn/content/timeAttack/ksv/")
    ? [{ bytes: () => mirrorArchives().read("DataPack4", path) }] : [],
};
const catalog = { karts: [{ itemId: 1531, path: "kart" }], characters: [{ itemId: 8, path: "rider" }] };

function request(trackId: string, stage: number, difficulty: number): DuelRaceRequest {
  const row = missions.duels.find(duel => duel.trackId === trackId)!.stages[stage - 1]!;
  return { event: { trackId } as never, stage: { ...row, targetMs: row.npcTimeMs, rewards: [] },
    standing: {} as never, difficulty };
}

test("赛道对决的 NPC 播放原版录像：倒计时里停在起跑位，第 7 秒出发，车头朝行驶方向", async () => {
  const duel = request("tomb_I09", 1, 2);
  assert.equal(duel.stage.ksv, "tomb_I09_20260917_2_1");
  assert.equal(duel.stage.targetMs, 118_040); // the recording's best time, 1:58.04
  const ghost = await duelNpcGhost(library, duel, "tomb_I09", catalog);
  // Dressed as the mission's NPC (npcId 8, itemOn kart 1531 color 1 dye 4), from its recorded slot.
  assert.equal(ghost.equipment.playerName, "小乖");
  assert.equal(ghost.equipment.character, 8);
  assert.equal(ghost.equipment.kart, 1531);
  assert.equal(ghost.equipment.kartPaint, 1);
  assert.equal(ghost.equipment.characterColor, 4);
  assert.equal(ghost.equipment.startSlot, 0);
  // 难度设定 level 2: the NPC sets off 3 s later.
  assert.equal(ghost.timeOffsetMs, -3000);

  // Stamp 0 is the sentinel; the record starts at the countdown, GO is at 7 s.
  const stamps = (ghost.record as { stamps: Stamp[] }).stamps.slice(1);
  const grid = stamps[0]!;
  const moved = (stamp: Stamp) => Math.hypot(stamp.x - grid.x, stamp.y - grid.y) > 5;
  assert.ok(stamps.filter(stamp => stamp.time < 70).every(stamp => !moved(stamp)), "NPC 在 GO 之前不动");
  const start = stamps.findIndex(moved);
  assert.ok(stamps[start]!.time >= 70 && stamps[start]!.time <= 72, `NPC 在 ${stamps[start]!.time * 100} ms 出发`);
  // Its last stamp is a little after the finish (1:58.04 from GO).
  assert.ok(stamps.at(-1)!.time * 100 > 7000 + duel.stage.targetMs);

  // The kart faces where it goes: heading vs the next second's travel, while under way.
  const angles: number[] = [];
  for (let index = start + 20; index + 10 < stamps.length; index += 10) {
    const stamp = stamps[index]!, next = stamps[index + 10]!;
    // Wire → world: x, y = −z; the stored quaternion is the body basis (orientation-math.ts).
    const travel = { x: next.x - stamp.x, z: -(next.y - stamp.y) };
    if (Math.hypot(travel.x, travel.z) < 50) continue;
    const body = { right: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 } };
    setBodyBasis(body as never, matrixFromQuaternion({ w: stamp.w / 1e4, x: stamp.qx / 1e4, y: stamp.qy / 1e4,
      z: stamp.qz / 1e4 }));
    const dot = (body.forward.x * travel.x + body.forward.z * travel.z) /
      (Math.hypot(body.forward.x, body.forward.z) * Math.hypot(travel.x, travel.z));
    angles.push(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
  }
  angles.sort((a, b) => a - b);
  assert.ok(angles.length > 50);
  assert.ok(angles[Math.floor(angles.length / 2)]! < 15, `车头与行驶方向的中位夹角 ${angles[Math.floor(angles.length / 2)]}°`);
});

test("每个对决阶段都有原版录像，目标时间就是录像成绩", async () => {
  for (const duel of missions.duels) {
    for (const stage of duel.stages) {
      const ghost = await duelNpcGhost(library, request(duel.trackId, stage.stage, 0), duel.trackId, catalog);
      assert.equal(ghost.equipment.playerName, stage.npc.name);
      assert.equal(ghost.timeOffsetMs, 0);
      assert.ok(stage.npcTimeMs > 60_000, `${stage.ksv} ${stage.npcTimeMs}`);
    }
  }
  const missing = request("tomb_I09", 1, 0);
  missing.stage.ksv = "";
  await assert.rejects(duelNpcGhost(library, missing, "tomb_I09", catalog), /对决录像/);
});
