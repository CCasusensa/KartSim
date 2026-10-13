/**
 * 下车步行 in the city session (server-go/CITY.md 7). The local rider sits in
 * its kart's driver's seat, someone's back seat, or walks:
 *
 * - E: out of the kart (it stays parked where it stopped), or into the kart
 *   within reach: an empty one is driven (the local kart turns into it,
 *   with this rider at the wheel), one someone drives takes us on its back
 *   seat. L locks or unlocks the own kart; R on foot steps to the nearest
 *   road.
 * - On foot: WASD / arrows walk (Shift runs), a follow camera replaces the
 *   race camera, the race sender's kart frames stop and the walker's pose
 *   goes out instead; the local kart shows parked without its rider.
 * - Everyone else: members on foot walk as their characters, passengers sit
 *   on their driver's kart, karts someone else drives show the owner's kart
 *   with the driver's rider, parked karts stand without riders.
 */
import { Group, Vector3 } from "three";
import { racePresenterInitializationDependencies } from "../generated/world.js";
import { captureOutgoingMotion } from "../multiplayer/outgoing-race-motion";
import { CITY_MAP } from "./city-track";
import { designToWorld, nearestRoadPoint, worldToDesign } from "./city-coordinates";
import { groundHeightAt } from "./city-ground";
import { cityWaterLevel, type CityWaterMap } from "./city-water";
import {
  drivenEquipment, enterChoice, exitPose, headingOfYaw, stepFoot, yawOfHeading,
  type FootInput, type FootState, type FootWorld,
} from "./city-foot-motion";
import { CityWalker, type CityWalkerHost } from "./city-walker";
import { discardLocalKart, installLocalKart, loadLocalFlyingPet, loadLocalKart } from "./city-local-kart";
import { mountRacer } from "./city-racer-mount";
import { CITY_VEHICLE_SCALE } from "./city-vehicle-scale";
import type { CityFuel, CityMember, CityPose, CitySeat, CitySeatReply, CityVehicle } from "./city-protocol";
import { loadCityMinimap, showCityMapWindow, type CityMapMarkers, type CityMapWindow } from "./city-map-window";

export interface CityOnFootNetwork {
  exit(pose?: CityPose): Promise<CitySeatReply>;
  enter(vehicle: number): Promise<CitySeatReply>;
  lock(locked: boolean): Promise<CityVehicle>;
  respawn(pose: CityPose): Promise<unknown>;
  sendMotion(sample: unknown): boolean;
}

export interface CityOnFootFleet {
  peers: Map<string, { playerId: string; member: CityMember; participant?: any }>;
  byId: Map<number, { playerId: string; member: CityMember; participant?: any }>;
  hidden: Set<string>;
  reequip(id: number, equipment: unknown): void;
  copyWebPose(playerId: string): { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } } | undefined;
}

export interface CityOnFootHost {
  library: unknown;
  playerId: string;
  name: string;
  stage(): any;
  network(): CityOnFootNetwork | undefined;
  fleet(): CityOnFootFleet | undefined;
  /** The member's own equipment (its kart and rider). */
  equipment(): unknown;
  notice(text: string): void;
  /** session.teleportLocal: the local kart to a design pose, telling the node or not. */
  teleport(pose: CityPose, notify: boolean): void;
  /** The local kart's design pose. */
  kartPose(): CityPose | undefined;
  /** A tank from a seat reply (the kart we now drive) or none (not driving). */
  setFuel(fuel: CityFuel | undefined): void;
  /** Whether the race keys drive the kart (false while walking or riding). */
  setDriving(driving: boolean): void;
  /** The race view's size (CSS pixels). */
  viewport(): { width: number; height: number };
  /** Where windows open. */
  root: HTMLElement;
}

/** Below this speed (km/h) the driver may get out. */
export const EXIT_SPEED_KMH = 12;
/**
 * The back seat in the kart's rider mount space (+y points to the kart's
 * tail, -x to its right, +z up; 0.5 m per unit in the city): behind the
 * driver and a little to the right, so the chase camera shows both.
 */
const PASSENGER_OFFSET = { right: 0.34, back: 0.5, up: 0.14 };
/** Follow camera behind a walker, and behind the kart we ride (m, half-size riders). */
const CAMERA = { distance: 2.4, height: 1.25, aim: 0.55, fov: 62 };
const RIDE_CAMERA = { distance: 3.4, height: 1.7, aim: 0.5 };
const MOTION_MS = 64;

function participantOf(stage: any, playerId: string): any {
  return (stage?.runtime?.assets?.participants as any[] | undefined)?.find(entry => entry.playerId === playerId);
}

function characterOf(participant: any): any {
  return participant?.characters?.linked ?? participant?.characters?.ordinary;
}

/** The kart's rider mount (where mountRacer puts the rider). */
export function riderMountOf(participant: any): any {
  const deps = racePresenterInitializationDependencies as any;
  const vehicle = participant?.vehicle;
  if (!vehicle?.imported?.model) return undefined;
  const sourceRoot = deps.serializedRoot(vehicle.imported.model);
  const riderSource = sourceRoot.children[6]?.value;
  return riderSource ? vehicle.imported.renderScene?.bySource.get(riderSource) : undefined;
}

