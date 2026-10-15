import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "@babel/parser";
import {
  BufferAttribute, BufferGeometry, DataTexture, LinearFilter, MathUtils,
  Mesh, NormalBlending, PerspectiveCamera, RGBAFormat, ShaderMaterial,
  Vector3, ClampToEdgeWrapping, SRGBColorSpace,
} from "three";
import { SnowScreenEffect, loadSnowScreenEffect } from "../src/vehicle/snow-screen-effect.ts";

const release = readFileSync(new URL("../../recovered/formatted/index.js", import.meta.url), "utf8");
const declarations = parse(release, { sourceType: "module" }).program.body;
const constants = declarations.find(node => node.type === "VariableDeclaration" &&
  node.declarations.some(part => part.id.name === "gi"));
const originalClass = declarations.find(node => node.type === "ClassDeclaration" && node.id.name === "A7");
assert.ok(constants && originalClass);
const aliases = {
  t9: BufferGeometry, _0: BufferAttribute, $1: ShaderMaterial,
  X5: NormalBlending, D2: Mesh, H: Vector3, kl: MathUtils,
  ca: (mesh, key) => { mesh.userData.sortKey = key; },
};
const Original = new Function("aliases", `const { t9, _0, $1, X5, D2, H, kl, ca } = aliases;
  ${release.slice(constants.start, constants.end)}
  ${release.slice(originalClass.start, originalClass.end)}
  return A7;`)(aliases);

class Rewritten extends SnowScreenEffect {
  constructor(random, texture) {
    super(random, texture, aliases.ca);
  }
}

function random() {
  let seed = 0x12345678;
  return { next() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; } };
}

function snapshot(effect) {
  return {
    enabled: effect.enabled,
    previousMs: effect.previousMs,
    spawnAccumulatorMs: effect.spawnAccumulatorMs,
    fadeRemainingMs: effect.fadeRemainingMs,
    queuedSpawns: effect.queuedSpawns,
    active: effect.activeParticleCount(),
    particles: effect.particles.filter(p => p.active).slice(0, 8).map(p => ({
      active: p.active, position: p.position.toArray(), size: p.size,
      speed: p.speed, lifeMs: p.lifeMs, u0: p.u0, u1: p.u1,
    })),
    positions: [...effect.positions.slice(0, 96)],
    colors: [...effect.colors.slice(0, 128)],
    uvs: [...effect.uvs.slice(0, 64)],
    drawRange: { ...effect.object.geometry.drawRange },
    material: {
      name: effect.object.material.name,
      toneMapped: effect.object.material.toneMapped,
      transparent: effect.object.material.transparent,
      blending: effect.object.material.blending,
      depthTest: effect.object.material.depthTest,
      depthWrite: effect.object.material.depthWrite,
      vertexColors: effect.object.material.vertexColors,
    },
    object: { name: effect.object.name, frustumCulled: effect.object.frustumCulled,
      sortKey: effect.object.userData.sortKey },
  };
}

function exercise(Type) {
  const effect = new Type(random(), new DataTexture(new Uint8Array(32 * 128 * 4), 32, 128));
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 1000);
  const states = [snapshot(effect)];
  for (const time of [1, 500, 650, 800, 1100, 1250, 1250, 1500]) {
    effect.update(time, camera, 1280, 720);
    states.push(snapshot(effect));
  }
  effect.setEnabled(false);
  effect.update(1800, camera, 1280, 720);
  states.push(snapshot(effect));
  effect.setEnabled(true);
  effect.update(2000, camera, 1280, 720);
  states.push(snapshot(effect));
  effect.reset();
  states.push(snapshot(effect));
  effect.dispose();
  return states;
}

/** Release state without the parts the 2026-10-15 snow fix changed on purpose. */
function releaseShared(state) {
  const { positions, material: { depthTest, ...material }, ...rest } = state;
  return { ...rest, material };
}

test("snow screen renderer keeps the release particle state, colours and uvs", () => {
  const original = exercise(Original);
  const rewritten = exercise(Rewritten);
  assert.ok(original.some(state => state.drawRange.count > 0));
  assert.deepEqual(rewritten.map(releaseShared), original.map(releaseShared));
});

test("snow flakes draw as visible screen quads: strip-shaped, twice the release size, no depth test", () => {
  const original = exercise(Original);
  const rewritten = exercise(Rewritten);
  let quads = 0;
  for (let index = 0; index < original.length; index++) {
    assert.equal(original[index].material.depthTest, true);
    assert.equal(rewritten[index].material.depthTest, false);
    const count = original[index].drawRange.count / 6;
    for (let quad = 0; quad < Math.min(count, 8); quad++) {
      const corners = positions => [0, 1, 2, 3].map(corner => positions.slice((quad * 4 + corner) * 3, (quad * 4 + corner) * 3 + 3));
      const before = corners(original[index].positions), after = corners(rewritten[index].positions);
      const extent = quad => ({
        x: (quad[2][0] + quad[0][0]) / 2, y: (quad[0][1] + quad[1][1]) / 2, z: quad[0][2],
        halfWidth: (quad[2][0] - quad[0][0]) / 2, halfHeight: (quad[0][1] - quad[1][1]) / 2,
      });
      const a = extent(before), b = extent(after);
      assert.ok(Math.abs(b.x - a.x) < 1e-6 && Math.abs(b.y - a.y) < 1e-6 && b.z === a.z);
      assert.ok(Math.abs(b.halfWidth - a.halfWidth * 2) < 1e-6);
      assert.ok(Math.abs(b.halfHeight - a.halfHeight * 8) < 1e-6);
      quads++;
    }
  }
  assert.ok(quads > 0);
});

test("snow fades the faint motion trail and keeps the flakes", () => {
  const effect = new Rewritten(random(), new DataTexture(new Uint8Array(32 * 128 * 4), 32, 128));
  assert.match(effect.object.material.fragmentShader, /smoothstep\(0\.30, 0\.65, texel\.a\)/);
  effect.dispose();
});

test("snow texture loader validates source identity before decode", async () => {
  await assert.rejects(loadSnowScreenEffect({ exactCanonicalCandidates: () => [] }, random(),
    async () => { throw new Error("unexpected decode"); }, () => { throw new Error("unexpected render"); }),
  /exact source 数量应为1/);
  await assert.rejects(loadSnowScreenEffect({ exactCanonicalCandidates: () => [
    { sourceName: "other.rho", bytes: async () => new Uint8Array() },
  ] }, random(), async () => { throw new Error("unexpected decode"); },
  () => { throw new Error("unexpected render"); }), /必须来自 theme_ice.rho/);
});
