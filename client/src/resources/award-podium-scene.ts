import { Group, Matrix4, Quaternion, Vector3, type PerspectiveCamera } from "three";
import { DrivingAction, type DrivingInputEvent } from "../input/driving-input";

interface Vec3 { x: number; y: number; z: number }
export interface AwardSlot {
  name: string;
  kind?: string;
  children: AwardSlot[];
  position: [number, number, number];
  transform: [[number, number, number], [number, number, number], [number, number, number]];
  scale: [number, number, number];
}
export interface AwardAsset {
  object: Group;
  reset(time: number): void;
  update(time: number, camera: PerspectiveCamera, width: number, height: number): void;
  dispose(): void;
}
export interface AwardDistanceController {
  reset(time: number): void;
  update(time: number): number;
}
export interface AwardPodiumDependencies {
  makeDistanceController(parsed: {
    kind: "float-controller";
    base: { cycleMode: number; frequency: number; phaseWord: number;
      startTimeWord: number; stopTimeWord: number };
    keys: { type: number; records: Uint8Array[] };
  }): AwardDistanceController;
  baseFov(): number;
  horizontalFov(verticalFov: number, aspect: number): number;
}
export interface AwardPositionedParticipant {
  root: { visible: boolean };
}
export interface AwardCharacter {
  award?: { enter(): void; request(motion: number): void };
  scene: { update(time: number, camera: PerspectiveCamera,
    width: number, height: number, context?: unknown): void };
}
export interface AwardParticipant {
  playerId: string;
  characters: { linked?: AwardCharacter; ordinary?: AwardCharacter };
  vehicle: {
    imported: { renderScene?: { update(camera: PerspectiveCamera,
      width: number, height: number): void } };
    accessories: Array<{ render: { scene: { update(time: number,
      camera: PerspectiveCamera, width: number, height: number): void } } }>;
    decoration?: { scene: { update(time: number, camera: PerspectiveCamera,
      width: number, height: number): void } };
  };
}
export interface AwardConnection {
  playerId?: string;
  subscribeAwardMotion?(listener: (event: { playerId: string; motion: number }) => void): () => void;
  sendAwardMotion?(motion: number): Promise<unknown>;
}
export interface AwardStage {
  startPose: { right: Vec3; up: Vec3; forward: Vec3; position: Vec3 };
  track: { rayQuery(position: Vec3, direction: Vec3,
    backface: boolean): { point: Vec3 } | undefined };
}
export interface AwardRaceResult { playerId: string; rank: number; elapsedMs: number | null }
export interface AwardRoom {
  roster: Array<{ playerId: string; team?: number }>;
  winningTeam?: number;
}
export interface AwardVisual {
  root: { updateMatrixWorld(force: boolean): void };
  updatePose(pose: { x: number; y: number; z: number;
    right: Vector3; up: Vector3; forward: Vector3;
    visualScale: Vec3 }): void;
}

function winnerIds(mode: string, roster: AwardRoom["roster"],
  results: AwardRaceResult[], winningTeam: number | undefined): string[] {
  return results.filter(result => mode === "team"
    ? roster.find(player => player.playerId === result.playerId)?.team === winningTeam
    : result.rank <= 3 && result.elapsedMs !== null)
    .map(result => result.playerId);
}

function distanceKeys(): Uint8Array[] {
  return [[0, 21], [500, 14], [2000, 11]].map(([time, distance]) => {
    const record = new Uint8Array(8);
    const view = new DataView(record.buffer);
    view.setUint32(0, time!, true);
    view.setFloat32(4, distance!, true);
    return record;
  });
}

/** A stand node's rotation in the stand's (three.js) frame. */
function slotRotation(slot: AwardSlot): Quaternion {
  const [right, forward, up] = slot.transform;
  const matrix = new Matrix4().set(
    right[0], right[1], right[2], 0,
    forward[0], forward[1], forward[2], 0,
    up[0], up[1], up[2], 0,
    0, 0, 0, 1);
  const axis = new Matrix4().makeRotationX(-Math.PI / 2);
  matrix.premultiply(axis).multiply(axis.clone().invert());
  return new Quaternion().setFromRotationMatrix(matrix);
}