interface Display {
  vehicle: CityVehicle;
  participant?: any;
  view?: any;
  generation: number;
}

interface Riding {
  /** The rider's character object, moved onto the driver's kart. */
  character: any;
  holder: Group;
  home?: any;
}

export class CityOnFoot {
  seat: CitySeat = "driver";
  readonly vehicles = new Map<number, CityVehicle>();
  readonly members = new Map<number, CityMember>();
  myId = 0;
  /** The vehicle the local kart model and physics stand for. */
  localKartVehicle = 0;
  busy = false;
  disposed = false;

  private walker?: CityWalker;
  private foot?: FootState;
  private footMoving = false;
  private readonly keys = new Set<string>();
  private lastFrameAt?: number;
  private lastMotionAt = 0;
  private cameraYaw?: number;
  private readonly remoteWalkers = new Map<string, CityWalker>();
  private readonly displays = new Map<number, Display>();
  private readonly riding = new Map<string, Riding>();
  private unhook: Array<() => void> = [];
  private map?: CityMapWindow;
  private mapOpening = false;
  private mapClosedAt = -Infinity;
  private minimap?: Promise<CanvasImageSource | undefined>;

  constructor(readonly host: CityOnFootHost) {}

  // ---- state from the node ----

  /** The snapshot's seats and karts. */
  install(myId: number, members: readonly CityMember[], vehicles: readonly CityVehicle[], seat: CitySeat = "driver"): void {
    this.myId = myId;
    this.localKartVehicle = myId;
    for (const member of members) this.members.set(member.id, member);
    for (const vehicle of vehicles) this.vehicles.set(vehicle.id, vehicle);
    this.seat = seat;
    this.hookStage();
    for (const member of members) this.applyMemberSeat(member);
  }

  memberJoined(member: CityMember, vehicle?: CityVehicle): void {
    this.members.set(member.id, member);
    if (vehicle) this.vehicles.set(vehicle.id, vehicle);
  }

  memberLeft(id: number, playerId: string): void {
    this.members.delete(id);
    this.unride(playerId);
    this.remoteWalkers.get(playerId)?.dispose();
    this.remoteWalkers.delete(playerId);
    this.host.fleet()?.hidden.delete(playerId);
  }

  /** A member's garage change: its own equipment (its kart is its vehicle's too). */
  equipmentChanged(id: number, equipment: unknown): void {
    const member = this.members.get(id);
    if (member) member.equipment = equipment;
    const vehicle = this.vehicles.get(id);
    if (vehicle) vehicle.equipment = equipment;
  }

  vehicleChanged(vehicle: CityVehicle): void {
    const before = this.vehicles.get(vehicle.id);
    this.vehicles.set(vehicle.id, vehicle);
    // The local kart came to rest somewhere else (someone drove it): stand it there.
    if (vehicle.id === this.localKartVehicle && vehicle.driver === 0 && this.seat !== "driver" &&
        before && before.driver !== 0 && before.driver !== this.myId)
      this.host.teleport(vehicle.pose, false);
  }

  vehicleGone(id: number): void {
    this.vehicles.delete(id);
    this.dropDisplay(id);
  }

  /** city-seat: someone (maybe us, when it was not asked for) sits elsewhere. */
  seatChanged(event: { id: number; playerId: string; seat: CitySeat; vehicle: number; pose?: CityPose; reason?: string }): void {
    const member = this.members.get(event.id);
    if (member) {
      member.seat = event.seat;
      member.vehicle = event.vehicle;
      if (event.pose) member.pose = event.pose;
    }
    if (event.id === this.myId) {
      // Our own requests are handled with their replies; only forced changes land here.
      if (!event.reason || event.seat !== "foot" || !event.pose) return;
      this.host.notice(event.reason === "recalled" ? "车主收回了这辆车，你下车了。" : "司机下车了，你也下了车。");
      void this.becomeFoot(event.pose);
      return;
    }
    if (member) this.applyMemberSeat(member);
  }

  /** How another member is drawn for its seat. */
  private applyMemberSeat(member: CityMember): void {
    if (member.id === this.myId) return;
    const fleet = this.host.fleet();
    if (!fleet) return;
    const seat = member.seat ?? "driver";
    if (seat === "driver") {
      fleet.hidden.delete(member.playerId);
      this.unride(member.playerId);
      const vehicle = this.vehicles.get(member.vehicle ?? member.id);
      const own = !vehicle || vehicle.owner === member.id;
      const equipment = own ? member.equipment : drivenEquipment(vehicle!.equipment, member.equipment);
      const peer = fleet.byId.get(member.id);
      if (peer && JSON.stringify(peer.member.equipment) !== JSON.stringify(equipment)) fleet.reequip(member.id, equipment);
    } else {
      fleet.hidden.add(member.playerId);
    }
  }

  // ---- keys ----

  /** Window keydown; true when the key was ours. */
  keydown(event: KeyboardEvent): boolean {
    if (this.disposed) return false;
    const code = event.code;
    if (this.seat === "foot" && /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(code)) {
      this.keys.add(code);
      event.preventDefault();
      return true;
    }
    if (event.repeat) return false;
    if (code === "KeyE") { event.preventDefault(); void this.pressE(); return true; }
    if (code === "KeyL") { event.preventDefault(); void this.toggleLock(); return true; }
    if (code === "KeyM") { event.preventDefault(); void this.toggleMap(); return true; }
    if (code === "KeyR" && this.seat === "foot") { event.preventDefault(); this.stepToRoad(); return true; }
    return false;
  }

