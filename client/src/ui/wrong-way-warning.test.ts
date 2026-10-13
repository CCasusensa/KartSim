import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { RhoReader } from "../codecs/rho";
import { y9 } from "../generated/formats.js";
import type { RhoArchiveIndex } from "../resources/archive-index";
import {
  WRONG_WAY_HIDE_MS, WRONG_WAY_MIN_SPEED, WRONG_WAY_SHOW_MS, WrongWayDetector,
  drivingWrongWay, sampleWrongWay, type WrongWaySample,
} from "./wrong-way-warning";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const course = { x: 0, y: 0, z: 2 };
const sample = (forward: number, speed: number, racing = true): WrongWaySample => ({
  racing, direction: course,
  forward: { x: 0, y: 0, z: forward },
  velocity: { x: 0, y: 0, z: speed },
});

test("wrong way means facing and driving back down the course", () => {
  const fast = WRONG_WAY_MIN_SPEED + 1;
  assert.equal(drivingWrongWay(sample(-1, -fast)), true);
  // Reversing with the nose up the course, or sliding backwards facing back, is not.
  assert.equal(drivingWrongWay(sample(1, -fast)), false);
  assert.equal(drivingWrongWay(sample(-1, fast)), false);
  // Turned round but slower than 20 km/h, or not racing, or off the course frames.
  assert.equal(drivingWrongWay(sample(-1, -(WRONG_WAY_MIN_SPEED - 0.5))), false);
  assert.equal(drivingWrongWay(sample(-1, -fast, false)), false);
  assert.equal(drivingWrongWay({ ...sample(-1, -fast), direction: undefined }), false);
  // Sideways across the course (90°) is not turned round.
  assert.equal(drivingWrongWay({ ...sample(0, 0), forward: { x: 1, y: 0, z: 0 },
    velocity: { x: fast * 3, y: 0, z: -fast } }), false);
});

test("the sign shows after a second of the wrong way and hides after 300 ms", () => {
  const detector = new WrongWayDetector();
  assert.equal(detector.update(0, true, true), false);
  assert.equal(detector.update(WRONG_WAY_SHOW_MS - 1, true, true), false);
  // A moment the right way restarts the wait.
  assert.equal(detector.update(WRONG_WAY_SHOW_MS, false, true), false);
  assert.equal(detector.update(1_100, true, true), false);
  assert.equal(detector.update(1_100 + WRONG_WAY_SHOW_MS, true, true), true);
  assert.equal(detector.update(2_200, false, true), true);
  assert.equal(detector.update(2_200 + WRONG_WAY_HIDE_MS - 1, false, true), true);
  assert.equal(detector.update(2_200 + WRONG_WAY_HIDE_MS, false, true), false);
  // Leaving the racing state (finish, warp) hides it at once.
  detector.update(3_000, true, true);
  assert.equal(detector.update(3_000 + WRONG_WAY_SHOW_MS, true, true), true);
  assert.equal(detector.update(4_001, true, false), false);
  assert.equal(detector.update(4_002, true, true), false);
});

test("the course direction comes from the kart's route sample", () => {
  const physics = { body: { forward: { x: 0, y: 0, z: -1 }, linearVelocity: { x: 0, y: 0, z: -10 } } };
  const route = (surface: string, sampled = true) => ({
    sampleRoute: (vehicle: object, lookahead: number) => {
      assert.equal(vehicle, physics);
      assert.equal(lookahead, 0);
      return { surface, sampled, ...(sampled ? { direction: course } : {}) };
    },
  });
  assert.equal(drivingWrongWay(sampleWrongWay(physics, route(""), true)), true);
  assert.equal(drivingWrongWay(sampleWrongWay(physics, route("", false), true)), false);
  assert.equal(drivingWrongWay(sampleWrongWay(physics, route("rail"), true)), false);
  assert.equal(drivingWrongWay(sampleWrongWay(physics, route("warpnext"), true)), false);
  assert.equal(sampleWrongWay(physics, { sampleRoute: () => assert.fail("not racing") }, false)
    .direction, undefined);
});

async function archiveEntry(container: string, entry: string): Promise<Uint8Array> {
  const archiveIndex = JSON.parse(inflateSync(await readFile(path.resolve(project,
    "../mirror/__p3553/archive-index"))).toString("utf8")) as { rho: RhoArchiveIndex[] };
  const archive = archiveIndex.rho.find(candidate => candidate.name === container);
  assert.ok(archive, container);
  const source = await readFile(path.resolve(project, "../mirror/p3553", archive.name));
  const copy = (chunk: Uint8Array): ArrayBuffer => Uint8Array.from(chunk).buffer as ArrayBuffer;
  const reader = new RhoReader({
    name: archive.name, size: source.length,
    arrayBuffer: async () => copy(source),
    slice: (start = 0, end = source.length) => ({ arrayBuffer: async () => copy(source.subarray(start, end)) }),
  }, archive);
  return reader.read(entry);
}

interface SceneNode { className: string; name: string; children: SceneNode[]; slots?: unknown[];
  camera?: { projectionMode: number } }

function find(node: SceneNode, test: (node: SceneNode) => boolean): SceneNode | undefined {
  if (test(node)) return node;
  for (const child of node.children) {
    const found = find(child, test);
    if (found) return found;
  }
  return undefined;
}

test("wrongway.1s is the looping no-entry sign the warning plays", async () => {
  const parsed = y9(await archiveEntry("stage_common.rho", "action/wrongway.1s")) as { root: SceneNode };
  assert.equal(find(parsed.root, node => node.className === "ReCamera")?.camera?.projectionMode, 0);
  const plane = find(parsed.root, node => node.name === "Plane03");
  const texture = plane?.slots?.find(slot => (slot as { kind?: string } | null)?.kind === "texture") as {
    name: string;
    alphaController: { base: { cycleMode: number; stopTimeWord: number };
      keys: { records: Array<Record<number, number>> } };
  };
  assert.equal(texture.name, "restricted area");
  const { base, keys } = texture.alphaController;
  // Looped (cycle mode 0) over 1000 ms: opaque at 0 and 433 ms, clear at 1000 ms.
  assert.equal(base.cycleMode, 0);
  assert.equal(base.stopTimeWord, 1_000);
  const time = (record: Record<number, number>) => record[0]! | record[1]! << 8;
  const alpha = (record: Record<number, number>) => new Float32Array(Uint8Array.from(
    [4, 5, 6, 7].map(index => record[index]!)).buffer)[0];
  assert.deepEqual(keys.records.map(record => [time(record), alpha(record)]),
    [[0, 1], [433, 1], [1_000, 0]]);
  const sound = await archiveEntry("sound_fx_etc.rho", "wrongway.flac");
  assert.equal(new TextDecoder().decode(sound.subarray(0, 4)), "fLaC");
});
