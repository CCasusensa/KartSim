/**
 * The street graph NPC traffic drives on, from the centre lines of the real
 * Vice City asphalt (road-skeleton.mjs: split at its junction pixels). Road
 * ends that meet become nodes; the (closed) asphalt raster gives each road
 * its width. Plazas, the
 * airport aprons and slivers are dropped, junction pixels that the skeleton
 * spread over a wide crossing are merged into one junction, dead ends are
 * pruned (traffic never has to turn round) and bends are joined, leaving a
 * network of streets between junctions.
 */

export const GRAPH_RULES = {
  /** Road ends closer than this (m) meet at one node. */
  endTolerance: 3,
  /** Streets narrower or wider than this (median asphalt width, m) carry no traffic. */
  minWidth: 6.5,
  maxWidth: 30,
  /** Wider pieces at least this long (m) are plazas and aprons. */
  minPlaza: 60,
  /** Pieces shorter than this (m) are junction pieces: not measured, never dropped for their width. */
  junctionPiece: 16,
  /** Width samples every this many m along a road. */
  widthSpacing: 4,
  /** A street piece shorter than this (m) between junctions is merged into them. */
  minStreet: 10,
  /** Share of a piece's course that must have real asphalt within `asphaltReach` m. */
  minAsphalt: 0.6,
  asphaltReach: 7,
  /** Two streets between the same junctions this far apart (m, at their middles) are a divided road. */
  carriageways: [5, 45],
  /** Components with less street than this (m) are dropped. */
  minComponent: 1500,
};

const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return length;
}

/** Points every `spacing` m along a polyline ([x, z, y]), ends included. */
export function resample(points, spacing) {
  const total = polylineLength(points);
  const count = Math.max(1, Math.round(total / spacing));
  const out = [];
  let segment = 1, segmentStart = 0;
  for (let k = 0; k <= count; k++) {
    const target = (total * k) / count;
    while (segment < points.length - 1) {
      const length = Math.hypot(points[segment][0] - points[segment - 1][0], points[segment][1] - points[segment - 1][1]);
      if (segmentStart + length >= target) break;
      segmentStart += length;
      segment++;
    }
    const a = points[segment - 1], b = points[segment];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, Math.max(0, (target - segmentStart) / length));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t]);
  }
  return out;
}

/** The asphalt width (m) across a road, sampled perpendicular to it. */
export function roadWidth(raster, points, spacing = GRAPH_RULES.widthSpacing) {
  const samples = resample(points, spacing);
  const widths = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1], b = samples[i + 1], p = samples[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / length, tz = (b[1] - a[1]) / length;
    // Right of the direction of travel in design coordinates (x east, z south).
    const rx = -tz, rz = tx;
    widths.push(raster.reach(p[0], p[1], rx, rz) + raster.reach(p[0], p[1], -rx, -rz));
  }
  if (!widths.length) return 0;
  // A low quantile: a street that passes a car park or a forecourt keeps its own width.
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length * 0.3)];
}

class UnionFind {
  constructor() { this.parent = new Map(); }
  find(a) {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let root = a;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(a) !== root) { const next = this.parent.get(a); this.parent.set(a, root); a = next; }
    return root;
  }
  union(a, b) { this.parent.set(this.find(a), this.find(b)); }
}

/**
 * Builds the street graph: { nodes: Map<id, {x, z, y}>, edges: Map<id,
 * {id, a, b, points, width, roads}> } with every edge running a → b.
 */
