import { add, frameDistance, scale, subtract, type RouteSection, type Vec3 } from "./route";

/**
 * Checkpoint resets (R, a fall, a stall, a crush) put the kart on the first
 * frame of its route section, as the release does, without looking at what
 * stands there. A few frames sit against a wall (village_I15 交通高峰 section
 * 7 straddles the side of the ramp where the road forks, china_I08 东方明珠
 * section 10 faces a wall 2 m ahead) and a moving obstacle (a hammer, a train,
 * traffic) may stand on any of them, so the reset first checks the kart's box
 * there and, when it is blocked, moves to the nearest clear spot further along
 * the section or beside the route.
 */

export interface ResetPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  surface: string;
}

interface Box { center: Vec3; axes: Vec3[]; halfExtents: number[] }
interface Contact { point: Vec3; normal: Vec3 }
interface Triangle { a: Vec3; b: Vec3; c: Vec3; normal: Vec3; motion?: Partial<Vec3> }

interface ObstacleAnimator {
  updateSnapshot(): readonly Triangle[];
  registrationCenter?(): Vec3;
  modelRadius?(): number;
}

/** The track (`_L`) collision queries the physics uses; absent ones skip their check. */
export interface ResetClearanceWorld {
  queryObb?(box: Box): Iterable<Contact> | undefined;
  rayQuery?(origin: Vec3, movement: Vec3, includeWalls: boolean):
    (Contact & { obstacleSource?: boolean }) | undefined;
  triangleObbQuery?(triangle: Triangle, box: Box): boolean;
  data?: { obstacleAnimators?: readonly unknown[] };
}

export interface ResetClearanceVehicle {
  collisionShape?: {
    rawHalfWidth: number; rawHalfLength: number;
    scaleX: number; scaleY: number; rawHeight: number;
  };
}

/** Floors and ceilings: |normal·up| above this (the physics' road/wall split). */
const FLOOR = 0.65;
/** The box also covers this much road ahead of the kart (m). */
const LOOKAHEAD = 3;
/** A face blocks once the kart box reaches this far past it (m). */
const FACING_DEPTH = 0.05;
const SIDE_DEPTH = 0.25;
/** Moving obstacles are also checked where their current motion takes them (s). */
const OBSTACLE_TIMES = [0, 0.5, 1, 1.5];
/** Spots tried past the checkpoint (m along the route) and beside it (m). */
const ALONG = [0, 2, 4, 6, 9, 12, 16, 20];
const ACROSS = [0, 1.5, -1.5, 3, -3];
/** Lateral spots must stand on road within this height of the checkpoint's road (m). */
const GROUND_PROBE = 1.5;
const GROUND_STEP = 1;
/** Stay this far before the section's end, so its way out is still crossed (m). */
const END_MARGIN = 1;
/** Sections whose arrival needs the exact frame (rail capture, warps). */
const EXACT_SURFACE = /rail|warp/i;

const CANDIDATES = ALONG.flatMap(along => ACROSS.map(across => ({ along, across })))
  .slice(1)
  .map((spot, index) => ({ ...spot, cost: Math.hypot(spot.along, spot.across * 1.5), index }))
  .sort((a, b) => a.cost - b.cost || a.index - b.index);

const f32 = Math.fround;
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});

function unit(vector: Vec3): Vec3 | undefined {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-6 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : undefined;
}

interface KartSize { halfWidth: number; halfLength: number; lift: number; halfHeight: number }

/** The primary collision box of driving/track-collision.ts at this vehicle's scale. */
function kartSize(vehicle: ResetClearanceVehicle): KartSize | undefined {
  const shape = vehicle.collisionShape;
  if (!shape) return undefined;
  const lift = shape.rawHeight > 1 ? 0.4 * shape.rawHeight : shape.rawHeight;
  const size = {
    halfWidth: shape.rawHalfWidth * shape.scaleX,
    halfLength: shape.rawHalfLength * shape.scaleY,
    lift, halfHeight: 0.7 * lift,
  };
  return Object.values(size).every(value => Number.isFinite(value) && value > 0) ? size : undefined;
}

function support(box: Box, normal: Vec3): number {
  return box.axes.reduce((sum, axis, index) =>
    sum + box.halfExtents[index]! * Math.abs(dot(axis, normal)), 0);
}

/** How far the box reaches past a contact's plane, toward the side its normal faces away from. */
function depth(box: Box, contact: Contact): number {
  return support(box, contact.normal) - dot(subtract(box.center, contact.point), contact.normal);
}

