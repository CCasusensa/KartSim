/**
 * Lanes, junction links and junction control for the NPC traffic of 卡丁城
 * (server-go/CITY-NPC.md), from the street graph (road-graph.mjs).
 *
 * Traffic keeps right. Each street gets one lane per direction, two where
 * the asphalt on its side is at least `twoLanes` m wide; a lane sits in the
 * middle of its share of the asphalt run on that side of the centre line
 * (so the two carriageways of a divided road each get their direction).
 * Lanes stop short of a junction where the crossing streets begin; links
 * (cubic curves) join an arriving lane to the lanes leaving by every other
 * street: left turns from the inner lane to the inner lane, right turns from
 * the outer lane to the outer lane, straight on lane by lane. Two links of a
 * junction conflict when they come closer than `conflictGap` m or end in
 * the same lane. Junctions where the original Vice City signal heads hang
 * have signals (two phases, by axis; each head shows one approach its
 * lamps); other three-way junctions give way to their through street (the
 * stem stops); the rest are all-way stops.
 */
import { polylineLength, resample } from "./road-graph.mjs";

export const LANE_RULES = {
  /** Centre line smoothing (Gaussian sigma, m). */
  smoothing: 4,
  /** Asphalt on one side at least this wide (m) carries two lanes. */
  twoLanes: 8,
  /** The furthest a lane centre sits from the street centre (m). */
  maxOffset: 9,
  /** A median up to this wide (m) between centre line and asphalt is skipped. */
  medianSkip: 12,
  /** Junction radius = widest crossing half width + this margin (m), clamped. */
  stopMargin: 1.5,
  minRadius: 5,
  maxRadius: 18,
  /** Speed limits (m/s) by street width (m). */
  limits: [[10, 9], [16, 11], [Infinity, 13.5]],
  /** Links of different arriving lanes this close (m) cannot be used together. */
  conflictGap: 2.2,
  /** Turn classes by the angle between arrival and departure (degrees). */
  straight: 40,
  uTurn: 150,
  /** Polyline simplification tolerance (m). */
  tolerance: 0.08,
  /** Junctions get signals where the original signal heads are (else every junction of 4+ streets). */
  signalsFromHeads: true,
  /** A signal head belongs to the nearest junction within this distance (m); longer ones are not lamp bars. */
  headReach: 32,
  headMaxLength: 2,
  /** Signal plan (s): green for axis A, green for axis B, yellow, all red. */
  signal: { greenA: 14, greenB: 11, yellow: 3, allRed: 2 },
};

const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Gaussian smoothing of a 1 m resampled polyline; the ends stay put. */
function smooth(points, sigma) {
  if (points.length < 3 || sigma <= 0) return points;
  const reach = Math.ceil(sigma * 3);
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)));
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    // Near the ends the window shrinks symmetrically, so the curve still meets them.
    const span = Math.min(reach, i, points.length - 1 - i);
    let x = 0, z = 0, y = 0, sum = 0;
    for (let k = -span; k <= span; k++) {
      const w = weights[k + reach], q = points[i + k];
      x += q[0] * w; z += q[1] * w; y += q[2] * w; sum += w;
    }
    return [x / sum, z / sum, y / sum];
  });
}

function tangents(points) {
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  });
}

/** Right of the direction of travel in design coordinates (x east, z south). */
const rightOf = ([tx, tz]) => [-tz, tx];

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Douglas–Peucker on [x, z, y] (plan distance), ends kept. */
export function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first], b = points[last];
    const dx = b[0] - a[0], dz = b[1] - a[1], dy = b[2] - a[2];
    const length2 = dx * dx + dz * dz;
    let worst = -1, index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length2)) : 0;
      const d = Math.max(Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t), Math.abs(p[2] - a[2] - dy * t) * 0.5);
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The asphalt run beside a street, on its right (side 1) or left (−1), as constant offsets. */
function sideRun(raster, points, side, rules) {
  const ts = tangents(points);
  const starts = [], ends = [];
  // Skip the ends: there the run reaches into the crossing streets.
  const margin = Math.min(15, points.length / 4);
  for (let i = Math.ceil(margin); i < points.length - margin; i += 2) {
    const [rx, rz] = rightOf(ts[i]);
    const run = raster.run(points[i][0], points[i][1], rx * side, rz * side, rules.medianSkip);
    if (!run) continue;
    starts.push(run.start);
    ends.push(run.end);
  }
  const start = median(starts) ?? 0, end = median(ends) ?? 3;
  return { start, end: Math.max(end, start + 2.5) };
}

