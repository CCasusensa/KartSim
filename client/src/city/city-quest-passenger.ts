/**
 * 载客任务的乘客（server-go/CITY-QUESTS.md）：司机接了载客任务的车（city-vehicle
 * 的 npcPassenger）在后座坐着那位任务点人物，用原版的坐车姿势（f00），整条线路
 * 的人都看得见；坐车期间人物原来站的地方空着（city-npcs 的 away）。
 */
import { Group, type Object3D } from "three";
import { disposeWalkingAvatar, updateWalkingAvatar, type WalkingAvatar } from "../ui/my-room-scene";
import { loadNpcAvatar, type CityNpcFigureHost } from "./city-npc-figure";
import { PASSENGER_OFFSET } from "./city-onfoot";
import { QUEST_NPCS } from "./city-quest-data";

export interface CityQuestPassengerHost {
  /** What loads a character (absent until the city scene is up). */
  figureHost(): Pick<CityNpcFigureHost, "library" | "environment" | "stageBinding"> | undefined;
  /** The karts carrying an NPC and who drives them. */
  riders(): Array<{ vehicle: number; npc: string; driverPlayerId: string }>;
  /** A driver's kart rider mount and the size riders take on it. */
  mount(driverPlayerId: string): { mount: Object3D; scale: number } | undefined;
  /** The NPCs riding (hidden at their spots). */
  away: Set<string>;
}

interface Seat {
  npc: string;
  driver: string;
  holder: Group;
  avatar?: WalkingAvatar;
  mount?: Object3D;
  elapsed: number;
  disposed: boolean;
}

/** The kart pose (the original character_common f00) for both of the avatar's motions. */
const SEATED = { idle: "f00", walk: "f00" };

export class CityQuestPassengers {
  private readonly seats = new Map<number, Seat>();
  private lastNow?: number;
  disposed = false;

  constructor(readonly host: CityQuestPassengerHost) {}

  /** Before the frame is drawn: seats, unseats and animates the passengers. */
  update(now: number, camera: unknown, width: number, height: number): void {
    if (this.disposed) return;
    const delta = this.lastNow === undefined ? 0 : Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const riders = this.host.riders();
    const current = new Set<number>();
    this.host.away.clear();
    for (const rider of riders) {
      if (!QUEST_NPCS[rider.npc]) continue;
      current.add(rider.vehicle);
      this.host.away.add(rider.npc);
      let seat = this.seats.get(rider.vehicle);
      if (seat && (seat.npc !== rider.npc || seat.driver !== rider.driverPlayerId)) {
        this.unseat(rider.vehicle);
        seat = undefined;
      }
      if (!seat) seat = this.seat(rider.vehicle, rider.npc, rider.driverPlayerId);
      if (!seat?.avatar) continue;
      const mounted = this.host.mount(seat.driver);
      if (!mounted) continue;
      if (seat.mount !== mounted.mount) {
        // A new kart model (garage change, a member's kart reloading): sit down again.
        mounted.mount.add(seat.holder);
        seat.mount = mounted.mount;
      }
      seat.holder.scale.setScalar(mounted.scale);
      seat.elapsed += delta;
      seat.avatar.motion.submitMotion(3);
      seat.holder.updateMatrixWorld(true);
      updateWalkingAvatar(seat.avatar, seat.elapsed, camera, width, height);
    }
    for (const vehicle of [...this.seats.keys()]) if (!current.has(vehicle)) this.unseat(vehicle);
  }

  private seat(vehicle: number, npcId: string, driver: string): Seat | undefined {
    const figureHost = this.host.figureHost();
    const npc = QUEST_NPCS[npcId];
    if (!figureHost || !npc) return undefined;
    const holder = new Group();
    holder.name = `city-quest-passenger-${npcId}`;
    holder.position.set(-PASSENGER_OFFSET.right, PASSENGER_OFFSET.back, PASSENGER_OFFSET.up);
    const seat: Seat = { npc: npcId, driver, holder, elapsed: 0, disposed: false };
    this.seats.set(vehicle, seat);
    void loadNpcAvatar(figureHost, npc.character, npc.dye, SEATED).then(avatar => {
      if (seat.disposed || this.disposed) { disposeWalkingAvatar(avatar); return; }
      seat.avatar = avatar;
      holder.add(avatar.scene.object);
    }).catch(error => console.warn("载客任务的乘客未能载入", error));
    return seat;
  }

  private unseat(vehicle: number): void {
    const seat = this.seats.get(vehicle);
    if (!seat) return;
    this.seats.delete(vehicle);
    seat.disposed = true;
    seat.holder.removeFromParent();
    disposeWalkingAvatar(seat.avatar);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const vehicle of [...this.seats.keys()]) this.unseat(vehicle);
    this.host.away.clear();
  }
}
