import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Group, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";

import { DrivingAction } from "../input/driving-input";
import { AwardPodiumScene, LEVEL_UP_EFFECT_PATH, loadAwardPodiumScene,
  type AwardAsset, type AwardPodiumDependencies,
  type AwardSlot } from "./award-podium-scene";

const releaseFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../../recovered/formatted/index.js");

async function releaseAward(dependencies: {
  distance: AwardPodiumDependencies["makeDistanceController"];
  parse?: (bytes: Uint8Array) => unknown;
  scene?: (parsed: unknown, library: unknown, label: string,
    texture: unknown, options: unknown) => Promise<AwardAsset>;
}) {
  const source = await readFile(releaseFile, "utf8");
  const start = source.indexOf("class tw {");
  const end = source.indexOf("\nfunction ", start);
  const rankStart = source.indexOf("function rG(");
  const rankEnd = source.indexOf("\nconst l2", rankStart);
  assert.ok(start >= 0 && end > start && rankStart >= 0 && rankEnd > rankStart);
  return new Function("T2", "H", "v2", "s5", "on", "l2", "we", "z6", "y9",
    "W1", "sn", `${source.slice(rankStart, rankEnd)}
    ${source.slice(start, end)}
    return tw;`)(Group, Vector3, Matrix4, Quaternion,
    { fromParsed: dependencies.distance }, DrivingAction,
    (fov: number, aspect: number) => fov / aspect,
    () => ({ base: 70 }), dependencies.parse,
    dependencies.scene, () => "texture") as {
    new (render: AwardAsset, slots: AwardSlot[], confetti: AwardAsset,
      mode: string): AwardPodiumScene;
    load(library: unknown, options: unknown): Promise<AwardPodiumScene>;
  };
}

function slot(name: string, x = 0): AwardSlot {
  return { name, kind: "node", children: [], position: [x, 0, 0],
    transform: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], scale: [1, 1, 1] };
}

function fixture() {
  const events: unknown[][] = [];
  const asset = (name: string): AwardAsset => ({
    object: new Group(),
    reset: time => events.push([name, "reset", time]),
    update: (time, _camera, width, height) =>
      events.push([name, "update", time, width, height]),
    dispose: () => events.push([name, "dispose"]),
  });
  const distance: AwardPodiumDependencies["makeDistanceController"] = parsed => {
    events.push(["distance", "create", parsed]);
    return { reset: time => events.push(["distance", "reset", time]),
      update: time => { events.push(["distance", "update", time]); return 14; } };
  };
  const deps: AwardPodiumDependencies = { makeDistanceController: distance,
    baseFov: () => 70, horizontalFov: (fov, aspect) => fov / aspect };
  const slots = [slot("first", 1), slot("second", 2), slot("third", 3)];
  const stage = { startPose: { right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: 1 },
    position: { x: 4, y: 5, z: 6 } },
  track: { rayQuery: (_position: unknown, _direction: unknown, _backface: boolean) =>
    ({ point: { x: 10, y: 20, z: 30 } }) } };
  const character = { award: { enter: () => events.push(["award", "enter"]),
    request: (motion: number) => events.push(["award", "request", motion]) },
  scene: { update: (time: number) => events.push(["character", "update", time]) } };
  const player = { playerId: "p1", characters: { ordinary: character },
    vehicle: { imported: { renderScene: { update: () => events.push(["kart", "update"]) } },
      accessories: [{ render: { scene: { update: () => events.push(["accessory", "update"]) } } }],
      decoration: { scene: { update: () => events.push(["decoration", "update"]) } } } };
  const race = { participants: [player] };
  const sent: number[] = [];
  let subscriber: ((event: { playerId: string; motion: number }) => void) | undefined;
  const connection = { playerId: "p1",
    subscribeAwardMotion: (listener: typeof subscriber) => {
      subscriber = listener;
      return () => events.push(["unsubscribe"]);
    },
    sendAwardMotion: async (motion: number) => { sent.push(motion); },
  };
  const results = [{ playerId: "p1", rank: 1, elapsedMs: 1000 },
    { playerId: "p2", rank: 2, elapsedMs: 1100 }];
  const racers = new Map([["p1", { root: { visible: false } }],
    ["p2", { root: { visible: false } }]]);
  const room = { roster: [{ playerId: "p1", team: 1 },
    { playerId: "p2", team: 2 }], winningTeam: 1 };
  const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 1000);
  const visuals = new Map([["p1", { root: { updateMatrixWorld: () =>
    events.push(["visual", "matrix"]) },
  updatePose: (pose: unknown) => events.push(["visual", "pose", pose]) }]]);
  return { events, asset, distance, deps, slots, stage, race, connection,
    sent, subscriber: () => subscriber, results, racers, room, camera, visuals };
}