/**
 * 升级: the original award stand puts racers whose race exp reached a new
 * level, and who are not on the podium, on its `levelup` nodes in front of
 * the stand (indi.1s levelup01-05, team.1s levelup00-03), and
 * award/effect/레벨업이펙트.1s is the level-up effect: a light column and a
 * swirl around the kart and a rising "升级" sign. Its controllers clamp
 * after 1500 ms, so it is restarted every 1500 ms while the stand shows.
 */
export const LEVEL_UP_EFFECT_PATH = "stuff/award/effect/레벨업이펙트.1s";
export const LEVEL_UP_EFFECT_MS = 1500;
const LEVEL_UP_SLOT = /^levelup\d+$/i;
/** The release turns the stand by this yaw away from the award camera. */
const STAND_YAW = Math.fround(-0.9);

/** A racer the stand shows with the level-up effect. */
export interface AwardLevelUp {
  /** Its podium slot, or the level-up slot it stands on. */
  slot: AwardSlot;
  podium: boolean;
  effect?: AwardAsset;
  /** When the effect's current cycle began; unset until its first frame. */
  cycleStart?: number;
}

/** The award stand, confetti, winner poses, camera and victory controls. */
export class AwardPodiumScene {
  readonly root = new Group();
  readonly effectRoot = new Group();
  readonly cameraTarget = new Vector3();
  readonly winners = new Map<string, AwardSlot>();
  readonly distance: AwardDistanceController;
  active = false;
  disposed = false;
  off?: () => void;
  connection?: AwardConnection;
  participants?: AwardParticipant[];
  /** The stand's `levelup` nodes in name order (loadAwardPodiumScene). */
  levelSlots: AwardSlot[] = [];
  /** Loads one instance of the level-up effect (loadAwardPodiumScene). */
  createLevelUpEffect?: () => Promise<AwardAsset>;
  /** Plays levelup.flac (the race loader); once per stand. */
  playLevelUpSound?: () => void;
  readonly levelUps = new Map<string, AwardLevelUp>();
  private racers?: Map<string, AwardPositionedParticipant>;
  private levelUpSoundPlayed = false;

  constructor(readonly render: AwardAsset, readonly slots: AwardSlot[],
    readonly confetti: AwardAsset, readonly mode: string,
    private readonly deps: AwardPodiumDependencies) {
    this.effectRoot.add(confetti.object);
    this.root.add(render.object);
    this.distance = deps.makeDistanceController({
      kind: "float-controller",
      base: { cycleMode: 2, frequency: 1, phaseWord: 0,
        startTimeWord: 0, stopTimeWord: 2000 },
      keys: { type: 1, records: distanceKeys() },
    });
  }

