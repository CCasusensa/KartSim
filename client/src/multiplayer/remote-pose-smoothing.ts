/**
 * Not in the release: smooths the drawn pose of a remote kart.
 *
 * The release (and `RemoteMotionPredictor`, which matches it) re-anchors a
 * remote kart on every 64 ms motion packet: the kart jumps to the packet's
 * position and the prediction restarts from there. Every prediction error —
 * a turn or drift between packets, a clock offset between the two clients,
 * one-way latency jitter — therefore shows as a jump at each packet, and the
 * jump grows with speed (≈ speed × timing error), which players see as other
 * karts flickering back and forth at high speed.
 *
 * The smoother keeps the physics prediction untouched (collisions, rank and
 * slipstream still read it) and only changes what is drawn: at a re-anchor it
 * measures the offset between where the kart was drawn (advanced by its
 * velocity) and the new prediction, then bleeds that offset out over the next
 * ~100–300 ms so the drawn kart glides onto the prediction instead of jumping.
 * A correction larger than SNAP_DISTANCE / SNAP_ANGLE is a reset, warp or
 * long packet gap and is shown at once.
 */
import { matrixFromQuaternion, quaternionFromMatrix,
  type Quaternion } from "../driving/orientation-math";
import type { RailMatrix } from "../driving/rail-frame";

type Vector = [number, number, number];

export interface RawRemotePose {
  position: Vector;
  rotation: RailMatrix;
  velocity: Vector;
}

export interface SmoothedRemotePose {
  position: Vector;
  rotation: RailMatrix;
}

/** Metres: a larger correction is a teleport (reset, warp) and is not blended. */
export const SNAP_DISTANCE = 8;
/** Radians: a larger rotation correction is shown at once. */
export const SNAP_ANGLE = Math.PI / 2;
/** The offset bleeds out over the packet gap, within these bounds (ms). */
export const MIN_BLEND_MS = 100;
export const MAX_BLEND_MS = 300;

const IDENTITY: Quaternion = { w: 1, x: 0, y: 0, z: 0 };

const add = (left: Vector, right: Vector): Vector =>
  [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const sub = (left: Vector, right: Vector): Vector =>
  [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
const scale = (vector: Vector, factor: number): Vector =>
  [vector[0] * factor, vector[1] * factor, vector[2] * factor];
const length = (vector: Vector): number => Math.hypot(vector[0], vector[1], vector[2]);

function multiply(left: Quaternion, right: Quaternion): Quaternion {
  return {
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  };
}

const conjugate = (q: Quaternion): Quaternion => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });

function normalize(q: Quaternion): Quaternion {
  const norm = Math.hypot(q.w, q.x, q.y, q.z);
  if (!(norm > 0) || !Number.isFinite(norm)) return { ...IDENTITY };
  const sign = q.w < 0 ? -1 / norm : 1 / norm;
  return { w: q.w * sign, x: q.x * sign, y: q.y * sign, z: q.z * sign };
}

/** The rotation angle (radians, 0..π) of a normalized quaternion with w ≥ 0. */
function rotationAngle(q: Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.max(-1, q.w)));
}

/** The same axis with the angle scaled by `fraction` (0..1). */
function scaleRotation(q: Quaternion, fraction: number): Quaternion {
  const angle = rotationAngle(q);
  const sinHalf = Math.sin(angle / 2);
  if (angle < 1e-6 || sinHalf < 1e-9) return { ...IDENTITY };
  const half = (angle * fraction) / 2;
  const factor = Math.sin(half) / sinHalf;
  return { w: Math.cos(half), x: q.x * factor, y: q.y * factor, z: q.z * factor };
}

export class RemotePoseSmoother {
  private offset: Vector = [0, 0, 0];
  private twist: Quaternion = { ...IDENTITY };
  private remainingMs = 0;
  private lastTick?: number;
  private lastReanchorTick?: number;
  private last?: { displayed: SmoothedRemotePose; velocity: Vector };
  /** The pose to draw after the latest `observe`; undefined before any pose. */
  displayed?: SmoothedRemotePose;

  /** Whether a correction is still being blended out. */
  get blending(): boolean { return this.remainingMs > 0; }

  /**
   * Called once per frame after the predictor advanced to `nowTick`.
   * `reanchored` says the predictor restarted from a new packet this frame;
   * `passthrough` (locked or bypassed frames) draws the raw pose unchanged.
   */
  observe(raw: RawRemotePose | undefined, nowTick: number, reanchored: boolean,
    passthrough = false): SmoothedRemotePose | undefined {
    if (!raw || passthrough) {
      this.reset();
      this.displayed = raw ? { position: raw.position, rotation: raw.rotation } : undefined;
      return this.displayed;
    }
    const dt = this.lastTick === undefined ? 0 : Math.max(0, nowTick - this.lastTick);
    if (reanchored) {
      if (this.last) {
        const expected = add(this.last.displayed.position, scale(this.last.velocity, dt / 1000));
        const offset = sub(expected, raw.position);
        const twist = normalize(multiply(quaternionFromMatrix(this.last.displayed.rotation),
          conjugate(quaternionFromMatrix(raw.rotation))));
        const gap = nowTick - (this.lastReanchorTick ?? nowTick);
        if (length(offset) > SNAP_DISTANCE || rotationAngle(twist) > SNAP_ANGLE ||
            offset.some(value => !Number.isFinite(value))) {
          this.clearOffset();
        } else {
          this.offset = offset;
          this.twist = twist;
          this.remainingMs = Math.min(MAX_BLEND_MS, Math.max(MIN_BLEND_MS, gap));
        }
      }
      this.lastReanchorTick = nowTick;
    } else if (this.remainingMs > 0 && dt > 0) {
      const keep = Math.max(0, 1 - dt / this.remainingMs);
      this.remainingMs = Math.max(0, this.remainingMs - dt);
      if (this.remainingMs === 0 || keep === 0) this.clearOffset();
      else {
        this.offset = scale(this.offset, keep);
        this.twist = scaleRotation(this.twist, keep);
      }
    }
    this.lastTick = nowTick;
    this.displayed = this.remainingMs > 0
      ? {
        position: add(raw.position, this.offset),
        rotation: matrixFromQuaternion(normalize(multiply(this.twist,
          quaternionFromMatrix(raw.rotation)))),
      }
      : { position: raw.position, rotation: raw.rotation };
    this.last = { displayed: this.displayed, velocity: raw.velocity };
    return this.displayed;
  }

  private clearOffset(): void {
    this.offset = [0, 0, 0];
    this.twist = { ...IDENTITY };
    this.remainingMs = 0;
  }

  reset(): void {
    this.clearOffset();
    this.lastTick = undefined;
    this.lastReanchorTick = undefined;
    this.last = undefined;
    this.displayed = undefined;
  }
}