function kartBox(pose: ResetPose, right: Vec3, size: KartSize): Box {
  return {
    center: add(add(pose.position, scale(pose.up, size.lift)), scale(pose.forward, LOOKAHEAD / 2)),
    axes: [right, pose.forward, pose.up],
    halfExtents: [size.halfWidth, size.halfLength + LOOKAHEAD / 2, size.halfHeight],
  };
}

/**
 * Static and moving-road faces the kart cannot drive off: the physics only
 * answers a face the kart moves into, so floors, ceilings and faces looking
 * ahead (a ledge the kart drops from) do not count; a face looking back at
 * the kart does, and a side wall once it cuts well into the body.
 */
function wallBlocks(box: Box, pose: ResetPose, contact: Contact): boolean {
  const vertical = dot(contact.normal, pose.up);
  if (vertical > FLOOR || vertical < -FLOOR) return false;
  const facing = dot(contact.normal, pose.forward);
  if (facing > 0.3) return false;
  return depth(box, contact) > (facing < -0.3 ? FACING_DEPTH : SIDE_DEPTH);
}

function shifted(triangle: Triangle, seconds: number): Triangle {
  if (seconds === 0) return triangle;
  const motion = { x: triangle.motion?.x ?? 0, y: triangle.motion?.y ?? 0, z: triangle.motion?.z ?? 0 };
  const offset = scale(motion, seconds);
  return { ...triangle, a: add(triangle.a, offset), b: add(triangle.b, offset), c: add(triangle.c, offset) };
}

function isAnimator(value: unknown): value is ObstacleAnimator {
  return typeof (value as ObstacleAnimator | undefined)?.updateSnapshot === "function";
}

/**
 * Moving obstacles near the box, now and along their current motion. The
 * track's obstacle surface only holds the animators near the kart's old
 * place, so this reads every animator's last pose instead.
 */
function obstacleBlocks(world: ResetClearanceWorld, box: Box, pose: ResetPose): boolean {
  const animators = world.data?.obstacleAnimators;
  const overlaps = world.triangleObbQuery?.bind(world);
  if (!animators?.length || !overlaps) return false;
  const reach = Math.hypot(...box.halfExtents);
  for (const animator of animators) {
    if (!isAnimator(animator)) continue;
    const triangles = animator.updateSnapshot();
    if (!triangles.length) continue;
    let speed = 0;
    for (const { motion } of triangles)
      speed = Math.max(speed, Math.hypot(motion?.x ?? 0, motion?.y ?? 0, motion?.z ?? 0));
    const center = animator.registrationCenter?.();
    const radius = animator.modelRadius?.();
    if (center && radius !== undefined && radius > 0) {
      const sweep = radius + reach + speed * OBSTACLE_TIMES[OBSTACLE_TIMES.length - 1]!;
      if (Math.hypot(center.x - box.center.x, center.y - box.center.y,
        center.z - box.center.z) > sweep) continue;
    }
    for (const seconds of OBSTACLE_TIMES) {
      if (seconds > 0 && speed === 0) break;
      for (const triangle of triangles) {
        // The top of an obstacle is ground a kart may stand on.
        if (dot(triangle.normal, pose.up) > FLOOR) continue;
        if (overlaps(shifted(triangle, seconds), box)) return true;
      }
    }
  }
  return false;
}

function poseBlocked(world: ResetClearanceWorld, pose: ResetPose, size: KartSize): boolean {
  const right = unit(cross(pose.up, pose.forward));
  if (!right) return false;
  const box = kartBox(pose, right, size);
  for (const contact of world.queryObb?.(box) ?? []) {
    if (wallBlocks(box, pose, contact)) return true;
  }
  return obstacleBlocks(world, box, pose);
}

/** Walls a straight move from `from` to `to` would pass through (`oneWay`: only faces looking back at it). */
function pathBlocked(world: ResetClearanceWorld, from: Vec3, to: Vec3, up: Vec3,
  size: KartSize, oneWay: boolean): boolean {
  const travel = subtract(to, from);
  const length = Math.hypot(travel.x, travel.y, travel.z);
  if (length < 1e-3) return false;
  const direction = unit(travel)!;
  const side = unit(cross(up, direction));
  if (!side) return false;
  const lifted = cross(direction, side);
  const box: Box = {
    center: add(add(from, scale(travel, 0.5)), scale(up, size.lift)),
    axes: [side, direction, lifted],
    halfExtents: [0.3, length / 2, size.halfHeight],
  };
  for (const contact of world.queryObb?.(box) ?? []) {
    const vertical = dot(contact.normal, up);
    if (vertical > FLOOR || vertical < -FLOOR) continue;
    const along = dot(contact.normal, direction);
    if (oneWay ? along < -0.5 : Math.abs(along) > 0.5) return true;
  }
  return false;
}

