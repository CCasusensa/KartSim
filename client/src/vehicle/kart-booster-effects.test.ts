import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { boosterKindForState, KartBoosterEffectHost, KartBoosterSharedSources,
  waveKindForState } from "./kart-booster-effects";
import type { BoosterEffectDependencies, EffectObject, EffectResource,
  EffectScene, EffectVehicle } from "./kart-booster-effects";

const release = readFileSync(new URL("../../../recovered/formatted/index.js", import.meta.url), "utf8");
const start = release.indexOf("const dS =");
const end = release.indexOf("function u10(", start);
assert.ok(start > 0 && end > start);

class ObjectNode implements EffectObject {
  visible = true;
  parent: ObjectNode | null = null;
  children: ObjectNode[] = [];
  constructor(readonly name: string) {}
  add(object: EffectObject): void {
    object.removeFromParent();
    const child = object as ObjectNode;
    child.parent = this;
    this.children.push(child);
  }
  removeFromParent(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}

function harness(exceedTable = false, magnetField = false) {
  const events: unknown[] = [];
  const scenes: EffectScene[] = [];
  const resources = new Map<string, EffectResource>();
  const add = (path: string) => resources.set(path, {
    virtualPath: path, async bytes() { events.push(["bytes", path]); return new Uint8Array([1]); },
  });
  for (const name of ["booster", "boosterTeam", "boosterPlay", "boosterDual_S",
    "boosterDualIdle_S", "boosterDual_T", "boosterDualIdle_T"])
    for (const family of ["booster", "boosterFlare"])
      add(`effect/${family}/red/${name}.1s`);
  for (const name of ["effect", "custom", "drift", "exceed"])
    add(`effect/boosterWave/${name}.1s`);
  if (exceedTable) add("zeta_/cn/engine/exceedTypeChange.xml");
  if (magnetField) add("item/magnet/item01.1s");
  const library = { exactCanonicalCandidates(path: string) {
    const resource = resources.get(path);
    return resource ? [resource] : [];
  } };
  const root = new ObjectNode("kart");
  const attachment = new ObjectNode("socket");
  root.add(attachment);
  const kart = { object: root, nodes: new Map([["boost", { object: attachment }]]) };
  const vehicle: EffectVehicle = {
    boosterTypes: ["red"], attachments: ["boost"], boosterWaveType: "custom",
    driftBoostEffectType: "drift", defaultExceedType: 0, exceedWaveType: "exceed",
  };
  const decodeScene: BoosterEffectDependencies["decodeScene"] = () => {
    events.push(["decode"]);
    return { root: { kind: "node", scale: [1, 2, 3] } };
  };
  const buildScene: BoosterEffectDependencies["buildScene"] = async (
    parsed, _library, path, identity, options) => {
    events.push(["build", path, identity, parsed.root.scale,
      options.advanceEnvironment, options.convertClientCoordinates]);
    const object = new ObjectNode(path);
    const scene: EffectScene = {
      object,
      reset(time) { events.push(["reset", path, time]); },
      update(time, delta) { events.push(["update", path, time, delta]); },
      stopControllers(time) { events.push(["stop", path, time]); },
      pruneWorldMatrixRecursion() { events.push(["prune", path]); },
      dispose() { events.push(["dispose", path]); },
    };
    scenes.push(scene);
    return scene;
  };
  const deps: BoosterEffectDependencies = {
    decodeScene, buildScene,
    parseXml: () => ({ root: { name: "exceedType", children: [
      { name: "exceedTypeList", children: [{ name: "exceedType", children: [] }] },
    ] } }),
    xmlChild: (parent, name) => parent.children.find(child => child.name === name),
    xmlAttribute: (_node, name) => name === "id" ? "1"
      : name === "exceedWaveType" ? "exceed" : undefined,
    warmDetachedScene: (_root, object, time, force) => {
      events.push(["warm", (object as ObjectNode).name, time, force]);
    },
  };
  const Original = new Function("y9", "c5", "Hn", "x1", "zp", "j0",
    `${release.slice(start, end)}\nreturn { KI, Ca, $w, Ww };`)(
    decodeScene, buildScene, deps.warmDetachedScene, deps.parseXml,
    deps.xmlChild, deps.xmlAttribute,
  ) as {
    KI: typeof KartBoosterSharedSources;
    Ca: typeof KartBoosterEffectHost;
    $w: typeof boosterKindForState;
    Ww: typeof waveKindForState;
  };
  return { Original, library, kart, vehicle, deps, root, scenes, events };
}

function snapshot(host: KartBoosterEffectHost) {
  return {
    kinds: host.instances.map(instance => [instance.family, instance.kind,
      (instance.scene.object as ObjectNode).name,
      (instance.scene.object.parent as ObjectNode | null)?.name,
      instance.scene.object.visible]),
    state: host.state, dualMode: host.dualMode, dualVisual: host.dualVisual,
    dualFlavor: host.dualFlavor, exceedActive: host.exceedActive,
    hasTeamDual: host.hasTeamDual,
    census: host.censusEffectRoots().map(entry => entry.name),
  };
}

test("booster effect loading, state transitions and scene ownership match release", async () => {
  const old = harness();
  const current = harness();
  const expected = await old.Original.Ca.load(old.library, old.vehicle, 8, old.kart,
    {}, {}, "driving", undefined, undefined, old.deps);
  const actual = await KartBoosterEffectHost.load(current.library, current.vehicle, 8,
    current.kart, {}, {}, "driving", undefined, undefined, current.deps);
  assert.deepEqual(snapshot(actual), snapshot(expected));
  assert.deepEqual(current.events, old.events);
  const transitions: Array<[number, number, boolean, boolean, number]> = [
    [1, 0, false, false, 100], [3, 1, false, false, 150],
    [10, 3, true, true, 200], [10, 3, true, false, 250],
    [4, 1, false, false, 300],
  ];
  for (const args of transitions) {
    assert.equal(actual.setState(...args), expected.setState(...args));
    assert.deepEqual(snapshot(actual), snapshot(expected));
    assert.deepEqual(current.events, old.events);
  }
  actual.update(400, 16, {}, {});
  expected.update(400, 16, {}, {});
  actual.warmDetachedScenes({}, 410);
  expected.warmDetachedScenes({}, 410);
  assert.deepEqual(current.events, old.events);
  actual.dispose(); expected.dispose();
  assert.deepEqual(current.events, old.events);
});

test("garage preview effect scene and shared source lifetimes match release", async () => {
  const old = harness();
  const current = harness();
  const oldShared = new old.Original.KI();
  const newShared = new KartBoosterSharedSources();
  const expected = await old.Original.Ca.load(old.library, old.vehicle, 0, old.kart,
    {}, {}, "garage-preview", undefined, oldShared, old.deps);
  const actual = await KartBoosterEffectHost.load(current.library, current.vehicle, 0,
    current.kart, {}, {}, "garage-preview", undefined, newShared, current.deps);
  assert.deepEqual(snapshot(actual), snapshot(expected));
  assert.equal(newShared.refs, oldShared.refs);
  assert.deepEqual(current.events, old.events);
  actual.setState(1, 0, false, false, 100);
  expected.setState(1, 0, false, false, 100);
  actual.restartGaragePreview(200);
  expected.restartGaragePreview(200);
  assert.deepEqual(snapshot(actual), snapshot(expected));
  assert.deepEqual(current.events, old.events);
  actual.dispose(); expected.dispose();
  assert.equal(newShared.refs, oldShared.refs);
  assert.deepEqual(current.events, old.events);
});

test("booster and wave state labels match release", () => {
  const original = harness().Original;
  for (let state = 0; state < 24; state++) {
    assert.equal(boosterKindForState(state), original.$w(state));
    assert.equal(waveKindForState(state), original.Ww(state));
  }
});

test("the magnet state (MZ road) shows the magnet item's field unless an item magnet draws it", async () => {
  const current = harness(false, true);
  const host = await KartBoosterEffectHost.load(current.library, current.vehicle, 8,
    current.kart, {}, {}, "driving", undefined, undefined, current.deps);
  const magnet = host.instances.find(instance => instance.kind === "magnet")!;
  assert.equal(magnet.family, "item");
  const object = magnet.scene.object as ObjectNode;
  assert.deepEqual(current.events.find(event => (event as unknown[])[1] === "item/magnet/item01.1s" &&
    (event as unknown[])[0] === "build"), ["build", "item/magnet/item01.1s", { id: "item" }, [1, 2, 3], false, false]);
  const shown = () => [object.visible, object.parent?.name];
  const resets = () => current.events.filter(event =>
    (event as unknown[])[0] === "reset" && (event as unknown[])[1] === "item/magnet/item01.1s").length;
  assert.deepEqual(shown(), [false, undefined]);
  host.setState(16, 0, false, false, 100);
  assert.deepEqual(shown(), [true, "kart"], "on the kart root, like the booster waves");
  assert.equal(resets(), 1);
  assert.equal(host.instances.filter(instance => instance.scene.object.visible).length, 1, "no booster look");
  host.setMagnetSuppressed(true, 150);
  assert.deepEqual(shown(), [false, undefined]);
  host.setMagnetSuppressed(true, 160);
  host.setMagnetSuppressed(false, 200);
  assert.deepEqual(shown(), [true, "kart"]);
  assert.equal(resets(), 2);
  host.setState(0, 0, false, false, 300);
  assert.deepEqual(shown(), [false, undefined]);
  host.setMagnetSuppressed(true, 350);
  host.setState(16, 0, false, false, 400);
  assert.deepEqual(shown(), [false, undefined], "an item magnet's pull draws its own field");
  host.dispose();

  const preview = harness(false, true);
  const garage = await KartBoosterEffectHost.load(preview.library, preview.vehicle, 8,
    preview.kart, {}, {}, "garage-preview", undefined, undefined, preview.deps);
  assert.ok(!garage.instances.some(instance => instance.kind === "magnet"));
  const filtered = harness(false, true);
  const ghost = await KartBoosterEffectHost.load(filtered.library, filtered.vehicle, 8,
    filtered.kart, {}, {}, "driving", new Set(["booster"]), undefined, filtered.deps);
  assert.ok(!ghost.instances.some(instance => instance.kind === "magnet"));
});

test("exceed wave XML selection and parsed scene cache match release", async () => {
  const old = harness(true);
  const current = harness(true);
  old.vehicle.defaultExceedType = 1;
  current.vehicle.defaultExceedType = 1;
  const oldShared = new old.Original.KI();
  const newShared = new KartBoosterSharedSources();
  const expected = await old.Original.Ca.load(old.library, old.vehicle, 8, old.kart,
    {}, {}, "driving", undefined, oldShared, old.deps);
  const actual = await KartBoosterEffectHost.load(current.library, current.vehicle, 8,
    current.kart, {}, {}, "driving", undefined, newShared, current.deps);
  assert.deepEqual(snapshot(actual), snapshot(expected));
  assert.deepEqual(current.events, old.events);
  assert.equal(newShared.parsedScenes.size, oldShared.parsedScenes.size);
  actual.dispose(); expected.dispose();
});
