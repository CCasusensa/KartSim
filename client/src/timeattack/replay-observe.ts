/**
 * OB 观看 at race time (TIMEATTACK.md 4): a replay is a solo race whose only
 * participant is the watched ghost. The session's `observe` state carries the
 * playback clock (play / pause / 0.5× / 0.25× / seek), the camera mode and
 * the console; stage-update, the camera routing and the action dispatch read
 * it to hide the local kart, drive the ghost off the clock and point the
 * camera at it.
 */
import { Matrix4, Vector3 } from "three";
import { matrixFromQuaternion } from "../driving/orientation-math";

export type ObserveCameraMode = "A" | "S" | "Q" | "F" | "D" | "V";

/** The playback clock: ghost time as a function of the race's own ghost time. */
export class ReplayClock {
  rate = 1;
  paused = false;
  private anchorNatural?: number;
  private anchorTime = 0;

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
  private last = 0;

  /** Called once a frame by stage-update with the natural time; remembers the result. */
  advance(naturalMs: number): number {
    this.last = this.timeAt(naturalMs);
    return this.last;
  }

  private reanchor(naturalMs: number, time: number): void {
    this.anchorNatural = naturalMs;
    this.anchorTime = Math.max(0, Math.min(this.durationMs, time));
    this.last = this.anchorTime;
  }