/** The road under a point, as an offset along `up` (undefined: none, or an obstacle's top). */
function groundOffset(world: ResetClearanceWorld, point: Vec3, up: Vec3): number | undefined {
  if (!world.rayQuery) return undefined;
  const origin = add(point, scale(up, GROUND_PROBE));
  const hit = world.rayQuery(origin, scale(up, -2 * GROUND_PROBE), false);
  if (!hit || hit.obstacleSource || dot(hit.normal, up) <= FLOOR) return undefined;
  return dot(subtract(hit.point, point), up);
}

interface RouteSpot { position: Vec3; forward: Vec3; up: Vec3; path: Vec3[] }

/** A point `distance` along the section's frame polyline, with the polyline corners passed on the way. */
function routeSpot(section: RouteSection, distance: number): RouteSpot | undefined {
  const frames = section.frames;
  const path = [frames[0]!.position];
  let remaining = distance;
  for (let index = 0; index + 1 < frames.length; index += 1) {
    const from = frames[index]!;
    const to = frames[index + 1]!;
    const length = frameDistance(from.position, to.position);
    if (length <= 0) continue;
    if (remaining <= length) {
      const position = add(from.position, scale(subtract(to.position, from.position),
        f32(remaining / length)));
      return { position, forward: from.forward, up: from.up, path: [...path, position] };
    }
    remaining -= length;
    path.push(to.position);
  }
  return undefined;
}

function polylineLength(section: RouteSection): number {
  let length = 0;
  for (let index = 0; index + 1 < section.frames.length; index += 1)
    length += frameDistance(section.frames[index]!.position, section.frames[index + 1]!.position);
  return length;
}

/**
 * The reset pose to use for `pose`, the first frame of `section`: itself when
 * nothing solid stands there (or the track cannot be asked), otherwise the
 * nearest clear spot further along the section or up to 3 m beside it, which
 * must stand on road and be reachable without passing through a wall. When
 * none is clear the checkpoint is kept.
 */
export function clearResetPose(world: ResetClearanceWorld, vehicle: ResetClearanceVehicle,
  section: RouteSection, pose: ResetPose): ResetPose {
  const size = kartSize(vehicle);
  if (!size || !world.queryObb || EXACT_SURFACE.test(pose.surface)) return pose;
  if (!poseBlocked(world, pose, size)) return pose;
  const start = groundOffset(world, pose.position, pose.up);
  // A checkpoint in the air (a jump, a drop) has no road to slide along.
  if (start === undefined) return pose;
  const room = Math.min(section.length, polylineLength(section)) - size.halfLength - END_MARGIN;
  for (const { along, across } of CANDIDATES) {
    const offset = f32(0.10000000149011612) + along;
    if (along > 0 && offset > room) continue;
    const spot = along === 0
      ? { position: pose.position, forward: pose.forward, up: pose.up, path: [] }
      : routeSpot(section, offset);
    if (!spot) continue;
    const right = unit(cross(spot.up, spot.forward));
    if (!right) continue;
    let position = add(spot.position, scale(right, across));
    const ground = groundOffset(world, position, spot.up);
    if (ground === undefined || Math.abs(ground - start) > GROUND_STEP) continue;
    // Keep the checkpoint's height above its road.
    position = add(position, scale(spot.up, ground - start));
    const candidate = { position, forward: { ...spot.forward }, up: { ...spot.up }, surface: pose.surface };
    if (poseBlocked(world, candidate, size)) continue;
    const route = along === 0 ? [] : [pose.position, ...spot.path.slice(1)];
    let blocked = false;
    for (let index = 0; index + 1 < route.length && !blocked; index += 1)
      blocked = pathBlocked(world, route[index]!, route[index + 1]!, spot.up, size, true);
    if (blocked || (across !== 0 &&
      pathBlocked(world, spot.position, position, spot.up, size, false))) continue;
    return candidate;
  }
  return pose;
}