export function buildRoadGraph(roads, raster, rules = GRAPH_RULES, log = () => {}, asphalt = raster) {
  // 1. Every road end becomes a node; nearby ends share it.
  const ends = [];
  const pieces = [];
  for (const [index, road] of roads.entries()) {
    const points = road.points.map(p => [p[0], p[1], p[2] ?? 0]);
    if (points.length < 2) continue;
    const piece = { road: index, points };
    piece.ends = [{ piece, at: 0, p: points[0] }, { piece, at: 1, p: points[points.length - 1] }];
    pieces.push(piece);
    ends.push(...piece.ends);
  }
  const sets = new UnionFind();
  const grid = new Map();
  const cell = p => `${Math.floor(p[0] / 8)},${Math.floor(p[1] / 8)}`;
  ends.forEach((end, i) => {
    const [cx, cz] = cell(end.p).split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        const other = ends[j];
        if (Math.hypot(other.p[0] - end.p[0], other.p[1] - end.p[1]) <= rules.endTolerance) sets.union(i, j);
      }
    }
    const k = cell(end.p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const nodes = new Map();
  const members = new Map();
  ends.forEach((end, i) => {
    const root = sets.find(i);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(end);
    end.node = root;
  });
  for (const [root, list] of members) {
    const x = list.reduce((sum, e) => sum + e.p[0], 0) / list.length;
    const z = list.reduce((sum, e) => sum + e.p[1], 0) / list.length;
    const y = list.reduce((sum, e) => sum + e.p[2], 0) / list.length;
    nodes.set(root, { x, z, y });
  }

  // 2. Edges with their widths; the wrong widths carry no traffic.
  const edges = new Map();
  let nextEdge = 0;
  let dropped = { narrow: 0, wide: 0, median: 0 };
  for (const piece of pieces) {
    const a = piece.ends[0].node, b = piece.ends[1].node;
    // Closing the raster also bridges a median at its ends: a piece across
    // it is not a street.
    if (onAsphalt(asphalt, piece.points, rules) < rules.minAsphalt) { dropped.median++; continue; }
    // Pieces inside a junction are too short to measure (across them lies
    // the crossing street): they stay, without a width of their own.
    const short = polylineLength(piece.points) < rules.junctionPiece;
    const width = short ? undefined : roadWidth(raster, piece.points);
    if (width < rules.minWidth) { dropped.narrow++; continue; }
    // A wide stretch is a car park, plaza or apron only when it is long; a
    // short one is a crossing or forecourt the street runs through.
    if (width > rules.maxWidth && polylineLength(piece.points) >= rules.minPlaza) { dropped.wide++; continue; }
    const points = piece.points.map(p => [...p]);
    points[0] = [nodes.get(a).x, nodes.get(a).z, points[0][2]];
    points[points.length - 1] = [nodes.get(b).x, nodes.get(b).z, points[points.length - 1][2]];
    edges.set(nextEdge, { id: nextEdge, a, b, points, width, roads: [piece.road] });
    nextEdge++;
  }
  log(`道路 ${pieces.length} 段，丢弃：窄 ${dropped.narrow}、宽 ${dropped.wide}、横穿隔离带 ${dropped.median}`);

  const graph = { nodes, edges, nextEdge };
  let changed = true;
  while (changed) {
    changed = false;
    changed = dropLoops(graph) || changed;
    changed = mergeShortStreets(graph, rules) || changed;
    changed = pruneDeadEnds(graph) || changed;
    changed = joinBends(graph) || changed;
    changed = dropDuplicates(graph) || changed;
  }
  keepLargeComponents(graph, rules, log);
  markOneWayPairs(graph, rules, log);
  return graph;
}

function incident(graph) {
  const list = new Map();
  for (const id of graph.nodes.keys()) list.set(id, []);
  for (const edge of graph.edges.values()) {
    list.get(edge.a).push(edge);
    if (edge.b !== edge.a) list.get(edge.b).push(edge);
  }
  return list;
}

/** Short self-loops are skeleton artifacts around a junction's paint; long ones get a middle node. */
function dropLoops(graph) {
  let changed = false;
  for (const edge of [...graph.edges.values()]) {
    if (edge.a !== edge.b) continue;
    const length = polylineLength(edge.points);
    graph.edges.delete(edge.id);
    changed = true;
    if (length < 60) continue;
    const half = Math.floor(edge.points.length / 2);
    const mid = edge.points[half];
    const node = `m${edge.id}`;
    graph.nodes.set(node, { x: mid[0], z: mid[1], y: mid[2] });
    graph.edges.set(graph.nextEdge, { ...edge, id: graph.nextEdge++, b: node, points: edge.points.slice(0, half + 1) });
    graph.edges.set(graph.nextEdge, { ...edge, id: graph.nextEdge++, a: node, points: edge.points.slice(half) });
  }
  return changed;
}

/**
 * A street piece shorter than the crossing it sits in is part of that
 * junction: its two nodes merge (at the mean of their positions).
 */
function mergeShortStreets(graph, rules) {
  const list = incident(graph);
  const radius = node => Math.max(0, ...(list.get(node) ?? []).map(e => (e.width ?? 0) / 2));
  let best;
  for (const edge of graph.edges.values()) {
    if (edge.a === edge.b) continue;
    const length = polylineLength(edge.points);
    const limit = Math.max(rules.minStreet, radius(edge.a) + radius(edge.b) + 2);
    if (length < limit && (!best || length < best.length)) best = { edge, length };
  }
  if (!best) return false;
  const { edge } = best;
  const a = graph.nodes.get(edge.a), b = graph.nodes.get(edge.b);
  const merged = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: (a.y + b.y) / 2 };
  graph.edges.delete(edge.id);
  graph.nodes.set(edge.a, merged);
  graph.nodes.delete(edge.b);
  for (const other of graph.edges.values()) {
    if (other.a === edge.b) other.a = edge.a;
    if (other.b === edge.b) other.b = edge.a;
    if (other.a === edge.a) other.points[0] = [merged.x, merged.z, other.points[0][2]];
    if (other.b === edge.a) other.points[other.points.length - 1] = [merged.x, merged.z, other.points[other.points.length - 1][2]];
  }
  return true;
}

