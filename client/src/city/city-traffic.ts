/**
 * 卡丁城 NPC traffic (server-go/CITY-NPC.md): the game node drives the cars
 * and sends the ones near us as (path, distance, speed, lights) five times a
 * second (0xC3, city-traffic-protocol.ts). Here each car is replayed 250 ms
 * in the past between two packets along the lanes and junction links it
 * drove (so a car turning a corner follows the curve, not a straight cut),
 * set on the road surface, and drawn as an ordinary kart with its rider: a
 * small pool of karts loaded with the race loader (city-fleet.ts does the
 * same for members) is lent to the nearest cars and taken back from cars
 * that drive out of range.
 *
 * The presenter asks runtime.remotes for every participant's pose; the
 * session wraps the member fleet so ids "npc:<slot>" come here
 * (withTraffic). NPC karts never collide with members' karts (like members
 * among themselves); the cars stop for members instead.
 */
import { racePresenterInitializationDependencies } from "../generated/world.js";
import { cityVisualScale } from "./city-vehicle-scale";
import { designToWorld } from "./city-coordinates";
import { groundHeightAt, type CityGroundTrack } from "./city-ground";
import { mountRacer } from "./city-racer-mount";
import { CAR_BRAKE, CAR_HORN, type TrafficCarState, type TrafficPacket } from "./city-traffic-protocol";
import { pointAt, type PathPoint, type TrafficNetwork, type TrafficPath } from "./city-traffic-network";

/** How far in the past the cars are shown (ms): one packet interval and some jitter. */
const REPLAY_DELAY_MS = 260;
/** A car not in a packet for this long has driven out of range (ms). */
const FORGET_MS = 1600;
/** At most this many NPC karts are drawn (the nearest cars). */
export const MAX_NPC_KARTS = 22;
/** Loaded karts kept for reuse, drawn or not. */
const MAX_NPC_SLOTS = 28;
/** Cars further than this (m) get no kart. */
const DRAW_RADIUS = 190;
/** Height of a city kart's body above the road (m), as the local physics rests. */
export const NPC_BODY_LIFT = 0.12;
/** Ground heights are sampled along each path at this spacing (m). */
const GROUND_STEP = 2;

export const NPC_ID_PREFIX = "npc:";
export const isNpcId = (id: unknown): id is string => typeof id === "string" && id.startsWith(NPC_ID_PREFIX);

/**
 * The traffic's karts and drivers (kart item, character item): cars that
 * look like cars — buses, taxis, fire engines, roadsters, MINIs, jeeps —
 * driven by the original riders. A car's model byte picks one.
 */
export const NPC_PRESETS: ReadonlyArray<{ kart: number; character: number; driver: string; paint: number; dye: number }> = [
  // Paints and dyes (slots 2, 70): 1 红 2 黄 3 朱黄 4 绿 5 青绿 6 蓝 7 紫 8 黑 9 粉 10 白 11 海蓝.
  { kart: 967, character: 5, driver: "胖墩", paint: 2, dye: 3 },    // 滴哒出租车 9 · 胖墩
  { kart: 30, character: 4, driver: "葱头", paint: 2, dye: 4 },     // 校车 · 葱头
  { kart: 345, character: 3, driver: "黑妞", paint: 1, dye: 9 },    // MINI COOPER · 黑妞
  { kart: 27, character: 1, driver: "宝宝", paint: 6, dye: 1 },     // 经典敞篷跑车 · 宝宝
  { kart: 1046, character: 7, driver: "小强", paint: 1, dye: 8 },   // 消防车 9 · 小强
  { kart: 1417, character: 8, driver: "小乖", paint: 9, dye: 9 },   // 品克缤出租 V1 · 小乖
  { kart: 252, character: 2, driver: "皮蛋", paint: 4, dye: 4 },    // 军用吉普车PRO · 皮蛋
  { kart: 44, character: 12, driver: "R博士", paint: 8, dye: 10 },   // 老爷车 · R博士
  { kart: 931, character: 15, driver: "吉米", paint: 8, dye: 6 },   // 马格南 9 · 吉米
  { kart: 99, character: 14, driver: "妮妮", paint: 10, dye: 9 },   // MINI COOPER-SS · 妮妮
  { kart: 682, character: 9, driver: "海盗船长", paint: 1, dye: 8 },    // Spyder HT · 海盗船长
  { kart: 384, character: 18, driver: "嘟嘟", paint: 2, dye: 5 },   // 校车SR · 嘟嘟
  { kart: 1421, character: 10, driver: "奇奇", paint: 3, dye: 7 },  // 危险地区快速出租车 V1 · 奇奇
  { kart: 758, character: 19, driver: "茜茜", paint: 11, dye: 6 },  // New R8 · 茜茜
  { kart: 467, character: 6, driver: "蓝蓝", paint: 1, dye: 6 },    // 消防车 Z7 · 蓝蓝
  { kart: 346, character: 25, driver: "雯雯", paint: 5, dye: 2 },   // MINI COOPER-B · 雯雯
];

