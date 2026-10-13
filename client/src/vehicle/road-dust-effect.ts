/**
 * 沙尘 and 水花 behind a kart on sand and shallow water. Not in the release.
 *
 * A track road names its wheel effect in `dust`: one of desertdust (沙漠),
 * valleydust (侏罗纪), water, waterspark and citywaterspark, each the
 * native effect `effect/dust/<dust>.1s` in effect.rho. The release only
 * accepted the attribute (track-road-descriptor.ts) and never drew it. The
 * effects are built for the kart: two groups of billboards at the rear wheels
 * (x = ±0.633) thrown back and up over a 166 ms looping PRS animation, so the
 * scene is attached to the kart like the charger effect and plays while the
 * wheels are on such a road.
 */
import type { ChargerArchive, ChargerScene, ChargerSceneObject } from "./charger-effect";

export const ROAD_DUST_DIRECTORY = "effect/dust";

/**
 * Below this speed (km/h) no dust is raised. `dustVel` overrides it: 50.0 on
 * the waterspark shallows of sword_F01/I02/R01, the only roads that set it.
 */
export const DEFAULT_ROAD_DUST_SPEED_KMH = 10;

export interface RoadDustDescriptor {
  road: { attributes: Array<{ name: string; value: string }> };
}

function attribute(descriptor: RoadDustDescriptor, name: string): string | undefined {
  return descriptor.road.attributes.find(entry => entry.name === name)?.value;
}

/** The effect a road raises at `speedKmh`, if any. */
export function roadDustEffectName(descriptor: RoadDustDescriptor | undefined,
  speedKmh: number): string | undefined {
  if (!descriptor) return undefined;
  const name = attribute(descriptor, "dust");
  if (!name || !/^\w+$/.test(name)) return undefined;
  const velocity = Number.parseFloat(attribute(descriptor, "dustVel") ?? "");
  const minimum = Number.isFinite(velocity) ? velocity : DEFAULT_ROAD_DUST_SPEED_KMH;
  return Math.abs(speedKmh) >= minimum ? name : undefined;
}

export interface RoadDustEffectOps<ModelData> {
  decodeModel(bytes: unknown): ModelData;
  loadModel(
    data: ModelData,
    archive: ChargerArchive,
    path: string,
    identity: { id: string },
    options: { environment: unknown; stageBinding: unknown; advanceEnvironment: false;
      convertClientCoordinates: false },
  ): Promise<ChargerScene>;
  prepareTexture(object: ChargerSceneObject): void;
  configureMesh(node: { isMesh?: boolean }, renderOrder: -1000, transparent: true,
    depthBias: -0.01): void;
  configureMaterials(object: ChargerSceneObject): void;
}

type Slot = { scene: ChargerScene } | { loading: Promise<void> } | { missing: true };

/** One kart's road effects, loaded the first time its wheels meet each one. */
export class RoadDustEffect<ModelData = unknown> {
  readonly slots = new Map<string, Slot>();
  /** The effect the wheels ask for, and the one now playing. */
  wanted: string | undefined;
  playing: string | undefined;
  disposed = false;

  constructor(readonly archive: ChargerArchive, readonly parent: { object: ChargerSceneObject },
    readonly environment: unknown, readonly stageBinding: unknown,
    readonly ops: RoadDustEffectOps<ModelData>,
    readonly onError: (error: unknown) => void = error => console.warn(error)) {}

  update(nowMs: number, name: string | undefined, frame: unknown, environment: unknown,
    options: unknown): void {
    const now = Math.trunc(nowMs) >>> 0;
    this.wanted = name;
    if (name !== undefined && !this.slots.has(name)) this.load(name);
    const ready = name === undefined ? undefined : this.slots.get(name);
    const next = ready && "scene" in ready ? name : undefined;
    if (next !== this.playing) {
      this.stop(now);
      if (next !== undefined) {
        const scene = (this.slots.get(next) as { scene: ChargerScene }).scene;
        scene.object.visible = true;
        scene.playControllers?.(now, 0);
        this.playing = next;
      }
    }
    if (this.playing !== undefined)
      (this.slots.get(this.playing) as { scene: ChargerScene }).scene
        .update(now, frame, environment, options);
  }