/** Streets that end nowhere would make traffic turn round: they go, repeatedly. */
function pruneDeadEnds(graph) {
  let changed = false;
  for (;;) {
    const list = incident(graph);
    const dead = [...list].filter(([, edges]) => edges.length === 0 || (edges.length === 1 && edges[0].a !== edges[0].b));
    if (!dead.length) break;
    for (const [node, edges] of dead) {
      for (const e of edges) graph.edges.delete(e.id);
      graph.nodes.delete(node);
    }
    changed = true;
  }
  return changed;
}

/** A node with exactly two streets is a bend: the streets join. */
function joinBends(graph) {
  const list = incident(graph);
  for (const [node, edges] of list) {
    if (edges.length !== 2) continue;
    const [e1, e2] = edges;
    if (e1.a === e1.b || e2.a === e2.b) continue;
    const p1 = e1.b === node ? e1.points : [...e1.points].reverse();
    const p2 = e2.a === node ? e2.points : [...e2.points].reverse();
    const start = e1.b === node ? e1.a : e1.b;
    const end = e2.a === node ? e2.b : e2.a;
    if (start === end) continue; // would close a loop on itself
    const measured = [e1, e2].filter(e => e.width !== undefined);
    const width = measured.length
      ? measured.reduce((sum, e) => sum + e.width * polylineLength(e.points), 0) /
        measured.reduce((sum, e) => sum + polylineLength(e.points), 0)
      : undefined;
    graph.edges.delete(e1.id);
    graph.edges.delete(e2.id);
    graph.nodes.delete(node);
    graph.edges.set(graph.nextEdge, { id: graph.nextEdge, a: start, b: end, points: [...p1, ...p2.slice(1)],
      width, roads: [...e1.roads, ...e2.roads] });
    graph.nextEdge++;
    return true;
  }
  return false;
}

/** Two streets between the same nodes with the same course are one street. */
function dropDuplicates(graph) {
  const seen = new Map();
  let changed = false;
  for (const edge of [...graph.edges.values()]) {
    const k = key(edge.a, edge.b);
    const length = polylineLength(edge.points);
    const others = seen.get(k) ?? [];
    const twin = others.find(o => Math.abs(o.length - length) < Math.max(4, 0.1 * length) &&
      midpointDistance(o.edge, edge) < Math.max(o.edge.width ?? 4, edge.width ?? 4) / 2);
    if (twin) { graph.edges.delete(edge.id); changed = true; continue; }
    others.push({ edge, length });
    seen.set(k, others);
  }
  return changed;
}

