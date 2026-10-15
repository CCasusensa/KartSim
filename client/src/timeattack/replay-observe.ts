/**
 * OB 观看 at race time (TIMEATTACK.md 4), after the release replay stage
 * (stage_/replay: mq_window@zz.bml, screenui.bml, stage_stringBag.bml): a
 * replay is a race whose only participants are the recorded ghosts. The
 * session's `observe` state carries the playback clock (play / pause / 0.5× /
 * 0.25× / seek), the watched rider (选择车手 by rank, 锁定车手), the camera
 * and its arrow-key adjustments, 比赛资料 and 帮助; stage-update, the camera
 * routing, the race HUD and the action dispatch read it to hide the local
 * kart, drive the ghosts off the clock and point the camera at the watched one.
 */
import { Matrix4, Vector3 } from "three";

/** The release replay cameras (stage_replay mq_window@zz.bml helpMessage: A Q S D E F R V G T H Y). */
export type ObserveCameraMode = "A" | "Q" | "S" | "D" | "E" | "F" | "R" | "V" | "G" | "T" | "H" | "Y";

/**
 * Each camera's key and its string-bag name (stage_stringBag: 3rdCam …
 * rightSideCam, cn texts as fallback). The console pad has buttons for
 * A S Q F D V only; the others are keys.
 */
export const OBSERVE_CAMERAS: ReadonlyArray<{ mode: ObserveCameraMode; key: string; sb: string; name: string }> = [
  { mode: "A", key: "KeyA", sb: "3rdCam", name: "第3人称视角" },
  { mode: "Q", key: "KeyQ", sb: "firstPersonCam", name: "第1人称视角" },
  { mode: "S", key: "KeyS", sb: "topCam", name: "俯视视角" },
  { mode: "D", key: "KeyD", sb: "frontCam", name: "正面视角" },
  { mode: "E", key: "KeyE", sb: "frontRotCam", name: "正面旋转视角" },
  { mode: "F", key: "KeyF", sb: "leftViewCam", name: "左侧注视视角" },
  { mode: "R", key: "KeyR", sb: "rightViewCam", name: "右侧注视视角" },
  { mode: "V", key: "KeyV", sb: "lowViewCam", name: "低角度注视视角" },
  { mode: "G", key: "KeyG", sb: "lowFixCam", name: "低角度固定视角" },
  { mode: "T", key: "KeyT", sb: "highFixCam", name: "高角度固定视角" },
  { mode: "H", key: "KeyH", sb: "leftSideCam", name: "左侧面视角" },
  { mode: "Y", key: "KeyY", sb: "rightSideCam", name: "右侧面视角" },
];

/** The playback clock: ghost time as a function of the race's own ghost time. */
export class ReplayClock {
  rate = 1;
  paused = false;
  private anchorNatural?: number;
  private anchorTime = 0;
  private last = 0;

  constructor(readonly durationMs: number) {}

  /** The ghost time to sample at, given the race's natural ghost time. */
  timeAt(naturalMs: number): number {
    if (this.anchorNatural === undefined) {
      this.anchorNatural = naturalMs;
      this.anchorTime = Math.max(0, Math.min(this.durationMs, naturalMs));
    }
    const time = this.paused ? this.anchorTime
      : this.anchorTime + (naturalMs - this.anchorNatural) * this.rate;
    return Math.max(0, Math.min(this.durationMs, time));
  }

  get current(): number { return this.last; }

  /** Called once a frame by stage-update with the natural time; stops at the end of the recording. */
  advance(naturalMs: number): number {
    this.last = this.timeAt(naturalMs);
    if (!this.paused && this.last >= this.durationMs) this.pause(naturalMs);
    return this.last;
  }

  private reanchor(naturalMs: number, time: number): void {
    this.anchorNatural = naturalMs;
    this.anchorTime = Math.max(0, Math.min(this.durationMs, time));
    this.last = this.anchorTime;
  }

  /** Play at a rate; at the end of the recording it starts over. */
  play(naturalMs: number, rate = 1): void {
    this.reanchor(naturalMs, this.ended ? 0 : this.timeAt(naturalMs));
    this.paused = false;
    this.rate = rate;
  }

  pause(naturalMs: number): void {
    this.reanchor(naturalMs, this.timeAt(naturalMs));
    this.paused = true;
  }

  seek(naturalMs: number, time: number): void {
    this.reanchor(naturalMs, time);
  }

  get ended(): boolean { return this.last >= this.durationMs; }
}

interface Vec3 { x: number; y: number; z: number }

/** A world pose (the race's decoded ghost pose: position and body basis). */
export interface ObservePose { position: Vec3; right: Vec3; forward: Vec3; up: Vec3 }

