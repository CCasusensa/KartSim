import type { RailMatrix } from "../driving/rail-frame";
import type { RemoteMotionSnapshot } from "./remote-motion";
import type { SmoothedRemotePose } from "./remote-pose-smoothing";

interface Vec3 { x: number; y: number; z: number }
interface Ground { point: Vec3; normal: Vec3 }

export interface RemoteGroundTrack {
  /** Web coordinates, and a finite displacement, as used by the local wheels. */
  rayQuery(origin: Vec3, movement: Vec3, includeWalls: false): Ground | undefined;
}

export interface RemoteGroundFootprint { halfWidth: number; halfLength: number }
type Anchor = Pick<RemoteMotionSnapshot, "position" | "quaternion"> &
  Partial<Pick<RemoteMotionSnapshot, "linearVelocity">>;

const MIN_NORMAL_Y = Math.fround(0.65);
const ABOVE = 0.35;
const BELOW_ANCHOR = 0.65;
const NEAR_ROAD = 0.12;
const EPSILON = 0.002;

const web = (position: readonly number[]): Vec3 =>
  ({ x: position[0]!, y: position[2]!, z: -position[1]! });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
  ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
function unit(value: Vec3): Vec3 | undefined {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 1e-6 && Number.isFinite(length)
    ? { x: value.x / length, y: value.y / length, z: value.z / length } : undefined;
}
const planeHeight = (ground: Ground, x: number, z: number): number => ground.point.y -
  (ground.normal.x * (x - ground.point.x) + ground.normal.z * (z - ground.point.z)) / ground.normal.y;

/** Skip bridge undersides; native road raycasts are double sided. */
function floor(track: RemoteGroundTrack, x: number, z: number, top: number,
  bottom: number, downwardWoundAt?: number): Ground | undefined {
  let downward: Ground | undefined;
  for (let count = 0; count < 8 && top >= bottom; count++) {
    const hit = track.rayQuery({ x, y: top, z }, { x: 0, y: bottom - top, z: 0 }, false);
    if (!hit || !Number.isFinite(hit.point.y) || hit.point.y > top + EPSILON ||
      hit.point.y < bottom - EPSILON) return downward;
    const normal = unit(hit.normal);
    if (normal && normal.y >= MIN_NORMAL_Y) {
      // Track surfaces reuse their hit object on the next query.
      return downward && downwardWoundAt !== undefined &&
        Math.abs(downward.point.y - downwardWoundAt) + 0.05 < Math.abs(hit.point.y - downwardWoundAt)
        ? downward : { point: { ...hit.point }, normal };
    }
    if (!downward && normal && normal.y <= -MIN_NORMAL_Y && downwardWoundAt !== undefined &&
      Math.abs(hit.point.y - downwardWoundAt) <= 0.3)
      downward = { point: { ...hit.point }, normal: { x: -normal.x, y: -normal.y, z: -normal.z } };
    top = hit.point.y - 0.01;
  }
  return downward;
}

/** A finite movement into a road finds ramp entries without scanning above a tunnel. */
function sweepRoad(track: RemoteGroundTrack, from: Vec3, to: Vec3): Ground | undefined {
  const movement = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  if (Math.hypot(movement.x, movement.y, movement.z) < 1e-6) return undefined;
  const hit = track.rayQuery({ x: from.x, y: from.y + ABOVE, z: from.z }, movement, false);
  if (!hit) return undefined;
  const normal = unit(hit.normal);
  // Backface hits while rising through a bridge do not make that deck our road.
  return normal && normal.y >= MIN_NORMAL_Y && dot(normal, movement) < -1e-6
    ? { point: { ...hit.point }, normal } : undefined;
}

function roadRotation(rotation: RailMatrix, normal: Vec3): RailMatrix | undefined {
  const forward = { x: -rotation[0].y, y: -rotation[2].y, z: rotation[1].y };
  // Keep the horizontal heading exactly; only its pitch and the kart's roll
  // follow the road. An orthogonal projection would also alter its steering.
  const tangent = unit({ x: forward.x,
    y: -(normal.x * forward.x + normal.z * forward.z) / normal.y, z: forward.z });
  if (!tangent) return undefined;
  const right = unit(cross(normal, tangent));
  if (!right) return undefined;
  return [
    { x: right.x, y: -tangent.x, z: normal.x },
    { x: -right.z, y: tangent.z, z: -normal.z },
    { x: right.y, y: -tangent.y, z: normal.y },
  ];
}

