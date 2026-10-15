import assert from "node:assert/strict";
import test from "node:test";

import { matrixFromQuaternion, quaternionFromMatrix } from "../driving/orientation-math";
import type { RailMatrix } from "../driving/rail-frame";
import { RemoteFleet, type MotionPacket } from "./remote-fleet";
import { MIN_BLEND_MS, RemotePoseSmoother, SNAP_DISTANCE } from "./remote-pose-smoothing";

type Vector = [number, number, number];

const yaw = (radians: number): RailMatrix =>
  matrixFromQuaternion({ w: Math.cos(radians / 2), x: 0, y: 0, z: Math.sin(radians / 2) });
const yawOf = (matrix: RailMatrix): number => {
  const q = quaternionFromMatrix(matrix);
  return 2 * Math.atan2(q.z, q.w);
};
const raw = (position: Vector, velocity: Vector = [10, 0, 0], heading = 0) =>
  ({ position, velocity, rotation: yaw(heading) });
const distance = (a: Vector, b: Vector) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("without a re-anchor the smoother passes the raw pose through untouched", () => {
  const smoother = new RemotePoseSmoother();
  const first = raw([0, 0, 0]);
  assert.equal(smoother.observe(first, 1_000, true), smoother.displayed);
  assert.equal(smoother.displayed!.position, first.position);
  assert.equal(smoother.displayed!.rotation, first.rotation);
  const second = raw([0.16, 0, 0]);
  smoother.observe(second, 1_016, false);
  assert.equal(smoother.displayed!.position, second.position);
  assert.equal(smoother.blending, false);
});

test("a small correction at a re-anchor is blended out instead of jumping", () => {
  const smoother = new RemotePoseSmoother();
  // Drawn so far: a kart at 10 m/s along x, re-anchored at t=1000.
  smoother.observe(raw([0, 0, 0]), 1_000, true);
  smoother.observe(raw([0.16, 0, 0]), 1_016, false);
  smoother.observe(raw([0.32, 0, 0]), 1_032, false);
  // The next packet says the kart is 0.8 m further ahead and 0.3 m to the side.
  const reanchorPosition: Vector = [0.48 + 0.8, 0.3, 0];
  smoother.observe(raw(reanchorPosition), 1_048, true);
  assert.equal(smoother.blending, true);
  // The drawn kart keeps gliding from where it was (0.32 + 0.16) instead of jumping to 1.28.
  assert.ok(distance(smoother.displayed!.position, [0.48, 0, 0]) < 1e-9,
    `drawn at ${smoother.displayed!.position}`);
  let previous = smoother.displayed!.position;
  let previousOffset = distance(previous, reanchorPosition);
  let time = 1_048;
  for (let frame = 1; frame <= 8; frame++) {
    time += 16;
    const rawPosition: Vector = [reanchorPosition[0] + 0.16 * frame, 0.3, 0];
    smoother.observe(raw(rawPosition), time, false);
    const drawn = smoother.displayed!.position;
    const step = distance(drawn, previous);
    // Each frame moves at most the raw 16 cm plus the offset share bled out (≤ 0.85 m / ~6 frames).
    assert.ok(step > 0.1 && step < 0.5, `frame ${frame} moved ${step}`);
    const offset = distance(drawn, rawPosition);
    assert.ok(offset <= previousOffset + 1e-9, `frame ${frame} offset ${offset} grew`);
    previous = drawn;
    previousOffset = offset;
  }
  // Blend time is MIN_BLEND_MS for a 48 ms gap; by now the drawn pose is the prediction.
  assert.ok(time - 1_048 >= MIN_BLEND_MS);
  assert.equal(smoother.blending, false);
  assert.equal(previousOffset, 0);
});

test("a teleport-sized correction snaps at once", () => {
  const smoother = new RemotePoseSmoother();
  smoother.observe(raw([0, 0, 0]), 1_000, true);
  smoother.observe(raw([0.16, 0, 0]), 1_016, false);
  const far = raw([0.32 + SNAP_DISTANCE + 1, 0, 0]);
  smoother.observe(far, 1_032, true);
  assert.equal(smoother.blending, false);
  assert.equal(smoother.displayed!.position, far.position);
});

test("rotation corrections glide to the predicted heading", () => {
  const smoother = new RemotePoseSmoother();
  smoother.observe(raw([0, 0, 0], [0, 0, 0], 0), 1_000, true);
  smoother.observe(raw([0, 0, 0], [0, 0, 0], 0), 1_016, false);
  const turned = 20 * Math.PI / 180;
  smoother.observe(raw([0, 0, 0], [0, 0, 0], turned), 1_032, true);
  assert.ok(Math.abs(yawOf(smoother.displayed!.rotation)) < 1e-6, "still drawn at the old heading");
  let previous = 0;
  for (let time = 1_048; time <= 1_032 + MIN_BLEND_MS + 16; time += 16) {
    smoother.observe(raw([0, 0, 0], [0, 0, 0], turned), time, false);
    const heading = yawOf(smoother.displayed!.rotation);
    assert.ok(heading >= previous - 1e-9 && heading <= turned + 1e-6, `heading ${heading} at ${time}`);
    previous = heading;
  }
  assert.ok(Math.abs(previous - turned) < 1e-6, `ended at ${previous}`);
});

