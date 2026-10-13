import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ROAD_DUST_SPEED_KMH, groundRoadDust, PoseSpeed, RoadDustEffect,
  roadDustEffectName, vehicleRoadDust, type RoadDustEffectOps,
} from "./road-dust-effect";

function road(attributes: Record<string, string>) {
  return { road: { attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })) } };
}

test("a road's dust names its effect once the kart is fast enough", () => {
  const sand = road({ dust: "desertdust" });
  assert.equal(roadDustEffectName(sand, DEFAULT_ROAD_DUST_SPEED_KMH), "desertdust");
  assert.equal(roadDustEffectName(sand, DEFAULT_ROAD_DUST_SPEED_KMH - 1), undefined);
  assert.equal(roadDustEffectName(sand, -40), "desertdust", "reversing raises dust too");
  // sword_F01/I02/R01 shallows: dustVel="50.0".
  const sword = road({ sound: "물밟기", dust: "waterspark", dustVel: "50.0" });
  assert.equal(roadDustEffectName(sword, 49), undefined);
  assert.equal(roadDustEffectName(sword, 50), "waterspark");
  assert.equal(roadDustEffectName(road({ sound: "모래바닥" }), 100), undefined);
  assert.equal(roadDustEffectName(road({ dust: "../x" }), 100), undefined);
  assert.equal(roadDustEffectName(undefined, 100), undefined);
});

test("only a visible kart with its wheels on the road raises dust", () => {
  const vehicle = {
    wheels: { roadDescriptor: road({ dust: "water" }) },
    runtime: { contactWorking: true },
    displaySpeedKmh: () => 80,
  };
  assert.equal(vehicleRoadDust(vehicle, true), "water");
  assert.equal(vehicleRoadDust(vehicle, false), undefined);
  vehicle.runtime.contactWorking = false;
  assert.equal(vehicleRoadDust(vehicle, true), undefined);
});

test("a remote kart's dust comes from the road under it", () => {
  const rays: unknown[] = [];
  const track = {
    rayQuery(origin: { x: number; y: number; z: number }, displacement: unknown) {
      rays.push([origin, displacement]);
      return { point: { x: 0, y: 0, z: 0 }, roadDescriptor: road({ dust: "valleydust" }) };
    },
  };
  assert.equal(groundRoadDust(track, { x: 1, y: 2, z: 3 }, 60), "valleydust");
  assert.deepEqual(rays, [[{ x: 1, y: 3, z: 3 }, { x: 0, y: -2, z: 0 }]]);
  assert.equal(groundRoadDust({ rayQuery: () => undefined }, { x: 0, y: 0, z: 0 }, 60), undefined);
});

test("pose speed follows drawn positions and ignores jumps", () => {
  const speed = new PoseSpeed();
  assert.equal(speed.update(1000, { x: 0, y: 0, z: 0 }), 0);
  assert.equal(Math.round(speed.update(1100, { x: 2, y: 0, z: 0 })), 72);
  assert.equal(Math.round(speed.update(1100, { x: 9, y: 0, z: 0 })), 72, "same frame");
  assert.equal(speed.update(2000, { x: 50, y: 0, z: 0 }), 0, "respawn");
});

function harness(candidates: Record<string, number> = { water: 1, desertdust: 1 }) {
  const events: string[] = [];
  const parent = { object: {
    visible: true,
    add(object: unknown) { events.push(`attach ${(object as { name: string }).name}`); },
    traverse() {},
    removeFromParent() {},
  } };
  const archive = {
    exactCanonicalCandidates(path: string) {
      events.push(`candidates ${path}`);
      const name = path.replace(/^effect\/dust\/|\.1s$/g, "");
      return Array.from({ length: candidates[name] ?? 0 }, () => ({
        virtualPath: `effect.rho/${name}.1s`,
        bytes: async () => name,
      }));
    },
  };
  const ops: RoadDustEffectOps<string> = {
    decodeModel: bytes => `decoded ${bytes}`,
    async loadModel(data, _archive, path, identity) {
      events.push(`load ${data} ${path} ${identity.id}`);
      const name = identity.id.replace("effect:dust:", "");
      return {
        object: {
          name, visible: true,
          add() {},
          traverse(visit: (node: { isMesh?: boolean }) => void) { visit({ isMesh: true }); },
          removeFromParent() { events.push(`detach ${name}`); },
        },
        playControllers(now: number, offset: number) { events.push(`play ${name} ${now} ${offset}`); },
        stopControllers(now: number) { events.push(`stop ${name} ${now}`); },
        update(now: number, frame: unknown) { events.push(`update ${name} ${now} ${frame}`); },
        dispose() { events.push(`dispose ${name}`); },
      };
    },
    prepareTexture: object => { events.push(`texture ${(object as unknown as { name: string }).name}`); },
    configureMesh: (_node, order, transparent, bias) => { events.push(`mesh ${order} ${transparent} ${bias}`); },
    configureMaterials: object => { events.push(`materials ${(object as unknown as { name: string }).name}`); },
  };
  const errors: unknown[] = [];
  const effect = new RoadDustEffect(archive, parent, "env", "stage", ops, error => errors.push(error));
  return { effect, events, errors };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("dust effects load on first use, then play and stop with the road", async () => {
  const { effect, events, errors } = harness();
  effect.update(100, undefined, "camera", 1, 2);
  assert.deepEqual(events, []);
  effect.update(116, "water", "camera", 1, 2);
  await settle();
  assert.deepEqual(events.splice(0), [
    "candidates effect/dust/water.1s",
    "load decoded water effect.rho/water.1s effect:dust:water",
    "attach water", "texture water", "mesh -1000 true -0.01", "materials water",
  ]);
  effect.update(133, "water", "camera", 1, 2);
  effect.update(150, "water", "camera", 1, 2);
  effect.update(166, "desertdust", "camera", 1, 2);
  await settle();
  effect.update(183, "desertdust", "camera", 1, 2);
  effect.update(200, undefined, "camera", 1, 2);
  effect.update(216, "water", "camera", 1, 2);
  assert.deepEqual(events.splice(0), [
    "play water 133 0", "update water 133 camera",
    "update water 150 camera",
    "candidates effect/dust/desertdust.1s", "stop water 166",
    "load decoded desertdust effect.rho/desertdust.1s effect:dust:desertdust",
    "attach desertdust", "texture desertdust", "mesh -1000 true -0.01", "materials desertdust",
    "play desertdust 183 0", "update desertdust 183 camera",
    "stop desertdust 200",
    "play water 216 0", "update water 216 camera",
  ]);
  effect.reset(300);
  effect.dispose();
  assert.deepEqual(events, ["stop water 300", "detach water", "dispose water",
    "detach desertdust", "dispose desertdust"]);
  assert.deepEqual(errors, []);
});

test("a missing effect is asked for once; one loaded after disposal is released", async () => {
  const { effect, events, errors } = harness({ water: 1 });
  effect.update(0, "forestdust", "camera", 1, 2);
  effect.update(16, "forestdust", "camera", 1, 2);
  assert.deepEqual(events.splice(0), ["candidates effect/dust/forestdust.1s"]);
  effect.update(32, "water", "camera", 1, 2);
  effect.dispose();
  await settle();
  assert.deepEqual(events, ["candidates effect/dust/water.1s",
    "load decoded water effect.rho/water.1s effect:dust:water", "dispose water"]);
  assert.deepEqual(errors, []);
});
