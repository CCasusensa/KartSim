import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { Group, Vector3 } from "three";

import { RhoReader } from "../codecs/rho";
import { T, s2 } from "../generated/formats.js";
import type { RhoArchiveIndex } from "../resources/archive-index";
import { KartPresentationView, type KartPose } from "../world/kart-presentation-view";
import {
  AUTOPILOT_ANNOUNCE_MS, AUTOPILOT_ERROR_MS, AUTOPILOT_POP_DELAY_MS, autopilotPromptAlphas,
  isAutopilotKart,
} from "./autopilot-prank";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("only 创世 9 自动版 is the autopilot kart", () => {
  assert.equal(isAutopilotKart("solarAuto"), true);
  assert.equal(isAutopilotKart("solarauto"), true);
  assert.equal(isAutopilotKart("solarGolden"), false);
  assert.equal(isAutopilotKart(undefined), false);
});

test("the announcement runs through the count, the error and the pop follow GO", () => {
  const at = (time: number) => autopilotPromptAlphas(time);
  assert.deepEqual(at(-AUTOPILOT_ANNOUNCE_MS - 1), { announce: 0, error: 0, pop: 0 });
  assert.equal(at(-AUTOPILOT_ANNOUNCE_MS + 50).announce, 0.5);
  assert.equal(at(-1_500).announce, 1);
  assert.equal(at(-50).announce, 0.5);
  // GO: the announcement is gone and the error fades in.
  assert.deepEqual(at(0), { announce: 0, error: 0, pop: 0 });
  assert.equal(at(100).error, 1);
  assert.equal(at(AUTOPILOT_ERROR_MS - 50).error, 0.5);
  assert.equal(at(AUTOPILOT_ERROR_MS).error, 0);
  // aprilFoolPop: 100 ms in, 1000 ms shown, 100 ms out.
  assert.equal(at(AUTOPILOT_POP_DELAY_MS).pop, 0);
  assert.equal(at(AUTOPILOT_POP_DELAY_MS + 50).pop, 0.5);
  assert.equal(at(AUTOPILOT_POP_DELAY_MS + 1_100).pop, 1);
  assert.equal(at(AUTOPILOT_POP_DELAY_MS + 1_150).pop, 0.5);
  assert.equal(at(AUTOPILOT_POP_DELAY_MS + 1_200).pop, 0);
  assert.deepEqual(at(60_000), { announce: 0, error: 0, pop: 0 });
});

function poseAt(x: number, z: number, yaw = 0): KartPose & { vx: number } {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return { x, y: 0.5, z, vx: x, right: { x: c, y: 0, z: -s }, up: { x: 0, y: 1, z: 0 },
    forward: { x: s, y: 0, z: c }, visualScale: { x: 1, y: 1, z: 1 } };
}

/** A view whose kart has a rider mount (ReKart child 6) holding a rider. */
function riddenView() {
  const scene = new Group();
  const view = new KartPresentationView(scene, {
    makeWheelPresentation() { throw new Error("unused"); },
    makeBalloon() { throw new Error("unused"); }, disposeObject() {},
  });
  const model = new Group();
  const mount = new Group();
  mount.position.set(0.1, 0.3, -0.2);
  model.add(mount);
  const rider = new Group();
  rider.position.set(0, 0.2, 0.05);
  mount.add(rider);
  view.setModel(model, { attachments: [], isTransformAutoCharge: false, autoChargeLowSpeed: 0,
    transformTime: 0 }, undefined);
  const wheels: number[] = [];
  view.wheelPresentation = { reset() {}, update(pose) { wheels.push((pose as unknown as { vx: number }).vx); } };
  const frame = (pose: KartPose, time: number) => {
    view.update(pose, time);
    scene.updateMatrixWorld(true);
  };
  const world = (object: Group) => object.getWorldPosition(new Vector3());
  return { view, model, mount, rider, wheels, frame, world };
}

const near = (actual: Vector3, expected: Vector3) =>
  assert.ok(actual.distanceTo(expected) < 1e-5, `${actual.toArray()} ≠ ${expected.toArray()}`);

