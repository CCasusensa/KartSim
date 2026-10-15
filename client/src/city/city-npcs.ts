import { cityContentName } from "../i18n/catalogs/city-content-names";
/**
 * 卡丁城 NPCs (server-go/CITY-NPC.md) for the city session: the node's
 * law-abiding traffic (city-traffic.ts), the lamps of the signals it obeys
 * (city-traffic-lights.ts) and the task-point riders standing at fixed
 * spots (city-npcs.json, city-npc-figure.ts). A rider who stops
 * near a task-point NPC gets a greeting in a talk balloon and the NPC turns
 * to face them.
 */
import npcData from "./city-npcs.json";
import { CityNpcFigure } from "./city-npc-figure";
import { CityTraffic, withTraffic } from "./city-traffic";
import { CityTrafficLights } from "./city-traffic-lights";
import { loadTrafficNetwork } from "./city-traffic-network";
import type { TrafficPacket } from "./city-traffic-protocol";
import { designToWorld } from "./city-coordinates";
import { groundHeightAt, type CityGroundTrack } from "./city-ground";
import { CITY_VEHICLE_SCALE } from "./city-vehicle-scale";

export { withTraffic };

/**
 * Task-point NPCs load within this distance (m), are drawn within DRAW and
 * let go of beyond UNLOAD (65 of them over the city: only those nearby are
 * kept), at most MAX_LOADING at a time.
 */
const LOAD_RADIUS = 220;
const DRAW_RADIUS = 200;
const UNLOAD_RADIUS = 300;
const MAX_LOADING = 2;
/** A rider this close (m) and this slow (m/s) is greeted. */
const GREET_RADIUS = 12;
const GREET_SPEED = 6;
const GREET_INTERVAL_MS = 12_000;
/** How long a honking car's driver shows a name tag and balloon (ms), and what it says. */
const HONK_SHOW_MS = 3200;
const HONK_LINES = ["嘀嘀～请让一让", "嘀嘀！前面的车手借过一下～", "嘀嘀～我从旁边绕过去啦"];
/** A standing rider's head is this far above the feet (m), less the labels' kart head height. */
const HEAD_OFFSET = 1.6 * CITY_VEHICLE_SCALE - 1.9 * CITY_VEHICLE_SCALE;

interface NpcDefinition { id: string; name: string; character: number; dye: number; x: number; z: number; y: number; heading: number; lines: string[] }

interface TaskNpc {
  definition: NpcDefinition;
  world: { x: number; y: number; z: number };
  yaw: number;
  figure?: CityNpcFigure;
  failed: boolean;
  grounded: boolean;
  greetedAt: number;
  line: number;
}

export interface CityNpcsHost {
  stage: any;
  library: unknown;
  /** Node time now (ms). */
  serverNow(): number;
  /** The local rider's world position and speed (m/s): its kart, or itself on foot. */
  local(): { position: { x: number; y: number; z: number }; speed: number } | undefined;
  /** Where the camera is (the nearest cars get karts). */
  view(): { x: number; y: number; z: number };
  say(id: string, text: string, now: number): void;
  onError(error: unknown): void;
}

export class CityNpcs {
  traffic?: CityTraffic;
  lights?: CityTrafficLights;
  readonly tasks: TaskNpc[];
  private readonly byId: Map<string, TaskNpc>;
  private loading = 0;
  disposed = false;
  /** The honks already announced, by car. */
  private readonly announced = new Map<number, number>();

  constructor(readonly host: CityNpcsHost) {
    this.tasks = (npcData.npcs as NpcDefinition[]).map(definition => {
      // Design heading (0 north, clockwise) → yaw around +y with 0 facing +z (south).
      const yaw = Math.PI - (definition.heading * Math.PI) / 180;
      return { definition, world: designToWorld(definition.x, definition.y, definition.z), yaw,
        failed: false, grounded: false, greetedAt: -Infinity, line: 0 };
    });
    this.byId = new Map(this.tasks.map(npc => [npc.definition.id, npc]));
  }

  /** Loads the traffic network and the traffic's karts; packets before that are dropped. */
  async start(): Promise<void> {
    const runtime = this.host.stage.runtime;
    const network = await loadTrafficNetwork();
    if (this.disposed) return;
    this.lights = new CityTrafficLights(network, this.host.stage.scene.scene, () => this.host.serverNow());
    const traffic = new CityTraffic({
      assets: runtime.assets, presenter: this.host.stage.scene, track: runtime.local.track,
      library: this.host.library, network,
      serverNow: () => this.host.serverNow(),
      localPosition: () => this.host.view(),
      onError: error => this.host.onError(error),
    });
    await traffic.prepare();
    if (this.disposed) { traffic.dispose(); return; }
    this.traffic = traffic;
  }

