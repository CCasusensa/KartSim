import assert from "node:assert/strict";
import test from "node:test";

import {
  drivenEquipment, enterChoice, exitPose, headingOfYaw, stepFoot, yawOfHeading, STEP_UP, type FootWorld,
} from "./city-foot-motion";
import type { CityVehicle } from "./city-protocol";
import { RUN_SPEED, WALK_SPEED } from "./city-walker";

const flat: FootWorld = { ground: () => 10, wall: () => undefined };

test("walking and running speeds, turning, and backing up slower", () => {
  const start = { x: 0, y: 10, z: 0, yaw: 0 };
  const walk = stepFoot(start, { forward: 1, turn: 0, run: false }, 1, flat);
  assert.ok(walk.moving && !walk.running);
  assert.ok(Math.abs(walk.state.z - WALK_SPEED) < 1e-9 && Math.abs(walk.state.x) < 1e-9);
  const run = stepFoot(start, { forward: 1, turn: 0, run: true }, 1, flat);
  assert.ok(run.running && Math.abs(run.state.z - RUN_SPEED) < 1e-9);
  const back = stepFoot(start, { forward: -1, turn: 0, run: true }, 1, flat);
  assert.ok(!back.running && back.state.z < 0 && back.state.z > -WALK_SPEED);
  const turn = stepFoot(start, { forward: 0, turn: 1, run: false }, 0.5, flat);
  assert.ok(!turn.moving && turn.state.yaw < -1);
  // Facing north (heading 0), turning right then walking heads east (+x).
  const north = { x: 0, y: 10, z: 0, yaw: yawOfHeading(0) };
  const right = stepFoot(stepFoot(north, { forward: 0, turn: 1, run: false }, Math.PI / 2 / 2.8, flat).state,
    { forward: 1, turn: 0, run: false }, 1, flat);
  assert.ok(right.state.x > 0.9 && Math.abs(right.state.z) < 1e-6);
  assert.ok(Math.abs(headingOfYaw(right.state.yaw) - 90) < 1e-6);
});

test("walls stop the walk into them and let it slide along", () => {
  // A wall along x = 0.5 facing -x.
  const world: FootWorld = { ground: () => 10, wall: (_from, to) => to.x > 0.5 ? { x: -1, z: 0 } : undefined };
  const into = stepFoot({ x: 0.45, y: 10, z: 0, yaw: Math.PI / 2 }, { forward: 1, turn: 0, run: false }, 1, world);
  assert.equal(into.moving, false);
  const slide = stepFoot({ x: 0.45, y: 10, z: 0, yaw: Math.PI / 4 }, { forward: 1, turn: 0, run: false }, 1, world);
  assert.ok(slide.moving && Math.abs(slide.state.x - 0.45) < 1e-9 && slide.state.z > 0.5);
});

test("kerbs up to a step, drops follow the ground, no ground or the sea blocks", () => {
  const step: FootWorld = { ground: (_x, z) => z > 0.5 ? 10 + STEP_UP - 0.01 : 10, wall: () => undefined };
  assert.ok(stepFoot({ x: 0, y: 10, z: 0.4, yaw: 0 }, { forward: 1, turn: 0, run: false }, 1, step).moving);
  const kerb: FootWorld = { ground: (_x, z) => z > 0.5 ? 10.6 : 10, wall: () => undefined };
  assert.equal(stepFoot({ x: 0, y: 10, z: 0.4, yaw: 0 }, { forward: 1, turn: 0, run: false }, 1, kerb).moving, false);
  const drop: FootWorld = { ground: (_x, z) => z > 0.5 ? 7 : 10, wall: () => undefined };
  assert.equal(stepFoot({ x: 0, y: 10, z: 0.4, yaw: 0 }, { forward: 1, turn: 0, run: false }, 1, drop).state.y, 7);
  const sea: FootWorld = { ground: () => 4, wall: () => undefined, water: () => 5.7 };
  assert.equal(stepFoot({ x: 0, y: 6, z: 0, yaw: 0 }, { forward: 1, turn: 0, run: false }, 1, sea).moving, false);
  const none: FootWorld = { ground: () => undefined, wall: () => undefined };
  assert.equal(stepFoot({ x: 0, y: 6, z: 0, yaw: 0 }, { forward: 1, turn: 0, run: false }, 1, none).moving, false);
});

test("headings and yaws are the city's physics convention", () => {
  for (const degrees of [0, 45, 90, 180, 270, 359]) assert.ok(Math.abs(headingOfYaw(yawOfHeading(degrees)) - degrees) < 1e-9);
  // Heading 90 (east, +x) faces +x.
  assert.ok(Math.abs(Math.sin(yawOfHeading(90)) - 1) < 1e-9);
  const out = exitPose({ x: 0, y: 0, z: 0, heading: 0 });
  assert.ok(out.x < 0 && Math.abs(out.z) < 1e-9, "heading north: out on the left (west)");
});

test("someone else's kart shows the owner's kart parts and the driver's rider", () => {
  const owner = { itemIds: { 1: 5, 2: 7, 3: 1020, 4: 9, 8: 11, 27: 3 }, kartSerial: 2, systemKart: "x" };
  const driver = { itemIds: { 1: 2, 2: 1, 3: 0, 8: 4, 11: 6 }, systemKart: "practiceKart", kartSerial: 0 };
  const merged = drivenEquipment(owner, driver);
  assert.deepEqual(merged.itemIds, { 1: 2, 2: 7, 3: 1020, 4: 9, 8: 4, 11: 6, 27: 3 });
  assert.equal(merged.kartSerial, 2);
  assert.equal(merged.systemKart, "x");
  assert.equal(driver.itemIds[3], 0, "the driver's own equipment is untouched");
});

test("E picks the nearest kart that takes the member", () => {
  const kart = (id: number, x: number, changes: Partial<CityVehicle> = {}): CityVehicle => ({
    id, owner: id, playerId: `p${id}`, ownerName: `n${id}`, equipment: {}, pose: { x, y: 0, z: 0, heading: 0 },
    locked: false, driver: 0, passenger: 0, ...changes,
  });
  assert.equal(enterChoice([kart(1, 10)], 0, 0, 9).kind, "none");
  assert.equal(enterChoice([kart(1, 2, { locked: true })], 0, 0, 9).kind, "locked");
  assert.equal(enterChoice([kart(9, 2, { locked: true })], 0, 0, 9).kind, "drive", "the owner opens its own");
  const choice = enterChoice([kart(1, 1, { locked: true }), kart(2, 3, { driver: 5 })], 0, 0, 9);
  assert.equal(choice.kind, "ride");
  assert.equal((choice as { vehicle: CityVehicle }).vehicle.id, 2);
  assert.equal(enterChoice([kart(2, 3, { driver: 5, passenger: 6 })], 0, 0, 9).kind, "full");
});