/** A recorded rider: name, kart and its .ksv stamps (time in 0.1 s, wire x/y/z). */
export interface ObserveRider {
  name: string;
  kartName: string;
  record?: unknown;
}

export interface ObserveState {
  riders: ObserveRider[];
  recordMs: number;
  clock: ReplayClock;
  camera: ObserveCameraMode;
  /** 比赛资料 开/关 (I): the screen UI, the minimap and the speed. */
  hudVisible: boolean;
  /** 帮助 开/关 (F1). */
  helpVisible: boolean;
  /** 锁定车手 (SPC): follow the chosen rider; off follows whoever holds the chosen rank. */
  rankLock: boolean;
  /** The rank followed while rankLock is off (1-based). */
  followRank: number;
  /** The ghost index watched now. */
  watched: number;
  /** Ghost indices by rank, leader first (stage-update). */
  ranking: number[];
  /** Each ghost's rank color (the session's rankColors after the local slot; stage-update). */
  colors: unknown[];
  /** Arrow-key adjustments of the current camera (zoom, turn, lift); reset on a camera change. */
  view: { zoom: number; turn: number; lift: number };
  /** The race's natural ghost time of the latest frame (stage-update). */
  naturalMs: number;
  /** The watched ghost's pose and speed of the latest frame (stage-update). */
  pose?: ObservePose;
  speedKmh: number;
  /** A fixed camera's place (G / T) until the kart has passed it. */
  fixed?: { mode: ObserveCameraMode; rider: number; eye: Vec3; side: number };
  /** The watched rider's previous position and its velocity over replay time (stage-update). */
  previous?: { x: number; y: number; z: number; atMs: number; rider: number };
  velocity?: Vec3;
  /** Set by the race builder: leaves the replay (退出). */
  exit?(): void;
  /** The console over the race, owned by replay-session. */
  console?: { update(): void; dispose(): void };
}

export function createObserveState(riders: ObserveRider[], recordMs: number, durationMs: number): ObserveState {
  return { riders, recordMs, clock: new ReplayClock(durationMs), camera: "A", hudVisible: true, helpVisible: false,
    rankLock: false, followRank: 1, watched: 0, ranking: riders.map((_, index) => index), colors: [],
    view: { zoom: 1, turn: 0, lift: 0 }, naturalMs: 0, speedKmh: 0 };
}

/** The observe state of a race session: carried by its selection's story request. */
export function observeOf(session: unknown): ObserveState | undefined {
  const raw = session as { observe?: unknown; selection?: { story?: { observe?: unknown } } } | undefined;
  const observe = raw?.observe ?? raw?.selection?.story?.observe;
  return observe && typeof observe === "object" ? observe as ObserveState : undefined;
}

/** Switch camera: its adjustments and a fixed camera's place start over. */
export function setObserveCamera(observe: ObserveState, mode: ObserveCameraMode): void {
  observe.camera = mode;
  observe.view = { zoom: 1, turn: 0, lift: 0 };
  observe.fixed = undefined;
  observe.previous = undefined;
}

/** 1–8: watch the rider holding that rank (锁定车手 keeps that very rider afterwards). */
export function selectObserveRank(observe: ObserveState, rank: number): void {
  const rider = observe.ranking[rank - 1];
  if (rider === undefined) return;
  observe.followRank = rank;
  if (observe.watched !== rider) { observe.fixed = undefined; observe.previous = undefined; }
  observe.watched = rider;
}

/** -/+: the previous or next rank. */
export function stepObserveRank(observe: ObserveState, step: number): void {
  const count = observe.ranking.length;
  if (count === 0) return;
  const current = Math.max(1, observe.ranking.indexOf(observe.watched) + 1);
  selectObserveRank(observe, ((current - 1 + step) % count + count) % count + 1);
}

/** The rank of the rider watched now (1-based). */
export function watchedRank(observe: ObserveState): number {
  return observe.ranking.indexOf(observe.watched) + 1 || 1;
}

/** stage-update, once a frame: the new ranking and, while not locked, who holds the followed rank. */
export function updateObserveRanking(observe: ObserveState, ranking: number[]): void {
  observe.ranking = ranking;
  if (observe.rankLock) return;
  const rider = ranking[observe.followRank - 1] ?? ranking[0];
  if (rider !== undefined && rider !== observe.watched) {
    observe.watched = rider;
    observe.fixed = undefined;
    observe.previous = undefined;
  }
}

/**
 * Once a frame from the console: the arrow keys held for `seconds` (帮助: A D
 * E zoom with ↑↓, S zooms and turns, H Y raise with ↑↓ and zoom with ←→; ↑
 * brings the camera closer) and E's own turn around the kart.
 */