  receive(packet: TrafficPacket): void {
    this.traffic?.receive(packet);
  }

  update(now: number): void {
    if (this.disposed) return;
    this.traffic?.update(now);
    this.lights?.update(now);
    for (const car of this.traffic?.honking(now, HONK_SHOW_MS) ?? []) {
      if (this.announced.get(car.id) === car.honks) continue;
      this.announced.set(car.id, car.honks);
      this.host.say(`npc-car:${car.id}`, HONK_LINES[car.honks % HONK_LINES.length]!, now);
    }
    const local = this.host.local();
    const stage = this.host.stage;
    const presenter = stage.scene;
    const canvas = stage.host?.renderer?.domElement as HTMLCanvasElement | undefined;
    const width = canvas?.width ?? 1, height = canvas?.height ?? 1;
    for (const npc of this.tasks) {
      // A 载客 quest's NPC rides in someone's back seat instead of standing here.
      const away = this.away.has(npc.definition.id);
      const distance = away ? Infinity
        : local ? Math.hypot(local.position.x - npc.world.x, local.position.z - npc.world.z) : Infinity;
      if (!npc.figure && !npc.failed && distance < LOAD_RADIUS && this.loading < MAX_LOADING) this.load(npc);
      if (npc.figure && distance > UNLOAD_RADIUS && npc.figure.avatar) {
        npc.figure.dispose();
        npc.figure = undefined;
        npc.grounded = false;
      }
      const figure = npc.figure;
      if (!figure?.avatar) continue;
      if (!npc.grounded) this.ground(npc);
      if (local && distance < GREET_RADIUS) {
        figure.targetYaw = Math.atan2(local.position.x - npc.world.x, local.position.z - npc.world.z);
        if (local.speed < GREET_SPEED && now - npc.greetedAt > GREET_INTERVAL_MS) {
          npc.greetedAt = now;
          const lines = npc.definition.lines;
          this.host.say(this.labelId(npc), lines[npc.line % lines.length]!, now);
          npc.line++;
        }
      } else {
        figure.targetYaw = npc.yaw;
      }
      figure.update(now, presenter.camera, width, height, distance < DRAW_RADIUS);
    }
  }

  /** The task-point NPCs riding in a back seat (not standing at their spots). */
  readonly away = new Set<string>();

  private load(npc: TaskNpc): void {
    const runtime = this.host.stage.runtime;
    const figure = new CityNpcFigure({
      library: this.host.library, scene: this.host.stage.scene.scene,
      environment: runtime.assets.map.environment, stageBinding: runtime.assets.map.stageBinding,
    }, npc.definition.character, npc.definition.dye, npc.definition.id);
    npc.figure = figure;
    figure.place(npc.world.x, npc.world.y, npc.world.z, npc.yaw);
    this.loading++;
    figure.ready.then(() => { this.loading--; }, error => {
      this.loading--;
      npc.failed = true;
      if (npc.figure === figure) npc.figure = undefined;
      figure.dispose();
      this.host.onError(error);
    });
  }

  /** Stands the figure on the pavement under its spot. */
  private ground(npc: TaskNpc): void {
    const track = this.host.stage.runtime.local.track as CityGroundTrack;
    const y = groundHeightAt(track, npc.world.x, npc.world.z, npc.world.y);
    if (y !== undefined) npc.world = { ...npc.world, y };
    npc.figure!.place(npc.world.x, npc.world.y, npc.world.z, npc.figure!.yaw);
    npc.grounded = true;
  }

  private labelId(npc: TaskNpc): string { return `npc-task:${npc.definition.id}`; }

  /** A task-point NPC's feet (world), once its figure stands on the ground. */
  feetOf(id: string): { x: number; y: number; z: number } | undefined {
    const npc = this.byId.get(id);
    return npc?.figure?.avatar && npc.grounded && !this.away.has(id) ? npc.world : undefined;
  }

  /** Name tags over the task-point NPCs that are drawn, and over honking cars' drivers. */
  heads(): Array<{ id: string; name: string; position: { x: number; y: number; z: number } }> {
    const out = [];
    for (const car of this.traffic?.honking(performance.now(), HONK_SHOW_MS) ?? [])
      out.push({ id: `npc-car:${car.id}`, name: car.driver, position: car.position });
    for (const npc of this.tasks) {
      if (!npc.figure?.avatar || !npc.figure.root.visible || this.away.has(npc.definition.id)) continue;
      out.push({ id: this.labelId(npc), name: cityContentName(npc.definition.name),
        position: { x: npc.world.x, y: npc.world.y + HEAD_OFFSET, z: npc.world.z } });
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.traffic?.dispose();
    this.traffic = undefined;
    this.lights?.dispose();
    this.lights = undefined;
    for (const npc of this.tasks) npc.figure?.dispose();
  }
}