test("locked or bypassed frames draw the raw pose and forget the blend", () => {
  const smoother = new RemotePoseSmoother();
  smoother.observe(raw([0, 0, 0]), 1_000, true);
  smoother.observe(raw([0.16, 0, 0]), 1_016, false);
  smoother.observe(raw([1.5, 0, 0]), 1_032, true);
  assert.equal(smoother.blending, true);
  const locked = raw([1.66, 0, 0]);
  smoother.observe(locked, 1_048, false, true);
  assert.equal(smoother.blending, false);
  assert.equal(smoother.displayed!.position, locked.position);
  assert.equal(smoother.observe(undefined, 1_064, false), undefined);
  assert.equal(smoother.displayed, undefined);
});

/**
 * A kart circling at 50 m/s whose 64 ms packets arrive with 10–50 ms of
 * latency jitter and a 30 ms clock offset between the two clients: the
 * release prediction jumps at every packet; the drawn pose must not.
 */
test("remote fleet draws a jittery high-speed peer without visible jumps", () => {
  const SPEED = 50, RADIUS = 100, OMEGA = SPEED / RADIUS, MASS = 2, CLOCK_SKEW = 30;
  const BASE = 100_000;
  let seed = 7;
  const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  let now = BASE;
  let receive!: (packet: MotionPacket) => void;
  const fleet = new RemoteFleet(
    { roomId: "room", raceId: "race", participants: [
      { playerId: "me", slot: 0, remoteParameters: { mass: MASS } },
      { playerId: "peer", slot: 1, remoteParameters: { mass: MASS } },
    ] },
    { roomId: "room", raceId: "race", playerId: "me",
      subscribeMotion: listener => { receive = listener; return () => {}; } },
    () => now, error => { throw error; }, undefined,
    { createPresentation: () => ({ receive() {}, consume() { return undefined; } }),
      createGiant: () => { throw new Error("no giants"); },
      validateGiantState: () => true,
      newerSequence: (sequence, previous) => sequence > previous,
      resetVisible: () => true });
  fleet.bindClock({ offsetMs: 0 });
  fleet.groundTrack = {
    rayQuery(origin, movement) {
      const fraction = -origin.y / movement.y;
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return undefined;
      return { point: { x: origin.x + movement.x * fraction, y: 0,
        z: origin.z + movement.z * fraction }, normal: { x: 0, y: 1, z: 0 } };
    },
  };

  const sampleAt = (elapsedMs: number, sequence: number): MotionPacket => {
    const theta = OMEGA * elapsedMs / 1000;
    const heading = theta + Math.PI / 2;
    return { roomId: "room", raceId: "race", playerId: "peer", sequence, payload: {
      kind: "kinematic", tick: BASE + elapsedMs + CLOCK_SKEW, flags: [1, 0],
      position: [RADIUS * Math.cos(theta), RADIUS * Math.sin(theta), 0],
      quaternion: [Math.cos(heading / 2), 0, 0, Math.sin(heading / 2)],
      linearVelocity: [-SPEED * Math.sin(theta), SPEED * Math.cos(theta), 0],
      angularVelocity: [0, 0, OMEGA],
      vector5C: [-MASS * SPEED * OMEGA * Math.cos(theta), -MASS * SPEED * OMEGA * Math.sin(theta), 0],
      vector68: [0, 0, 0],
      collision: { active: true, scaleX: 1, scaleY: 1 },
    } };
  };
  const pending: { arrival: number; packet: MotionPacket }[] = [];
  for (let elapsed = 0, sequence = 1; elapsed <= 6_000; elapsed += 64, sequence++)
    pending.push({ arrival: elapsed + 10 + random() * 40, packet: sampleAt(elapsed, sequence) });

  const web = (pose: { position: { x: number; y: number; z: number } }) =>
    [pose.position.x, pose.position.y, pose.position.z] as Vector;
  let previousDrawn: Vector | undefined, previousRaw: Vector | undefined;
  let worstDrawn = 0, worstRaw = 0, frames = 0;
  for (let elapsed = 0; elapsed <= 6_000; elapsed += 16) {
    now = BASE + elapsed;
    while (pending.length && pending[0]!.arrival <= elapsed) receive(pending.shift()!.packet);
    fleet.update(now, { bypass: false, locked: false });
    const drawn = fleet.copyWebPose("peer");
    const rawPose = fleet.remotes.get("peer")!.motion.copyPose();
    if (!drawn || !rawPose || elapsed < 500) continue;
    const drawnNow = web(drawn);
    const rawNow: Vector = [rawPose.position[0], rawPose.position[2], -rawPose.position[1]];
    if (previousDrawn && previousRaw) {
      frames++;
      worstDrawn = Math.max(worstDrawn, Math.abs(distance(drawnNow, previousDrawn) / 0.016 - SPEED));
      worstRaw = Math.max(worstRaw, Math.abs(distance(rawNow, previousRaw) / 0.016 - SPEED));
    }
    previousDrawn = drawnNow;
    previousRaw = rawNow;
  }
  assert.ok(frames > 300);
  // The release prediction's frame-to-frame speed swings by tens of m/s at each packet.
  assert.ok(worstRaw > 25, `raw speed deviation ${worstRaw.toFixed(1)} m/s`);
  // The drawn kart stays within a few m/s of its true speed.
  if (process.env.SMOOTHING_REPORT) console.log(`raw ${worstRaw.toFixed(1)} m/s, drawn ${worstDrawn.toFixed(1)} m/s over ${frames} frames`);
  assert.ok(worstDrawn < 8, `drawn speed deviation ${worstDrawn.toFixed(1)} m/s (raw ${worstRaw.toFixed(1)})`);
  fleet.dispose();
});
