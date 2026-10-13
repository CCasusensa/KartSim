import assert from "node:assert/strict";
import test from "node:test";
import { Group, Vector3 } from "three";
import { createSpeedDriver } from "../driving/item-test-fixtures";
import { KartPresentationView } from "../world/kart-presentation-view";
import { applyCityVehicleScale, CITY_VEHICLE_SCALE, cityVisualScale } from "./city-vehicle-scale";

const unit = { x: 1, y: 1, z: 1 };
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

test("city size survives actual AL resets and frames without changing race karts", () => {
  const city = createSpeedDriver(), race = createSpeedDriver();
  applyCityVehicleScale(city.vehicle);
  applyCityVehicleScale(city.vehicle);
  assert.deepEqual(city.vehicle.state.visualScale, cityVisualScale());
  city.run(1000);
  assert.ok(city.vehicle.wheels.grounded);
  assert.ok(city.vehicle.body.position.z > 2);
  assert.deepEqual(city.vehicle.state.visualScale, cityVisualScale());

  city.vehicle.reset(4, .3, 6, .4);
  assert.deepEqual(city.vehicle.state.visualScale, cityVisualScale());
  city.run(1000);
  assert.deepEqual(city.vehicle.state.visualScale, cityVisualScale());
  city.vehicle.runtime.eventScalePrimary = { x: .6, y: .8, z: 1.2 };
  city.vehicle.syncPresentationFields();
  assert.deepEqual(city.vehicle.state.visualScale, {
    x: Math.fround(.6 * CITY_VEHICLE_SCALE),
    y: Math.fround(1.2 * CITY_VEHICLE_SCALE),
    z: Math.fround(.8 * CITY_VEHICLE_SCALE),
  });
  city.vehicle.reset(0, .3, 0, 0);
  assert.deepEqual(city.vehicle.state.visualScale, cityVisualScale());
  race.run(1000);
  assert.deepEqual(race.vehicle.state.visualScale, unit);
  assert.equal(race.vehicle.collisionShape.scaleX, 1);
  assert.equal(race.vehicle.collisionShape.scaleY, 1);
  assert.equal(race.vehicle.collisionShape.rawHeight, 1);
});

test("city collision dimensions and four wheel footprints all use the same scale", () => {
  const race = createSpeedDriver().vehicle, city = createSpeedDriver().vehicle;
  applyCityVehicleScale(city);
  for (const vehicle of [race, city]) vehicle.reset(0, .3, 0, 0);
  const raceBox = structuredClone(race.secondaryCollisionBox());
  const cityBox = structuredClone(city.secondaryCollisionBox());
  for (let axis = 0; axis < 3; axis++)
    close(cityBox.halfExtents[axis], raceBox.halfExtents[axis] * CITY_VEHICLE_SCALE);
  close(cityBox.center.y - city.body.position.y,
    (raceBox.center.y - race.body.position.y) * CITY_VEHICLE_SCALE);
  const primaryBox = (vehicle: any) => {
    let queried: any;
    vehicle.resolvePrimaryCollision({ queryObb(box: unknown) {
      queried = structuredClone(box);
      return [];
    } }, {});
    return queried;
  };
  const racePrimary = primaryBox(race), cityPrimary = primaryBox(city);
  for (let axis = 0; axis < 3; axis++)
    close(cityPrimary.halfExtents[axis], racePrimary.halfExtents[axis] * CITY_VEHICLE_SCALE);

  const probes = (vehicle: any) => {
    const origins: Array<{ x: number; y: number; z: number }> = [];
    vehicle.probeWheels({ rayQuery(origin: { x: number; y: number; z: number }) {
      origins.push({ ...origin });
    } }, false);
    assert.equal(origins.length, 4);
    return origins;
  };
  const raceWheels = probes(race), cityWheels = probes(city);
  for (let wheel = 0; wheel < 4; wheel++) {
    close(cityWheels[wheel]!.x, raceWheels[wheel]!.x * CITY_VEHICLE_SCALE);
    close(cityWheels[wheel]!.z, raceWheels[wheel]!.z * CITY_VEHICLE_SCALE);
  }
});

test("city pose size reaches model and wheel presentation on every frame", () => {
  const vehicle = createSpeedDriver().vehicle;
  applyCityVehicleScale(vehicle);
  const view = new KartPresentationView(new Group(), {
    makeWheelPresentation() { throw new Error("unused"); },
    makeBalloon() { throw new Error("unused"); }, disposeObject() {},
  });
  const wheelScales: unknown[] = [];
  view.wheelPresentation = {
    reset() {}, update(pose) { wheelScales.push({ ...pose.visualScale }); },
  };
  for (let frame = 0; frame < 3; frame++) {
    const { position, right, forward, up } = vehicle.body;
    view.update({ ...position, right, forward, up, visualScale: vehicle.state.visualScale }, frame);
    const scale = new Vector3().setFromMatrixScale(view.modelMount.matrixWorld);
    close(scale.x, CITY_VEHICLE_SCALE);
    close(scale.y, CITY_VEHICLE_SCALE);
    close(scale.z, CITY_VEHICLE_SCALE);
  }
  assert.deepEqual(wheelScales, [cityVisualScale(), cityVisualScale(), cityVisualScale()]);
});

test("city remote initial, radar and network poses agree without double scaling", async () => {
  (globalThis as any).document ??= {
    createElement: () => ({ relList: { supports: () => true }, getContext: () => null, style: {} }),
  };
  const { CityFleet, poseFromDesign } = await import("./city-fleet");
  assert.deepEqual(poseFromDesign({ x: 0, y: 0, z: 0, heading: 0 }).visualScale, cityVisualScale());
  const fleet = new CityFleet({ assets: {}, presenter: {}, track: {}, now: () => 1000,
    onError(error) { throw error; }, localPlayerId: "self", renderCapacity: 24 });
  const peer: any = { member: { pose: { y: 3 } }, radar: { x: 10, z: 20 }, smoother: {} };
  fleet.peers.set("remote", peer);
  assert.deepEqual(fleet.copyWebPose("remote")?.visualScale, cityVisualScale());
  peer.motion = { copyPose: () => ({ position: [1, 2, 3], rotation: [
    { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  ] }) };
  assert.deepEqual(fleet.copyWebPose("remote")?.visualScale, cityVisualScale());
  peer.visualScale = cityVisualScale();
  assert.deepEqual(fleet.copyWebPose("remote")?.visualScale, cityVisualScale());
  peer.visualScale = { x: .6, y: .4, z: .6 };
  assert.deepEqual(fleet.copyWebPose("remote")?.visualScale, peer.visualScale);
  assert.notStrictEqual(fleet.copyWebPose("remote")?.visualScale, peer.visualScale);
});
