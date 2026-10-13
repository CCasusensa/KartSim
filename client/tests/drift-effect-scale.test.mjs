import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createDriftEffectClass } from "../src/vehicle/drift-effect.ts";

const DriftEffect = createDriftEffectClass({
  Object3D: THREE.Object3D, DataTexture: THREE.DataTexture,
  MeshBasicMaterial: THREE.MeshBasicMaterial, BufferGeometry: THREE.BufferGeometry,
  BufferAttribute: THREE.BufferAttribute, Mesh: THREE.Mesh,
  decodePng() { throw new Error("This geometry test does not load assets."); },
  configureSkidMesh() {}, configureDriftMesh() {},
  textureFormat: THREE.RGBAFormat, textureType: THREE.UnsignedByteType,
  colorSpace: THREE.SRGBColorSpace, wrapping: THREE.ClampToEdgeWrapping,
  nearestFilter: THREE.NearestFilter, dynamicUsage: THREE.DynamicDrawUsage,
  doubleSide: THREE.DoubleSide, customBlending: THREE.CustomBlending,
  additiveEquation: THREE.AddEquation, sourceAlpha: THREE.SrcAlphaFactor,
  oneMinusSourceAlpha: THREE.OneMinusSrcAlphaFactor, oneBlend: THREE.OneFactor,
});

const origin = { x: 100, y: 8, z: 200 };
const sources = [{ x: -1.2, y: 1.6, z: 0 }, { x: 1.2, y: 1.6, z: 0 }];
const raycast = { rayQuery: at => ({ point: { x: at.x, y: 4, z: at.z } }) };
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 2e-5,
  `${label}: ${actual} ≠ ${expected}`);
function effect(t) {
  const textures = Array.from({ length: 6 }, () => new THREE.Texture());
  const value = new DriftEffect({ next: () => 16384 }, { sources, width: .6 }, ...textures);
  t.after(() => value.dispose());
  return value;
}
function frame(scale, overrides = {}) {
  return {
    active: true, contact: true, speedKmh: 80, forwardSpeed: 20,
    roadSurface: "road", motionMode: 0, position: { ...origin },
    right: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 },
    presentationRight: { x: 1, y: 0, z: 0 },
    presentationForward: { x: 0, y: 0, z: 1 }, presentationUp: { x: 0, y: 1, z: 0 },
    rearWheelCompression: [0, 0], wheelCompressionBaseline: 0,
    obstacleWheelHit: false, fullPhysicsBypass: false,
    ...(scale === undefined ? {} : { visualScale: { x: scale, y: scale, z: scale } }),
    ...overrides,
  };
}
function vertices(mesh) {
  return Array.from(mesh.geometry.getAttribute("position").array
    .slice(0, mesh.geometry.drawRange.count * 3));
}
function snapshot(value) {
  return structuredClone({
    activeSkids: value.activeSkids, finishedSkids: value.finishedSkids,
    particles: value.particles, drift2Particles: value.drift2Particles,
    meshes: [value.skidMesh, value.driftMesh, value.drift2Mesh].map(mesh => ({
      positions: vertices(mesh),
      uv: Array.from(mesh.geometry.getAttribute("uv").array.slice(0, mesh.geometry.drawRange.count * 2)),
    })),
  });
}

test("half-size skid marks follow both rear wheels with half width at world coordinates", t => {
  const full = effect(t), half = effect(t);
  for (const [tick, z] of [[0, 200], [40, 204]]) {
    for (const [value, scale] of [[full, 1], [half, .5]])
      value.update(tick, frame(scale, { position: { ...origin, z } }), raycast, false);
  }
  for (let channel = 0; channel < 2; channel++) {
    const pairs = half.activeSkids[channel].pairs;
    const fullPairs = full.activeSkids[channel].pairs;
    assert.equal(pairs.length, fullPairs.length);
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index], original = fullPairs[index];
      close(pair.center.x, origin.x + sources[channel].x * .5, "rear wheel side offset");
      // The center retains the traveled path; only the rear attachment offset scales.
      close(pair.center.z, original.center.z + sources[channel].y * .5, "rear wheel length offset");
      close(pair.center.y, 4.02, "road contact plus fixed depth lift");
      const width = p => Math.hypot(p.second.x - p.first.x, p.second.y - p.first.y,
        p.second.z - p.first.z);
      close(width(pair), .3, "half-width tread");
      close(width(pair), width(original) * .5, "relative tread width");
    }
    close(pairs.at(-1).center.z - pairs[0].center.z, 4, "actual traveled distance");
  }
});

test("both drift particle variants halve their offsets and full quad geometry", t => {
  for (const mode of [0, 2]) {
    const full = effect(t), half = effect(t);
    full.update(0, frame(1, { motionMode: mode }), raycast, true);
    half.update(0, frame(.5, { motionMode: mode }), raycast, true);
    for (const key of mode === 0 ? ["driftMesh"] : ["driftMesh", "drift2Mesh"]) {
      const original = vertices(full[key]), scaled = vertices(half[key]);
      assert.equal(original.length, 36, `${key}: two six-vertex particles`);
      assert.equal(scaled.length, original.length);
      for (let index = 0; index < scaled.length; index++) {
        const axis = ["x", "y", "z"][index % 3];
        close(scaled[index], origin[axis] + (original[index] - origin[axis]) * .5,
          `${key} vertex ${index}`);
      }
    }
  }
});

test("missing visual scale and explicit unit scale produce identical geometry and lifecycle", t => {
  const implicit = effect(t), explicit = effect(t);
  for (const [tick, mode] of [[0, 0], [40, 2], [80, 3], [120, 0]]) {
    const overrides = { motionMode: mode, position: { ...origin, z: origin.z + tick / 20 } };
    implicit.update(tick, frame(undefined, overrides), raycast, true);
    explicit.update(tick, frame(1, overrides), raycast, true);
    assert.deepEqual(snapshot(implicit), snapshot(explicit));
  }
});

test("finished marks and existing particles retain their birth size when the kart scale changes", t => {
  const changed = effect(t), control = effect(t);
  for (const value of [changed, control]) {
    value.update(0, frame(.5, { motionMode: 2 }), raycast, true);
    value.update(40, frame(.5, { motionMode: 2, position: { ...origin, z: 202 } }), raycast, true);
  }
  const pairsAtBirth = structuredClone(changed.activeSkids.map(history => history.pairs));
  const basisAtBirth = value => structuredClone([...value.particles, ...value.drift2Particles]
    .map(({ origin, right, rear, up }) => ({ origin, right, rear, up })));
  const oldParticleBasis = basisAtBirth(changed);
  const stop = { active: false, fullPhysicsBypass: true, motionMode: 2,
    position: { x: 500, y: 20, z: 600 } };
  changed.update(80, frame(1, stop), raycast, false);
  control.update(80, frame(.5, stop), raycast, false);
  assert.deepEqual(changed.finishedSkids.map(history => history.pairs), pairsAtBirth);
  assert.deepEqual(basisAtBirth(changed), oldParticleBasis);
  // Both effects age normally; the current kart size must not resize existing quads.
  assert.deepEqual(snapshot(changed), snapshot(control));
});
