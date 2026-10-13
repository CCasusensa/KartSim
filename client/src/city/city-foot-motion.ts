/**
 * 下车步行 rules the browser applies (server-go/CITY.md 7): how a rider on
 * foot moves over the city's collision (keyboard tank controls, walls stop
 * it, kerbs up to a step, never into the sea), which kart E gets into, and
 * what a kart someone else drives looks like (its owner's kart, the
 * driver's character).
 */
import type { CityPose, CityVehicle } from "./city-protocol";
import { RUN_SPEED, WALK_SPEED } from "./city-walker";

export interface FootInput {
  /** -1 back … 1 forward */
  forward: number;
  /** -1 left … 1 right */
  turn: number;
  run: boolean;
}

/** A walker in the client world (y up); yaw 0 faces +z, turning towards +x. */
export interface FootState { x: number; y: number; z: number; yaw: number }

export interface FootWorld {
  /** The walkable ground height under x/z near hintY, undefined when none. */
  ground(x: number, z: number, hintY: number): number | undefined;
  /** A wall between two points at knee height: its horizontal normal, or undefined. */
  wall(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }):
    { x: number; z: number } | undefined;
  /** The sea level at x/z (client y), undefined away from water. */
  water?(x: number, z: number): number | undefined;
}

/** Turning speed (rad/s), the highest kerb a walker steps onto (m), how far it may drop. */
export const TURN_RATE = 2.8;
export const STEP_UP = 0.3;
export const BACK_SPEED_FACTOR = 0.6;

export interface FootStep { state: FootState; moving: boolean; running: boolean; speed: number }

/** One walking step of dt seconds. */
export function stepFoot(state: FootState, input: FootInput, dt: number, world: FootWorld): FootStep {
  // A growing yaw turns from +z towards +x, which is a left turn seen from above.
  const yaw = state.yaw - input.turn * TURN_RATE * dt;
  const forward = Math.max(-1, Math.min(1, input.forward));
  const running = input.run && forward > 0;
  const speed = forward >= 0 ? forward * (running ? RUN_SPEED : WALK_SPEED) : forward * WALK_SPEED * BACK_SPEED_FACTOR;
  if (Math.abs(speed) < 1e-6 || dt <= 0) return { state: { ...state, yaw }, moving: false, running: false, speed: 0 };
  let dx = Math.sin(yaw) * speed * dt, dz = Math.cos(yaw) * speed * dt;
  const from = { x: state.x, y: state.y, z: state.z };
  // A wall stops the move along its normal; the rest slides along it.
  const wall = world.wall(from, { x: state.x + dx, y: state.y, z: state.z + dz });
  if (wall) {
    const into = dx * wall.x + dz * wall.z;
    if (into < 0) { dx -= into * wall.x; dz -= into * wall.z; }
    if (world.wall(from, { x: state.x + dx, y: state.y, z: state.z + dz })) { dx = 0; dz = 0; }
  }
  const x = state.x + dx, z = state.z + dz;
  const ground = world.ground(x, z, state.y + 0.6);
  const water = world.water?.(x, z);
  const blocked = ground === undefined || ground - state.y > STEP_UP || (water !== undefined && ground < water - 0.2);
  if (blocked || Math.hypot(dx, dz) < 1e-6) return { state: { ...state, yaw }, moving: false, running: false, speed: 0 };
  return { state: { x, y: ground, z, yaw }, moving: true, running, speed: Math.hypot(dx, dz) / dt };
}

/** Yaw (client world) of a design heading (0 north = -z, clockwise). */
export function yawOfHeading(degrees: number): number {
  return Math.PI - (degrees * Math.PI) / 180;
}

/** Design heading (degrees) of a client yaw. */
export function headingOfYaw(yaw: number): number {
  const degrees = 180 - (yaw * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** The equipment slots and fields that belong to the kart, not to its rider. */
export const KART_SLOTS = [2, 3, 4, 20, 27] as const;
export const KART_FIELDS = ["kartSerial", "exceedType", "valueAt3E", "systemKart", "systemKartVariant"] as const;

/** What a kart looks like with someone else at the wheel: the owner's kart, the driver's rider. */
export function drivenEquipment(kart: any, rider: any): any {
  const merged = structuredClone(rider ?? {});
  merged.itemIds = { ...(rider?.itemIds ?? {}) };
  for (const slot of KART_SLOTS) {
    const value = kart?.itemIds?.[slot];
    if (value === undefined) delete merged.itemIds[slot];
    else merged.itemIds[slot] = value;
  }
  for (const field of KART_FIELDS) {
    if (kart && field in kart) merged[field] = kart[field];
    else delete merged[field];
  }
  return merged;
}

/** How far (m, ground plane) the browser offers E on a kart; the node allows 5 m. */
export const ENTER_REACH = 4;

export type EnterChoice =
  | { kind: "drive" | "ride"; vehicle: CityVehicle; distance: number }
  | { kind: "locked" | "full"; vehicle: CityVehicle; distance: number }
  | { kind: "none" };

/**
 * The kart E gets into from a design position: the nearest within reach,
 * preferring one that takes the member (an empty one or one with a free
 * back seat) over a locked or full one.
 */
export function enterChoice(vehicles: Iterable<CityVehicle>, x: number, z: number, me: number): EnterChoice {
  let best: EnterChoice = { kind: "none" };
  let bestScore = Infinity;
  for (const vehicle of vehicles) {
    const distance = Math.hypot(vehicle.pose.x - x, vehicle.pose.z - z);
    if (distance > ENTER_REACH) continue;
    const mine = vehicle.owner === me;
    const kind: EnterChoice["kind"] = vehicle.locked && !mine ? "locked"
      : vehicle.driver === 0 ? "drive" : vehicle.passenger === 0 ? "ride" : "full";
    const score = distance + (kind === "drive" || kind === "ride" ? 0 : 100);
    if (score < bestScore) { bestScore = score; best = { kind, vehicle, distance } as EnterChoice; }
  }
  return best;
}

/** Where a driver stands after getting out: a side step to the kart's left. */
export function exitPose(kart: CityPose, step = 1.2): CityPose {
  const h = (kart.heading * Math.PI) / 180;
  return { x: kart.x - step * Math.cos(h), y: kart.y, z: kart.z - step * Math.sin(h), heading: kart.heading };
}
