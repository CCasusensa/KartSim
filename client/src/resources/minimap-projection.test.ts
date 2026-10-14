import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { RhoReader } from "../codecs/rho";
import { y9 } from "../generated/formats.js";
import type { RhoArchiveIndex } from "./archive-index";
import { minimapProjection } from "./minimap-projection";
import { decodePngRgba } from "./png-decoder";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mirror = path.resolve(project, "../mirror/p3553");
const containers = ["track_beach_R02.rho", "track_china_R01.rho", "track_china_R01_sn09.rho",
  "track_china_R01_sn10.rho", "track_desert_R02.rho", "track_desert_R02_sn15.rho"];
const mirrorReady = containers.every(name => existsSync(path.join(mirror, name)));

interface ToMinimap { kind: "ToMinimap"; centerX: number; centerY: number; scale: number;
  canvasWidth: number; canvasHeight: number; padding: number }
interface ToRoad { kind: "ToRoad"; records: Array<{ frames: Array<{ position: number[] }> }> }

test("other tracks keep their own ToMinimap record", () => {
  const record = { kind: "ToMinimap", centerX: 1, centerY: 2, scale: 0.3, padding: 4 };
  assert.equal(minimapProjection("beach_R01", record), record);
  assert.deepEqual(minimapProjection("BEACH_R02", record),
    { kind: "ToMinimap", centerX: 453.1, centerY: 546.5, scale: 0.2617, padding: 4 });
});

let archiveIndex: Promise<{ rho: RhoArchiveIndex[] }> | undefined;

async function archiveEntry(container: string, entry: string): Promise<Uint8Array> {
  archiveIndex ??= readFile(path.resolve(project, "../mirror/__p3553/archive-index"))
    .then(bytes => JSON.parse(inflateSync(bytes).toString("utf8")));
  const archive = (await archiveIndex).rho.find(candidate => candidate.name === container);
  assert.ok(archive, container);
  const source = await readFile(path.join(mirror, archive.name));
  const copy = (chunk: Uint8Array): ArrayBuffer => Uint8Array.from(chunk).buffer as ArrayBuffer;
  const reader = new RhoReader({
    name: archive.name, size: source.length,
    arrayBuffer: async () => copy(source),
    slice: (start = 0, end = source.length) => ({ arrayBuffer: async () => copy(source.subarray(start, end)) }),
  }, archive);
  return reader.read(entry);
}

async function trackObjects(track: string): Promise<Array<ToMinimap | ToRoad | { kind: string }>> {
  return (y9(await archiveEntry(`track_${track}.rho`, "track.1s")) as {
    root: { trackObjects: Array<ToMinimap | ToRoad | { kind: string }> } }).root.trackObjects;
}

async function toMinimap(track: string): Promise<ToMinimap> {
  return (await trackObjects(track)).find((object): object is ToMinimap => object.kind === "ToMinimap")!;
}

test("story-mode cuts take the projection of the track whose map art they ship", {
  skip: !mirrorReady && "sparse worktree has no mirror/p3553",
}, async () => {
  for (const [cut, full] of [["china_R01_sn09", "china_R01"], ["china_R01_sn10", "china_R01"],
    ["desert_R02_sn15", "desert_R02"]] as const) {
    assert.deepEqual(await archiveEntry(`track_${cut}.rho`, "xt_minimap.png"),
      await archiveEntry(`track_${full}.rho`, "xt_minimap.png"), cut);
    const own = await toMinimap(cut);
    const original = await toMinimap(full);
    assert.notEqual(own.centerY, original.centerY, cut);
    assert.deepEqual(minimapProjection(cut, own), { ...own,
      centerX: original.centerX, centerY: original.centerY, scale: original.scale }, cut);
  }
});

test("滨海大道 火车 course frames land on the drawn road with the corrected projection", {
  skip: !mirrorReady && "sparse worktree has no mirror/p3553",
}, async () => {
  const objects = await trackObjects("beach_R02");
  const own = objects.find((object): object is ToMinimap => object.kind === "ToMinimap")!;
  const art = await decodePngRgba(await archiveEntry("track_beach_R02.rho", "xt_minimap.png"));
  // Course centre lines, sampled every 3 units; long jumps join separate roads.
  const samples: Array<[number, number]> = [];
  for (const road of objects.filter((object): object is ToRoad => object.kind === "ToRoad"))
    for (const record of road.records)
      for (let i = 0; i + 1 < record.frames.length; i++) {
        const [ax, ay] = record.frames[i]!.position, [bx, by] = record.frames[i + 1]!.position;
        const length = Math.hypot(bx! - ax!, by! - ay!);
        if (length > 400) continue;
        const steps = Math.max(1, Math.ceil(length / 3));
        for (let k = 0; k <= steps; k++)
          samples.push([ax! + (bx! - ax!) * k / steps, ay! + (by! - ay!) * k / steps]);
      }
  const onRoad = (projection: ToMinimap) => samples.filter(([x, y]) => {
    const u = Math.round((128 + (x - projection.centerX) * projection.scale) * art.width / 256);
    const v = Math.round((128 - (y - projection.centerY) * projection.scale) * art.height / 256);
    return u >= 0 && v >= 0 && u < art.width && v < art.height && art.pixels[(v * art.width + u) * 4]! > 128;
  }).length / samples.length;
  const before = onRoad(own);
  const after = onRoad(minimapProjection("beach_R02", own));
  assert.ok(before < 0.5, `own ToMinimap ${before}`);
  assert.ok(after > 0.8, `corrected ${after}`);
});
