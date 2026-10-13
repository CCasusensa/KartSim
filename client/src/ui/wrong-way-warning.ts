import type { WebGLRenderer } from "three";
import { Q9, S9 } from "../generated/library.js";
import { ActionSceneView, loadActionScene, type ActionSceneClip } from "../story/mission-result-action";
import { loadRequiredInterfaceAudio, type InterfaceAudioLibrary } from "../timeattack/interface-audio";

/**
 * 逆向提示, which the KartSim release never drew: the `wrongway` action of the
 * speed stage (stage_speedIndiGame action.bml; the time attack and item race
 * stages load the same folder). stage_common action/wrongway.1s is a
 * "restricted area" no-entry sign at the centre of the 800×600 action stage,
 * opaque for 433 ms and faded out by 1000 ms on a loop; sound_fx_etc
 * wrongway.flac is 600 ms of beeps padded to that loop, so it plays on every
 * loop. The release client's rule for when the sign shows is not in the data:
 * facing and driving back down the course for a second shows it.
 */

const MODEL = "stage_/common/action/wrongway.1s";
const SOUND = "sound_/fx/etc/wrongway.flac";

/** Speed back down the course that counts as driving the wrong way: 20 km/h. */
export const WRONG_WAY_MIN_SPEED = 20 / 3.6;
/** The kart faces more than 120° away from the course direction. */
export const WRONG_WAY_HEADING_COS = -0.5;
/** How long the wrong way must last before the sign shows. */
export const WRONG_WAY_SHOW_MS = 1_000;
/** How long the right way must last before the sign hides. */
export const WRONG_WAY_HIDE_MS = 300;

interface Vec3 { x: number; y: number; z: number }
interface Disposable { dispose(): void }

export interface WrongWaySample {
  /** The local kart is racing: after GO, before its finish, not warping or observed. */
  racing: boolean;
  forward: Vec3;
  velocity: Vec3;
  /** The course direction where the kart is; undefined off the frames or on a rail. */
  direction?: Vec3;
}

export interface WrongWayPhysics {
  body: { forward: Vec3; linearVelocity: Vec3 };
}

export interface WrongWayTrack {
  sampleRoute(vehicle: object, lookahead: number):
    { surface: string; sampled: boolean; direction?: Vec3 };
}

/** The kart's heading, velocity and the course direction at its route position. */
export function sampleWrongWay(physics: WrongWayPhysics, track: WrongWayTrack,
  racing: boolean): WrongWaySample {
  const sample: WrongWaySample = { racing, forward: physics.body.forward,
    velocity: physics.body.linearVelocity };
  if (!racing) return sample;
  const route = track.sampleRoute(physics, 0);
  // Rails carry the kart along the course and warps move it: neither is driving.
  if (route.sampled && route.direction && !/rail|warp/.test(route.surface))
    sample.direction = route.direction;
  return sample;
}

/** Facing and moving back down the course. */
export function drivingWrongWay(sample: WrongWaySample): boolean {
  const direction = sample.direction;
  if (!sample.racing || !direction) return false;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 1e-6)) return false;
  const along = (vector: Vec3) =>
    (vector.x * direction.x + vector.y * direction.y + vector.z * direction.z) / length;
  return along(sample.forward) <= WRONG_WAY_HEADING_COS &&
    along(sample.velocity) <= -WRONG_WAY_MIN_SPEED;
}

/** Shows after a second of the wrong way, hides after 300 ms of the right one. */
export class WrongWayDetector {
  active = false;
  /** When the opposite of `active` began. */
  private changingSinceMs?: number;

  update(nowMs: number, wrong: boolean, racing: boolean): boolean {
    if (!racing) {
      this.reset();
      return false;
    }
    if (wrong === this.active) {
      this.changingSinceMs = undefined;
      return this.active;
    }
    if (this.changingSinceMs === undefined || nowMs < this.changingSinceMs)
      this.changingSinceMs = nowMs;
    if (nowMs - this.changingSinceMs >= (this.active ? WRONG_WAY_HIDE_MS : WRONG_WAY_SHOW_MS)) {
      this.active = wrong;
      this.changingSinceMs = undefined;
    }
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.changingSinceMs = undefined;
  }
}

export class WrongWayWarning {
  readonly detector = new WrongWayDetector();
  /** Start of the loop playing now, while the sign shows. */
  private loopStartMs?: number;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly view = new ActionSceneView();
  private disposed = false;

  private constructor(readonly clip: ActionSceneClip, readonly sound: AudioBuffer,
    readonly textures: Map<string, Disposable>, readonly context: AudioContext) {}

  static async load(library: unknown, context: AudioContext): Promise<WrongWayWarning> {
    const textures = new Map<string, Disposable>();
    let clip: ActionSceneClip | undefined;
    try {
      clip = await loadActionScene(library, MODEL, textures);
      const sound = await loadRequiredInterfaceAudio(library as InterfaceAudioLibrary, context,
        SOUND, { decode: Q9, route: S9 } as never);
      return new WrongWayWarning(clip, sound, textures, context);
    } catch (error) {
      clip?.model.scene.dispose();
      for (const texture of textures.values()) texture.dispose();
      throw error;
    }
  }

  get showing(): boolean { return this.loopStartMs !== undefined; }

  update(nowMs: number, sample: WrongWaySample): void {
    if (this.disposed) return;
    const now = Math.trunc(nowMs);
    if (!this.detector.update(now, drivingWrongWay(sample), sample.racing)) {
      this.loopStartMs = undefined;
      return;
    }
    const loopMs = this.clip.durationMs;
    if (this.loopStartMs === undefined || now < this.loopStartMs) {
      this.loopStartMs = now;
      this.clip.model.scene.reset(now >>> 0);
      this.beep();
    } else if (now - this.loopStartMs >= loopMs) {
      this.loopStartMs += Math.floor((now - this.loopStartMs) / loopMs) * loopMs;
      this.beep();
    }
  }

  render(renderer: WebGLRenderer, nowMs: number): void {
    if (this.disposed || this.loopStartMs === undefined) return;
    this.view.draw(renderer, this.clip, Math.trunc(nowMs) >>> 0);
  }

  reset(): void {
    this.detector.reset();
    this.loopStartMs = undefined;
    this.stopSounds();
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    this.clip.model.scene.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }

  private beep(): void {
    const source = this.context.createBufferSource();
    source.buffer = this.sound;
    // The "fx" group: sound effect volume and mute.
    S9(this.context, source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    this.sources.add(source);
    source.start();
  }

  private stopSounds(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      source.disconnect();
    }
    this.sources.clear();
  }
}

/** The solo race session's 逆向提示, when it loaded. */
export function wrongWayOf(session: unknown): WrongWayWarning | undefined {
  const warning = (session as { wrongWay?: unknown } | undefined)?.wrongWay;
  return warning instanceof WrongWayWarning ? warning : undefined;
}
