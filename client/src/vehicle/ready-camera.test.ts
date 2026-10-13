import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "three";

import { ReadyCameraController, type ReadyCameraRuntime, type ReadyNode } from "./ready-camera";

function node(className: string, children: ReadyNode[] = [], extra: Partial<ReadyNode> = {}): ReadyNode {
  return { className, children, position: [0, 0, 0], scale: [1, 1, 1],
    transform: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], slotOccurrences: [], ...extra };
}

test("hold shows the first key until start, which plays from the next frame", () => {
  const sampled: number[] = [];
  const runtimes: ReadyCameraRuntime[] = [];
  const camera = node("ReCamera", [], { camera: { projectionMode: 0, fieldOfViewDegrees: 45,
    nearClip: 1, farClip: 1000 } });
  const root = { ...node("Relement", [node("Relement", [camera],
    { name: "Camera02", slotOccurrences: [{ value: undefined }, { value: "prs" }] })]), kind: "node" };
  const ready = new ReadyCameraController({ root }, {
    isPrsController: value => value === "prs",
    unsupportedPrs: () => undefined,
    createPrsRuntime: () => {
      const runtime = { anchor: 0, previousCycle: 0, reverseHalf: false };
      runtimes.push(runtime);
      return runtime;
    },
    animatePrs(_controller, runtime, timeMs, pose) {
      if (runtime.anchor === 0 && timeMs !== 0) runtime.anchor = timeMs;
      sampled.push(timeMs - runtime.anchor);
      return pose;
    },
    fieldOfView: degrees => degrees,
  });
  const view = new PerspectiveCamera();
  const kart = { position: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };

  ready.apply(view, 5000, kart);
  ready.hold();
  ready.apply(view, 6000, kart);
  ready.apply(view, 9000, kart);
  assert.equal(ready.waiting, true);
  assert.equal(runtimes[0]!.anchor, 0);
  ready.start();
  ready.apply(view, 9500, kart);
  ready.apply(view, 10500, kart);
  assert.equal(ready.waiting, false);
  assert.deepEqual(sampled, [0, 0, 0, 0, 1000]);
});