function sceneSnapshot(scene: AwardPodiumScene, camera: PerspectiveCamera,
  events: unknown[][], sent: number[]) {
  return { active: scene.active, disposed: scene.disposed,
    winners: [...scene.winners].map(([name, chosen]) => [name, chosen.name]),
    rootPosition: scene.root.position.toArray(),
    rootQuaternion: scene.root.quaternion.toArray(),
    effectPosition: scene.effectRoot.position.toArray(),
    effectQuaternion: scene.effectRoot.quaternion.toArray(),
    cameraTarget: scene.cameraTarget.toArray(),
    cameraPosition: camera.position.toArray(),
    cameraQuaternion: camera.quaternion.toArray(),
    cameraFov: camera.fov, cameraNear: camera.near, cameraFar: camera.far,
    events, sent };
}

test("颁奖台站位、动作输入、角色动画、镜头和清理与发行版一致", async () => {
  const oldCase = fixture(), newCase = fixture();
  const Original = await releaseAward({ distance: oldCase.distance });
  const old = new Original(oldCase.asset("stand"), oldCase.slots,
    oldCase.asset("confetti"), "individual");
  const current = new AwardPodiumScene(newCase.asset("stand"), newCase.slots,
    newCase.asset("confetti"), "individual", newCase.deps);
  assert.deepEqual(oldCase.events, newCase.events, "distance definition");
  for (const [scene, data] of [[old, oldCase], [current, newCase]] as const) {
    scene.bind(data.connection, data.race);
    scene.show(1000, data.stage, data.results, data.racers, data.room);
    scene.request("p1", 7);
    data.subscriber()?.({ playerId: "p1", motion: 8 });
    scene.input([{ action: DrivingAction.Forward, down: true },
      { action: DrivingAction.SteerLeft, down: true },
      { action: DrivingAction.SteerRight, down: false }], true);
    scene.update(1016, data.camera, data.stage, data.race, data.visuals);
  }
  assert.deepEqual(sceneSnapshot(current, newCase.camera, newCase.events, newCase.sent),
    sceneSnapshot(old, oldCase.camera, oldCase.events, oldCase.sent));
  assert.deepEqual([...newCase.racers].map(([id, racer]) => [id, racer.root.visible]),
    [...oldCase.racers].map(([id, racer]) => [id, racer.root.visible]));
  old.dispose(); current.dispose();
  assert.deepEqual(sceneSnapshot(current, newCase.camera, newCase.events, newCase.sent),
    sceneSnapshot(old, oldCase.camera, oldCase.events, oldCase.sent));
});

test("颁奖资源选择、颁奖台节点检查和失败清理与发行版一致", async () => {
  for (const failure of ["none", "missing-stand", "missing-slot", "missing-confetti", "scene-error"]) {
    const run = async (release: boolean) => {
      const data = fixture();
      const calls: unknown[][] = [];
      const root = slot("root");
      root.children = [slot("first"), slot("second"), slot("third")];
      if (failure === "missing-slot") root.children.pop();
      const library = { exactCanonicalCandidates: (name: string) => {
        calls.push(["find", name]);
        if (failure === "missing-stand" && name.includes("stand")) return [];
        if (failure === "missing-confetti" && name.includes("effect")) return [];
        return [{ bytes: async () => new Uint8Array([name.includes("stand") ? 1 : 2]) }];
      } };
      const parse = (bytes: Uint8Array) => ({ root: bytes[0] === 1 ? root : slot("effect") });
      const scene = async (_parsed: unknown, _lib: unknown, label: string) => {
        calls.push(["scene", label]);
        if (failure === "scene-error" && label === "MultiplayerConfetti")
          throw new Error("scene failed");
        const asset = data.asset(label);
        return asset;
      };
      const options = { mode: "individual", map: { environment: {}, stageBinding: {} } };
      try {
        const loaded = release
          ? await (await releaseAward({ distance: data.distance, parse, scene })).load(library, options)
          : await loadAwardPodiumScene(library, options,
            { parseModel: parse, loadScene: scene,
              resolveTexture: () => "texture" },
          (stand, slots, confetti, mode) => new AwardPodiumScene(
            stand, slots, confetti, mode, data.deps));
        return { error: undefined, calls, events: data.events,
          slots: loaded.slots.map(item => item.name), mode: loaded.mode };
      } catch (error) {
        return { error: String(error), calls, events: data.events };
      }
    };
    assert.deepEqual(await run(false), await run(true), failure);
  }
});

