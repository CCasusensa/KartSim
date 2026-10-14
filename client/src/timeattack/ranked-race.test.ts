import assert from "node:assert/strict";
import test from "node:test";

import { ksvCompression } from "../codecs/ksv-compression";
import { decodeKsvFile } from "../game/ghost/ksv-codec";
import { encodeRunReplay, ghostZCeiling, rankedRaceOf, recordSpeedChannel, replayBase64 } from "./ranked-race";

test("a ranked run's recording round-trips through the .ksv file the ranking keeps", () => {
  // Stored stamps: 100 ms ticks, x/y ×10, z as (z − 590) ×50, quaternion ×1e4.
  const stamps = Array.from({ length: 30 }, (_unused, index) => ({ time: index, x: index * 20, y: -50,
    z: (10 + index) * 50, w: 10_000, qx: 0, qy: 0, qz: 0, status: index % 2 ? 128 : 0 }));
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