  keyup(event: KeyboardEvent): void { this.keys.delete(event.code); }
  blur(): void { this.keys.clear(); }

  private input(): FootInput {
    const held = (...codes: string[]) => codes.some(code => this.keys.has(code));
    return {
      forward: (held("KeyW", "ArrowUp") ? 1 : 0) - (held("KeyS", "ArrowDown") ? 1 : 0),
      turn: (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0),
      run: held("ShiftLeft", "ShiftRight"),
    };
  }

  // ---- E, L, R ----

  async pressE(): Promise<void> {
    const network = this.host.network();
    if (this.busy || !network) return;
    if (this.seat === "foot") {
      const foot = this.footDesign();
      if (!foot) return;
      const choice = enterChoice(this.liveVehicles(), foot.x, foot.z, this.myId);
      if (choice.kind === "none") { this.host.notice("附近没有可以上的车。"); return; }
      if (choice.kind === "locked") { this.host.notice(`${choice.vehicle.ownerName}的车上锁了。`); return; }
      if (choice.kind === "full") { this.host.notice("这辆车坐满了。"); return; }
      this.busy = true;
      try {
        const reply = await network.enter(choice.vehicle.id);
        if (this.disposed) return;
        if (reply.vehicle) this.vehicles.set(reply.vehicle.id, reply.vehicle);
        const vehicle = reply.vehicle ?? choice.vehicle;
        if (reply.seat === "driver") await this.becomeDriver(vehicle, reply.fuel);
        else if (reply.seat === "passenger") this.becomePassenger(vehicle);
      } catch (error) {
        this.host.notice(seatErrorText(error));
      } finally {
        this.busy = false;
      }
      return;
    }
    if (this.seat === "driver") {
      const velocity = this.host.stage()?.runtime?.local?.physics?.body?.linearVelocity;
      if (velocity && Math.hypot(velocity.x, velocity.y, velocity.z) * 3.6 > EXIT_SPEED_KMH) {
        this.host.notice("请先停车再下车。");
        return;
      }
    }
    const kart = this.host.kartPose();
    let pose: CityPose | undefined;
    if (this.seat === "driver" && kart) {
      pose = exitPose(kart);
      const ground = this.groundAt(pose.x, pose.z, kart.y);
      if (ground !== undefined) pose = { ...pose, y: ground };
    }
    this.busy = true;
    try {
      const reply = await network.exit(pose);
      if (this.disposed) return;
      if (reply.vehicle) this.vehicles.set(reply.vehicle.id, reply.vehicle);
      await this.becomeFoot(reply.pose ?? pose ?? kart ?? { x: 0, y: 0, z: 0, heading: 0 });
    } catch (error) {
      this.host.notice(seatErrorText(error));
    } finally {
      this.busy = false;
    }
  }

  /** The karts where they are now: a driven one moves with its driver (its node pose follows the frames). */
  liveVehicles(): CityVehicle[] {
    const fleet = this.host.fleet();
    return [...this.vehicles.values()].map(vehicle => {
      if (vehicle.driver === 0 || vehicle.driver === this.myId) return vehicle;
      const driver = this.members.get(vehicle.driver);
      const pose = driver ? fleet?.copyWebPose(driver.playerId) : undefined;
      if (!pose) return vehicle;
      const at = worldToDesign(pose.position.x, pose.position.y, pose.position.z);
      return { ...vehicle, pose: { ...at, heading: headingOfYaw(Math.atan2(pose.forward.x, pose.forward.z)) } };
    });
  }

  async toggleLock(): Promise<void> {
    const network = this.host.network();
    const own = this.vehicles.get(this.myId);
    if (this.busy || !network || !own) return;
    this.busy = true;
    try {
      const vehicle = await network.lock(!own.locked);
      this.vehicles.set(vehicle.id, vehicle);
      this.host.notice(vehicle.locked ? "你的车已上锁，别人开不走也坐不上。" : "你的车已解锁，谁都可以开走或搭车。");
    } catch (error) {
      this.host.notice(seatErrorText(error));
    } finally {
      this.busy = false;
    }
  }

  get mapOpen(): boolean { return !!this.map || this.mapOpening; }

  /** True while an Esc should close the map, not count towards leaving the city. */
  consumesEscape(now: number): boolean { return !!this.map || this.mapOpening || now - this.mapClosedAt < 400; }

  async toggleMap(): Promise<void> {
    if (this.map) { this.closeMap(); return; }
    if (this.mapOpening) return;
    this.mapOpening = true;
    try {
      this.minimap ??= loadCityMinimap(this.host.library).catch(error => { console.warn("城市地图图片未能载入", error); return undefined; });
      const image = await this.minimap;
      if (this.disposed) return;
      this.map = await showCityMapWindow({ library: this.host.library as never, root: this.host.root }, image,
        () => this.mapMarkers(), () => this.closeMap());
      if (this.disposed) this.closeMap();
    } catch (error) {
      console.warn("城市地图打开失败", error);
      this.host.notice("地图打开失败。");
    } finally {
      this.mapOpening = false;
    }
  }

