// Native checks for the 卡丁城 fuel stations (kind "fuel" POIs): a drivable
// grid around a station, a path from the nearest design road into the refuel
// zone, and AL kart drives (straight out of the park pose, along a path).
// The caller passes the parsed native world: { surface, world, toWorld,
// toDesign, AL, tuning, scaleKart } with design x/z and world y up.
import { groundHeightAt } from '../../../src/city/city-ground.ts';

export const NEUTRAL_INPUT = { forward: 0, reverse: 0, steer: 0, rawSteer: 0, steeringInverted: false, rawDriftHeld: false, derivedDriftHeld: false, actionMarkerWord: 0 };

/** Design heading (0 = north/−z, clockwise) → unit design vector [dx, dz]. */
export const headingVector = degrees => { const r = degrees * Math.PI / 180; return [Math.sin(r), -Math.cos(r)]; };
const physicsYaw = degrees => Math.PI - degrees * Math.PI / 180;

export function pointInPolygon([x, z], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 0 inside the polygon, else the distance to its outline. */
export function distanceOutside(point, polygon) {
  if (pointInPolygon(point, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t));
  }
  return best;
}

/** The same turn direction at every corner ⇒ convex (either winding). */
export function isConvex(polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

export function polygonCentroid(polygon) {
  const n = polygon.length;
  return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n];
}

/** Nearest point on any design road centre line (roads store [x, z, y]), optionally on the level of `y`. */
export function nearestRoadPoint(design, x, z, { y, levelTolerance = 1.5 } = {}) {
  let best;
  for (const road of design.roads) {
    const points = road.points, count = road.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
      const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2)) : 0;
      const px = a[0] + dx * t, pz = a[1] + dz * t, distance = Math.hypot(px - x, pz - z), py = (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t;
      if (y !== undefined && Math.abs(py - y) > levelTolerance) continue; // a road on another level (an underpass, a bridge)
      if (!best || distance < best.distance) best = { road: road.id, at: [px, pz], y: py, distance };
    }
  }
  return best;
}

export function nativeQueries({ surface, toWorld }) {
  const rayQuery = (origin, movement, includeWalls) => {
    const fraction = surface.queryBest(origin, movement, includeWalls);
    if (!Number.isFinite(fraction)) return undefined;
    const hit = surface.buildHit(origin, movement, fraction);
    return { point: { ...hit.point }, normal: { ...hit.normal } };
  };
  return {
    rayQuery,
    /** Kart landing height (upward road surface) at design x/z near hintY. */
    ground(x, z, hintY) { const w = toWorld(x, 0, z); return groundHeightAt({ rayQuery }, w.x, w.z, hintY); },
    /** The first upward surface below hintY + 1.2 (what a kart there rests on), down to hintY − 2. */
    resting(x, z, hintY) {
      let top = hintY + 1.2;
      for (let i = 0; i < 4 && top > hintY - 2; i++) {
        const hit = rayQuery(toWorld(x, top, z), { x: 0, y: hintY - 2 - top, z: 0 }, false);
        if (!hit) return undefined;
        if (hit.normal.y >= .65) return hit.point.y;
        top = hit.point.y - .02;
      }
      return undefined;
    },
    /** Any solid between design points a and b (each [x, y, z]). */
    blocked(a, b) { const o = toWorld(a[0], a[1], a[2]); return !!rayQuery(o, { x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] }, true); },
    down(x, z, fromY, toY) { const o = toWorld(x, fromY, z); return rayQuery(o, { x: 0, y: toY - fromY, z: 0 }, true); },
  };
}

/**
 * A drivable grid in design space. A cell is open when it has an upward
 * surface within `hintY` −2…+1.2, nothing solid from 6 cm to `bodyHeight`
 * above it, and the kart's half width (`radius`) of open cells around it.
 * Between neighbours a horizontal sweep must be clear (thin walls) and the
 * height step must stay ≤ kerbStep; steps above maxStep are kerbs, which a
 * path may cross at a cost (whether the kart really climbs one is left to
 * the drive that follows the path).
 */
