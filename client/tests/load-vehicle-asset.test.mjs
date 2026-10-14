import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "@babel/parser";
import { loadVehicleAsset } from "../src/vehicle/load-vehicle-asset.ts";

const release = readFileSync(new URL("../../recovered/formatted/index.js", import.meta.url), "utf8");
const declaration = parse(release, { sourceType: "module" }).program.body.find(node =>
  node.type === "ClassDeclaration" && node.id.name === "ul");
assert.ok(declaration);
const originalClass = release.slice(declaration.start, declaration.end);

function fixture(options = {}) {
  const calls = [];
  const roadDust = [];
  const disposable = name => ({ name, dispose(...args) { calls.push(["dispose", name, ...args]); } });
  const make = name => async (...args) => {
    calls.push([name, ...args.map(value =>
      value?.name ?? value?.type ?? value?.internalId ?? value)]);
    if (options.failAt === name) throw new Error(`${name} failed`);
    return disposable(name);
  };
  const root = { name: "root", rootBounds: "bounds", simpleShadow: "shadow settings" };
  const transform = { name: "transform" };
  const imported = {
    name: "imported", model: { name: "model" }, object: { name: "object" },
    renderScene: options.noRenderScene ? undefined : disposable("render scene"),
    scene: { bySource: new Map(options.noShadowTransform ? [] : [[root, transform]]) },
  };
  const runtime = {
    imported,
    visual: { name: "visual", tachometerType: "tacho", tachometerName: "name",
      engineSound: "engine", attachments: "attachments" },
    resources: { find(paths) {
      calls.push(["find", paths]);
      return options.noShadow ? undefined : { name: "shadow file" };
    } },
    coating: disposable("coating"),
    particleModification: disposable("particle modification"),
  };
  const itemIds = { 2: options.equipped ? 12 : 0,
    8: options.equipped ? 18 : 0,
    9: options.equipped ? 19 : 0,
    11: options.equipped ? 21 : 0,
    16: 0, 26: 0, 27: options.equipped ? 37 : 0 };
  const library = {
    async timeAttackGarageCatalog() { calls.push(["catalog"]); return { karts: "karts" }; },
    async timeAttackDecorationItem(slot, id) {
      calls.push(["decoration item", slot, id]);
      return { internalId: `${slot}:${id}`, name: "decoration" };
    },
  };
  const host = {
    getLibrary() { calls.push(["library"]); return options.noLibrary ? undefined : library; },
    userProfile: { equipment: { itemIds } },
    targetRandom: "random", shadow: options.shadow ?? true,
  };
  const kart = options.noKart ? undefined : {
    itemId: 100, systemKey: "system", engineGrade: 7,
    textureKey: "texture", fixedPlateId: 3, linkCharacterId: 1,
    alwaysLinkCharacter: false, hideChar: false, characterAniType: 0,
  };
  if (options.badMetadata && kart) delete kart.engineGrade;
  const dependencies = {
    b4(karts, itemId, path, hint) {
      calls.push(["resolve kart", karts, itemId, path, hint]); return kart;
    },
    O50(type, name, grade) {
      calls.push(["tachometer selection", type, name, grade]); return "selection";
    },
    E50(forceNew, grade, selection, version) {
      calls.push(["classic?", forceNew, grade, selection, version]);
      return !!options.classic;
    },
    Bt(key) { calls.push(["version", key]); return "p3553"; },
    uv: { load: make("classic tachometer") },
    $50: async (lib, selection) => {
      calls.push(["tachometer config", selection]);
      if (options.failAt === "tachometer config") throw new Error("tachometer config failed");
      return { type: options.tachometerType ?? "Tacho1" };
    },
    fv: class { constructor(config) { calls.push(["Tacho1", config.type]); this.name = "Tacho1"; }
      dispose() { calls.push(["dispose", "Tacho1"]); } },
    Fk: class { constructor(config) { calls.push(["MqTacho", config.type]); this.name = "MqTacho"; }
      dispose() { calls.push(["dispose", "MqTacho"]); } },
    p7: { load: make("NineTacho") },
    Ta: { load: make("V1Tacho") },
    Gr: { load: make("XGenTacho") },
    pv: { load: make("audio") },
    Ca: { load: make("effects") },
    Ea: { load: make("trails") },
    Ze0(...args) { calls.push(["drift setup", ...args.map(value => value?.name ?? value)]); return "drift setup"; },
    iv: { load: make("drift effects") },
    sv: { load: make("motion blur") },
    lv: { load: make("zet air") },
    av: { load: make("shock wave") },
    rv: { load: make("exhaust") },
    nv: { load: make("crash") },
    tv: { load: make("charger") },
    s6: { load: make("lamp flares") },
    J5(model) { calls.push(["model root", model.name]); return root; },
    fr: { load: make("shadow") },
    We: async (_library, paintId) => {
      calls.push(["paint", paintId]); return { primary: 0x123456 };
    },
    Jw: make("decoration"),
    hr: make("accessory"),
    jt0(body, visual, grade) {
      calls.push(["physics", body.name, visual.name, grade]); return "physics";
    },
    el(bounds, x, y) {
      calls.push(["extent", bounds, x, y]); return "extent";
    },
    v90(extent, scale) {
      calls.push(["collision shape", extent, scale]); return "shape";
    },
    u5(object) { calls.push(["dispose object", object.name]); },
  };
  const Original = new Function("deps", `with (deps) { ${originalClass}; return ul; }`)(dependencies);
  const original = new Original(host);
  original.loadVehicleRuntime = async (...args) => {
    calls.push(["runtime", ...args.map(value => value?.name ?? value)]);
    return runtime;
  };
  const owner = { assetHost: host, loadVehicleRuntime: original.loadVehicleRuntime };
  const ops = {
    resolveKartIdentity: dependencies.b4,
    tachometerSelection: dependencies.O50,
    useClassicHud: dependencies.E50,
    resourceVersion: dependencies.Bt,
    loadClassicTachometer: dependencies.uv.load,
    loadTachometerConfig: dependencies.$50,
    makeTacho1: config => new dependencies.fv(config),
    makeMqTacho: config => new dependencies.Fk(config),
    loadNineTacho: dependencies.p7.load,
    loadV1Tacho: dependencies.Ta.load,
    loadXGenTacho: dependencies.Gr.load,
    loadAudio: dependencies.pv.load,
    loadEffects: dependencies.Ca.load,
    loadTrails: dependencies.Ea.load,
    makeDriftSetup: dependencies.Ze0,
    loadDriftEffects: dependencies.iv.load,
    loadMotionBlur: dependencies.sv.load,
    loadZetAir: dependencies.lv.load,
    loadShockWave: dependencies.av.load,
    loadExhaust: dependencies.rv.load,
    loadCrash: dependencies.nv.load,
    loadCharger: dependencies.tv.load,
    // Not in the release: 沙尘/水花 (road-dust-effect.ts). It loads nothing up
    // front, so it adds no call to the release order.
    createRoadDust: (_library, parent, environment, stageBinding) => {
      roadDust.push([parent.name, environment, stageBinding]);
      return { name: "road dust", dispose() { roadDust.push("dispose"); } };
    },
    loadLampFlares: dependencies.s6.load,
    kartModelRoot: dependencies.J5,
    loadShadow: dependencies.fr.load,
    paintColor: dependencies.We,
    loadDecoration: dependencies.Jw,
    loadAccessory: dependencies.hr,
    physicsParams: dependencies.jt0,
    rootExtent: dependencies.el,
    collisionShape: dependencies.v90,
    disposeObject: dependencies.u5,
  };
  return { calls, original, owner, ops, roadDust };
}