function midpointDistance(e1, e2) {
  const m1 = e1.points[Math.floor(e1.points.length / 2)], m2 = e2.points[Math.floor(e2.points.length / 2)];
  return Math.hypot(m1[0] - m2[0], m1[1] - m2[1]);
}

function keepLargeComponents(graph, rules, log) {
  const list = incident(graph);
  const seen = new Set();
  const components = [];
  for (const start of graph.nodes.keys()) {
    if (seen.has(start)) continue;
    const stack = [start], nodes = [], edgeIds = new Set();
    seen.add(start);
    while (stack.length) {
      const node = stack.pop();
      nodes.push(node);
      for (const e of list.get(node) ?? []) {
        edgeIds.add(e.id);
        for (const next of [e.a, e.b]) if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    const length = [...edgeIds].reduce((sum, id) => sum + polylineLength(graph.edges.get(id).points), 0);
    components.push({ nodes, edgeIds, length });
  }
  components.sort((a, b) => b.length - a.length);
  for (const component of components) {
    if (component.length >= rules.minComponent) continue;
    for (const id of component.edgeIds) graph.edges.delete(id);
    for (const node of component.nodes) graph.nodes.delete(node);
  }
  const kept = components.filter(c => c.length >= rules.minComponent);
  log(`连通片 ${components.length} 个，保留 ${kept.length} 个：${kept.map(c => Math.round(c.length)).join("、")} m`);
}

/** The share of a line's course with asphalt on it or within `asphaltReach` m across it. */
function onAsphalt(asphalt, points, rules) {
  const samples = resample(points, 2);
  if (samples.length < 3) return 1;
  let hits = 0, total = 0;
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1], b = samples[i + 1], p = samples[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const rx = -(b[1] - a[1]) / length, rz = (b[0] - a[0]) / length;
    total++;
    if (asphalt.isRoad(p[0], p[1])) { hits++; continue; }
    const right = asphalt.run(p[0], p[1], rx, rz, rules.asphaltReach, rules.asphaltReach + 1);
    const left = asphalt.run(p[0], p[1], -rx, -rz, rules.asphaltReach, rules.asphaltReach + 1);
    if (right && left) hits++; // a median: carriageways on both sides
  }
  return total ? hits / total : 1;
}

/**
 * Two streets between the same pair of junctions, side by side, are the
 * carriageways of a divided road: each becomes one-way, the direction that
 * keeps the other carriageway on its left (traffic keeps right). An edge's
 * `oneway` is 1 for a → b, -1 for b → a.
 */
function markOneWayPairs(graph, rules, log) {
  const byPair = new Map();
  for (const edge of graph.edges.values()) {
    const k = key(edge.a, edge.b);
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(edge);
  }
  let pairs = 0;
  for (const list of byPair.values()) {
    if (list.length !== 2) continue;
    const [e1, e2] = list;
    const l1 = polylineLength(e1.points), l2 = polylineLength(e2.points);
    if (Math.min(l1, l2) / Math.max(l1, l2) < 0.7) continue;
    const gap = midpointDistance(e1, e2);
    if (gap < rules.carriageways[0] || gap > rules.carriageways[1]) continue;
    for (const [edge, other] of [[e1, e2], [e2, e1]]) {
      const i = Math.floor(edge.points.length / 2);
      const p = edge.points[i], q = edge.points[Math.min(edge.points.length - 1, i + 1)], o = edge.points[Math.max(0, i - 1)];
      const tx = q[0] - o[0], tz = q[1] - o[1];
      const m = other.points[Math.floor(other.points.length / 2)];
      // Cross product < 0: the other carriageway is on the left of a → b (x east, z south).
      const cross = tx * (m[1] - p[1]) - tz * (m[0] - p[0]);
      edge.oneway = cross < 0 ? 1 : -1;
    }
    if (e1.oneway === e2.oneway) {
      // The two runs point the same way relative to their own a → b.
      e2.oneway = e1.a === e2.a ? -e1.oneway : e1.oneway;
    }
    pairs++;
  }
  log(`分离式道路（单行车行道对）${pairs} 对`);
}