export function drivableGrid(queries, { min, max, hintY, cell = .4, maxStep = .06, kerbStep = .17, bodyHeight = .9, sweepHeight = .25, radius = .5 }) {
  const nx = Math.ceil((max[0] - min[0]) / cell), nz = Math.ceil((max[1] - min[1]) / cell);
  const height = new Float32Array(nx * nz).fill(NaN), solid = new Uint8Array(nx * nz);
  const center = (i, j) => [min[0] + (i + .5) * cell, min[1] + (j + .5) * cell];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const [x, z] = center(i, j), k = j * nx + i;
    const g = queries.resting(x, z, hintY);
    if (g === undefined) { solid[k] = 1; continue; }
    height[k] = g;
    if (queries.down(x, z, g + bodyHeight, g + .06)) solid[k] = 1;
  }
  // Walls (a hit sweep or a step above kerbStep) between orthogonal neighbours make both cells hard.
  const hard = Uint8Array.from(solid);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (solid[k]) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const i2 = i + di, j2 = j + dj; if (i2 >= nx || j2 >= nz) continue;
      const k2 = j2 * nx + i2; if (solid[k2]) continue;
      const a = center(i, j), b = center(i2, j2);
      if (Math.abs(height[k] - height[k2]) > kerbStep || queries.blocked([a[0], height[k] + sweepHeight, a[1]], [b[0], height[k2] + sweepHeight, b[1]])) hard[k] = hard[k2] = 1;
    }
  }
  // Dilate: a kart centre needs `radius` clear around it.
  const reach = Math.max(1, Math.round(radius / cell));
  const open = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let ok = !hard[j * nx + i];
    for (let dj = -reach; ok && dj <= reach; dj++) for (let di = -reach; ok && di <= reach; di++) {
      if (di * di + dj * dj > reach * reach + reach) continue;
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz || hard[j2 * nx + i2]) ok = false;
    }
    open[j * nx + i] = ok ? 1 : 0;
  }
  const index = (x, z) => { const i = Math.floor((x - min[0]) / cell), j = Math.floor((z - min[1]) / cell); return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i; };
  return { nx, nz, cell, min, max, maxStep, kerbStep, height, open, center: k => center(k % nx, Math.floor(k / nx)), index };
}

/**
 * Cheapest 8-connected path over open cells from `start` (design x/z) to the
 * first cell where goal(x, z) holds. A kerb step costs `kerbPenalty` metres;
 * cells within an `avoid` disk ({ at, radius }) are closed.
 */
export function findPath(grid, start, goal, { kerbPenalty = 25, avoid = [] } = {}) {
  const { nx, nz, height } = grid;
  const open = Uint8Array.from(grid.open);
  for (const disk of avoid) for (let k = 0; k < open.length; k++) { if (!open[k]) continue; const [x, z] = grid.center(k); if (Math.hypot(x - disk.at[0], z - disk.at[1]) < disk.radius) open[k] = 0; }
  let s = grid.index(start[0], start[1]);
  if (s < 0) return undefined;
  if (!open[s]) { // the road point may sit next to a kerb or a lamp post: take the nearest open cell within 4 m
    let best = -1, bestD = Infinity; const r = Math.ceil(4 / grid.cell), si = s % nx, sj = Math.floor(s / nx);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = si + di, j = sj + dj; if (i < 0 || j < 0 || i >= nx || j >= nz || !open[j * nx + i]) continue; const d = di * di + dj * dj; if (d < bestD) { bestD = d; best = j * nx + i; } }
    if (best < 0) return undefined;
    s = best;
  }
  const distance = new Float64Array(nx * nz).fill(Infinity), previous = new Int32Array(nx * nz).fill(-1);
  distance[s] = 0;
  const heap = [[0, s]];
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop(); if (d > distance[k]) continue;
    const [x, z] = grid.center(k);
    if (goal(x, z)) {
      const cells = []; for (let c = k; c >= 0; c = previous[c]) cells.push(c);
      cells.reverse();
      let kerbs = 0, length = 0;
      for (let c = 1; c < cells.length; c++) {
        const a = grid.center(cells[c - 1]), b = grid.center(cells[c]);
        length += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (Math.abs(height[cells[c]] - height[cells[c - 1]]) > grid.maxStep) kerbs++;
      }
      return { cells, length, kerbs, start: grid.center(s), points: cells.map(c => { const [cx, cz] = grid.center(c); return [cx, cz, height[c]]; }) };
    }
    const i = k % nx, j = Math.floor(k / nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i2 = i + di, j2 = j + dj; if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz) continue;
      const k2 = j2 * nx + i2; if (!open[k2]) continue;
      if (di && dj && (!open[j * nx + i2] || !open[j2 * nx + i])) continue;
      const step = Math.abs(height[k2] - height[k]);
      if (step > grid.kerbStep) continue;
      const nd = d + (di && dj ? Math.SQRT2 : 1) * grid.cell + (step > grid.maxStep ? kerbPenalty : 0);
      if (nd < distance[k2]) { distance[k2] = nd; previous[k2] = k; push([nd, k2]); }
    }
  }
  return undefined;
}