  private closeMap(): void {
    this.map?.dispose();
    this.map = undefined;
    this.mapClosedAt = performance.now();
  }

  /** Where the rider, its kart and the others are (design x/z). */
  mapMarkers(): CityMapMarkers {
    const fleet = this.host.fleet();
    const design = (world: { x: number; y: number; z: number } | undefined) => world ? worldToDesign(world.x, world.y, world.z) : undefined;
    let me: CityMapMarkers["me"];
    if (this.seat === "foot") me = this.footDesign();
    else if (this.seat === "driver") me = this.host.kartPose();
    else {
      const vehicle = [...this.vehicles.values()].find(entry => entry.passenger === this.myId);
      const driver = vehicle ? this.members.get(vehicle.driver) : undefined;
      const pose = driver ? fleet?.copyWebPose(driver.playerId) : undefined;
      const at = design(pose?.position);
      if (at && pose) me = { x: at.x, z: at.z, heading: headingOfYaw(Math.atan2(pose.forward.x, pose.forward.z)) };
    }
    const own = this.vehicles.get(this.myId);
    let kart: CityMapMarkers["kart"];
    if (own) {
      const driver = own.driver ? this.members.get(own.driver) : undefined;
      const driven = own.driver !== 0 && own.driver !== this.myId;
      const at = driven && driver ? design(fleet?.copyWebPose(driver.playerId)?.position) : own.driver === this.myId ? me : own.pose;
      if (at) kart = { x: at.x, z: at.z, locked: own.locked, driven };
    }
    const others: CityMapMarkers["others"] = [];
    for (const member of this.members.values()) {
      if (member.id === this.myId || !fleet) continue;
      const at = design(fleet.copyWebPose(member.playerId)?.position);
      if (at) others.push({ x: at.x, z: at.z });
    }
    return { me: me && { x: me.x, z: me.z, heading: me.heading }, kart, others };
  }

  private stepToRoad(): void {
    const foot = this.footDesign();
    if (!foot || !this.foot) return;
    const road = nearestRoadPoint(foot.x, foot.z);
    const heading = ((Math.atan2(road.tx, -road.tz) * 180) / Math.PI + 360) % 360;
    this.placeFoot({ x: road.x, y: road.y, z: road.z, heading });
    void this.host.network()?.respawn({ x: road.x, y: this.foot.y, z: road.z, heading }).catch(() => undefined);
  }

  // ---- seats ----

  private ensureWalker(): CityWalker | undefined {
    if (this.walker) return this.walker;
    const host = this.walkerHost();
    if (!host) return undefined;
    this.walker = new CityWalker(host, this.host.equipment(), "local");
    this.walker.ready.catch(error => console.warn("步行人物加载失败", error));
    return this.walker;
  }

  private walkerHost(): CityWalkerHost | undefined {
    const stage = this.host.stage();
    const map = stage?.runtime?.assets?.map;
    if (!stage || !map) return undefined;
    return { library: this.host.library, scene: stage.scene.scene, environment: map.environment, stageBinding: map.stageBinding };
  }

  private placeFoot(pose: CityPose): void {
    const world = designToWorld(pose.x, pose.y, pose.z);
    const ground = this.groundAt(pose.x, pose.z, pose.y);
    this.foot = { x: world.x, y: ground ?? world.y, z: world.z, yaw: yawOfHeading(pose.heading) };
    this.cameraYaw = this.foot.yaw;
  }

  /** On foot at a design pose: the kart stays parked, the walker takes over. */
  async becomeFoot(pose: CityPose): Promise<void> {
    const wasPassenger = this.seat === "passenger";
    this.seat = "foot";
    this.host.setDriving(false);
    this.host.setFuel(undefined);
    const physics = this.host.stage()?.runtime?.local?.physics;
    physics?.hardCancelControls?.();
    physics?.setRaceMotionLocked?.(true);
    if (wasPassenger) this.unride(this.host.playerId);
    this.setLocalRiderVisible(false);
    this.placeFoot(pose);
    this.ensureWalker();
  }

  /** At the wheel of a kart: the local kart becomes it (with our rider). */
  async becomeDriver(vehicle: CityVehicle, fuel?: CityFuel): Promise<void> {
    const stage = this.host.stage();
    if (!stage) return;
    if (this.seat === "passenger") this.unride(this.host.playerId);
    if (vehicle.id !== this.localKartVehicle) {
      const equipment = vehicle.owner === this.myId ? this.host.equipment()
        : drivenEquipment(vehicle.equipment, this.host.equipment());
      this.host.notice(vehicle.owner === this.myId ? "坐回了你的车。" : `上了${vehicle.ownerName}的车。`);
      let loaded: any;
      try {
        loaded = await loadLocalKart(stage, this.host.playerId, this.host.name, equipment);
        if (this.disposed || this.host.stage() !== stage) return;
        installLocalKart(stage, this.host.playerId, loaded);
        loaded = undefined;
        this.localKartVehicle = vehicle.id;
        void loadLocalFlyingPet(stage, this.host.library).catch(error => console.warn("飞宠载入失败", error));
      } finally {
        if (loaded) discardLocalKart(loaded);
      }
    }
    this.seat = "driver";
    this.host.teleport(vehicle.pose, false);
    const physics = stage.runtime?.local?.physics;
    physics?.setRaceMotionLocked?.(false);
    this.setLocalRiderVisible(true);
    this.host.setDriving(true);
    this.host.setFuel(fuel);
    this.walker && (this.walker.root.visible = false);
  }