/** Every slot an equipment document carries (the loader reads them all; 0 = nothing worn). */
const EQUIPMENT_SLOTS = [1, 2, 3, 4, 8, 9, 10, 11, 12, 16, 17, 18, 20, 21, 26, 27, 30, 31, 32, 36, 43, 44, 45, 46,
  52, 58, 59, 61, 68, 69, 70, 71, 76, 77, 78];

/** The equipment document of an NPC: kart, rider, paint and dye, nothing else. */
export function npcEquipment(preset: { kart: number; character: number; paint: number; dye: number }) {
  const itemIds: Record<number, number> = {};
  for (const slot of EQUIPMENT_SLOTS) itemIds[slot] = 0;
  Object.assign(itemIds, { 1: preset.character, 2: preset.paint, 3: preset.kart, 70: preset.dye });
  return { itemIds, kartSerial: 0, valueAt3E: 0, exceedType: 0 };
}

interface Snapshot extends TrafficCarState { tick: number }

interface Car {
  id: number;
  model: number;
  snapshots: Snapshot[];
  seenAt: number;
  slot?: Slot;
  /** This frame's pose and presentation (computed once per frame). */
  frame?: number;
  pose?: WebPose;
  speed: number;
  steer: number;
  brake: boolean;
  /** When the car last sounded its horn (performance.now ms), and how often so far. */
  honkAt: number;
  honks: number;
}

interface Slot {
  playerId: string;
  preset: number;
  index: number;
  participant?: any;
  view?: any;
  loading?: Promise<void>;
  car?: Car;
  attached: boolean;
  failed: boolean;
}

interface Vec3 { x: number; y: number; z: number }
interface WebPose { position: Vec3; right: Vec3; up: Vec3; forward: Vec3; visualScale: Vec3 }

export interface CityTrafficHost {
  assets: any;
  presenter: any;
  track: CityGroundTrack;
  library: unknown;
  network: TrafficNetwork;
  /** Node time now (ms): performance.now() plus the clock offset. */
  serverNow(): number;
  /** Where we look from (who the nearest cars are nearest to): the camera. */
  localPosition(): Vec3 | undefined;
  onError(error: unknown): void;
}

interface CatalogEntry { itemId: number; path: string; systemKey?: string }

export class CityTraffic {
  readonly cars = new Map<number, Car>();
  readonly slots: Slot[] = [];
  disposed = false;
  private frameNumber = 0;
  private lastAssign = -Infinity;
  private loadQueue: Slot[] = [];
  private loadingNow = false;
  private presets: Array<(typeof NPC_PRESETS)[number]> = [];
  /** Presets whose kart failed to load here: cars get another one. */
  private readonly broken = new Set<number>();
  private readonly ground = new Map<number, Float32Array>();
  private readonly scratch: PathPoint = { x: 0, z: 0, y: 0, dx: 0, dz: 1 };
  private nextSlot = 0;

  constructor(readonly host: CityTrafficHost) {}

  /** Keeps the presets whose kart and character this resource version has. */
  async prepare(): Promise<void> {
    const library = this.host.library as { timeAttackGarageCatalog(): Promise<{ karts: CatalogEntry[]; characters: CatalogEntry[] }> };
    const catalog = await library.timeAttackGarageCatalog();
    const karts = new Set(catalog.karts.map(k => k.itemId)), characters = new Set(catalog.characters.map(c => c.itemId));
    this.presets = NPC_PRESETS.filter(p => karts.has(p.kart) && characters.has(p.character));
    if (!this.presets.length) throw new Error("车流没有可用的卡丁车与角色。");
  }