function lanesOf(run, rules) {
  const width = run.end - run.start;
  const count = width >= rules.twoLanes ? 2 : 1;
  const laneWidth = width / count;
  // Index 0 is the inner lane (next to the centre line).
  return Array.from({ length: count }, (_, k) => Math.max(-rules.maxOffset,
    Math.min(rules.maxOffset, run.start + laneWidth * (k + 0.5))));
}

function offsetLine(points, ts, offset) {
  return points.map((p, i) => {
    const [rx, rz] = rightOf(ts[i]);
    return [p[0] + rx * offset, p[1] + rz * offset, p[2]];
  });
}

/** The part of a line further than `radius` from `center`, cut at the crossing. */
function trimNear(points, center, radius, fromStart) {
  const list = fromStart ? points : [...points].reverse();
  let cut = 0;
  while (cut < list.length - 1 && Math.hypot(list[cut][0] - center.x, list[cut][1] - center.z) < radius) cut++;
  let out = list.slice(cut);
  if (cut > 0 && out.length) {
    const a = list[cut - 1], b = list[cut];
    const da = Math.hypot(a[0] - center.x, a[1] - center.z), db = Math.hypot(b[0] - center.x, b[1] - center.z);
    const t = db === da ? 0 : Math.max(0, Math.min(1, (radius - da) / (db - da)));
    out = [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], ...out.slice(1)];
  }
  return fromStart ? out : out.reverse();
}

/** Unit direction of travel along `points` (which run away from a junction) between 5 and 25 m out; sign −1 reverses it. */
function chordDirection(points, sign) {
  const length = polylineLength(points);
  const near = Math.min(5, length * 0.2), far = Math.min(25, length);
  const a = pointAlong(points, near), b = pointAlong(points, far);
  const dx = (b[0] - a[0]) * sign, dz = (b[1] - a[1]) * sign;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

function pointAlong(points, distance) {
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (travelled + step >= distance) {
      const t = step ? (distance - travelled) / step : 0;
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
    }
    travelled += step;
  }
  return points[points.length - 1];
}

function bezier(p0, p1, p2, p3, steps) {
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push([0, 1, 2].map(axis => w[0] * p0[axis] + w[1] * p1[axis] + w[2] * p2[axis] + w[3] * p3[axis]));
  }
  return out;
}

function segmentDistance(a, b, c, d) {
  // Plan distance between segments ab and cd (0 when they cross).
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const pointSegment = (p, s, e) => {
    const dx = e[0] - s[0], dz = e[1] - s[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dz) / l2)) : 0;
    return Math.hypot(p[0] - s[0] - dx * t, p[1] - s[1] - dz * t);
  };
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

function polylineDistance(p, q) {
  let best = Infinity;
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) {
    best = Math.min(best, segmentDistance(p[i - 1], p[i], q[j - 1], q[j]));
    if (best === 0) return 0;
  }
  return best;
}

