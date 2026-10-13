/**
 * A task-point NPC of 卡丁城 (city-npcs.json): an original character
 * standing on the pavement with the release standing motion (f10), loaded
 * and dressed like My Room's walking rider, at the city's kart size. It
 * turns to face a rider who stops by.
 */
import { Group } from "three";
import {
  bodyBounds, disposeWalkingAvatar, loadWalkingAvatar, updateWalkingAvatar, walkingAvatarColors,
  type MyRoomSceneSubject, type WalkingAvatar,
} from "../ui/my-room-scene";
import { CITY_VEHICLE_SCALE } from "./city-vehicle-scale";

export interface CityNpcFigureHost {
  library: unknown;
  /** The race scene (its matrices are updated by hand). */
  scene: { add(object: unknown): void; remove(object: unknown): void };
  environment: unknown;
  stageBinding: MyRoomSceneSubject["stageBinding"];
}

interface CatalogEntry { itemId: number; path: string; systemKey?: string }
interface CatalogLibrary {
  timeAttackGarageCatalog(): Promise<{ karts: CatalogEntry[]; characters: CatalogEntry[] }>;
}

/**
 * An original character as My Room's walking rider loads it, coloured by its
 * dye; motions default to standing (f10) and walking (f11).
 */
export async function loadNpcAvatar(host: Pick<CityNpcFigureHost, "library" | "environment" | "stageBinding">,
  characterItem: number, dye: number, motions?: { idle: string; walk: string }): Promise<WalkingAvatar> {
  const catalog = await (host.library as CatalogLibrary).timeAttackGarageCatalog();
  const character = catalog.characters.find(item => item.itemId === characterItem) ?? catalog.characters[0];
  const kart = catalog.karts[0];
  if (!character || !kart) throw new Error("任务点人物缺少角色目录。");
  const equipment = { itemIds: { 1: character.itemId, 70: dye } };
  const subject = {
    kart, character, profile: { equipment },
    environment: host.environment, stageBinding: host.stageBinding,
  } as unknown as MyRoomSceneSubject;
  // The rider's colours come from its dye (slot 70), as My Room loads them.
  const colors = await walkingAvatarColors(host.library as never, equipment);
  return loadWalkingAvatar(host.library as never, subject, colors, motions);
}

/** How fast a figure turns to face someone (radians per second). */
const TURN_RATE = 2.5;

export class CityNpcFigure {
  /** At the figure's feet, turned to its yaw (around +y, 0 facing +z). */
  readonly root = new Group();
  private readonly ground = new Group();
  avatar?: WalkingAvatar;
  readonly ready: Promise<void>;
  disposed = false;
  yaw = 0;
  targetYaw = 0;
  private elapsed = 0;
  private lastNow?: number;
  private needsGrounding = true;

  constructor(readonly host: CityNpcFigureHost, readonly character: number, readonly dye: number, readonly name: string) {
    this.root.name = `city-npc-${name}`;
    this.root.scale.setScalar(CITY_VEHICLE_SCALE);
    // The character model is Z-up (convertClientCoordinates false), like My Room's.
    this.ground.rotation.x = -Math.PI / 2;
    this.root.add(this.ground);
    this.root.visible = false;
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const avatar = await loadNpcAvatar(this.host, this.character, this.dye);
    if (this.disposed) { disposeWalkingAvatar(avatar); return; }
    this.avatar = avatar;
    this.ground.add(avatar.scene.object);
    this.host.scene.add(this.root);
    this.needsGrounding = true;
  }

  /** Puts the figure's feet at a world position facing yaw (radians, 0 = +z). */
  place(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.yaw = this.targetYaw = yaw;
    this.root.rotation.set(0, yaw, 0);
    this.needsGrounding = true;
  }

  /** Animates the standing figure; it turns towards targetYaw. */
  update(now: number, camera: unknown, width: number, height: number, visible: boolean): void {
    const avatar = this.avatar;
    if (this.disposed || !avatar) return;
    const delta = this.lastNow === undefined ? 0 : Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.root.visible = visible;
    if (!visible) return;
    this.elapsed += delta;
    let turn = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
    const step = TURN_RATE * delta / 1000;
    turn = Math.max(-step, Math.min(step, turn));
    this.yaw += turn;
    this.root.rotation.set(0, this.yaw, 0);
    avatar.motion.submitMotion(3);
    this.root.updateMatrixWorld(true);
    updateWalkingAvatar(avatar, this.elapsed, camera, width, height);
    if (this.needsGrounding) {
      // Stand the character's own meshes on the feet point.
      const bounds = bodyBounds(avatar);
      const lift = (this.root.position.y - bounds.min.y) / CITY_VEHICLE_SCALE;
      if (Number.isFinite(lift) && Math.abs(lift) < 20) this.ground.position.y += lift;
      this.needsGrounding = false;
      this.root.updateMatrixWorld(true);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    disposeWalkingAvatar(this.avatar);
    this.avatar = undefined;
  }
}
