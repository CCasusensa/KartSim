import assert from "node:assert/strict";
import test from "node:test";
import { matrixFromQuaternion } from "../driving/orientation-math";
import { constrainRemotePose, type RemoteGroundTrack } from "./remote-pose-grounding";
import type { SmoothedRemotePose } from "./remote-pose-smoothing";

type Vector = [number, number, number];
interface Plane { y: (x: number, z: number) => number; normal: { x: number; y: number; z: number };
  has?: (x: number, z: number) => boolean }
const up = { x: 0, y: 1, z: 0 };
const identity = matrixFromQuaternion({ w: 1, x: 0, y: 0, z: 0 });
const pose = (position: Vector): SmoothedRemotePose => ({ position, rotation: identity });
const anchor = (position: Vector, linearVelocity: Vector = [0, 0, 0]) =>
  ({ position, quaternion: [1, 0, 0, 0] as [number, number, number, number], linearVelocity });
const flat = (height: number, normalY = 1, has?: Plane["has"]): Plane =>
  ({ y: () => height, normal: { x: 0, y: normalY, z: 0 }, has });
const slope = (gradient: number, has?: Plane["has"]): Plane =>
  ({ y: x => gradient * x, normal: { x: -gradient, y: 1, z: 0 }, has });

/** Like native surfaces, all rays share one mutable hit object. */
function track(...planes: Plane[]): RemoteGroundTrack {
  const hit = { point: { x: 0, y: 0, z: 0 }, normal: { ...up } };
  return { rayQuery(origin, movement, walls) {
    assert.equal(walls, false);
    const found = planes.map(plane => {
      const start = origin.y - plane.y(origin.x, origin.z);
      const end = origin.y + movement.y - plane.y(origin.x + movement.x, origin.z + movement.z);
      const fraction = -start / (end - start);
      return { plane, fraction, x: origin.x + movement.x * fraction,
        y: origin.y + movement.y * fraction, z: origin.z + movement.z * fraction };
    }).filter(hit => hit.fraction >= 0 && hit.fraction <= 1 && hit.plane.has?.(hit.x, hit.z) !== false)
      .sort((a, b) => a.fraction - b.fraction)[0];
    if (!found) return undefined;
    Object.assign(hit.point, { x: found.x, y: found.y, z: found.z });
    Object.assign(hit.normal, found.plane.normal);
    return hit;
  } };
}

test("falling prediction and landing blend are lifted to the real floor without mutating their inputs", () => {
  const drawn = pose([5, 3, -0.6]);
  const snapshot = anchor([4, 3, 0]);
  const copy = structuredClone({ drawn, snapshot });
  const corrected = constrainRemotePose(track(flat(0)), drawn, snapshot);
  assert.deepEqual(corrected.position, [5, 3, 0]);
  assert.deepEqual({ drawn, snapshot }, copy);
});

test("jump height and takeoff pitch remain visible; landing from an airborne packet is caught", () => {
  const jumping = pose([4, 0, 3]);
  assert.strictEqual(constrainRemotePose(track(flat(0)), jumping, anchor([2, 0, 2])), jumping);
  const takeoff = { position: [0, 0, 0.05] as Vector,
    rotation: matrixFromQuaternion({ w: Math.cos(0.2), x: Math.sin(0.2), y: 0, z: 0 }) };
  assert.strictEqual(constrainRemotePose(track(flat(0)), takeoff, anchor([0, 0, 0], [0, 0, 3])), takeoff);
  assert.equal(constrainRemotePose(track(flat(0)), pose([2, 0, -2]), anchor([0, 0, 4])).position[2], 0);
});

test("underpasses keep their road layer and reject downward-facing bridge undersides", () => {
  const bridge = track(flat(4), flat(3.5, -1), flat(0));
  assert.equal(constrainRemotePose(bridge, pose([2, 0, -1]), anchor([0, 0, 0])).position[2], 0);
  assert.equal(constrainRemotePose(bridge, pose([2, 0, 3]), anchor([0, 0, 4])).position[2], 4);
  // No nearby support in this airborne packet; its fall crosses the underside only.
  assert.equal(constrainRemotePose(bridge, pose([2, 0, -1]), anchor([0, 0, 3])).position[2], 0);
  const lowBridge = track(flat(2), flat(1.8, -1), flat(0));
  for (const y of [1.66, 1.9])
    assert.equal(constrainRemotePose(lowBridge, pose([0, 0, y]), anchor([0, 0, 0])).position[2], y);
  // An upward-wound floor at the packet's level wins over a nearby underside.
  assert.equal(constrainRemotePose(track(flat(0.25, -1), flat(0)),
    pose([0, 0, 0]), anchor([0, 0, 0])).position[2], 0);
});