  // ---- packets ----

  receive(packet: TrafficPacket): void {
    if (this.disposed || packet.network !== this.host.network.wireId) return;
    const now = performance.now();
    const tick = this.unwrapTick(packet.tick);
    for (const state of packet.cars) {
      if (state.path >= this.host.network.paths.length) continue;
      let car = this.cars.get(state.id);
      if (!car) {
        car = { id: state.id, model: state.model, snapshots: [], seenAt: now, speed: 0, steer: 0, brake: false,
          honkAt: -Infinity, honks: 0 };
        this.cars.set(state.id, car);
      }
      const last = car.snapshots[car.snapshots.length - 1];
      if (last && tick <= last.tick) continue;
      // A car that moved far (it started again elsewhere) starts a new history.
      if (last && !this.connected(last, state)) car.snapshots.length = 0;
      car.snapshots.push({ ...state, tick });
      // The node sets the horn flag for one packet each time a car honks.
      if (state.flags & CAR_HORN && now - car.honkAt > 1500) { car.honkAt = now; car.honks++; }
      if (car.snapshots.length > 8) car.snapshots.shift();
      car.model = state.model;
      car.seenAt = now;
    }
  }

  /** The packet's uint32 node tick nearest the node clock now. */
  private unwrapTick(tick: number): number {
    const now = this.host.serverNow();
    const span = 2 ** 32;
    return tick + Math.round((now - tick) / span) * span;
  }

  /** Whether b continues a along the network within two paths. */
  private connected(a: TrafficCarState, b: TrafficCarState): boolean {
    return this.route(a, b) !== undefined;
  }

  /** The distance from a to b along the paths it drives (undefined: not connected). */
  private route(a: TrafficCarState, b: TrafficCarState): Array<{ path: number; from: number; to: number }> | undefined {
    const paths = this.host.network.paths;
    if (a.path === b.path && b.s >= a.s - 0.25) return [{ path: a.path, from: a.s, to: Math.max(a.s, b.s) }];
    const first = paths[a.path]!;
    if (first.next.includes(b.path)) return [{ path: a.path, from: a.s, to: first.length }, { path: b.path, from: 0, to: b.s }];
    for (const middle of first.next) {
      const second = paths[middle]!;
      if (second.next.includes(b.path)) {
        return [{ path: a.path, from: a.s, to: first.length }, { path: middle, from: 0, to: second.length },
          { path: b.path, from: 0, to: b.s }];
      }
    }
    return undefined;
  }

  // ---- per frame ----

  /** Forgets cars out of range, lends karts to the nearest cars. */
  update(now: number): void {
    if (this.disposed) return;
    this.frameNumber++;
    for (const [id, car] of this.cars) {
      if (now - car.seenAt > FORGET_MS) {
        this.release(car);
        this.cars.delete(id);
      }
    }
    if (now - this.lastAssign < 250) return;
    this.lastAssign = now;
    this.assign();
  }