/**
 * Keep only the remote presentation above its actual road. The latest real
 * packet selects the road layer; a short probe above that layer cannot pull
 * a kart out of a tunnel onto its roof. A grounded packet's road plane also
 * lets a smoothed horizontal position climb a slope before the next packet.
 * Airborne poses are never pulled down, and missing road never retains an
 * old floor height, so jumps and falls through gaps remain visible.
 */
export function constrainRemotePose(track: RemoteGroundTrack, drawn: SmoothedRemotePose,
  anchor: Anchor, footprint?: RemoteGroundFootprint): SmoothedRemotePose {
  const position = web(drawn.position), source = web(anchor.position);
  if (![...drawn.position, ...anchor.position].every(Number.isFinite)) return drawn;
  let support = floor(track, source.x, source.z, source.y + ABOVE,
    source.y - BELOW_ANCHOR, source.y);
  support = sweepRoad(track, source, position) ?? support;
  const distance = Math.hypot(position.x - source.x, position.z - source.z);
  // Follow steep roads in small steps: extending an old ramp plane over a
  // crest could otherwise put the probe above an unrelated bridge deck.
  if (support && Math.hypot(support.normal.x, support.normal.z) > 0.1 && distance > 2) {
    const steps = Math.min(12, Math.ceil(distance / 2));
    for (let step = 1; step < steps && support; step++) {
      const t = step / steps;
      const x = source.x + (position.x - source.x) * t;
      const z = source.z + (position.z - source.z) * t;
      let height = planeHeight(support, x, z);
      const ramp = sweepRoad(track, support.point, { x, y: height, z });
      if (ramp) height = planeHeight(ramp, x, z);
      support = floor(track, x, z, height + ABOVE,
        Math.min(position.y - EPSILON, height - BELOW_ANCHOR), height);
    }
  }
  const reference = support ? planeHeight(support, position.x, position.z) : source.y;
  const ground = floor(track, position.x, position.z, reference + ABOVE,
    Math.min(position.y - EPSILON, reference - BELOW_ANCHOR), support ? reference : undefined);
  if (!ground) return drawn;
  const lift = Math.max(0, ground.point.y - position.y);
  const near = position.y <= ground.point.y + NEAR_ROAD;
  // A kart actually leaving the road keeps its jump pitch. Velocity along
  // a slope is tangent to the road and does not count as takeoff.
  const takeoff = anchor.linearVelocity && dot(web(anchor.linearVelocity), ground.normal) > 1;
  const rotation = near && !takeoff && drawn.rotation[2].z > 0.2
    ? roadRotation(drawn.rotation, ground.normal) ?? drawn.rotation : drawn.rotation;
  let height = position.y + lift;
  if (near && footprint && [footprint.halfWidth, footprint.halfLength]
    .every(value => Number.isFinite(value) && value > 0 && value <= 30)) {
    const right = { x: rotation[0].x, y: rotation[2].x, z: -rotation[1].x };
    const forward = { x: -rotation[0].y, y: -rotation[2].y, z: rotation[1].y };
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const offset = {
        x: right.x * footprint.halfWidth * side + forward.x * footprint.halfLength * end,
        y: right.y * footprint.halfWidth * side + forward.y * footprint.halfLength * end,
        z: right.z * footprint.halfWidth * side + forward.z * footprint.halfLength * end,
      };
      const x = position.x + offset.x, z = position.z + offset.z;
      const ramp = sweepRoad(track, { x: position.x, y: height, z: position.z },
        { x, y: height + offset.y, z });
      const expected = planeHeight(ramp ?? ground, x, z);
      const corner = floor(track, x, z, expected + ABOVE, expected - BELOW_ANCHOR, expected);
      if (corner) height = Math.max(height, corner.point.y - offset.y);
    }
  }
  if (height === position.y && rotation === drawn.rotation) return drawn;
  return { position: [drawn.position[0], drawn.position[1], height], rotation };
}