function signedTurn(from, to) {
  // Negative turns left, positive right (design x east, z south).
  const cross = from[0] * to[1] - from[1] * to[0], dot = from[0] * to[0] + from[1] * to[1];
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The traffic network document (paths = lanes then links, junctions with
 * their approaches and control) for a street graph.
 */
export function buildTrafficNetwork(graph, raster, rules = LANE_RULES, signalHeads = []) {
  const nodeIds = [...graph.nodes.keys()];
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const edges = [...graph.edges.values()];

  // Junction radius: where the widest street meeting there begins.
  const radius = new Map();
  for (const id of nodeIds) radius.set(id, rules.minRadius);
  const halfWidths = new Map(nodeIds.map(id => [id, []]));
  for (const edge of edges) {
    const w = edge.width ?? 8;
    halfWidths.get(edge.a).push(w / 2);
    halfWidths.get(edge.b).push(w / 2);
  }
  for (const [id, list] of halfWidths) {
    const sorted = [...list].sort((a, b) => b - a);
    radius.set(id, Math.min(rules.maxRadius, Math.max(rules.minRadius, (sorted[0] ?? 4) + rules.stopMargin)));
  }

  const paths = [];
  /** approach key `${node}|${edge}|${end}` → { in: [lane ids, inner first], out: [...] , dirIn, dirOut } */
  const approaches = new Map();
  const approachOf = (node, edgeId, end) => {
    const key = `${node}|${edgeId}|${end}`;
    if (!approaches.has(key)) approaches.set(key, { node, edge: edgeId, end, in: [], out: [] });
    return approaches.get(key);
  };

  for (const edge of edges) {
    const raw = resample(edge.points, 1);
    const center = smooth(raw, rules.smoothing);
    const ts = tangents(center);
    const width = edge.width ?? 8;
    const limit = rules.limits.find(([w]) => width < w)[1];
    for (const dir of [1, -1]) {
      if (edge.oneway && edge.oneway !== dir) continue;
      // dir 1 runs a → b; its lanes are right of the centre line, i.e. on side 1.
      // A one-way carriageway uses its whole width.
      let run = sideRun(raster, center, dir, rules);
      if (edge.oneway) {
        const left = sideRun(raster, center, -dir, rules);
        run = { start: -left.end, end: run.end };
      }
      const offsets = lanesOf(run, rules);
      offsets.forEach((offset, laneIndex) => {
        let line = offsetLine(center, ts, offset * dir);
        if (dir === -1) line = line.reverse();
        const from = dir === 1 ? edge.a : edge.b, to = dir === 1 ? edge.b : edge.a;
        const fromNode = graph.nodes.get(from), toNode = graph.nodes.get(to);
        line = trimNear(line, fromNode, radius.get(from), true);
        line = trimNear(line, toNode, radius.get(to), false);
        if (polylineLength(line) < 2) {
          // Junctions this close leave no street between them: keep a stub in the middle.
          const mid = center[Math.floor(center.length / 2)];
          const t = ts[Math.floor(center.length / 2)].map(v => v * dir);
          const [rx, rz] = rightOf(t);
          const p = [mid[0] + rx * offset, mid[1] + rz * offset, mid[2]];
          line = [[p[0] - t[0], p[1] - t[1], p[2]], [p[0] + t[0], p[1] + t[1], p[2]]];
        }
        const id = paths.length;
        const curb = Math.max(0.5, run.end - offset);
        paths.push({ id, kind: "lane", edge: edge.id, dir, lane: laneIndex, lanes: offsets.length, limit,
          from: nodeIndex.get(from), to: nodeIndex.get(to), curb: round(curb, 1), points: line, next: [] });
        approachOf(to, edge.id, dir === 1 ? "b" : "a").in[laneIndex] = id;
        approachOf(from, edge.id, dir === 1 ? "a" : "b").out[laneIndex] = id;
      });
    }
  }

  // Junctions: approaches (arriving and leaving lanes of one street end), links, control.
  const junctions = nodeIds.map((id, index) => {
    const node = graph.nodes.get(id);
    return { id: index, x: round(node.x), z: round(node.z), y: round(node.y), approaches: [], control: "none" };
  });
  for (const approach of approaches.values()) {
    const junction = junctions[nodeIndex.get(approach.node)];
    // A one-way carriageway only arrives or only leaves: its other direction is the reverse.
    const anyIn = paths[approach.in[0]], anyOut = paths[approach.out[0]];
    // The street's course 5–25 m from the junction: right at it, a lane may
    // still be bending towards the junction point (the carriageways of a
    // divided road do for 15 m or more).
    if (anyIn) approach.dirIn = chordDirection([...anyIn.points].reverse(), -1);
    if (anyOut) approach.dirOut = chordDirection(anyOut.points, 1);
    approach.dirIn ??= [-approach.dirOut[0], -approach.dirOut[1]];
    approach.dirOut ??= [-approach.dirIn[0], -approach.dirIn[1]];
    approach.index = junction.approaches.length;
    junction.approaches.push(approach);
  }

  // The original signal heads (extract-signal-heads.mjs) hang over the junctions that have signals.
  for (const head of signalHeads) {
    if (head.length > rules.headMaxLength) continue;
    let best, bestDistance = rules.headReach;
    for (const junction of junctions) {
      const d = Math.hypot(junction.x - head.x, junction.z - head.z);
      if (d < bestDistance) { best = junction; bestDistance = d; }
    }
    if (best) (best.heads ??= []).push(head);
  }

  for (const junction of junctions) {
    const list = junction.approaches;
    for (const arrive of list) {
      if (!arrive.in.length) continue;
      for (const leave of list) {
        if (!leave.out.length) continue;
        if (leave === arrive && list.length > 1) continue;
        const angle = signedTurn(arrive.dirIn, leave.dirOut);
        if (Math.abs(angle) > rules.uTurn && list.length > 2) continue;
        const turn = Math.abs(angle) <= rules.straight ? "S" : angle < 0 ? "L" : "R";
        const nIn = arrive.in.length, nOut = leave.out.length;
        // Straight on lane by lane; the last arriving lane also feeds the
        // extra lanes of a wider street.
        const pairs = turn === "L" ? [[0, 0]] : turn === "R" ? [[nIn - 1, nOut - 1]]
          : Array.from({ length: Math.max(nIn, nOut) }, (_, k) => [Math.min(k, nIn - 1), Math.min(k, nOut - 1)]);
        for (const [k, j] of pairs) addLink(arrive.in[k], leave.out[j], turn, junction, arrive, leave);
      }
      // Every arriving lane must lead somewhere.
      for (const laneId of arrive.in) {
        if (paths[laneId].next.length) continue;
        const best = list.filter(l => l !== arrive && l.out.length).sort((a, b) =>
          Math.abs(signedTurn(arrive.dirIn, a.dirOut)) - Math.abs(signedTurn(arrive.dirIn, b.dirOut)))[0] ?? arrive;
        const angle = signedTurn(arrive.dirIn, best.dirOut);
        addLink(laneId, best.out[0], Math.abs(angle) <= rules.straight ? "S" : angle < 0 ? "L" : "R", junction, arrive, best);
      }
    }
    // Every leaving lane must be reachable: the arriving lane that turns least into it.
    for (const leave of list) {
      for (const laneId of leave.out) {
        if (paths.some(p => p.kind === "link" && p.next[0] === laneId && p.junction === junction.id)) continue;
        let best;
        for (const arrive of list) {
          if (arrive === leave || !arrive.in.length) continue;
          const angle = signedTurn(arrive.dirIn, leave.dirOut);
          if (Math.abs(angle) > rules.uTurn) continue;
          if (!best || Math.abs(angle) < Math.abs(best.angle)) best = { arrive, angle };
        }
        if (!best) continue;
        const k = best.angle < -rules.straight ? 0 : best.arrive.in.length - 1;
        addLink(best.arrive.in[k], laneId, Math.abs(best.angle) <= rules.straight ? "S" : best.angle < 0 ? "L" : "R",
          junction, best.arrive, leave);
      }
    }
    assignControl(junction, rules);
    if (junction.control === "signal") junction.lamps = (junction.heads ?? []).map(head => lampFor(head, junction, paths));
  }

  function addLink(fromId, toId, turn, junction, arrive, leave) {
    const from = paths[fromId], to = paths[toId];
    const p0 = from.points[from.points.length - 1], p3 = to.points[0];
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const k = turn === "S" ? 0.33 : 0.5;
    const d = chord * k;
    const p1 = [p0[0] + arrive.dirIn[0] * d, p0[1] + arrive.dirIn[1] * d, p0[2]];
    const p2 = [p3[0] - leave.dirOut[0] * d, p3[1] - leave.dirOut[1] * d, p3[2]];
    const points = bezier(p0, p1, p2, p3, Math.max(2, Math.ceil(chord)));
    const id = paths.length;
    paths.push({ id, kind: "link", junction: junction.id, turn, from: fromId, to: toId,
      arrive: arrive.index, leave: leave.index, limit: Math.min(from.limit, to.limit), points, next: [toId], conflicts: [] });
    from.next.push(id);
    return id;
  }

  // Every path must reach every other one (no lane traffic piles into).
  const reachable = new Set([0]);
  const queue = [0];
  while (queue.length) for (const next of paths[queue.shift()].next) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  const unreachable = paths.filter(p => !reachable.has(p.id));
  if (unreachable.length) throw new Error(`车道网络不连通：${unreachable.length} 条路径从车道 0 到不了，例如 ${
    unreachable.slice(0, 5).map(p => `${p.kind} ${p.id} (${p.points[0].slice(0, 2).map(Math.round).join(",")})`).join("、")}`);

  // Conflicts between links of one junction.
  const linksByJunction = new Map();
  for (const path of paths) if (path.kind === "link") {
    if (!linksByJunction.has(path.junction)) linksByJunction.set(path.junction, []);
    linksByJunction.get(path.junction).push(path);
  }
  for (const links of linksByJunction.values()) {
    for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
      const a = links[i], b = links[j];
      if (a.from === b.from) continue; // one queue: the follower waits behind
      const conflict = a.to === b.to || polylineDistance(a.points, b.points) < rules.conflictGap;
      if (conflict) { a.conflicts.push(b.id); b.conflicts.push(a.id); }
    }
  }

  // Movement priority: through and right turns of the major (or green) street first.
  for (const path of paths) if (path.kind === "link") {
    const junction = junctions[path.junction];
    const approach = junction.approaches[path.arrive];
    path.priority = approach.role === "minor" || junction.control === "stop" ? 0 : path.turn === "L" ? 1 : 2;
  }

  // The document: compact numbers, paths simplified.
  return {
    paths: paths.map(path => {
      const points = simplify(path.points, rules.tolerance);
      const base = { kind: path.kind, limit: path.limit, next: path.next,
        p: points.flatMap(p => [round(p[0]), round(p[1]), round(p[2])]) };
      return path.kind === "lane"
        ? { ...base, edge: path.edge, lane: path.lane, lanes: path.lanes, start: path.from, end: path.to, curb: path.curb }
        : { ...base, junction: path.junction, turn: path.turn, from: path.from, priority: path.priority,
          conflicts: path.conflicts.sort((a, b) => a - b) };
    }),
    junctions: junctions.map(junction => ({
      x: junction.x, z: junction.z, y: junction.y, control: junction.control,
      ...(junction.signal ? { signal: junction.signal } : {}),
      ...(junction.lamps?.length ? { lamps: junction.lamps } : {}),
      approaches: junction.approaches.map(a => ({ in: a.in, out: a.out, role: a.role,
        ...(a.group !== undefined ? { group: a.group } : {}) })),
    })),
  };
}