  private assign(): void {
    const local = this.host.localPosition();
    const ranked: Array<{ car: Car; distance: number }> = [];
    for (const car of this.cars.values()) {
      const pose = this.poseOf(car);
      if (!pose) continue;
      const distance = local ? Math.hypot(pose.position.x - local.x, pose.position.z - local.z) : 0;
      if (distance <= DRAW_RADIUS) ranked.push({ car, distance });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    const wanted = new Set(ranked.slice(0, MAX_NPC_KARTS).map(entry => entry.car));
    for (const car of this.cars.values()) if (car.slot && !wanted.has(car)) this.release(car);
    const working = this.presets.map((_, i) => i).filter(i => !this.broken.has(i));
    if (!working.length) return;
    for (const car of wanted) {
      if (car.slot) continue;
      const preset = working[car.model % working.length]!;
      let slot = this.slots.find(s => !s.car && !s.failed && s.preset === preset && s.participant);
      slot ??= this.slots.find(s => !s.car && !s.failed && s.preset === preset && s.loading);
      if (!slot && this.slots.length < MAX_NPC_SLOTS) slot = this.createSlot(preset);
      if (!slot) {
        // Make room: drop a loaded kart nobody drives for a preset that is needed.
        const spare = this.slots.find(s => !s.car && s.participant);
        if (!spare) continue;
        this.disposeSlot(spare);
        slot = this.createSlot(preset);
      }
      slot.car = car;
      car.slot = slot;
      if (slot.participant) this.attach(slot);
    }
  }

  private createSlot(preset: number): Slot {
    const index = this.nextSlot++;
    const slot: Slot = { playerId: `${NPC_ID_PREFIX}${index}`, preset, index, attached: false, failed: false };
    this.slots.push(slot);
    this.loadQueue.push(slot);
    void this.pumpLoads();
    return slot;
  }

  /** Loads queued karts one at a time (a kart and rider take a while to build). */
  private async pumpLoads(): Promise<void> {
    if (this.loadingNow) return;
    this.loadingNow = true;
    try {
      while (this.loadQueue.length && !this.disposed) {
        const slot = this.loadQueue.shift()!;
        if (!this.slots.includes(slot)) continue;
        slot.loading = this.load(slot).catch(error => {
          // This kart cannot be built here: no car gets it again.
          slot.failed = true;
          this.broken.add(slot.preset);
          this.disposeSlot(slot);
          this.host.onError(error);
        });
        await slot.loading;
        slot.loading = undefined;
      }
    } finally {
      this.loadingNow = false;
    }
  }

  private async load(slot: Slot): Promise<void> {
    const { assets } = this.host;
    const preset = this.presets[slot.preset]!;
    const equipment = npcEquipment(preset);
    const roster = { playerId: slot.playerId, name: "", slot: slot.index % 8, team: null };
    const participant = await assets.loadRosterEntry(roster, { equipment, initial: "", favoriteTracks: [], favoriteItems: [] });
    // The loader lists every kart it builds; a slot joins the list only while it drives.
    this.unlist(participant);
    if (this.disposed || !this.slots.includes(slot)) {
      participant.dispose?.();
      return;
    }
    const deps = racePresenterInitializationDependencies as any;
    const presenter = this.host.presenter;
    const vehicle = participant.vehicle;
    const view = deps.createRacerView(presenter.scene);
    view.setModel(vehicle.imported.object, vehicle.visual, vehicle.imported.animation,
      vehicle.imported.model, vehicle.imported.scene);
    mountRacer(presenter, slot.playerId, participant, view);
    presenter.scene.remove(view.root);
    slot.participant = participant;
    slot.view = view;
    if (slot.car) this.attach(slot);
  }

  private unlist(participant: unknown): void {
    const list = this.host.assets.participants as unknown[];
    const index = list.indexOf(participant);
    if (index >= 0) list.splice(index, 1);
  }

  /** Puts a slot's kart in the race scene and the presenter's lists. */
  private attach(slot: Slot): void {
    if (slot.attached || !slot.participant) return;
    const presenter = this.host.presenter;
    presenter.views.set(slot.playerId, slot.view);
    presenter.scene.add(slot.view.root);
    presenter.scene.add(slot.participant.vehicle.trails.object);
    (this.host.assets.participants as unknown[]).push(slot.participant);
    slot.attached = true;
  }

  private detach(slot: Slot): void {
    if (!slot.attached) return;
    const presenter = this.host.presenter;
    presenter.views.delete(slot.playerId);
    presenter.linkedPresentations?.delete?.(slot.playerId);
    presenter.scene.remove(slot.view.root);
    presenter.scene.remove(slot.participant.vehicle.trails.object);
    this.unlist(slot.participant);
    slot.attached = false;
  }

  private release(car: Car): void {
    const slot = car.slot;
    car.slot = undefined;
    if (!slot) return;
    slot.car = undefined;
    this.detach(slot);
  }

  private disposeSlot(slot: Slot): void {
    if (slot.car) this.release(slot.car);
    this.detach(slot);
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    try { slot.participant?.dispose?.(); } catch (error) { this.host.onError(error); }
    slot.participant = undefined;
    slot.view = undefined;
  }

  // ---- poses ----

  /** The car's pose this frame (world coordinates), undefined before its first packet. */
  private poseOf(car: Car): WebPose | undefined {
    if (car.frame === this.frameNumber && car.pose) return car.pose;
    const snapshots = car.snapshots;
    if (!snapshots.length) return undefined;
    const tick = this.host.serverNow() - REPLAY_DELAY_MS;
    let index = snapshots.length - 1;
    while (index > 0 && snapshots[index]!.tick > tick) index--;
    const a = snapshots[index]!, b = snapshots[index + 1];
    const paths = this.host.network.paths;
    let path: TrafficPath, distance: number, lateral: number, speed: number, flags: number;
    const along = b ? this.route(a, b) : undefined;
    if (b && along) {
      const f = Math.max(0, Math.min(1, (tick - a.tick) / Math.max(1, b.tick - a.tick)));
      const total = along.reduce((sum, part) => sum + part.to - part.from, 0);
      let left = total * f;
      let part = along[along.length - 1]!;
      for (const candidate of along) {
        if (left <= candidate.to - candidate.from) { part = candidate; break; }
        left -= candidate.to - candidate.from;
      }
      path = paths[part.path]!;
      distance = Math.min(part.to, part.from + left);
      lateral = a.lateral + (b.lateral - a.lateral) * f;
      speed = a.v + (b.v - a.v) * f;
      flags = f < 0.5 ? a.flags : b.flags;
    } else {
      // Past the newest packet: drive on a little at its speed, never off its path.
      const last = b ?? a;
      path = paths[last.path]!;
      const ahead = Math.max(0, Math.min(600, tick - last.tick)) / 1000;
      distance = Math.min(path.length, last.s + last.v * ahead);
      lateral = last.lateral;
      speed = last.v;
      flags = last.flags;
    }
    const point = pointAt(path, distance, lateral, this.scratch);
    const ground = this.groundAt(path, distance) ?? point.y;
    const back = this.groundAt(path, Math.max(0, distance - 1.2)) ?? ground;
    const front = this.groundAt(path, Math.min(path.length, distance + 1.2)) ?? ground;
    const span = Math.min(distance, 1.2) + Math.min(path.length - distance, 1.2);
    const rise = span > 0.1 ? (front - back) / span : 0;
    const world = designToWorld(point.x, ground + NPC_BODY_LIFT, point.z);
    // Forward with the slope; "right" level and, like the physics body's,
    // to the west of a kart facing north (the engine's handedness); up
    // completes the frame (forward × right).
    const fl = Math.hypot(point.dx, rise, point.dz);
    const forward = { x: point.dx / fl, y: rise / fl, z: point.dz / fl };
    const rl = Math.hypot(forward.z, forward.x) || 1;
    const right = { x: forward.z / rl, y: 0, z: -forward.x / rl };
    const up = {
      x: forward.y * right.z - forward.z * right.y,
      y: forward.z * right.x - forward.x * right.z,
      z: forward.x * right.y - forward.y * right.x,
    };
    car.pose = { position: world, right, up, forward, visualScale: cityVisualScale() };
    car.frame = this.frameNumber;
    car.speed = speed;
    car.brake = (flags & CAR_BRAKE) !== 0;
    car.steer = this.steerAt(path, distance);
    return car.pose;
  }

  /** How sharply the path turns just ahead (−1 left … 1 right) for the rider and front wheels. */
  private steerAt(path: TrafficPath, distance: number): number {
    const here = pointAt(path, distance, 0, { x: 0, z: 0, y: 0, dx: 0, dz: 1 });
    const ahead = pointAt(path, Math.min(path.length, distance + 3), 0, { x: 0, z: 0, y: 0, dx: 0, dz: 1 });
    const turn = Math.atan2(here.dx * ahead.dz - here.dz * ahead.dx, here.dx * ahead.dx + here.dz * ahead.dz);
    return Math.max(-1, Math.min(1, turn * 3));
  }

  /** The road height under a path (design y), sampled once per GROUND_STEP and kept. */
  private groundAt(path: TrafficPath, distance: number): number | undefined {
    let samples = this.ground.get(path.index);
    if (!samples) {
      samples = new Float32Array(Math.ceil(path.length / GROUND_STEP) + 1).fill(NaN);
      this.ground.set(path.index, samples);
    }
    const at = distance / GROUND_STEP;
    const i = Math.max(0, Math.min(samples.length - 1, Math.floor(at)));
    const j = Math.min(samples.length - 1, i + 1);
    const h0 = this.sample(path, samples, i), h1 = this.sample(path, samples, j);
    if (h0 === undefined || h1 === undefined) return h0 ?? h1;
    return h0 + (h1 - h0) * Math.max(0, Math.min(1, at - i));
  }

  private sample(path: TrafficPath, samples: Float32Array, i: number): number | undefined {
    let value = samples[i]!;
    if (Number.isNaN(value)) {
      const point = pointAt(path, Math.min(path.length, i * GROUND_STEP), 0, { x: 0, z: 0, y: 0, dx: 0, dz: 1 });
      const world = designToWorld(point.x, point.y, point.z);
      value = groundHeightAt(this.host.track, world.x, world.z, point.y) ?? Infinity;
      samples[i] = value;
    }
    return Number.isFinite(value) ? value : undefined;
  }

  // ---- the RemoteFleet surface for "npc:" ids ----

  private carOf(playerId: string): Car | undefined {
    const slot = this.slots.find(s => s.playerId === playerId);
    return slot?.car;
  }

  copyWebPose(playerId: string): WebPose | undefined {
    const car = this.carOf(playerId);
    return car ? this.poseOf(car) : undefined;
  }

  presentationVisible(playerId: string): boolean {
    return this.copyWebPose(playerId) !== undefined;
  }

  consumePresentation(playerId: string) {
    const car = this.carOf(playerId);
    if (!car || !this.poseOf(car)) return undefined;
    // Like a member's kart: forward speed in m/s, the display speed in km/h.
    const speed = car.speed;
    return {
      frontLamp: false,
      rearLamp: car.brake,
      animation: { physicsState: 0, displaySpeedKmh: car.speed * 3.6, dualMode: 0, dualBoosterState: 0,
        dualReadyRemainingMs: 0, dualTeam: 0, chargerActive: false },
      motion: {
        forwardSpeed: speed, rawSteer: car.steer, tireTransient: 0, boosterState: 0,
        instantAccelerationActive: false, motorcycle: 0, visualScaleMode: 0, collisionStrength: 0,
        landingTrigger: false, collisionHit: false,
      },
    };
  }

  /** Drawn cars that honked within `withinMs`: who drives them and where they are. */
  honking(now: number, withinMs: number): Array<{ id: number; driver: string; honks: number; position: Vec3 }> {
    const out = [];
    for (const slot of this.slots) {
      const car = slot.car;
      if (!car || !slot.attached || now - car.honkAt > withinMs) continue;
      const pose = this.poseOf(car);
      if (pose) out.push({ id: car.id, driver: this.presets[slot.preset]!.driver, honks: car.honks, position: pose.position });
    }
    return out;
  }

  /** NPC karts are not racers: no minimap marker, no rank. */
  hasDeparted(): boolean { return true; }

  /** World positions of the drawn NPC karts (tests and debugging). */
  drawn(): Array<{ id: number; playerId: string; position: Vec3 }> {
    const out: Array<{ id: number; playerId: string; position: Vec3 }> = [];
    for (const slot of this.slots) {
      if (!slot.car || !slot.attached) continue;
      const pose = this.poseOf(slot.car);
      if (pose) out.push({ id: slot.car.id, playerId: slot.playerId, position: pose.position });
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of [...this.slots]) this.disposeSlot(slot);
    this.cars.clear();
    this.loadQueue.length = 0;
  }
}

/** Members' ids go to the fleet, "npc:" ids to the traffic. */
const PER_RACER = new Set(["copyWebPose", "presentationVisible", "consumePresentation", "hasDeparted", "giant"]);

/**
 * runtime.remotes for the city: the member fleet, with the per-racer
 * questions about NPC karts answered by the traffic.
 */
export function withTraffic<T extends object>(fleet: T, traffic: () => CityTraffic | undefined): T {
  return new Proxy(fleet, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (typeof property === "string" && PER_RACER.has(property)) {
        return (id: unknown, ...rest: unknown[]) => {
          if (isNpcId(id)) {
            const t = traffic();
            if (!t) return property === "hasDeparted" ? true : undefined;
            if (property === "giant") return undefined;
            return (t as any)[property](id, ...rest);
          }
          return value.call(target, id, ...rest);
        };
      }
      return value.bind(target);
    },
  });
}