export function adjustObserveView(observe: ObserveState, keys: { up: boolean; down: boolean; left: boolean;
  right: boolean }, seconds: number): void {
  const vertical = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  const horizontal = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const view = observe.view;
  const zoom = (amount: number) => { view.zoom = Math.max(0.4, Math.min(3, view.zoom * Math.exp(amount * seconds))); };
  switch (observe.camera) {
    case "A": case "D": zoom(vertical * 0.9); break;
    case "E": zoom(vertical * 0.9); view.turn += 0.6 * seconds; break;
    case "S": zoom(vertical * 0.9); view.turn += horizontal * 1.6 * seconds; break;
    case "H": case "Y":
      view.lift = Math.max(-1, Math.min(12, view.lift - vertical * 3 * seconds));
      zoom(horizontal * 0.9);
      break;
  }
}

const scratch = { eye: new Vector3(), target: new Vector3(), up: new Vector3(), matrix: new Matrix4() };

type ObserveCamera = { matrixAutoUpdate: boolean; matrixWorld: Matrix4; matrixWorldInverse: Matrix4; matrix: Matrix4;
  position: Vector3; up: Vector3; fov: number; near: number; far: number; updateProjectionMatrix(): void;
  matrixWorldNeedsUpdate: boolean };

/** Point a three.js camera from eye at target with the given up. */
function lookAt(camera: ObserveCamera, eye: Vec3, target: Vec3, up: Vec3, fov: number): void {
  scratch.eye.set(eye.x, eye.y, eye.z);
  scratch.target.set(target.x, target.y, target.z);
  scratch.up.set(up.x, up.y, up.z);
  scratch.matrix.lookAt(scratch.eye, scratch.target, scratch.up);
  scratch.matrix.setPosition(scratch.eye);
  place(camera, scratch.matrix);
  camera.fov = fov;
  camera.near = 0.5;
  camera.far = 2000;
  camera.updateProjectionMatrix();
}

function place(camera: ObserveCamera, matrix: Matrix4): void {
  camera.matrixAutoUpdate = false;
  camera.matrix.copy(matrix);
  camera.matrixWorld.copy(matrix);
  camera.matrixWorldInverse.copy(matrix).invert();
  camera.position.setFromMatrixPosition(matrix);
  camera.matrixWorldNeedsUpdate = false;
}

/** Move a placed camera along its own view axis, keeping its aim (the chase camera's zoom). */
function dolly(camera: ObserveCamera, target: Vec3, zoom: number): void {
  if (zoom === 1) return;
  scratch.matrix.copy(camera.matrixWorld);
  scratch.eye.setFromMatrixPosition(scratch.matrix);
  const distance = scratch.eye.distanceTo(scratch.target.set(target.x, target.y, target.z));
  scratch.up.setFromMatrixColumn(scratch.matrix, 2).normalize().multiplyScalar(distance * (zoom - 1));
  scratch.matrix.setPosition(scratch.eye.add(scratch.up));
  place(camera, scratch.matrix);
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const WORLD_UP = { x: 0, y: 1, z: 0 };

/**
 * Where the rider's recording moves between two ghost times, in world metres.
 * Stamps are 0.1 s apart in 0.1 m integers (wire x, y, z → world x, z, -y;
 * the height carries the .ksv's own offset, so only differences are used).
 */
export function recordedMove(record: unknown, fromMs: number, toMs: number): Vec3 | undefined {
  const stamps = (record as { stamps?: Array<{ time: number; x: number; y: number; z: number }> } | undefined)?.stamps;
  if (!stamps?.length) return undefined;
  const at = (timeMs: number) => {
    let low = 0, high = stamps.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (stamps[middle]!.time * 100 < timeMs) low = middle + 1; else high = middle;
    }
    return stamps[low]!;
  };
  const from = at(fromMs), to = at(toMs);
  return { x: (to.x - from.x) / 10, y: (to.z - from.z) / 10, z: -(to.y - from.y) / 10 };
}

/**
 * G / T: a camera fixed beside the road ahead (low on the ground, or high
 * above it) that turns to follow the kart and moves on once the kart has
 * gone past it.
 */