test("a parked kart stays at the start while its rider drives on seated", () => {
  const parked = riddenView(), reference = riddenView();
  parked.frame(poseAt(0, 0), 0);
  const start = parked.world(parked.model);
  parked.view.parkModel(parked.mount);
  assert.equal(parked.view.parked(), true);
  for (const [index, pose] of [poseAt(4, 9, 0.3), poseAt(-2, 20, 1.2)].entries()) {
    parked.frame(pose, index + 1);
    reference.frame(pose, index + 1);
    near(parked.world(parked.model), start);
    // The rider sits exactly where it would in a kart that drove there.
    near(parked.world(parked.rider), reference.world(reference.rider));
    assert.ok(parked.rider.getWorldQuaternion(new Group().quaternion)
      .angleTo(reference.rider.getWorldQuaternion(new Group().quaternion)) < 1e-5);
  }
  // The parked kart's wheels and handle keep the pose they were parked in.
  assert.deepEqual(parked.wheels, [0, 0, 0]);
  parked.view.unparkModel();
  assert.equal(parked.rider.parent, parked.mount);
  parked.frame(poseAt(7, 7), 4);
  reference.frame(poseAt(7, 7), 4);
  near(parked.world(parked.rider), reference.world(reference.rider));
  near(parked.world(parked.model), reference.world(reference.model));
});

test("clearing a parked kart's model gives the rider back to it first", () => {
  const { view, mount, rider, frame } = riddenView();
  frame(poseAt(0, 0), 0);
  view.parkModel(mount);
  view.clearModel();
  assert.equal(view.parked(), false);
  assert.equal(rider.parent, mount);
});

let windowTemplate: Promise<RhoReader> | undefined;

/** gui_windowTemplate.rho, read once. */
function windowTemplateArchive(): Promise<RhoReader> {
  windowTemplate ??= (async () => {
    const archiveIndex = JSON.parse(inflateSync(await readFile(path.resolve(project,
      "../mirror/__p3553/archive-index"))).toString("utf8")) as { rho: RhoArchiveIndex[] };
    const archive = archiveIndex.rho.find(candidate => candidate.name === "gui_windowTemplate.rho");
    assert.ok(archive);
    const source = await readFile(path.resolve(project, "../mirror/p3553", archive.name));
    const copy = (chunk: Uint8Array): ArrayBuffer => Uint8Array.from(chunk).buffer as ArrayBuffer;
    return new RhoReader({
      name: archive.name, size: source.length,
      arrayBuffer: async () => copy(source),
      slice: (start = 0, end = source.length) => ({ arrayBuffer: async () => copy(source.subarray(start, end)) }),
    }, archive);
  })();
  return windowTemplate;
}

interface Node { name: string; attributes: Array<{ name: string; value: string }>; children: Node[] }

const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(flatten)];

test("the three April Fools' windows and their cn images are in gui_windowTemplate", async () => {
  const window = async (name: string) =>
    s2(await (await windowTemplateArchive()).read(`${name}.bml`)) as Node;
  const announce = await window("aprilFoolDayTuto");
  assert.equal(T(announce, "adjust"), "0 -180");
  assert.deepEqual(flatten(announce).map(node => [node.name, T(node, "image") ?? T(node, "texture")]),
    [["Container", undefined], ["ImageBoard", "aprilFoolDayTuto@zz"]]);
  const error = await window("aprilFoolDayWarning");
  assert.equal(T(error, "adjust"), "0 215");
  assert.deepEqual(flatten(error).map(node => T(node, "texture")),
    [undefined, "aprilFoolDayWarning@zz", "aprilFoolDayWarningMsg@zz"]);
  const pop = await window("aprilFoolPop");
  const control = flatten(pop).find(node => node.name === "ControlWindow")!;
  assert.deepEqual(["fadeInLength", "showLength", "fadeOutLength"].map(name => T(control, name)),
    ["100", "1000", "100"]);
  for (const image of ["aprilFoolDayTuto@cn", "aprilFoolDayWarning@zz", "aprilFoolDayWarningMsg@cn",
    "aprilFoolPop@cn"]) {
    const png = await (await windowTemplateArchive()).read(`${image}.png`);
    assert.equal(png[1], 0x50, image);
  }
});
