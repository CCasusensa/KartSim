import assert from "node:assert/strict";
import test from "node:test";

import { ksvCompression } from "../codecs/ksv-compression";
import { decodeKsvFile } from "../game/ghost/ksv-codec";
import { courseLine, generateNpcGhostRecord, quantizeStamp } from "./duel-npc-ghost";
import { encodeRunReplay, ghostZCeiling, rankedRaceOf, recordSpeedChannel, replayBase64 } from "./ranked-race";

test("a ranked run's recording round-trips through the .ksv file the ranking keeps", () => {
  const stamps = Array.from({ length: 30 }, (_unused, index) => quantizeStamp({ timeMs: index * 100, x: index * 2,
    y: -5, z: 600 + index, w: 1, qx: 0, qy: 0, qz: 0, status: index % 2 ? 128 : 0 }, 1500));
  const equipment = { character: 1, kart: 1531, kartPaint: 1, characterColor: 4, plate: 0, goggle: 0, balloon: 0,
    headBand: 0, handGearL: 0, plateText: "", playerName: "Ta", startSlot: 0 };
  const bytes = encodeRunReplay({ record: { stamps } }, equipment, "tomb_I09", 118_000, 7);
  assert.ok(bytes.length > 0);
  const decoded = decodeKsvFile(bytes, ghostZCeiling("tomb_I09"), ksvCompression) as unknown as {
    bestTimeMs: number; trackName: string; players: Array<{ playerName: string }>; records: Array<{ stamps: unknown[] }> };
  assert.equal(decoded.bestTimeMs, 118_000);
  assert.equal(decoded.trackName, "tomb_I09");
  assert.equal(decoded.players[0]?.playerName, "Ta");
  assert.equal(decoded.records[0]?.stamps.length, 30);
  // base64 of the file is what the settle body carries.
  assert.equal(Buffer.from(replayBase64(bytes), "base64").length, bytes.length);
  assert.equal(ghostZCeiling("transformer_R02"), 3000);
});

test("the record speed channel and the ranked marker follow the Ready options and selection", () => {
  assert.equal(recordSpeedChannel({ speed: 7 }), 7);
  assert.equal(recordSpeedChannel({ speed: 4, version: "国服", settingSpeed: 7 }), 4);
  assert.equal(recordSpeedChannel({ speed: 7, version: "国服", settingSpeed: 3 }), 3);
  assert.equal(rankedRaceOf({ ranked: { requestId: "r", speed: 7, booster: 0 } })?.requestId, "r");
  assert.equal(rankedRaceOf({}), undefined);
  assert.equal(rankedRaceOf(undefined), undefined);
});

test("the duel NPC drives the course line and finishes in the stage's time", () => {
  const frame = (x: number, z: number) => ({ position: { x, y: 0, z }, forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } });
  const course = {
    sections: [
      { frames: [frame(0, 0), frame(100, 0)], length: 100, outgoing: [{ section: 1 }] },
      { frames: [frame(100, 0), frame(100, 50)], length: 50, outgoing: [{ section: 0 }] },
    ],
    firstSection: 0, lastSection: 1,
  };
  assert.equal(courseLine(course, 1).length, 4);
  assert.equal(courseLine(course, 2).length, 8);
  const record = generateNpcGhostRecord(course, 1, 30_000, 1500);
  // Stamp 0 is the sentinel; the run spans 300 grid stamps plus a 3 s hold at the line.
  assert.equal(record.stamps.length, 1 + 301 + 30);
  assert.equal(record.stamps[1]!.time, 0);
  assert.equal(record.stamps[301]!.time, 300);
  const last = record.stamps[record.stamps.length - 1]!;
  // World (100, 0, 50) is wire x 100, y -50 (×10) at the end of the line.
  assert.equal(last.x, 1000);
  assert.equal(last.y, -500);
  const middle = record.stamps[151]!; // 15 s: 75 m along the 150 m line, on the first leg
  assert.equal(middle.x, 750);
  assert.equal(middle.y + 0, 0); // -0 after the wire sign flip
});
