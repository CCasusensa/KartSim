import assert from "node:assert/strict";
import test from "node:test";
import { Group } from "three";
import { createSpeedDriver, testTuning } from "../driving/item-test-fixtures";
import { racePresenterInitializationDependencies } from "../generated/world.js";
import { CityFleet } from "./city-fleet";
import { installLocalKart, loadLocalKart, retuneCityVehicle } from "./city-local-kart";
import { applyCityVehicleScale, CITY_VEHICLE_SCALE, cityVisualScale } from "./city-vehicle-scale";

const shape = (width: number) => ({ rawHalfWidth: width, rawHalfLength: 1.5, scaleX: 1, scaleY: 1, rawHeight: 1 });

/** A loaded kart as loadRosterEntry returns it, with only what the scene swap touches. */
function fakeParticipant(name: string, playerId = "local", kartId = 373) {
  const riderSource = { children: [] };
  const riderMount = new Group();
  const object = new Group();
  object.name = name;
  object.add(riderMount);
  const part = () => ({ object: new Group() });
  const character = { scene: { object: new Group(), getDecorationSocket() { return undefined; },
    getDecorationOwner() { return undefined; } } };
  return {
    playerId, name, disposed: 0, riderMount,
    remoteParameters: { mass: 100 },
    characters: { ordinary: character },
    vehicle: {
      imported: {
        object, animation: undefined, scene: undefined,
        model: { root: { value: { className: "ReKart",
          children: Array.from({ length: 7 }, (_, i) => ({ value: i === 6 ? riderSource : {} })) } } },
        renderScene: { bySource: new Map<unknown, Group>([[riderSource, riderMount]]) },
      },
      visual: { attachments: [], onCharacterSize: 1 },
      kartItem: { alwaysLinkCharacter: false },
      accessories: [], decoration: undefined,
      trails: part(), driftEffects: part(), zetAirEffect: part(), shockWaveEffect: part(),
      exhaustEffect: part(), crashEffect: part(), simpleShadow: part(),
      tachometerRenderer: { smoothed: false, enableUiSmoothing() { this.smoothed = true; } },
      tachometerSelection: { folder: name },
      audio: { started: 0, start() { this.started++; } },
      physicsParams: testTuning(kartId),
      collisionShape: shape(name === "new" ? 1.1 : 0.9),
    },
    dispose() { this.disposed++; },
  };
}

test("a garage change retunes the live vehicle and keeps the city size", () => {
  const driver = createSpeedDriver(373);
  const vehicle = driver.vehicle;
  applyCityVehicleScale(vehicle);
  driver.run(500);
  const clock = vehicle.clock;
  vehicle.addFlyingPetListener(() => {});
  const params = testTuning(373, { tag: "new kart" });
  retuneCityVehicle(vehicle, { physicsParams: params, collisionShape: shape(1.1) });
  assert.deepEqual(vehicle.tuning, params);
  assert.equal(vehicle.clock, clock, "the race clock stays");
  assert.equal(vehicle.flyingPetListeners.size, 0, "the old pet stops listening");
  assert.equal(vehicle.collisionShape.rawHalfWidth, 1.1);
  assert.equal(vehicle.collisionShape.scaleX, CITY_VEHICLE_SCALE);
  assert.equal(vehicle.runtime.raceMotionLocked, false);
  vehicle.reset(0, 0.3, 0, 0);
  assert.deepEqual(vehicle.state.visualScale, cityVisualScale());
  driver.run(1000);
  assert.ok(driver.speedKmh > 20, `drives on after the change (${driver.speedKmh} km/h)`);
  // A second change wraps the fresh shape again, not the old wrapper.
  retuneCityVehicle(vehicle, { physicsParams: params, collisionShape: shape(1.2) });
  assert.equal(vehicle.collisionShape.scaleX, CITY_VEHICLE_SCALE);
});

