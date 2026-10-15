import assert from "node:assert/strict";
import test from "node:test";

import { REMOTE_EXTRAPOLATION_LIMIT_MS, RemoteMotionPredictor,
  type RemoteMotionSnapshot } from "./remote-motion";
import type { RailMatrix } from "../driving/rail-frame";

const moving = { bypass: false, locked: false };
const horizonTick = 1_000 + REMOTE_EXTRAPOLATION_LIMIT_MS;
const inertia: RailMatrix = [
  { x: 1.3, y: 0.01, z: 0 },
  { x: 0.01, y: 1.4, z: 0.02 },
  { x: 0, y: 0.02, z: 1.5 },
];

function snapshot(changes: Partial<RemoteMotionSnapshot> = {}): RemoteMotionSnapshot {
  return {
    kind: "kinematic", flags: [1, 0],
    position: [5, 2, -2], quaternion: [0.9, 0.1, -0.1, 0.05],
    linearVelocity: [1.2, 0.1, -0.4], angularVelocity: [0.3, -0.2, 0.1],
    vector5C: [0.4, -0.2, 0.1], vector68: [0.02, 0.05, -0.03],
    collision: { active: true }, ...changes,
  };
}

function makePredictor(state = snapshot(), receivedAt = 1_040): RemoteMotionPredictor {
  const predictor = new RemoteMotionPredictor(2.5, inertia);
  predictor.receive(state, 1_000, receivedAt);
  return predictor;
}

test("packet loss freezes falling position, velocity and rotation at the age limit", () => {
  const predictor = makePredictor(snapshot({
    position: [5, -2, 1], linearVelocity: [1.2, -0.4, -3],
    vector5C: [0.4, 0.1, -25],
  }));
  for (let now = 1_040; now < horizonTick; now += 16) predictor.update(now, moving);
  predictor.update(horizonTick, moving);
  const horizonPose = predictor.copyPose();
  assert.ok(horizonPose);
  assert.ok(horizonPose.position[2] < 1, "the falling packet was extrapolated");
  for (let now = horizonTick + 16; now <= 7_000; now += 16) {
    predictor.update(now, moving);
    assert.deepEqual(predictor.copyPose(), horizonPose, `prediction changed at ${now}`);
  }
  assert.equal(predictor.active, false, "normal stale-peer expiry still applies");
});

test("a frame crossing the horizon only integrates the remaining time", () => {
  const crossing = makePredictor();
  const atLimit = makePredictor();
  for (const predictor of [crossing, atLimit]) {
    predictor.update(1_040, moving);
    predictor.update(horizonTick - 16, moving);
  }
  crossing.update(horizonTick + 17, moving);
  atLimit.update(horizonTick, moving);
  assert.deepEqual(crossing.copyPose(), atLimit.copyPose());
  crossing.update(horizonTick + 1_000, moving);
  assert.deepEqual(crossing.copyPose(), atLimit.copyPose());
});

test("a first packet delayed 800ms integrates only the per-update 200ms cap then freezes", () => {
  const receivedAt = horizonTick + 200;
  assert.equal(receivedAt - 1_000, 800);
  const delayed = makePredictor(snapshot(), receivedAt);
  const singleFrame = makePredictor();
  delayed.update(receivedAt, moving);
  singleFrame.update(1_200, moving);
  assert.deepEqual(delayed.copyPose(), singleFrame.copyPose());
  delayed.update(receivedAt + 16, moving);
  delayed.update(receivedAt + 32, moving);
  assert.deepEqual(delayed.copyPose(), singleFrame.copyPose());
});