/** Thin a cell path to waypoints about `spacing` metres apart (keeps the end). */
export function waypoints(points, spacing = 2) {
  const out = [points[0]];
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (run >= spacing || i === points.length - 1) { out.push(points[i]); run = 0; }
  }
  return out;
}

function newKart(ctx, x, z, y, heading) {
  const kart = new ctx.AL(ctx.tuning, { rawHalfWidth: .9, rawHalfLength: 1.5, scaleX: 1, scaleY: 1, rawHeight: 1 });
  ctx.scaleKart(kart);
  const start = ctx.toWorld(x, y + .4, z);
  kart.reset(start.x, start.y, start.z, physicsYaw(heading));
  ctx.world.resetRouteState(kart, kart.body.position);
  kart.update(10000, NEUTRAL_INPUT, ctx.world);
  return kart;
}

/**
 * Drive from a pose with full throttle (capped at maxKmh) and the steering of
 * `steerFor(designPosition, designHeading)`; `done(designPosition)` ends it.
 * Fails on an automatic reset, a fall (y below startY − fallLimit), a non-finite
 * pose or no progress for `stallMs`.
 */
export function drive(ctx, { at, y, heading, maxKmh = 30, timeoutMs = 20000, stallMs = 2500, fallLimit = 1.5, steerFor = () => 0, done }) {
  const result = { start: [at[0], y, at[1]], heading, reached: false, automaticReset: false, fell: false, stalled: false, maxSpeedKmh: 0, groundedTicks: 0, ticks: 0, distance: 0, trajectory: [] };
  try {
    const kart = newKart(ctx, at[0], at[1], y, heading);
    let last = ctx.toDesign(kart.body.position), lastMoveTime = 10000, moved = 0;
    for (let time = 10016; time <= 10000 + timeoutMs; time += 16) {
      const p = ctx.toDesign(kart.body.position), f = kart.body.forward;
      const currentHeading = ((Math.atan2(f.x, -f.z) * 180 / Math.PI) % 360 + 360) % 360;
      const steer = Math.max(-1, Math.min(1, steerFor(p, currentHeading)));
      const speed = kart.displaySpeedKmh();
      kart.update(time, { ...NEUTRAL_INPUT, forward: speed < maxKmh ? 1 : 0, steer, rawSteer: steer }, ctx.world);
      const q = ctx.toDesign(kart.body.position);
      result.ticks++;
      if (kart.wheels.grounded) result.groundedTicks++;
      result.maxSpeedKmh = Math.max(result.maxSpeedKmh, kart.displaySpeedKmh());
      const step = Math.hypot(q.x - last.x, q.z - last.z); result.distance += step; moved += step; last = q;
      if (moved > .5) { moved = 0; lastMoveTime = time; }
      if ((time - 10016) % 160 === 0) result.trajectory.push([+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), kart.wheels.grounded ? 1 : 0]);
      if (kart.consumeAutomaticResetRequest()) { result.automaticReset = true; break; }
      if (![q.x, q.y, q.z].every(Number.isFinite)) { result.invalidPosition = true; break; }
      if (q.y < y - fallLimit) { result.fell = true; break; }
      if (time - lastMoveTime > stallMs) { result.stalled = true; break; }
      if (done(q) && kart.wheels.grounded) { result.reached = true; break; }
    }
    const end = ctx.toDesign(kart.body.position);
    result.final = [+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)];
  } catch (error) { result.error = error.message; }
  result.passed = result.reached && !result.automaticReset && !result.fell && !result.stalled && !result.invalidPosition && !result.error;
  return result;
}

