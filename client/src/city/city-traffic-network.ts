/**
 * The NPC traffic network of 卡丁城 (server-go/CITY-NPC.md): the lanes and
 * junction links the game node drives its cars on, from the same
 * traffic-network.json (client/tools/city/traffic). The node sends each car
 * as (path, distance along it); this module turns that into a design
 * position and direction, and runs the junctions' signal plans on the node
 * clock exactly like the node (traffic_network.go SignalPlan.Aspect).
 */

export interface TrafficSignalPlan { greenA: number; greenB: number; yellow: number; allRed: number; offset: number }

export interface TrafficPath {
  index: number;
  link: boolean;
  limit: number;
  next: number[];
  x: Float64Array;
  z: Float64Array;
  y: Float64Array;
  /** Distance along the path at each point (plan length). */
  s: Float64Array;
  length: number;
  /** Lanes: the junction at the end, the lane index (0 inner) and the distance to the right kerb. */
  end: number;
  lane: number;
  curb: number;
  /** Links: the junction and the turn. */
  junction: number;
  turn: "L" | "S" | "R" | "";
}

export interface TrafficApproach { in: number[]; out: number[]; role: string; group: number }

/** An original signal head over a junction: the approach it shows its lamps to, and its facing (0 north, clockwise). */
export interface TrafficLamp { x: number; y: number; z: number; heading: number; length: number; approach: number }

export interface TrafficJunction {
  x: number;
  z: number;
  y: number;
  control: "none" | "signal" | "priority" | "stop";
  signal?: TrafficSignalPlan;
  approaches: TrafficApproach[];
  lamps?: TrafficLamp[];
}

export interface TrafficNetwork {
  id: string;
  /** The id as the traffic packet carries it (its first 8 hex digits). */
  wireId: number;
  paths: TrafficPath[];
  junctions: TrafficJunction[];
}

interface RawNetwork {
  version: number;
  id: string;
  paths: Array<{ kind: string; limit: number; next: number[]; p: number[]; end?: number; lane?: number;
    curb?: number; junction?: number; turn?: string }>;
  junctions: Array<{ x: number; z: number; y: number; control: TrafficJunction["control"];
    signal?: TrafficSignalPlan; approaches: Array<{ in: number[]; out: number[]; role: string; group?: number }>;
    lamps?: TrafficLamp[] }>;
}

export function parseTrafficNetwork(raw: RawNetwork): TrafficNetwork {
  if (raw.version !== 1) throw new Error(`车流网络版本 ${raw.version} 不支持。`);
  const paths = raw.paths.map((entry, index): TrafficPath => {
    const count = entry.p.length / 3;
    const x = new Float64Array(count), z = new Float64Array(count), y = new Float64Array(count), s = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      x[k] = entry.p[3 * k]!; z[k] = entry.p[3 * k + 1]!; y[k] = entry.p[3 * k + 2]!;
      if (k > 0) s[k] = s[k - 1]! + Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!);
    }
    return {
      index, link: entry.kind === "link", limit: entry.limit, next: entry.next, x, z, y, s, length: s[count - 1]!,
      end: entry.end ?? -1, lane: entry.lane ?? 0, curb: entry.curb ?? 2,
      junction: entry.junction ?? -1, turn: (entry.turn ?? "") as TrafficPath["turn"],
    };
  });
  const junctions = raw.junctions.map(j => ({
    x: j.x, z: j.z, y: j.y, control: j.control, signal: j.signal,
    approaches: j.approaches.map(a => ({ in: a.in, out: a.out, role: a.role, group: a.group ?? 0 })),
    lamps: j.lamps,
  }));
  return { id: raw.id, wireId: parseInt(raw.id.slice(0, 8), 16) >>> 0, paths, junctions };
}

let loading: Promise<TrafficNetwork> | undefined;

/** The bundled network, loaded on first use (a separate chunk: only the city needs it). */
export function loadTrafficNetwork(): Promise<TrafficNetwork> {
  loading ??= import("./traffic-network.json").then(module => parseTrafficNetwork((module.default ?? module) as RawNetwork));
  return loading;
}

/** Index k with s[k] <= distance < s[k + 1], clamped to the path. */
function segment(path: TrafficPath, distance: number): number {
  let lo = 0, hi = path.s.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.s[mid]! <= distance) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export interface PathPoint { x: number; z: number; y: number; dx: number; dz: number }

/**
 * The design point at `distance` along a path (clamped), `lateral` m to the
 * left of it, with the unit direction of travel there.
 */
export function pointAt(path: TrafficPath, distance: number, lateral = 0, out: PathPoint = { x: 0, z: 0, y: 0, dx: 0, dz: 1 }): PathPoint {
  const k = segment(path, distance);
  const length = path.s[k + 1]! - path.s[k]!;
  const t = length > 0 ? Math.max(0, Math.min(1, (distance - path.s[k]!) / length)) : 0;
  let dx = path.x[k + 1]! - path.x[k]!, dz = path.z[k + 1]! - path.z[k]!;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  out.dx = dx; out.dz = dz;
  // Left of the direction of travel (x east, z south) is (dz, −dx).
  out.x = path.x[k]! + (path.x[k + 1]! - path.x[k]!) * t + dz * lateral;
  out.z = path.z[k]! + (path.z[k + 1]! - path.z[k]!) * t - dx * lateral;
  out.y = path.y[k]! + (path.y[k + 1]! - path.y[k]!) * t;
  return out;
}

export const ASPECT_RED = 0, ASPECT_GREEN = 1, ASPECT_YELLOW = 2;

/** What signal group `group` of a plan shows at node time `tick` (ms): the node's SignalPlan.Aspect. */
export function signalAspect(plan: TrafficSignalPlan, group: number, tick: number): number {
  const ms = (seconds: number) => Math.round(seconds * 1000);
  const greenA = ms(plan.greenA), greenB = ms(plan.greenB), yellow = ms(plan.yellow), allRed = ms(plan.allRed);
  const cycle = greenA + greenB + 2 * (yellow + allRed);
  let t = (Math.trunc(tick) + ms(plan.offset)) % cycle;
  if (t < 0) t += cycle;
  const start = group === 1 ? greenA + yellow + allRed : 0;
  const green = group === 1 ? greenB : greenA;
  const local = (t - start + cycle) % cycle;
  if (local < green) return ASPECT_GREEN;
  if (local < green + yellow) return ASPECT_YELLOW;
  return ASPECT_RED;
}