  load(name: string): void {
    const path = `${ROAD_DUST_DIRECTORY}/${name}.1s`;
    const candidates = this.archive.exactCanonicalCandidates(path);
    if (candidates.length !== 1) {
      this.slots.set(name, { missing: true });
      if (candidates.length > 1) this.onError(new Error(`${path} source 数量为 ${candidates.length}。`));
      return;
    }
    const entry = candidates[0]!;
    const loading = (async () => {
      const scene = await this.ops.loadModel(
        this.ops.decodeModel(await entry.bytes()), this.archive, entry.virtualPath,
        { id: `effect:dust:${name}` },
        { environment: this.environment, stageBinding: this.stageBinding,
          advanceEnvironment: false, convertClientCoordinates: false },
      );
      if (this.disposed) {
        scene.dispose();
        return;
      }
      scene.object.visible = false;
      this.parent.object.add(scene.object);
      this.ops.prepareTexture(scene.object);
      scene.object.traverse(node => {
        if (node.isMesh === true) this.ops.configureMesh(node, -1000, true, -0.01);
      });
      this.ops.configureMaterials(scene.object);
      this.slots.set(name, { scene });
    })().catch(error => {
      if (!this.disposed) this.slots.set(name, { missing: true });
      this.onError(error);
    });
    this.slots.set(name, { loading });
  }

  stop(now: number): void {
    if (this.playing === undefined) return;
    const scene = (this.slots.get(this.playing) as { scene: ChargerScene }).scene;
    scene.stopControllers?.(now);
    scene.object.visible = false;
    this.playing = undefined;
  }

  reset(nowMs = 0): void {
    this.wanted = undefined;
    this.stop(Math.trunc(nowMs) >>> 0);
  }

  dispose(): void {
    this.disposed = true;
    this.playing = undefined;
    for (const slot of this.slots.values()) {
      if (!("scene" in slot)) continue;
      slot.scene.object.removeFromParent();
      slot.scene.dispose();
    }
    this.slots.clear();
  }
}

/** What a kart's physics shows of the road under its wheels. */
export interface RoadDustVehicle {
  wheels: { roadDescriptor?: RoadDustDescriptor };
  runtime: { contactWorking: boolean };
  displaySpeedKmh(): number;
}

/** The dust a driven kart raises: wheels on a dust road, fast enough, shown. */
export function vehicleRoadDust(vehicle: RoadDustVehicle, visible: boolean): string | undefined {
  if (!visible || !vehicle.runtime.contactWorking) return undefined;
  return roadDustEffectName(vehicle.wheels.roadDescriptor, vehicle.displaySpeedKmh());
}

interface DustPoint { x: number; y: number; z: number }

export interface RoadDustTrack {
  rayQuery(origin: DustPoint, displacement: DustPoint, includeSomething: false):
    { point: DustPoint; roadDescriptor?: RoadDustDescriptor } | undefined;
}

/**
 * The dust under a kart known only by its drawn pose (a remote racer): the
 * road a short ray down from it meets, as the drift effect finds the ground.
 * A kart more than a metre above the road is in the air and raises none.
 */
export function groundRoadDust(track: RoadDustTrack, position: DustPoint,
  speedKmh: number): string | undefined {
  const hit = track.rayQuery({ x: position.x, y: position.y + 1, z: position.z },
    { x: 0, y: -2, z: 0 }, false);
  return roadDustEffectName(hit?.roadDescriptor, speedKmh);
}

/** Speed (km/h) of a drawn pose from its last position, for karts without physics. */
export class PoseSpeed {
  last: { x: number; y: number; z: number; ms: number } | undefined;
  kmh = 0;

  update(nowMs: number, position: DustPoint): number {
    const last = this.last;
    if (last && nowMs > last.ms) {
      const seconds = (nowMs - last.ms) / 1000;
      // A jump (respawn, warp) over half a second apart is not speed.
      this.kmh = seconds > 0.5 ? 0 : Math.hypot(position.x - last.x,
        position.y - last.y, position.z - last.z) / seconds * 3.6;
    }
    if (!last || nowMs > last.ms)
      this.last = { x: position.x, y: position.y, z: position.z, ms: nowMs };
    return this.kmh;
  }
}