test("a fresh landing snapshot corrects a frozen falling pose and resumes motion", () => {
  const predictor = makePredictor(snapshot({
    position: [0, 0, 2], linearVelocity: [0, 0, -8],
    vector5C: [0, 0, -25],
  }));
  const recoveryTick = horizonTick + 400;
  for (let now = 1_040; now <= recoveryTick; now += 16) predictor.update(now, moving);
  assert.ok(predictor.copyPose()!.position[2] < 2);
  assert.equal(predictor.receive(snapshot({
    position: [8, 4, 0], quaternion: [1, 0, 0, 0],
    linearVelocity: [4, 0, 0], angularVelocity: [0, 0, 0],
    vector5C: [0, 0, 0], vector68: [0, 0, 0],
  }), recoveryTick, recoveryTick), true);
  predictor.update(recoveryTick, moving);
  assert.deepEqual(predictor.copyPose()!.position, [8, 4, 0]);
  assert.deepEqual(predictor.copyPose()!.velocity, [4, 0, 0]);
  predictor.update(recoveryTick + 50, moving);
  assert.ok(predictor.copyPose()!.position[0] > 8);
  assert.equal(predictor.copyPose()!.position[2], 0);
});

test("locked and bypassed frames do not extend an old snapshot's horizon", () => {
  for (const option of [{ bypass: true, locked: false },
    { bypass: false, locked: true }]) {
    const predictor = makePredictor();
    predictor.update(1_040, moving);
    predictor.update(horizonTick + 100, option);
    const heldPose = predictor.copyPose();
    predictor.update(horizonTick + 116, moving);
    predictor.update(horizonTick + 132, moving);
    assert.deepEqual(predictor.copyPose(), heldPose);
    predictor.receive(snapshot({ position: [20, 5, 10] }),
      horizonTick + 200, horizonTick + 200);
    predictor.update(horizonTick + 240, moving);
    assert.ok(predictor.copyPose()!.position[0] > 20);
  }
});

test("continuous 512ms distant-peer packets with 40ms latency keep moving between updates", () => {
  const predictor = new RemoteMotionPredictor(2.5, inertia);
  for (let index = 0; index < 4; index += 1) {
    const tick = 1_000 + index * 512;
    predictor.receive(snapshot({
      position: [index * 4 * 0.512, 0, 0], quaternion: [1, 0, 0, 0],
      linearVelocity: [4, 0, 0], angularVelocity: [0, 0, 0],
      vector5C: [0, 0, 0], vector68: [0, 0, 0],
    }), tick, tick + 40);
    predictor.update(tick + 40, moving);
    let previousPosition = predictor.copyPose()!.position[0];
    for (let elapsed = 56; elapsed < 512 + 40; elapsed += 16) {
      predictor.update(tick + elapsed, moving);
      const position = predictor.copyPose()!.position[0];
      assert.ok(position > previousPosition,
        `packet ${index} froze at ${elapsed}ms before the next scheduled packet`);
      previousPosition = position;
    }
  }
});

test("continuous 64ms packets retain the released float32 force and orientation results", () => {
  const predictor = new RemoteMotionPredictor(2.5, inertia);
  // Golden poses captured before the extrapolation-age limit was introduced.
  const positions = [
    [5.106283664703369, 2.008458137512207, -2.0350289344787598],
    [5.206284046173096, 2.0284581184387207, -2.1350290775299072],
    [5.306283950805664, 2.0484580993652344, -2.2350289821624756],
  ];
  const rotation = [
    { x: 0.9751244187355042, y: -0.12019003182649612, z: -0.18624386191368103 },
    { x: 0.07865136116743088, y: 0.9731705188751221, z: -0.21622474491596222 },
    { x: 0.20723509788513184, y: 0.19619770348072052, z: 0.9584153890609741 },
  ];
  for (let index = 0; index < 3; index += 1) {
    const tick = 1_000 + index * 64;
    predictor.receive(snapshot({
      position: [5 + index * 0.1, 2 + index * 0.02, -2 - index * 0.1],
    }), tick, tick + 40);
    for (const elapsed of [40, 56, 72, 88]) predictor.update(tick + elapsed, moving);
    assert.deepEqual(predictor.copyPose(), {
      position: positions[index], rotation,
      velocity: [1.2140800952911377, 0.09296000003814697, -0.3964799642562866],
      angularVelocity: [0.3025258481502533, -0.1932562291622162, 0.09677283465862274],
    });
  }
});
