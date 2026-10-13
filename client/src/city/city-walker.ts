/**
 * A rider on foot in 卡丁城 (下车步行, server-go/CITY.md 7): the character of
 * an equipment document with the release standing (f10) and walking (f11)
 * motions, dressed like My Room's walking rider, at the city's kart size.
 * The release has no running motion for characters (character_common.rho
 * and the costume archives carry f10/f11 only; the run_* karts animate their
 * own kart rig), so running plays the walking stride faster.
 */
import { Group } from "three";
import {
  bodyBounds, disposeWalkingAvatar, loadWalkingAvatar, updateWalkingAvatar, walkingAvatarColors,
  type MyRoomSceneSubject, type WalkingAvatar,
} from "../ui/my-room-scene";
import { CITY_VEHICLE_SCALE } from "./city-vehicle-scale";

/** Walking and running speeds (m/s) at the city's half size. */
export const WALK_SPEED = 0.95;
export const RUN_SPEED = 2.4;
/** How much faster the walking stride plays when running. */
export const RUN_STRIDE_RATE = 1.9;

export interface CityWalkerHost {
  library: unknown;
  /** The race scene the walker joins (its matrices update by hand). */
  scene: Group | { add(object: unknown): void; remove(object: unknown): void };
  environment: unknown;
  stageBinding: MyRoomSceneSubject["stageBinding"];
}

interface CatalogEntry { itemId: number; path: string; systemKey?: string }
interface CatalogLibrary {
  timeAttackGarageCatalog(): Promise<{ karts: CatalogEntry[]; characters: CatalogEntry[] }>;
}

/** The My Room subject that loads the character of `equipment`. */
export async function walkerSubject(host: CityWalkerHost, equipment: any): Promise<MyRoomSceneSubject> {
  const catalog = await (host.library as CatalogLibrary).timeAttackGarageCatalog();
  const itemIds = equipment?.itemIds ?? {};
  const character = catalog.characters.find(item => item.itemId === Number(itemIds[1])) ?? catalog.characters[0];
  const kartId = Number(itemIds[3] ?? 0);
  const kart = catalog.karts.find(item => item.itemId === kartId &&
    (kartId !== 0 || item.systemKey === equipment?.systemKart)) ?? catalog.karts[0];
  if (!character || !kart) throw new Error("步行人物缺少角色目录。");
  return { kart: kart as never, character: character as never, profile: { equipment } as never,
    environment: host.environment, stageBinding: host.stageBinding };
}

export class CityWalker {
  /** At the walker's feet, turned to its heading (yaw around +y, 0 facing +z). */
  readonly root = new Group();
  private readonly ground = new Group();
  avatar?: WalkingAvatar;
  ready: Promise<void>;
  moving = false;
  running = false;
  disposed = false;
  private stride = 0;
  private lastNow?: number;
  private needsGrounding = true;

  constructor(readonly host: CityWalkerHost, equipment: unknown, readonly label = "") {
    this.root.name = `city-walker${label ? `-${label}` : ""}`;
    this.root.matrixAutoUpdate = true;
    this.root.scale.setScalar(CITY_VEHICLE_SCALE);
    // The character model is Z-up (convertClientCoordinates false), like My Room's.
    this.ground.rotation.x = -Math.PI / 2;
    this.root.add(this.ground);
    this.root.visible = false;
    this.ready = this.load(equipment);
  }

  private async load(equipment: unknown): Promise<void> {
    const subject = await walkerSubject(this.host, equipment);
    const library = this.host.library as never;
    const colors = await walkingAvatarColors(library, (equipment as any) ?? { itemIds: {} });
    const avatar = await loadWalkingAvatar(library, subject, colors);
    if (this.disposed) { disposeWalkingAvatar(avatar); return; }
    this.avatar = avatar;
    this.ground.add(avatar.scene.object);
    this.host.scene.add(this.root);
    this.needsGrounding = true;
  }

  /** Puts the walker's feet at a world position facing yaw (radians, 0 = +z). */
  place(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);
  }

  /** Animates and poses the walker for this frame. */
  update(now: number, camera: unknown, width: number, height: number, visible = true): void {
    const avatar = this.avatar;
    if (this.disposed || !avatar) return;
    const delta = this.lastNow === undefined ? 0 : Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.stride += delta * (this.moving && this.running ? RUN_STRIDE_RATE : 1);
    this.root.visible = visible;
    avatar.motion.submitMotion(this.moving ? 4 : 3);
    this.root.updateMatrixWorld(true);
    updateWalkingAvatar(avatar, this.stride, camera, width, height);
    if (this.needsGrounding) {
      // Stand the character's own meshes on the feet point.
      this.root.updateMatrixWorld(true);
      const bounds = bodyBounds(avatar);
      const lift = (this.root.position.y - bounds.min.y) / CITY_VEHICLE_SCALE;
      if (Number.isFinite(lift) && Math.abs(lift) < 20) this.ground.position.y += lift;
      this.needsGrounding = false;
      this.root.updateMatrixWorld(true);
    }
  }

  /** The head's world height above the feet (for name tags). */
  get headHeight(): number { return 1.6 * CITY_VEHICLE_SCALE; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    disposeWalkingAvatar(this.avatar);
    this.avatar = undefined;
  }
}