/**
 * Which approach a signal head shows its lamps to: the one arriving
 * towards it along its facing (across its long axis), with the head beyond
 * that approach's stop line. The lamp bar faces those drivers; seen from
 * them red is on the left, then yellow, then green.
 */
function lampFor(head, junction, paths) {
  const normal = [-head.axis[1], head.axis[0]];
  let best, bestScore = -Infinity;
  for (const approach of junction.approaches) {
    if (!approach.in.length) continue;
    const lane = paths[approach.in[0]];
    const end = lane.points[lane.points.length - 1];
    const d = approach.dirIn;
    const alignment = Math.abs(normal[0] * d[0] + normal[1] * d[1]);
    const ahead = (head.x - end[0]) * d[0] + (head.z - end[1]) * d[1];
    const score = alignment + (ahead > 0 ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = approach; }
  }
  const d = best.dirIn;
  // Facing the arriving drivers: heading of −d (0 north, clockwise; x east, z south).
  const heading = ((Math.atan2(-d[0], d[1]) * 180) / Math.PI + 360) % 360;
  return { x: head.x, y: head.y, z: head.z, heading: Math.round(heading * 10) / 10,
    length: head.length, approach: best.index };
}

/** Signals (where the original signal heads hang, or none), a through street, or an all-way stop. */
function assignControl(junction, rules) {
  const list = junction.approaches;
  if (list.length <= 2) {
    junction.control = "none";
    for (const a of list) a.role = "major";
    return;
  }
  // The pair of streets that best continue each other.
  let best, bestScore = Infinity;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const straightness = Math.abs(signedTurn(list[i].dirIn, list[j].dirOut));
    if (straightness < bestScore) { bestScore = straightness; best = [list[i], list[j]]; }
  }
  const hasHeads = rules.signalsFromHeads ? (junction.heads?.length ?? 0) > 0 : list.length >= 4;
  if (hasHeads) {
    junction.control = "signal";
    const axis = best[0].dirIn;
    for (const a of list) {
      const along = Math.abs(a.dirIn[0] * axis[0] + a.dirIn[1] * axis[1]);
      a.group = along >= Math.SQRT1_2 ? 0 : 1;
      a.role = "signal";
    }
    if (!list.some(a => a.group === 1)) list.forEach((a, i) => { a.group = i % 2; });
    const { greenA, greenB, yellow, allRed } = rules.signal;
    const cycle = greenA + greenB + 2 * (yellow + allRed);
    junction.signal = { greenA, greenB, yellow, allRed, offset: hash(`signal:${junction.id}`) % cycle };
    return;
  }
  if (bestScore <= 45 && list.length === 3) {
    junction.control = "priority";
    for (const a of list) a.role = best.includes(a) ? "major" : "minor";
  } else {
    junction.control = "stop";
    for (const a of list) a.role = "minor";
  }
}