  play(naturalMs: number, rate = 1): void {
    this.reanchor(naturalMs, this.timeAt(naturalMs));
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

export interface ObserveState {
  riderName: string;
  kartName: string;
  recordMs: number;
  clock: ReplayClock;
  camera: ObserveCameraMode;
  hudVisible: boolean;
  /** The race's natural ghost time of the latest frame (stage-update). */
  naturalMs: number;
  /** Set by the race builder: leaves the replay (the pause menu's 菜单). */
  exit?(): void;
  /** The console over the race, owned by replay-session. */
  console?: { update(): void; dispose(): void };
  /** The previous ghost position, for the chase camera's velocity. */
  previous?: { x: number; y: number; z: number; atMs: number };
}

/** The observe state of a race session: carried by its selection's story request. */
export function observeOf(session: unknown): ObserveState | undefined {
  const raw = session as { observe?: unknown; selection?: { story?: { observe?: unknown } } } | undefined;
  const observe = raw?.observe ?? raw?.selection?.story?.observe;
  return observe && typeof observe === "object" ? observe as ObserveState : undefined;
}

interface Vec3 { x: number; y: number; z: number }

/** The watched ghost's world pose from a playback sample (the sampler's Dc shape). */
export function ghostWorldPose(sample: unknown): { position: Vec3; right: Vec3; forward: Vec3; up: Vec3 } | undefined {
  const raw = (sample && typeof sample === "object" && "sample" in (sample as object)
    ? (sample as { sample: unknown }).sample : sample) as { x: number; y: number; z: number;
    quaternion: { w: number; x: number; y: number; z: number } } | undefined;
  if (!raw || !raw.quaternion) return undefined;
  const m = matrixFromQuaternion(raw.quaternion);
  // Wire → world (world.js xv / LL): x, y = wire z, z = -wire y.
  return {
    position: { x: raw.x, y: raw.z, z: -raw.y },
    right: { x: m[0].x, y: m[2].x, z: -m[1].x },
    forward: { x: -m[0].y, y: -m[2].y, z: m[1].y },
    up: { x: m[0].z, y: m[2].z, z: -m[1].z },
  };
}

const scratch = { eye: new Vector3(), target: new Vector3(), up: new Vector3(), matrix: new Matrix4() };

/** Point a three.js camera from eye at target with the given up. */
function lookAt(camera: { matrixAutoUpdate: boolean; matrixWorld: Matrix4; matrixWorldInverse: Matrix4; matrix: Matrix4;
  position: Vector3; up: Vector3; fov: number; near: number; far: number; updateProjectionMatrix(): void;
  matrixWorldNeedsUpdate: boolean }, eye: Vec3, target: Vec3, up: Vec3, fov: number): void {
  scratch.eye.set(eye.x, eye.y, eye.z);
  scratch.target.set(target.x, target.y, target.z);
  scratch.up.set(up.x, up.y, up.z);
  camera.matrixAutoUpdate = false;
  scratch.matrix.lookAt(scratch.eye, scratch.target, scratch.up);
  scratch.matrix.setPosition(scratch.eye);
  camera.matrix.copy(scratch.matrix);
  camera.matrixWorld.copy(scratch.matrix);
  camera.matrixWorldInverse.copy(scratch.matrix).invert();
  camera.position.copy(scratch.eye);
  camera.up.copy(scratch.up);
  camera.matrixWorldNeedsUpdate = false;
  camera.fov = fov;
  camera.near = 0.5;
  camera.far = 2000;
  camera.updateProjectionMatrix();
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });

/**
 * Drive the race camera from the watched ghost (shell-routing updateActiveRaceCamera):
 * mode A is the release chase camera fed the ghost's pose; the others are fixed
 * views around the kart.
 */
export function updateObserverCamera(host: {
  camera: unknown;
  session: { ghosts: Array<{ playback: { sample(ms: number): unknown } }>; driveCameraState?: unknown };
  cameras: { drive?: { update(input: Record<string, unknown>): unknown; apply(camera: unknown, frame: unknown): void } };
  track: { currentRouteSurface?(owner: object): string } | undefined;
}, observe: ObserveState, nowMs: number): boolean {
  const ghost = host.session.ghosts[0];
  if (!ghost) return false;
  const timeMs = observe.clock.current;
  const pose = ghostWorldPose(ghost.playback.sample(timeMs));
  if (!pose) return false;
  const previous = observe.previous;
  const dt = previous ? Math.max(1, timeMs - previous.atMs) / 1000 : 0;
  const velocity = previous && dt > 0 ? { x: (pose.position.x - previous.x) / dt, y: (pose.position.y - previous.y) / dt,
    z: (pose.position.z - previous.z) / dt } : { x: 0, y: 0, z: 0 };
  observe.previous = { ...pose.position, atMs: timeMs };
  const camera = host.camera as Parameters<typeof lookAt>[0];
  const p = pose.position, f = pose.forward, u = pose.up, r = pose.right;
  const worldUp = { x: 0, y: 1, z: 0 };
  switch (observe.camera) {
    case "A": {
      const drive = host.cameras.drive;
      if (!drive) return false;
      let routeSurface: string | undefined;
      try { routeSurface = host.track?.currentRouteSurface?.(ghost as object); } catch { routeSurface = undefined; }
      const frame = drive.update({
        timestampMs: nowMs, motionMode: 0, body: { position: p, right: r, forward: f, up: u, linearVelocity: velocity },
        wheelContact: true, motorcycleType: false, mrContact: false, hwContact: false,
        averageWheelHitNormal: u, effectiveReverseScalar: 1, stateCode: 0, action8: false,
        eventScaleSecondary: { x: 1, y: 1, z: 1 }, routeSurface,
      });
      host.session.driveCameraState = frame;
      drive.apply(camera, frame);
      return true;
    }
    case "S": lookAt(camera, add(p, worldUp, 28), p, f, 60); return true;
    case "Q": lookAt(camera, add(add(p, u, 0.9), f, 0.6), add(add(p, f, 12), u, 0.6), u, 75); return true;
    case "F": lookAt(camera, add(add(p, r, -7), worldUp, 2.2), add(p, u, 0.8), worldUp, 60); return true;
    case "D": lookAt(camera, add(add(p, f, 9), worldUp, 2.5), add(p, u, 0.8), worldUp, 60); return true;
    case "V": lookAt(camera, add(add(p, f, -6), worldUp, 0.4), add(p, u, 0.9), worldUp, 65); return true;
  }
  return false;
}

export const OBSERVE_CAMERA_MODES: ReadonlyArray<{ mode: ObserveCameraMode; label: string; key: string }> = [
  { mode: "A", label: "追尾", key: "KeyA" }, { mode: "S", label: "俯视", key: "KeyS" }, { mode: "Q", label: "第一人称", key: "KeyQ" },
  { mode: "F", label: "左侧", key: "KeyF" }, { mode: "D", label: "正面", key: "KeyD" }, { mode: "V", label: "低角度", key: "KeyV" },
];
