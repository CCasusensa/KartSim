import assert from "node:assert/strict";
import test from "node:test";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera } from "three";

import {
  BRAWL_DRAW_DISTANCE, LOD_FAR, LOD_NEAR, nthSmallest, remoteRacerCulling, riderLod,
  setSmallPartsDrawn, SMALL_PART_RATIO, updateVisibleWorldMatrices,
} from "./race-presenter-participants";
import { nearbySlipstreamPeers, slipstreamCandidates } from "./remote-slipstream";

test("near karts keep full detail; further ones lose outlines, small parts and rider frames", () => {
  assert.equal(riderLod(LOD_NEAR - 1, 0), undefined);
  const mid = [0, 1, 2, 3].map(turn => riderLod(60, turn)!);
  assert.ok(mid.every(lod => !lod.outlines && lod.minimumPartRadius === 60 * SMALL_PART_RATIO));
  assert.deepEqual(mid.map(lod => lod.animate), [true, false, true, false]);
  const far = [0, 1, 2, 3, 4].map(turn => riderLod(LOD_FAR + 20, turn)!.animate);
  assert.deepEqual(far, [true, false, false, false, true]);
  // Only the nearest few keep full detail: a nearer threshold applies.
  assert.ok(riderLod(30, 0, 20));
  assert.equal(riderLod(15, 0, 20), undefined);
  assert.equal(nthSmallest([9, 3, 7, 1], 2), 3);
  assert.equal(nthSmallest([9, 3], 6), Infinity);
});

test("a remote kart is drawn in front of the camera and within the draw distance", () => {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  camera.updateMatrixWorld();
  const inView = remoteRacerCulling(camera);
  assert.ok(Math.abs(inView({ x: 0, y: 2, z: -50 })! - 50) < 1e-6);
  assert.equal(inView({ x: 0, y: 2, z: 50 }), undefined); // behind
  assert.equal(inView({ x: 0, y: 2, z: -(BRAWL_DRAW_DISTANCE + 10) }), undefined); // too far
  assert.equal(inView({ x: 400, y: 2, z: -60 }), undefined); // off to the side
});

test("world matrices of the visible part only, as updateMatrixWorld(true) gives them", () => {
  const root = new Group();
  const shown = new Group();
  const hidden = new Group();
  const leaf = new Object3D();
  hidden.visible = false;
  root.add(shown, hidden);
  shown.add(leaf);
  root.position.set(5, 0, 0);
  shown.position.set(0, 1, 0);
  hidden.position.set(0, 0, 3);
  leaf.position.set(1, 0, 0);
  updateVisibleWorldMatrices(root);
  assert.deepEqual(leaf.matrixWorld.elements.slice(12, 15), [6, 1, 0]);
  assert.deepEqual(hidden.matrixWorld.elements.slice(12, 15), [0, 0, 0]); // not touched
  const reference = leaf.matrixWorld.clone();
  root.updateMatrixWorld(true);
  assert.ok(leaf.matrixWorld.equals(reference));
});

test("small parts of a far kart leave the camera layer and come back", () => {
  const part = (radius: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([radius, 0, 0, -radius, 0, 0], 3));
    return new Mesh(geometry, new MeshBasicMaterial());
  };
  const root = new Group();
  const nut = part(0.05);
  const body = part(0.9);
  root.add(nut, body);
  root.updateMatrixWorld(true);
  setSmallPartsDrawn(root, 0.2);
  assert.equal(nut.layers.isEnabled(0), false);
  assert.equal(body.layers.isEnabled(0), true);
  assert.equal(nut.visible, true); // the kart's own visibility is untouched
  setSmallPartsDrawn(root, 0);
  assert.equal(nut.layers.isEnabled(0), true);
});

test("remote slipstreams follow only the karts near the local one and near each", () => {
  const peer = (id: string, z: number) => ({ playerId: id, position: { x: 0, y: 0, z },
    forward: { x: 0, y: 0, z: -1 } });
  const peers = [peer("a", 0), peer("b", 30), peer("c", 80), peer("d", 200)];
  assert.deepEqual(nearbySlipstreamPeers(peers, { x: 0, y: 0, z: 10 }).map(p => p.playerId), ["a", "b"]);
  assert.deepEqual(slipstreamCandidates(peers, peers[1]!).map(p => p.playerId), ["a", "c"]);
});