test("升级车手：领奖者原地、其余站到 levelup 站位，特效每 1500 ms 重播、音效一次", async () => {
  const data = fixture();
  const scene = new AwardPodiumScene(data.asset("stand"), data.slots,
    data.asset("confetti"), "individual", data.deps);
  scene.levelSlots = [slot("levelup01", 0), slot("levelup02", -3)];
  scene.levelSlots[1]!.position = [-3, -3.8, 0];
  const effects: AwardAsset[] = [];
  scene.createLevelUpEffect = async () => {
    const effect = data.asset(`effect${effects.length}`);
    effect.object.rotation.x = -Math.PI / 2; // the client-to-three.js rotation of loadScene
    effects.push(effect);
    return effect;
  };
  let sounds = 0;
  scene.playLevelUpSound = () => { sounds++; };
  const p3 = { ...data.race.participants[0]!, playerId: "p3" };
  const p4 = { ...data.race.participants[0]!, playerId: "p4" };
  const race = { participants: [...data.race.participants, p3, p4] };
  const racers = new Map([...data.racers, ["p3", { root: { visible: false } }],
    ["p4", { root: { visible: false } }]]);
  scene.bind(data.connection, race);
  scene.showLevelUps(["p2"]); // before the stand shows: ignored
  assert.equal(scene.levelUps.size, 0);
  scene.show(1000, data.stage, data.results, racers, data.room);
  assert.deepEqual([...racers].map(([id, racer]) => [id, racer.root.visible]),
    [["p1", true], ["p2", true], ["p3", false], ["p4", false]]);

  data.events.length = 0;
  scene.showLevelUps(["p1", "p3", "p4", "p9"]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([...scene.levelUps].map(([id, levelUp]) => [id, levelUp.slot.name, levelUp.podium]),
    [["p1", "first", true], ["p3", "levelup01", false], ["p4", "levelup02", false]]);
  assert.deepEqual([...racers].map(([id, racer]) => [id, racer.root.visible]),
    [["p1", true], ["p2", true], ["p3", true], ["p4", true]]);
  assert.deepEqual(data.events.filter(event => event[0] === "award"),
    [["award", "enter"], ["award", "enter"]], "both standing racers take the award pose");
  assert.equal(effects.length, 3);
  // The effect sits on its slot inside the stand (converted to three.js axes).
  assert.ok(effects.every(effect => effect.object.parent === scene.root));
  assert.deepEqual(effects[2]!.object.position.toArray(), [-3, 0, 3.8]);
  // Its own axis rotation kept, turned back by the stand's yaw to face the camera.
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.fround(0.9))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
  assert.ok(effects[2]!.object.quaternion.angleTo(facing) < 1e-6);
  const world = scene.root.quaternion.clone().multiply(effects[2]!.object.quaternion);
  const front = new Vector3(0, -1, 0).applyQuaternion(world); // the client front (-y)
  assert.ok(front.distanceTo(new Vector3(0, 0, 1)) < 1e-6, "faces the stand's forward, toward the camera");

  // Repeating a racer changes nothing; the slots are taken.
  scene.showLevelUps(["p3"]);
  assert.equal(effects.length, 3);

  const visuals = new Map([...["p1", "p3", "p4"]].map(id => [id, {
    root: { updateMatrixWorld: () => data.events.push(["visual", id, "matrix"]) },
    updatePose: () => data.events.push(["visual", id, "pose"]) }]));
  const resets = () => data.events.filter(event => event[1] === "reset" &&
    String(event[0]).startsWith("effect"));
  data.events.length = 0;
  scene.update(2000, data.camera, data.stage, race, visuals);
  assert.deepEqual(resets(), [["effect0", "reset", 2000], ["effect1", "reset", 2000],
    ["effect2", "reset", 2000]]);
  assert.equal(sounds, 1);
  assert.deepEqual(data.events.filter(event => event[0] === "visual" && event[2] === "pose")
    .map(event => event[1]), ["p1", "p3", "p4"]);
  assert.equal(data.events.filter(event => event[0] === "kart").length, 3);
  data.events.length = 0;
  scene.update(3499, data.camera, data.stage, race, visuals);
  assert.deepEqual(resets(), []);
  scene.update(3600, data.camera, data.stage, race, visuals);
  assert.deepEqual(resets(), [["effect0", "reset", 3500], ["effect1", "reset", 3500],
    ["effect2", "reset", 3500]]);
  assert.equal(sounds, 1, "levelup.flac plays once");

  // Standing racers may cheer like the winners.
  data.events.length = 0;
  scene.request("p3", 12);
  scene.request("p2", 12);
  assert.deepEqual(data.events, [["award", "request", 12]]);

  data.events.length = 0;
  scene.dispose();
  assert.ok(effects.every(effect => effect.object.parent === null));
  assert.deepEqual(data.events.filter(event => String(event[0]).startsWith("effect")),
    [["effect0", "dispose"], ["effect1", "dispose"], ["effect2", "dispose"]]);
  assert.equal(scene.levelUps.size, 0);
});