test("the local kart is loaded aside, then takes the old kart's place in the scene", async () => {
  const deps = racePresenterInitializationDependencies as any;
  const old = fakeParticipant("old"), next = fakeParticipant("new"), remote = fakeParticipant("remote", "bob");
  const scene = new Group();
  const view = deps.createRacerView(scene);
  view.setModel(old.vehicle.imported.object, old.vehicle.visual, undefined, old.vehicle.imported.model, undefined);
  old.riderMount.add(old.characters.ordinary.scene.object);
  for (const part of deps.vehicleParts(old.vehicle)) scene.add(part);
  const pet = { disposed: false, dispose() { this.disposed = true; } };
  const presenter: any = {
    scene, views: new Map([["local", view]]), linkedPresentations: new Map(),
    tachometer: old.vehicle.tachometerRenderer, audioStarted: true, flyingPet: pet,
    gaugePreserve: { folder: undefined as unknown, configure(folder: unknown) { this.folder = folder; } },
  };
  const participants: any[] = [remote, old];
  const requests: unknown[] = [];
  const assets = {
    participants,
    async loadRosterEntry(roster: unknown, entry: unknown) {
      requests.push({ roster, entry });
      participants.push(next);
      return next;
    },
  };
  const physics = createSpeedDriver(373).vehicle;
  applyCityVehicleScale(physics);
  const stage = { runtime: { assets, local: { physics } }, scene: presenter, host: {} };

  const equipment = { itemIds: { 3: 1637 } };
  const loaded = await loadLocalKart(stage, "local", "Me", equipment);
  assert.equal(loaded, next);
  assert.deepEqual(participants, [remote, old], "not raced until installed");
  assert.deepEqual(requests, [{ roster: { playerId: "local", name: "Me", slot: 0, team: null },
    entry: { equipment, initial: "", favoriteTracks: [], favoriteItems: [] } }]);

  installLocalKart(stage, "local", loaded);
  assert.deepEqual(participants, [remote, next]);
  assert.equal(old.disposed, 1);
  assert.equal(presenter.views.get("local"), view, "the view (camera, event effects) stays");
  assert.equal(view.importedModel, next.vehicle.imported.object);
  assert.equal(old.vehicle.imported.object.parent, null);
  assert.equal(next.characters.ordinary.scene.object.parent, next.riderMount);
  for (const part of deps.vehicleParts(old.vehicle)) assert.equal(part.parent, null);
  for (const part of deps.vehicleParts(next.vehicle)) assert.equal(part.parent, scene);
  assert.equal(presenter.tachometer, next.vehicle.tachometerRenderer);
  assert.ok(next.vehicle.tachometerRenderer.smoothed);
  assert.equal(presenter.gaugePreserve.folder, "new");
  assert.ok(pet.disposed);
  assert.equal(presenter.flyingPet, undefined);
  assert.equal(next.vehicle.audio.started, 1);
  assert.deepEqual(physics.tuning, next.vehicle.physicsParams);
  assert.equal(physics.collisionShape.rawHalfWidth, 1.1);
});

test("members' garage changes swap their kart once the new one has loaded", async () => {
  const pending: Array<{ resolve(participant: any): void; participant: any }> = [];
  const participants: any[] = [];
  let loads = 0;
  const assets = {
    participants,
    loadRosterEntry(_roster: unknown, entry: { equipment: { name: string } }) {
      const participant = fakeParticipant(entry.equipment.name, "bob");
      loads++;
      return new Promise(resolve => pending.push({ participant, resolve: () => {
        participants.push(participant);
        resolve(participant);
      } }));
    },
  };
  const presenter = { scene: new Group(), views: new Map<string, any>(), linkedPresentations: new Map(),
    initialPoses: new Map() };
  const fleet = new CityFleet({ assets, presenter, track: {}, now: () => 0, onError() {},
    localPlayerId: "local", renderCapacity: 24 });
  const peer = () => fleet.peers.get("bob") as any;
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

  fleet.add({ id: 3, playerId: "bob", name: "Bob", equipment: { name: "first" }, state: "driving",
    pose: { x: 0, y: 0, z: 0, heading: 0 } });
  pending.shift()!.resolve(undefined);
  await settle();
  const first = peer().participant;
  const motion = peer().motion;
  assert.equal(presenter.views.get("bob").importedModel.name, "first");

  // Two changes in a row: the first finishes loading last and is dropped.
  fleet.reequip(3, { name: "second" });
  fleet.reequip(3, { name: "third" });
  assert.equal(loads, 3);
  assert.equal(presenter.views.get("bob").importedModel.name, "first", "the old kart stays meanwhile");
  const [second, third] = [pending.shift()!, pending.shift()!];
  third.resolve(undefined);
  await settle();
  assert.equal(presenter.views.get("bob").importedModel.name, "third");
  assert.equal(first.disposed, 1);
  assert.equal(peer().motion, motion, "the predictor and its last frame stay");
  second.resolve(undefined);
  await settle();
  assert.equal(second.participant.disposed, 1);
  assert.equal(presenter.views.get("bob").importedModel.name, "third");
  assert.deepEqual(participants.map(p => p.name), ["third"]);
  assert.deepEqual(peer().member.equipment, { name: "third" });
  fleet.reequip(99, { name: "nobody" });
  assert.equal(loads, 3);
  fleet.dispose();
  assert.equal(third.participant.disposed, 1);
});