function simplify(value) {
  if (typeof value === "function") return "[function]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(simplify);
  if (value instanceof Map) return [...value].map(simplify);
  if (value.name) return value.name;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, simplify(entry)]));
}

async function exercise(kind, options = {}) {
  const f = fixture(options);
  const args = ["kart/model.1s", 100, "hint", {
    name: "body", chargeBoostBySpeed: 2.5, defaultExceedType: 3,
    motorcycleType: 0, effectSetupSelectorByte: 4,
    normalBoosterTime: 100, footprintExtent0: 1, footprintExtent1: 2,
  }, "kartname", "environment", "stage binding", "audio context",
    "coating texture", "decoration option", false,
    !!options.suppressClassic, !!options.forceNew];
  try {
    const result = kind === "original"
      ? await f.original.loadVehicleAsset(...args)
      : await loadVehicleAsset(f.owner, ...args, f.ops);
    if (kind !== "original") {
      assert.equal(result.roadDust.name, "road dust");
      assert.deepEqual(f.roadDust, [["render scene", "environment", "stage binding"]]);
      delete result.roadDust;
    }
    return { result: simplify(result), calls: simplify(f.calls) };
  } catch (error) {
    return { error: error.message, calls: simplify(f.calls) };
  }
}

test("vehicle asset assembly matches release for tachometers and equipment", async () => {
  for (const options of [{}, { classic: true }, { equipped: true },
    { tachometerType: "MqTacho", suppressClassic: true },
    { tachometerType: "Unknown" }]) {
    const actual = await exercise("rewritten", options);
    const expected = await exercise("original", options);
    assert.deepEqual(actual, expected, JSON.stringify(options));
  }
});