test("a missing road at the displayed position leaves a genuine fall alone", () => {
  const hole = track(flat(0, 1, x => x < 1 || x > 4));
  const falling = pose([2, 0, -2]);
  assert.strictEqual(constrainRemotePose(hole, falling, anchor([0, 0, 0]),
    { halfWidth: 2, halfLength: 2 }), falling);
});

test("a smoothed kart climbs its slope and its complete footprint stays on the plane", () => {
  const corrected = constrainRemotePose(track(slope(0.5)), pose([6, 0, -1]),
    anchor([0, 0, 0]), { halfWidth: 0.9, halfLength: 1.5 });
  assert.equal(corrected.position[2], 3);
  const matrix = corrected.rotation;
  assert.ok(Math.abs(matrix[0].z + 1 / Math.sqrt(5)) < 1e-6);
  assert.ok(Math.abs(matrix[2].z - 2 / Math.sqrt(5)) < 1e-6);
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const x = corrected.position[0] + matrix[0].x * side * 0.9 - matrix[0].y * end * 1.5;
    const y = corrected.position[2] + matrix[2].x * side * 0.9 - matrix[2].y * end * 1.5;
    assert.ok(y >= 0.5 * x - 1e-6);
  }
});

test("a flat-road packet can enter a rising ramp before the next authoritative packet", () => {
  const world = track(flat(0, 1, x => x <= 0), slope(0.5, x => x >= 0));
  const corrected = constrainRemotePose(world, pose([4, 0, 0]), anchor([-2, 0, 0]));
  assert.equal(corrected.position[2], 2);
  const corner = constrainRemotePose(world, pose([-0.2, 0, 0]), anchor([-1, 0, 0]),
    { halfWidth: 1.5, halfLength: 1 });
  assert.ok(corner.position[2] >= 0.65 - 1e-6);
});

test("grounded rotation preserves handedness and heading instead of mirroring the kart", () => {
  for (const angle of [0, 0.5, 1.5, -2]) {
    const rotation = matrixFromQuaternion({ w: Math.cos(angle / 2), x: 0, y: 0, z: Math.sin(angle / 2) });
    const corrected = constrainRemotePose(track(flat(0)), { position: [0, 0, 0], rotation }, anchor([0, 0, 0]));
    for (let i = 0; i < 3; i++) for (const axis of ["x", "y", "z"] as const)
      assert.ok(Math.abs(corrected.rotation[i]![axis] - rotation[i]![axis]) < 1e-6);
    const [a, b, c] = corrected.rotation;
    const determinant = a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x);
    assert.ok(Math.abs(determinant - 1) < 1e-6);
    const sloped = constrainRemotePose(track(slope(0.5)), { position: [0, 0, 0], rotation }, anchor([0, 0, 0]));
    assert.ok(Math.abs(Math.atan2(-sloped.rotation[0].y, sloped.rotation[1].y) -
      Math.atan2(-rotation[0].y, rotation[1].y)) < 1e-6);
  }
});

test("the previous ramp plane does not lift a kart onto an unrelated upper bridge after the ramp ends", () => {
  const world = track(slope(0.5, x => x < 2), flat(0, 1, x => x >= 2), flat(3, 1, x => x >= 4));
  const corrected = constrainRemotePose(world, pose([8, 0, -1]), anchor([0, 0, 0]));
  assert.equal(corrected.position[2], 0);
});

test("legacy downward-wound pavement is accepted only near the real road anchor", () => {
  const world = track(flat(0, -1), flat(-3));
  assert.equal(constrainRemotePose(world, pose([2, 0, -1]), anchor([0, 0, 0])).position[2], 0);
  assert.equal(constrainRemotePose(world, pose([2, 0, -4]), anchor([0, 0, 2])).position[2], -3);
});

test("corners clear a small road lip without pulling an airborne kart down", () => {
  const world = track(flat(0), flat(0.2, 1, x => x > 0.5));
  const corrected = constrainRemotePose(world, pose([0, 0, -0.1]), anchor([0, 0, 0]),
    { halfWidth: 0.9, halfLength: 1.5 });
  assert.equal(corrected.position[2], 0.2);
  const jump = pose([0, 0, 2]);
  assert.strictEqual(constrainRemotePose(world, jump, anchor([0, 0, 2]),
    { halfWidth: 0.9, halfLength: 1.5 }), jump);
});