  /** On someone's back seat: our rider sits on its kart; the camera follows it. */
  becomePassenger(vehicle: CityVehicle): void {
    this.seat = "passenger";
    this.host.setDriving(false);
    this.host.setFuel(undefined);
    this.walker && (this.walker.root.visible = false);
    this.setLocalRiderVisible(false);
    const driver = this.members.get(vehicle.driver);
    if (driver) this.ride(this.host.playerId, participantOf(this.host.stage(), this.host.playerId), driver.playerId);
    this.host.notice(`坐上了${driver?.name ?? "别人"}的车后座，按 E 下车。`);
  }

  private setLocalRiderVisible(visible: boolean): void {
    const character = characterOf(participantOf(this.host.stage(), this.host.playerId));
    if (character?.scene?.object && !this.riding.has(this.host.playerId)) character.scene.object.visible = visible;
  }

  // ---- back seats ----

  private mountOf(driverPlayerId: string | undefined): any {
    if (!driverPlayerId) return undefined;
    const participant = driverPlayerId === this.host.playerId ? participantOf(this.host.stage(), driverPlayerId)
      : this.host.fleet()?.peers.get(driverPlayerId)?.participant;
    return riderMountOf(participant);
  }

  /** Seats a rider (its participant's character) behind the driver of driverPlayerId. */
  private ride(riderPlayerId: string, riderParticipant: any, driverPlayerId: string): void {
    this.unride(riderPlayerId);
    const stage = this.host.stage();
    const driverParticipant = driverPlayerId === this.host.playerId ? participantOf(stage, driverPlayerId)
      : this.host.fleet()?.peers.get(driverPlayerId)?.participant;
    const mount = riderMountOf(driverParticipant);
    const character = characterOf(riderParticipant)?.scene?.object;
    if (!mount || !character) return;
    const holder = new Group();
    holder.name = `city-passenger-${riderPlayerId}`;
    holder.position.set(-PASSENGER_OFFSET.right, PASSENGER_OFFSET.back, PASSENGER_OFFSET.up);
    const home = character.parent;
    mount.add(holder);
    holder.add(character);
    character.visible = true;
    this.riding.set(riderPlayerId, { character, holder, home });
  }

  private unride(riderPlayerId: string): void {
    const riding = this.riding.get(riderPlayerId);
    if (!riding) return;
    this.riding.delete(riderPlayerId);
    riding.holder.removeFromParent();
    if (riding.home) riding.home.add(riding.character);
    else riding.character.removeFromParent();
  }

  // ---- per frame ----