test("升级特效在颁奖台关闭后才载入完成时被释放", async () => {
  const data = fixture();
  const scene = new AwardPodiumScene(data.asset("stand"), data.slots,
    data.asset("confetti"), "individual", data.deps);
  let resolve!: (asset: AwardAsset) => void;
  scene.createLevelUpEffect = () => new Promise(done => { resolve = done; });
  scene.bind(data.connection, data.race);
  scene.show(1000, data.stage, data.results, data.racers, data.room);
  scene.showLevelUps(["p1"]);
  scene.dispose();
  const late = data.asset("late");
  resolve(late);
  await new Promise(done => setTimeout(done, 0));
  assert.equal(late.object.parent, null);
  assert.deepEqual(data.events.filter(event => event[0] === "late"), [["late", "dispose"]]);
});

test("颁奖台载入记下 levelup 站位，升级特效按需读取", async () => {
  const data = fixture();
  const calls: unknown[][] = [];
  const root = slot("root");
  root.children = [slot("third"), slot("levelup03"), slot("levelup01"), slot("first"),
    slot("second"), slot("levelup02")];
  const library = { exactCanonicalCandidates: (name: string) => {
    calls.push(["find", name]);
    return [{ bytes: async () => new Uint8Array([name.includes("stand") ? 1 : 2]) }];
  } };
  const parse = (bytes: Uint8Array) => ({ root: bytes[0] === 1 ? root : slot("effect") });
  const scene = await loadAwardPodiumScene(library,
    { mode: "individual", map: { environment: {}, stageBinding: {} } },
    { parseModel: parse, loadScene: async (_parsed, _library, label) => {
      calls.push(["scene", label]);
      return data.asset(label);
    }, resolveTexture: () => "texture" },
    (stand, slots, confetti, mode) => new AwardPodiumScene(stand, slots, confetti, mode, data.deps));
  assert.deepEqual(scene.levelSlots.map(item => item.name), ["levelup01", "levelup02", "levelup03"]);
  assert.ok(!calls.some(call => call[1] === LEVEL_UP_EFFECT_PATH));
  await scene.createLevelUpEffect!();
  assert.deepEqual(calls.slice(-2), [["find", LEVEL_UP_EFFECT_PATH], ["scene", "MultiplayerLevelUp"]]);
});