  show(time: number, stage: AwardStage, results: AwardRaceResult[],
    racers: Map<string, AwardPositionedParticipant>, room: AwardRoom): void {
    if (this.active) return;
    this.active = true;
    const pose = stage.startPose;
    this.root.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(
      new Vector3(pose.right.x, pose.right.y, pose.right.z),
      new Vector3(pose.up.x, pose.up.y, pose.up.z),
      new Vector3(pose.forward.x, pose.forward.y, pose.forward.z)));
    const origin = { x: pose.position.x, y: pose.position.y + 10, z: pose.position.z };
    const ground = stage.track.rayQuery(origin, { x: 0, y: -60, z: 0 }, false)?.point;
    if (!ground) throw new Error("奖台基准未命中地面。");
    this.cameraTarget.set(ground.x, ground.y, ground.z)
      .addScaledVector(new Vector3(pose.forward.x, pose.forward.y, pose.forward.z), 5)
      .addScaledVector(new Vector3(pose.up.x, pose.up.y, pose.up.z), Math.fround(1.7));
    this.cameraTarget.y += 1;
    this.effectRoot.position.set(ground.x, ground.y, ground.z);
    this.effectRoot.quaternion.copy(this.root.quaternion);
    this.confetti.reset(Math.trunc(time) >>> 0);
    this.render.reset(Math.trunc(time) >>> 0);
    this.root.position.set(ground.x, ground.y, ground.z)
      .addScaledVector(new Vector3(pose.right.x, pose.right.y, pose.right.z), 3);
    this.root.quaternion.multiply(new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0), STAND_YAW));
    this.root.updateMatrixWorld(true);
    this.distance.reset(Math.trunc(time) >>> 0);

    const ranked = winnerIds(this.mode, room.roster, results, room.winningTeam);
    this.racers = racers;
    for (const [playerId, racer] of racers) {
      const slot = this.slots[ranked.indexOf(playerId)];
      racer.root.visible = !!slot;
      if (!slot) continue;
      this.winners.set(playerId, slot);
      const characters = this.participants?.find(player => player.playerId === playerId)?.characters;
      (characters?.linked ?? characters?.ordinary)?.award?.enter();
    }
  }

  /**
   * Shows the level-up effect around these racers (in result order): a
   * winner keeps its podium slot, any other racer takes the next free
   * level-up slot, with its kart, in the award pose. Racers beyond the
   * level-up slots are not shown, like on the original stand.
   */
  showLevelUps(playerIds: readonly string[]): void {
    if (!this.active || this.disposed) return;
    const taken = new Set([...this.levelUps.values()].map(levelUp => levelUp.slot));
    const free = this.levelSlots.filter(slot => !taken.has(slot));
    for (const playerId of playerIds) {
      if (this.levelUps.has(playerId)) continue;
      const podium = this.winners.get(playerId);
      const racer = this.racers?.get(playerId);
      const slot = podium ?? (racer ? free.shift() : undefined);
      if (!slot) continue;
      const levelUp: AwardLevelUp = { slot, podium: !!podium };
      this.levelUps.set(playerId, levelUp);
      if (!podium) {
        racer!.root.visible = true;
        this.character(playerId)?.award?.enter();
      }
      this.createLevelUpEffect?.().then(effect => {
        if (this.disposed || this.levelUps.get(playerId) !== levelUp) {
          effect.dispose();
          return;
        }
        // On the slot, keeping the effect's own client-to-three.js rotation,
        // and turned back by the stand's yaw: the effect is round but its
        // "升级" sign is a flat panel, which then faces the award camera.
        effect.object.position.set(slot.position[0], slot.position[2], -slot.position[1]);
        effect.object.quaternion.premultiply(new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0), -STAND_YAW));
        this.root.add(effect.object);
        levelUp.effect = effect;
      }).catch(error => console.warn("升级特效未能载入：", error));
    }
  }

  /** On the podium or on a level-up slot. */
  private shown(playerId: string): AwardSlot | undefined {
    return this.winners.get(playerId) ?? this.levelUps.get(playerId)?.slot;
  }

  private character(playerId: string): AwardCharacter | undefined {
    const characters = this.participants?.find(player => player.playerId === playerId)?.characters;
    return characters?.linked ?? characters?.ordinary;
  }

  bind(connection: AwardConnection, race: { participants: AwardParticipant[] }): void {
    this.connection = connection;
    this.participants = race.participants;
    this.off = connection.subscribeAwardMotion?.(event =>
      this.request(event.playerId, event.motion));
  }

  request(playerId: string, motion: number): void {
    if (!this.active || this.disposed || !this.shown(playerId)) return;
    this.character(playerId)?.award?.request(motion);
  }

  input(events: DrivingInputEvent[], releaseSteering = false): void {
    const playerId = this.connection?.playerId;
    if (!playerId || !this.active || this.disposed || !this.shown(playerId)) return;
    const motions = releaseSteering ? [3] : [];
    const linked = !!this.participants?.find(player => player.playerId === playerId)?.characters.linked;
    for (const event of events) {
      if (event.action === DrivingAction.Forward && event.down) motions.push(12);
      if (event.action === DrivingAction.SteerLeft && (!linked || !event.down))
        motions.push(event.down ? 4 : 3);
      if (event.action === DrivingAction.SteerRight && (!linked || !event.down))
        motions.push(event.down ? 5 : 3);
    }
    for (const motion of motions) {
      this.request(playerId, motion);
      this.connection?.sendAwardMotion?.(motion).catch(() => {});
    }
  }

  update(time: number, camera: PerspectiveCamera, stage: AwardStage,
    race: { participants: AwardParticipant[] }, visuals: Map<string, AwardVisual>): void {
    const pose = stage.startPose;
    const standing = [...this.levelUps].filter(([, levelUp]) => !levelUp.podium)
      .map(([playerId, levelUp]) => [playerId, levelUp.slot] as const);
    for (const [playerId, slot] of [...this.winners, ...standing]) {
      const visual = visuals.get(playerId);
      if (!visual) continue;
      const position = this.root.localToWorld(new Vector3(
        slot.position[0], slot.position[2], -slot.position[1]));
      const rotation = this.root.quaternion.clone().multiply(slotRotation(slot));
      visual.updatePose({
        x: position.x, y: position.y, z: position.z,
        right: new Vector3(1, 0, 0).applyQuaternion(rotation),
        up: new Vector3(0, 1, 0).applyQuaternion(rotation),
        forward: new Vector3(0, 0, 1).applyQuaternion(rotation),
        visualScale: { x: slot.scale[0], y: slot.scale[2], z: slot.scale[1] },
      });
      visual.root.updateMatrixWorld(true);
    }
    const distance = this.distance.update(Math.trunc(time) >>> 0);
    camera.matrixAutoUpdate = true;
    camera.position.copy(this.cameraTarget).addScaledVector(
      new Vector3(pose.forward.x, pose.forward.y, pose.forward.z), distance);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.lookAt(this.cameraTarget);
    camera.fov = this.deps.horizontalFov(Math.fround(this.deps.baseFov() +
      Math.fround(-17.046377182006836)), camera.aspect);
    camera.near = 1.5;
    camera.far = 500;
    camera.updateProjectionMatrix();
    this.render.update(time, camera, 1600, 900);
    this.confetti.update(time, camera, 1600, 900);
    this.updateLevelUps(time, camera);
    for (const player of race.participants) {
      if (!this.shown(player.playerId)) continue;
      player.vehicle.imported.renderScene?.update(camera, 1600, 900);
      (player.characters.linked ?? player.characters.ordinary)?.scene.update(
        time, camera, 1600, 900, undefined);
      for (const accessory of player.vehicle.accessories)
        accessory.render.scene.update(time, camera, 1600, 900);
      player.vehicle.decoration?.scene.update(time, camera, 1600, 900);
    }
  }

  /** Restarts each loaded effect every LEVEL_UP_EFFECT_MS; levelup.flac with the first. */
  private updateLevelUps(time: number, camera: PerspectiveCamera): void {
    for (const levelUp of this.levelUps.values()) {
      const effect = levelUp.effect;
      if (!effect) continue;
      const now = Math.trunc(time);
      if (levelUp.cycleStart === undefined || now < levelUp.cycleStart ||
          now - levelUp.cycleStart >= LEVEL_UP_EFFECT_MS) {
        levelUp.cycleStart = levelUp.cycleStart === undefined || now < levelUp.cycleStart ? now
          : levelUp.cycleStart + Math.floor((now - levelUp.cycleStart) / LEVEL_UP_EFFECT_MS) * LEVEL_UP_EFFECT_MS;
        effect.reset(levelUp.cycleStart >>> 0);
        if (!this.levelUpSoundPlayed) {
          this.levelUpSoundPlayed = true;
          this.playLevelUpSound?.();
        }
      }
      effect.update(time, camera, 1600, 900);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.off?.();
    for (const levelUp of this.levelUps.values()) {
      levelUp.effect?.object.removeFromParent();
      levelUp.effect?.dispose();
    }
    this.levelUps.clear();
    this.racers = undefined;
    this.winners.clear();
    this.participants = undefined;
    this.connection = undefined;
    this.root.removeFromParent();
    this.effectRoot.removeFromParent();
    this.confetti.dispose();
    this.render.dispose();
  }
}