  /** Before the presenter draws (stage.update wrapper). */
  frame(now: number, camera: any, width: number, height: number): void {
    if (this.disposed) return;
    this.hideTachometer();
    const dt = this.lastFrameAt === undefined ? 0 : Math.min(0.1, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    if (this.seat === "foot" && this.foot && this.walker) {
      const step = stepFoot(this.foot, this.input(), dt, this.world());
      this.foot = step.state;
      this.footMoving = step.moving;
      this.walker.moving = step.moving;
      this.walker.running = step.running;
      this.walker.place(this.foot.x, this.foot.y, this.foot.z, this.foot.yaw);
      this.walker.update(now, camera, width, height, true);
      if (now - this.lastMotionAt >= MOTION_MS) {
        this.lastMotionAt = now;
        this.sendFoot(now, step.speed);
      }
    }
    this.updateRemoteWalkers(now, camera, width, height);
    this.updateRiders();
    this.updateDisplays();
  }

  /** The walker's frame for the node and the members around (a kinematic sample). */
  private sendFoot(now: number, speed: number): void {
    const stage = this.host.stage();
    const sender = stage?.runtime?.sender;
    const foot = this.foot;
    if (!sender?.clock || !sender.bodyQuaternion || !foot) return;
    const forward = { x: Math.sin(foot.yaw), y: 0, z: Math.cos(foot.yaw) };
    const up = { x: 0, y: 1, z: 0 };
    const right = { x: forward.z * up.y - forward.y * up.z, y: forward.x * up.z - forward.z * up.x, z: forward.y * up.x - forward.x * up.y };
    // forward × up as the kart's body has it.
    const body = {
      position: { x: foot.x, y: foot.y, z: foot.z }, forward, up,
      right: { x: -right.x, y: -right.y, z: -right.z },
      linearVelocity: { x: forward.x * speed, y: 0, z: forward.z * speed }, angularVelocity: { x: 0, y: 0, z: 0 },
    };
    try {
      const sample = captureOutgoingMotion({ networkMotionMode: 0, body, copyNetworkWrench() {} } as never,
        sender.clock.encode(now), false, sender.bodyQuaternion);
      this.host.network()?.sendMotion(sample);
    } catch (error) {
      console.warn("步行运动帧发送失败", error);
    }
  }

  private updateRemoteWalkers(now: number, camera: any, width: number, height: number): void {
    const fleet = this.host.fleet();
    if (!fleet) return;
    for (const member of this.members.values()) {
      if (member.id === this.myId) continue;
      let walker = this.remoteWalkers.get(member.playerId);
      if ((member.seat ?? "driver") !== "foot") {
        if (walker) walker.root.visible = false;
        continue;
      }
      if (!walker) {
        const host = this.walkerHost();
        if (!host) continue;
        walker = new CityWalker(host, member.equipment, member.playerId);
        walker.ready.catch(error => console.warn("成员步行人物加载失败", member.name, error));
        this.remoteWalkers.set(member.playerId, walker);
      }
      const pose = fleet.copyWebPose(member.playerId);
      if (pose) {
        const yaw = Math.atan2(pose.forward.x, pose.forward.z);
        const last = walker.root.position.clone();
        walker.place(pose.position.x, pose.position.y, pose.position.z, yaw);
        const moved = last.distanceTo(walker.root.position);
        walker.moving = moved > 0.002;
        walker.running = moved > 0.03;
      } else if (member.pose) {
        const world = designToWorld(member.pose.x, member.pose.y, member.pose.z);
        walker.place(world.x, world.y, world.z, yawOfHeading(member.pose.heading));
      }
      walker.update(now, camera, width, height, true);
    }
  }

  /** Back seats follow the seats the node reports. */
  private updateRiders(): void {
    const fleet = this.host.fleet();
    if (!fleet) return;
    for (const member of this.members.values()) {
      if (member.id === this.myId) continue;
      const seat = member.seat ?? "driver";
      if (seat !== "passenger") { if (this.riding.has(member.playerId)) this.unride(member.playerId); continue; }
      const vehicle = this.vehicles.get(member.vehicle ?? 0);
      const driver = vehicle ? (vehicle.driver === this.myId ? this.host.playerId : this.members.get(vehicle.driver)?.playerId) : undefined;
      const riding = this.riding.get(member.playerId);
      // A driver's kart that reloaded (a garage change) takes the rider again.
      if (riding && riding.holder.parent && riding.holder.parent === this.mountOf(driver)) continue;
      const participant = fleet.peers.get(member.playerId)?.participant;
      if (driver && participant) this.ride(member.playerId, participant, driver);
    }
  }

  // ---- parked karts ----

  private updateDisplays(): void {
    for (const vehicle of this.vehicles.values()) {
      const parked = vehicle.driver === 0 && vehicle.id !== this.localKartVehicle;
      const display = this.displays.get(vehicle.id);
      if (!parked) { if (display) this.dropDisplay(vehicle.id); continue; }
      if (!display || JSON.stringify(display.vehicle.equipment) !== JSON.stringify(vehicle.equipment)) {
        if (display) this.dropDisplay(vehicle.id);
        void this.loadDisplay(vehicle);
      } else if (JSON.stringify(display.vehicle.pose) !== JSON.stringify(vehicle.pose)) {
        display.vehicle = vehicle;
        this.poseDisplay(display);
      }
    }
    for (const id of [...this.displays.keys()]) if (!this.vehicles.has(id)) this.dropDisplay(id);
  }

  private async loadDisplay(vehicle: CityVehicle): Promise<void> {
    const stage = this.host.stage();
    const assets = stage?.runtime?.assets;
    if (!assets?.loadRosterEntry) return;
    const display: Display = { vehicle, generation: (this.displays.get(vehicle.id)?.generation ?? 0) + 1 };
    this.displays.set(vehicle.id, display);
    const playerId = `vehicle:${vehicle.id}`;
    try {
      const participant = await assets.loadRosterEntry({ playerId, name: vehicle.ownerName, slot: vehicle.id % 8, team: null },
        { equipment: structuredClone(vehicle.equipment), initial: "", favoriteTracks: [], favoriteItems: [] });
      const list = assets.participants as any[];
      const index = list.indexOf(participant);
      if (index >= 0) list.splice(index, 1);
      if (this.disposed || this.displays.get(vehicle.id) !== display) { participant.dispose?.(); return; }
      const deps = racePresenterInitializationDependencies as any;
      const presenter = stage.scene;
      const view = deps.createRacerView(presenter.scene);
      view.setModel(participant.vehicle.imported.object, participant.vehicle.visual, participant.vehicle.imported.animation,
        participant.vehicle.imported.model, participant.vehicle.imported.scene);
      mountRacer(presenter, playerId, participant, view);
      presenter.linkedPresentations.delete(playerId);
      const character = characterOf(participant)?.scene?.object;
      if (character) character.visible = false;
      display.participant = participant;
      display.view = view;
      this.poseDisplay(display);
    } catch (error) {
      console.warn("停放车辆加载失败", vehicle.ownerName, error);
    }
  }

  private poseDisplay(display: Display): void {
    const view = display.view;
    if (!view) return;
    const pose = display.vehicle.pose;
    const world = designToWorld(pose.x, pose.y, pose.z);
    const ground = this.groundAt(pose.x, pose.z, pose.y);
    const h = Math.PI - (pose.heading * Math.PI) / 180;
    const forward = { x: Math.sin(h), y: 0, z: Math.cos(h) };
    const up = { x: 0, y: 1, z: 0 };
    const right = { x: -forward.z, y: 0, z: forward.x };
    const scale = { x: CITY_VEHICLE_SCALE, y: CITY_VEHICLE_SCALE, z: CITY_VEHICLE_SCALE };
    view.updatePose({ x: world.x, y: ground ?? world.y, z: world.z, position: { x: world.x, y: ground ?? world.y, z: world.z },
      forward, up, right, visualScale: scale });
    view.root.visible = true;
    view.root.updateMatrixWorld?.(true);
  }

  private dropDisplay(id: number): void {
    const display = this.displays.get(id);
    if (!display) return;
    this.displays.delete(id);
    display.view?.root?.removeFromParent?.();
    try { display.participant?.vehicle?.trails?.object?.removeFromParent?.(); } catch { /* none */ }
    try { display.participant?.dispose?.(); } catch (error) { console.warn("停放车辆释放失败", error); }
  }

  /** Parked karts with their owners' names, for the name tags. */
  parkedHeads(): Array<{ id: string; name: string; position: { x: number; y: number; z: number } }> {
    const heads: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }> = [];
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.driver !== 0) continue;
      const world = designToWorld(vehicle.pose.x, vehicle.pose.y, vehicle.pose.z);
      const owner = vehicle.owner === this.myId ? "我的车" : `${vehicle.ownerName}的车`;
      heads.push({ id: `vehicle:${vehicle.id}`, name: `${owner}${vehicle.locked ? " · 已上锁" : ""}`,
        position: { x: world.x, y: world.y - 0.35, z: world.z } });
    }
    return heads;
  }

  /** Where the local rider is (world): the walker, or undefined while seated. */
  footWorld(): { x: number; y: number; z: number } | undefined {
    return this.seat === "foot" && this.foot ? { x: this.foot.x, y: this.foot.y, z: this.foot.z } : undefined;
  }

  footDesign(): CityPose | undefined {
    if (!this.foot) return undefined;
    const design = worldToDesign(this.foot.x, this.foot.y, this.foot.z);
    return { ...design, heading: headingOfYaw(this.foot.yaw) };
  }

  /** Whether a remote member's name tag shows (on foot it follows the walker). */
  headOf(playerId: string): { x: number; y: number; z: number } | undefined {
    const walker = this.remoteWalkers.get(playerId);
    return walker?.root.visible ? walker.root.position : undefined;
  }

  // ---- the race scene hooks ----

  /** Hides the local kart while someone else drives it and puts the follow camera on the walker. */
  private hookStage(): void {
    const stage = this.host.stage();
    const local = stage?.runtime?.local;
    const presenter = stage?.scene;
    if (!local || !presenter) return;
    const resetVisible = local.resetVisible.bind(local);
    local.resetVisible = (value: unknown) => resetVisible(value) && this.localKartVisible();
    const drive = presenter.drive;
    const apply = drive.apply.bind(drive);
    // The camera step runs first in the presenter's update: walkers move
    // here so the camera, the culling and the draw order all see this frame.
    drive.apply = (camera: any, view: unknown) => {
      const { width, height } = this.host.viewport();
      try { this.frame(performance.now(), camera, width, height); } catch (error) { console.warn("步行更新失败", error); }
      if (!this.applyCamera(camera)) apply(camera, view);
    };
    this.unhook.push(() => { local.resetVisible = resetVisible; drive.apply = apply; });
    // The minimap marks the walker (or the kart we ride), and the driving
    // gauges (slots, N2O) stay away while not driving.
    const ui = presenter.hud?.ui;
    const minimap = ui?.minimap;
    if (minimap?.update) {
      const update = minimap.update.bind(minimap);
      minimap.update = (tick: unknown, body: any, ghosts: unknown) => update(tick, this.minimapBody(body), ghosts);
      this.unhook.push(() => { minimap.update = update; });
    }
    const commands = ui?.renderer;
    if (commands?.render) {
      const render = commands.render.bind(commands);
      commands.render = (...args: unknown[]) => { if (this.seat === "driver") render(...args); };
      this.unhook.push(() => { commands.render = render; });
    }
  }

  /** The tachometer of the kart in use draws only while we drive (it changes with the kart). */
  private hideTachometer(): void {
    const tachometer = this.host.stage()?.scene?.tachometer;
    if (!tachometer || tachometer.__cityOnFoot) return;
    const render = tachometer.render.bind(tachometer);
    tachometer.render = (...args: unknown[]) => { if (this.seat === "driver") render(...args); };
    tachometer.__cityOnFoot = true;
  }

  /** The body the minimap marks: the kart, or the walker / the kart we ride. */
  private minimapBody(body: any): any {
    let position: { x: number; y: number; z: number } | undefined;
    let forward: { x: number; y: number; z: number } | undefined;
    if (this.seat === "foot" && this.foot) {
      position = { x: this.foot.x, y: this.foot.y, z: this.foot.z };
      forward = { x: Math.sin(this.foot.yaw), y: 0, z: Math.cos(this.foot.yaw) };
    } else if (this.seat === "passenger") {
      const vehicle = [...this.vehicles.values()].find(entry => entry.passenger === this.myId);
      const driver = vehicle ? this.members.get(vehicle.driver) : undefined;
      const pose = driver ? this.host.fleet()?.copyWebPose(driver.playerId) : undefined;
      if (pose) { position = pose.position; forward = pose.forward; }
    }
    if (!position || !forward) return body;
    return { ...body, position, forward, right: { x: -forward.z, y: 0, z: forward.x }, up: { x: 0, y: 1, z: 0 } };
  }

  private localKartVisible(): boolean {
    if (this.seat === "driver") return true;
    const vehicle = this.vehicles.get(this.localKartVehicle);
    return !!vehicle && vehicle.driver === 0;
  }

  /** The follow camera while walking or riding; false leaves the race camera. */
  private applyCamera(camera: any): boolean {
    let target: Vector3 | undefined;
    let yaw: number | undefined;
    if (this.seat === "foot" && this.foot) {
      target = new Vector3(this.foot.x, this.foot.y + CAMERA.aim, this.foot.z);
      yaw = this.foot.yaw;
    } else if (this.seat === "passenger") {
      const vehicle = [...this.vehicles.values()].find(entry => entry.passenger === this.myId);
      const driver = vehicle ? this.members.get(vehicle.driver) : undefined;
      const pose = driver ? this.host.fleet()?.copyWebPose(driver.playerId) : undefined;
      if (pose) {
        target = new Vector3(pose.position.x, pose.position.y + CAMERA.aim, pose.position.z);
        yaw = Math.atan2(pose.forward.x, pose.forward.z);
      }
    }
    if (!target || yaw === undefined) return false;
    // The camera swings behind the rider rather than snapping.
    const current = this.cameraYaw ?? yaw;
    const turn = Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current));
    this.cameraYaw = current + turn * (this.footMoving || this.seat === "passenger" ? 0.12 : 0.04);
    const back = new Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const view = this.seat === "passenger" ? RIDE_CAMERA : CAMERA;
    let position = target.clone().addScaledVector(back, view.distance).add(new Vector3(0, view.height - view.aim, 0));
    // Keep a wall from coming between the camera and the rider.
    const track = this.host.stage()?.runtime?.local?.track;
    const movement = position.clone().sub(target);
    const hit = track?.rayQuery?.({ x: target.x, y: target.y, z: target.z }, { x: movement.x, y: movement.y, z: movement.z }, true);
    if (hit?.point) {
      const point = new Vector3(hit.point.x, hit.point.y, hit.point.z);
      position = target.clone().lerp(point, 0.85);
    }
    camera.matrixAutoUpdate = true;
    camera.up.set(0, 1, 0);
    camera.position.copy(position);
    camera.lookAt(target);
    if (camera.fov !== CAMERA.fov) { camera.fov = CAMERA.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    return true;
  }

  // ---- the city's collision for walking ----

  private groundAt(designX: number, designZ: number, hintY: number): number | undefined {
    const track = this.host.stage()?.runtime?.local?.track;
    if (!track) return undefined;
    const world = designToWorld(designX, hintY, designZ);
    return groundHeightAt(track, world.x, world.z, hintY);
  }

  private world(): FootWorld {
    const track = this.host.stage()?.runtime?.local?.track;
    const water = (CITY_MAP as typeof CITY_MAP & { world?: CityWaterMap }).world;
    return {
      ground: (x, z, hintY) => {
        if (!track) return undefined;
        const hit = track.rayQuery({ x, y: hintY, z }, { x: 0, y: -3, z: 0 }, false);
        if (hit && hit.normal.y >= 0.65) return hit.point.y;
        return groundHeightAt(track, x, z, hintY);
      },
      wall: (from, to) => {
        if (!track) return undefined;
        const dx = to.x - from.x, dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-6) return undefined;
        const reach = (length + 0.18) / length;
        const hit = track.rayQuery({ x: from.x, y: from.y + 0.25, z: from.z }, { x: dx * reach, y: 0, z: dz * reach }, true);
        if (!hit || Math.abs(hit.normal.y) >= 0.65) return undefined;
        const n = Math.hypot(hit.normal.x, hit.normal.z) || 1;
        return { x: hit.normal.x / n, z: hit.normal.z / n };
      },
      water: (x, z) => {
        const design = worldToDesign(x, 0, z);
        return cityWaterLevel(water, design.x, design.z);
      },
    };
  }

  /** The race sender may send kart frames only while we drive. */
  allowRaceMotion(): boolean { return this.seat === "driver"; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unhook of this.unhook) unhook();
    this.unhook = [];
    this.closeMap();
    for (const id of [...this.riding.keys()]) this.unride(id);
    for (const id of [...this.displays.keys()]) this.dropDisplay(id);
    for (const walker of this.remoteWalkers.values()) walker.dispose();
    this.remoteWalkers.clear();
    this.walker?.dispose();
    this.walker = undefined;
  }
}

/** Chinese text for the node's seat refusals. */
export function seatErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const text: Record<string, string> = {
    NOT_IN_KART: "你现在不在车上。",
    ALREADY_IN_KART: "你已经在车上了。",
    VEHICLE_NOT_FOUND: "这辆车已经不在了。",
    TOO_FAR: "离车太远了，再走近一点。",
    VEHICLE_LOCKED: "这辆车上锁了。",
    VEHICLE_FULL: "这辆车坐满了。",
    RATE_LIMITED: "操作太频繁，请稍后再试。",
    FUEL_EMPTY: "油箱空了，车已熄火。",
  };
  return text[code] ?? `操作失败：${code}`;
}