/** Pure-pursuit steering along design waypoints [x, z, …] (positive heading error = target to the right). */
export function pursuit(points, lookahead = 2.5) {
  let index = 0;
  return (p, currentHeading) => {
    while (index < points.length - 1 && Math.hypot(points[index][0] - p.x, points[index][1] - p.z) < lookahead) index++;
    const target = points[index];
    const want = Math.atan2(target[0] - p.x, -(target[1] - p.z)) * 180 / Math.PI;
    const delta = ((want - currentHeading) % 360 + 540) % 360 - 180;
    return -delta / 25; // AL steer +1 turns left (heading decreases)
  };
}

/** Heading (design degrees) from a to b. */
export const headingTo = (a, b) => ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI) % 360 + 360) % 360;

/**
 * Can a kart get from the nearest road on the zone's level into the zone?
 * Plans a path on the drivable grid, drives it with the native kart and,
 * when the kart stalls (an unclimbable kerb, a post the grid missed), closes
 * a disk around that spot and plans again.
 */
export function reachZone(ctx, queries, design, zone, y, { margin = 45, attempts = 8, cell = .4, maxKmh = 20, avoidRadius = 2.5, kerbPenalty = 200, roadLevelTolerance = 1.5, from } = {}) {
  const center = polygonCentroid(zone);
  const road = from ? { road: 'given', at: from, distance: Math.hypot(from[0] - center[0], from[1] - center[1]) } : nearestRoadPoint(design, center[0], center[1], { y, levelTolerance: roadLevelTolerance });
  const result = { road, attempts: [], passed: false };
  if (!road) return result;
  const xs = [...zone.map(p => p[0]), road.at[0]], zs = [...zone.map(p => p[1]), road.at[1]];
  const grid = drivableGrid(queries, { min: [Math.min(...xs) - margin, Math.min(...zs) - margin], max: [Math.max(...xs) + margin, Math.max(...zs) + margin], hintY: y, cell });
  result.grid = { nx: grid.nx, nz: grid.nz, cell, open: grid.open.reduce((a, b) => a + b, 0) };
  const inZone = (x, z) => pointInPolygon([x, z], zone);
  const avoid = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const path = findPath(grid, road.at, inZone, { avoid, kerbPenalty });
    if (!path) { result.attempts.push({ path: undefined }); break; }
    const points = waypoints(path.points, 1.5);
    const startHeading = headingTo(points[0], points[Math.min(2, points.length - 1)]);
    const drove = drive(ctx, { at: [points[0][0], points[0][1]], y: points[0][2], heading: startHeading, maxKmh, timeoutMs: Math.max(20000, path.length * 600), steerFor: pursuit(points, 2), done: q => inZone(q.x, q.z) });
    result.attempts.push({ pathLength: +path.length.toFixed(1), kerbs: path.kerbs, start: points[0].map(v => +v.toFixed(2)), waypoints: points.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]), drive: { ...drove, trajectory: drove.trajectory.filter((_, i) => i % 4 === 0) } });
    if (drove.passed) { result.passed = true; result.entry = drove.final; break; }
    if (!drove.final) break;
    avoid.push({ at: [drove.final[0], drove.final[2]], radius: avoidRadius });
  }
  Object.defineProperty(result, 'gridData', { value: grid, enumerable: false }); // for debug renders; not serialised
  return result;
}