test("vehicle asset failure and disposal order match release", async () => {
  for (const options of [{ noLibrary: true }, { noKart: true },
    { badMetadata: true }, { noRenderScene: true },
    { noShadowTransform: true }, { noShadow: true },
    { failAt: "effects" }, { failAt: "drift effects" },
    { failAt: "decoration", equipped: true }]) {
    assert.deepEqual(await exercise("rewritten", options),
      await exercise("original", options), JSON.stringify(options));
  }
});

test("冰河圣诞版 swaps the classic dashboard for its Christmas skin only", async () => {
  const run = async (options, xmas) => {
    const f = fixture(options);
    const loads = [];
    f.ops.loadXmasClassicTachometer = async library => {
      loads.push(library.name ?? "library");
      return { name: "xmas classic tachometer" };
    };
    const result = await loadVehicleAsset(f.owner, "kart/model.1s", 100, "hint", {
      name: "body", chargeBoostBySpeed: 2.5, defaultExceedType: 3,
      motorcycleType: 0, effectSetupSelectorByte: 4,
      normalBoosterTime: 100, footprintExtent0: 1, footprintExtent1: 2,
    }, "kartname", "environment", "stage binding", "audio context",
    "coating texture", "decoration option", false, false, !!options.forceNew, f.ops, xmas);
    return { renderer: simplify(result.tachometerRenderer), loads };
  };
  const xmas = await run({ classic: true, forceNew: true }, true);
  assert.equal(xmas.renderer, "xmas classic tachometer");
  assert.equal(xmas.loads.length, 1);
  // The plain classic dashboard off the Christmas tracks, and no classic HUD at all
  // when the player keeps the new tachometer.
  assert.notEqual((await run({ classic: true, forceNew: true }, false)).renderer, "xmas classic tachometer");
  const modern = await run({}, true);
  assert.notEqual(modern.renderer, "xmas classic tachometer");
  assert.equal(modern.loads.length, 0);
});

test("圣诞节码表 setting brings the Christmas dial to karts it fits even with 经典仪表 off", async () => {
  const run = async ({ fits, classicSetting = false, suppressClassic = false }, xmas) => {
    const f = fixture({});
    const asked = [];
    // The release rule: the classic dial needs the option and a kart it fits.
    f.ops.useClassicHud = forceNew => { asked.push(forceNew); return forceNew && fits; };
    f.ops.loadXmasClassicTachometer = async () => ({ name: "xmas classic tachometer" });
    const result = await loadVehicleAsset(f.owner, "kart/model.1s", 100, "hint", {
      name: "body", chargeBoostBySpeed: 2.5, defaultExceedType: 3,
      motorcycleType: 0, effectSetupSelectorByte: 4,
      normalBoosterTime: 100, footprintExtent0: 1, footprintExtent1: 2,
    }, "kartname", "environment", "stage binding", "audio context",
    "coating texture", "decoration option", false, suppressClassic, classicSetting, f.ops, xmas);
    return { renderer: simplify(result.tachometerRenderer), classicHud: result.classicHud, asked };
  };
  // Ticked on a Christmas track: an old kart gets the Christmas classic HUD.
  assert.deepEqual(await run({ fits: true }, true),
    { renderer: "xmas classic tachometer", classicHud: true, asked: [true] });
  // Unticked (or off the Christmas tracks): the normal HUD, as before.
  const plain = await run({ fits: true }, false);
  assert.equal(plain.classicHud, false);
  assert.deepEqual(plain.asked, [false]);
  // A newer tachometer has no Christmas skin and keeps its own dial.
  const modern = await run({ fits: false }, true);
  assert.equal(modern.classicHud, false);
  assert.notEqual(modern.renderer, "xmas classic tachometer");
  // Other racers' karts never draw a local HUD.
  const remote = await run({ fits: true, suppressClassic: true }, true);
  assert.equal(remote.classicHud, false);
  assert.deepEqual(remote.asked, []);
});