export interface AwardSceneLibrary {
  exactCanonicalCandidates(path: string): Array<{ bytes(): Promise<Uint8Array> }>;
}
export interface AwardSceneLoadOptions {
  mode?: string;
  map: { environment: unknown; stageBinding: unknown };
}
export interface AwardSceneLoadDependencies {
  parseModel(bytes: Uint8Array): { root: AwardSlot };
  loadScene(parsed: { root: AwardSlot }, library: AwardSceneLibrary,
    label: string, texture: (resource: unknown) => unknown,
    options: { environment: unknown; stageBinding: unknown;
      advanceEnvironment: boolean }): Promise<AwardAsset>;
  resolveTexture(library: AwardSceneLibrary, path: string, resource: unknown): unknown;
}

/** Loads the exact stand and confetti resources with release cleanup order. */
export async function loadAwardPodiumScene<T extends AwardPodiumScene>(
  library: AwardSceneLibrary, options: AwardSceneLoadOptions,
  dependencies: AwardSceneLoadDependencies,
  create: (stand: AwardAsset, slots: AwardSlot[], confetti: AwardAsset,
    mode: string) => T): Promise<T> {
  const mode = options.mode ?? "individual";
  const standPath = mode === "team"
    ? "stuff/award/stand/team.1s" : "stuff/award/stand/indi.1s";
  const standFiles = library.exactCanonicalCandidates(standPath);
  if (standFiles.length !== 1) throw new Error("颁奖台资源不唯一。");
  const standModel = dependencies.parseModel(await standFiles[0]!.bytes());
  if (standModel.root.kind !== "node") throw new Error("奖台不是 Relement。");
  const nodes: AwardSlot[] = [];
  const visit = (node: AwardSlot): void => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(standModel.root);
  const slotNames = mode === "team"
    ? ["victory00", "victory01", "victory02", "victory03"]
    : ["first", "second", "third"];
  const slots = slotNames.map(name => {
    const node = nodes.find(candidate => candidate.name === name);
    if (!node) throw new Error(`奖台缺少 ${name}`);
    return node;
  });
  const sceneOptions = { environment: options.map.environment,
    stageBinding: options.map.stageBinding, advanceEnvironment: false };
  const stand = await dependencies.loadScene(standModel, library,
    "MultiplayerAward", resource => dependencies.resolveTexture(
      library, standPath, resource), sceneOptions);
  let confetti: AwardAsset | undefined;
  try {
    const confettiPath = "stuff/award/effect/ob_award_efect_a.1s";
    const confettiFiles = library.exactCanonicalCandidates(confettiPath);
    if (confettiFiles.length !== 1) throw new Error("颁奖彩纸资源不唯一。");
    confetti = await dependencies.loadScene(dependencies.parseModel(
      await confettiFiles[0]!.bytes()), library, "MultiplayerConfetti",
    resource => dependencies.resolveTexture(library, confettiPath, resource),
    sceneOptions);
    const scene = create(stand, slots, confetti, mode);
    scene.levelSlots = nodes.filter(node => LEVEL_UP_SLOT.test(node.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Read when a racer levels up, so the stand loads as the release did.
    scene.createLevelUpEffect = async () => {
      const files = library.exactCanonicalCandidates(LEVEL_UP_EFFECT_PATH);
      if (files.length !== 1) throw new Error("升级特效资源不唯一。");
      return dependencies.loadScene(dependencies.parseModel(await files[0]!.bytes()),
        library, "MultiplayerLevelUp", resource => dependencies.resolveTexture(
          library, LEVEL_UP_EFFECT_PATH, resource), sceneOptions);
    };
    return scene;
  } catch (error) {
    confetti?.dispose();
    stand.dispose();
    throw error;
  }
}