function fixedEye(observe: ObserveState, p: Vec3, f: Vec3, r: Vec3): Vec3 {
  const high = observe.camera === "T";
  const fixed = observe.fixed;
  if (fixed && fixed.mode === observe.camera && fixed.rider === observe.watched) {
    const away = { x: fixed.eye.x - p.x, y: fixed.eye.y - p.y, z: fixed.eye.z - p.z };
    const behind = away.x * f.x + away.y * f.y + away.z * f.z < 0;
    if (!behind || Math.hypot(away.x, away.y, away.z) < (high ? 40 : 22)) return fixed.eye;
  }
  const side = fixed ? -fixed.side : 1;
  const now = observe.clock.current;
  const move = recordedMove(observe.riders[observe.watched]?.record, now, now + (high ? 4000 : 2500));
  const ahead = move && Math.hypot(move.x, move.z) > 5 ? add(p, move) : add(p, f, high ? 60 : 30);
  const eye = add(add(ahead, r, side * (high ? 2.5 : 3.5)), WORLD_UP, high ? 9 : 0.6);
  observe.fixed = { mode: observe.camera, rider: observe.watched, eye, side };
  return eye;
}

/**
 * Drive the race camera from the watched ghost (race-camera-coordinator):
 * A is the release chase camera fed the ghost's pose; the others are placed
 * around the kart after the console's 选择视角 pad (side view, the rider
 * facing right: S above, Q at the face, D / F / V in front, high / level /
 * low) and the 帮助 texts. The release's own camera paths are in its native
 * client, not in the data; these are drawn to match those descriptions.
 */
export function updateObserverCamera(host: {
  camera: unknown;
  session: { ghosts: unknown[]; driveCameraState?: unknown };
  cameras: { drive?: { update(input: Record<string, unknown>): unknown; apply(camera: unknown, frame: unknown): void } };
  track: { currentRouteSurface?(owner: object): string } | undefined;
}, observe: ObserveState, nowMs: number): boolean {
  const pose = observe.pose;
  if (!pose) return false;
  const p = pose.position, f = pose.forward, u = pose.up, r = pose.right;
  const velocity = observe.velocity ?? { x: 0, y: 0, z: 0 };
  const camera = host.camera as ObserveCamera;
  const zoom = observe.view.zoom;
  const kart = add(p, u, 0.8);
  switch (observe.camera) {
    case "A": {
      const drive = host.cameras.drive;
      if (!drive) return false;
      let routeSurface: string | undefined;
      const ghost = host.session.ghosts[observe.watched];
      try { routeSurface = ghost ? host.track?.currentRouteSurface?.(ghost as object) : undefined; } catch { routeSurface = undefined; }
      const frame = drive.update({
        timestampMs: nowMs, motionMode: 0, body: { position: p, right: r, forward: f, up: u, linearVelocity: velocity },
        wheelContact: true, motorcycleType: false, mrContact: false, hwContact: false,
        averageWheelHitNormal: u, effectiveReverseScalar: 1, stateCode: 0, action8: false,
        eventScaleSecondary: { x: 1, y: 1, z: 1 }, routeSurface,
      });
      host.session.driveCameraState = frame;
      drive.apply(camera, frame);
      dolly(camera, kart, zoom);
      return true;
    }
    case "Q": lookAt(camera, add(add(p, u, 0.9), f, 0.6), add(add(p, f, 12), u, 0.6), u, 75); return true;
    case "S": {
      const turn = observe.view.turn;
      const heading = { x: f.x * Math.cos(turn) - r.x * Math.sin(turn), y: 0,
        z: f.z * Math.cos(turn) - r.z * Math.sin(turn) };
      lookAt(camera, add(p, WORLD_UP, 18 * zoom), p, heading, 60);
      return true;
    }
    case "D": lookAt(camera, add(add(p, f, 8 * zoom), WORLD_UP, 2 * zoom), kart, WORLD_UP, 60); return true;
    case "E": {
      const turn = observe.view.turn;
      const around = { x: f.x * Math.cos(turn) + r.x * Math.sin(turn), y: f.y * Math.cos(turn) + r.y * Math.sin(turn),
        z: f.z * Math.cos(turn) + r.z * Math.sin(turn) };
      lookAt(camera, add(add(p, around, 8 * zoom), WORLD_UP, 2 * zoom), kart, WORLD_UP, 60);
      return true;
    }
    case "F": lookAt(camera, add(add(add(p, f, 5), r, -5), WORLD_UP, 3), kart, WORLD_UP, 60); return true;
    case "R": lookAt(camera, add(add(add(p, f, 5), r, 5), WORLD_UP, 3), kart, WORLD_UP, 60); return true;
    case "V": lookAt(camera, add(add(p, f, 6), WORLD_UP, 0.35), kart, WORLD_UP, 65); return true;
    case "G": case "T": lookAt(camera, fixedEye(observe, p, f, r), kart, WORLD_UP, observe.camera === "G" ? 55 : 45); return true;
    case "H": case "Y": {
      const side = observe.camera === "H" ? -1 : 1;
      lookAt(camera, add(add(p, r, side * 7 * zoom), WORLD_UP, 1.6 + observe.view.lift), kart, WORLD_UP, 60);
      return true;
    }
  }
  return false;
}
