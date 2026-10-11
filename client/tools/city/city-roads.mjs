// Road sweeps, guard rails, tunnel box and the ring route records.
import { densify2, polylineFrames2, pointInPolygon2, smoothstep } from "./geometry.mjs";

const LIFT = { expressway: 0.06, avenue: 0.05, street: 0.04, lane: 0.03, circuit: 0.04, tunnel: 0.02 };

/** Samples a design road: points with s, tangents, normals, width and elevation. */
export function sampleRoad(design, road, terrain, step = 6) {
  const type = design.roadTypes[road.type];
  const plan = road.points.map(p => [p[0], p[1]]);
  const { points, s, total } = densify2(plan, step, !!road.closed);
  const { tangents, normals } = polylineFrames2(points, !!road.closed);
  const sea = design.water.sea.polygon;
  const elevation = new Array(points.length);
  const overSea = points.map(p => pointInPolygon2(p, sea));
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    if (road.id === "tunnel") { elevation[i] = LIFT.tunnel; continue; }
    if (road.id === "mountain") { elevation[i] = terrain.land(x, z) + 0.1; continue; }
    let y = Math.max(terrain.height(x, z), 0) + LIFT[road.type];
    if (road.type === "expressway" && road.closed) {
      // 跨海大桥: lift the ring 20 m over the bay with 160 m ramps on both sides.
      let lift = 0;
      for (let k = 0; k < points.length; k++) {
        if (!overSea[k]) continue;
        const ds = Math.min(Math.abs(s[k] - s[i]), total - Math.abs(s[k] - s[i]));
        lift = Math.max(lift, 20 * smoothstep(160, 0, ds));
      }
      y += lift;
    }
    elevation[i] = y;
  }
  return { road, type, points, s, total, tangents, normals, elevation, overSea, width: type.width };
}

const edge = (sample, i, side, extra = 0) => {
  const [x, z] = sample.points[i];
  const [nx, nz] = sample.normals[i];
  const d = side * (sample.width / 2 + extra);
  return [x + nx * d, z + nz * d];
};

/** Road deck quads. */
export function buildRoadSurface(city, sample, surface) {
  const n = sample.points.length;
  const closed = !!sample.road.closed;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const l0 = edge(sample, i, 1), r0 = edge(sample, i, -1), l1 = edge(sample, j, 1), r1 = edge(sample, j, -1);
    const y0 = sample.elevation[i], y1 = sample.elevation[j];
    const v0 = sample.s[i] / sample.width, v1 = (closed && j === 0 ? sample.total : sample.s[j]) / sample.width;
    const mid = [(l0[0] + r1[0]) / 2, (l0[1] + r1[1]) / 2];
    const builder = city.mesh(`road:${sample.road.id}`, surface, mid[0], mid[1]);
    builder.pushQuad(
      [city.client(l0[0], l0[1], y0), [0, v0]],
      [city.client(r0[0], r0[1], y0), [1, v0]],
      [city.client(r1[0], r1[1], y1), [1, v1]],
      [city.client(l1[0], l1[1], y1), [0, v1]],
    );
  }
}

/**
 * A vertical rail/wall along one side (+1 left, -1 right) of the road:
 * height `h`, drawn double-sided; `where(i)` filters the samples.
 */
export function buildRoadWall(city, sample, surface, side, h, where = () => true, offset = 0.2, base = 0) {
  const n = sample.points.length;
  const closed = !!sample.road.closed;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    if (!where(i) && !where(j)) continue;
    const a = edge(sample, i, side, offset), b = edge(sample, j, side, offset);
    const y0 = sample.elevation[i] + base, y1 = sample.elevation[j] + base;
    const u0 = sample.s[i] / h, u1 = (closed && j === 0 ? sample.total : sample.s[j]) / h;
    const builder = city.mesh(`wall:${sample.road.id}`, surface, a[0], a[1]);
    // Face the road: for the left side the wall's front faces −normal.
    const quad = [
      [city.client(a[0], a[1], y0), [u0, 1]],
      [city.client(b[0], b[1], y0), [u1, 1]],
      [city.client(b[0], b[1], y1 + h), [u1, 0]],
      [city.client(a[0], a[1], y0 + h), [u0, 0]],
    ];
    if (side > 0) builder.pushQuad(quad[0], quad[1], quad[2], quad[3]);
    else builder.pushQuad(quad[1], quad[0], quad[3], quad[2]);
  }
}

/** Tunnel ceiling: a flat slab above the road between the two walls. */
export function buildRoadCeiling(city, sample, surface, h) {
  const n = sample.points.length;
  for (let i = 0; i + 1 < n; i++) {
    const j = i + 1;
    const l0 = edge(sample, i, 1, 0.2), r0 = edge(sample, i, -1, 0.2), l1 = edge(sample, j, 1, 0.2), r1 = edge(sample, j, -1, 0.2);
    const y0 = sample.elevation[i] + h, y1 = sample.elevation[j] + h;
    const builder = city.mesh(`ceiling:${sample.road.id}`, surface, l0[0], l0[1]);
    builder.pushQuad(
      [city.client(r0[0], r0[1], y0), [1, sample.s[i] / 10]],
      [city.client(l0[0], l0[1], y0), [0, sample.s[i] / 10]],
      [city.client(l1[0], l1[1], y1), [0, sample.s[j] / 10]],
      [city.client(r1[0], r1[1], y1), [1, sample.s[j] / 10]],
    );
  }
}

/** ToRoad records for a closed loop: a gate every `gateSpacing` metres. */
export function routeRecords(city, sample, { gateSpacing = 100, frameStride = 3, gateMargin = 6 } = {}) {
  const n = sample.points.length;
  const gates = [];
  let nextS = 0;
  for (let i = 0; i < n; i++) if (sample.s[i] >= nextS - 1e-6) { gates.push(i); nextS += gateSpacing; }
  if (sample.total - sample.s[gates[gates.length - 1]] < gateSpacing * 0.5) gates.pop();
  const forward = i => { const [tx, tz] = sample.tangents[i]; const c = city.clientDirection(tx, tz); return [c[0], c[1], 0]; };
  const records = [];
  for (let g = 0; g < gates.length; g++) {
    const i = gates[g], next = gates[(g + 1) % gates.length];
    const y = sample.elevation[i];
    const l = edge(sample, i, 1, gateMargin), r = edge(sample, i, -1, gateMargin);
    const positions = [
      city.client(l[0], l[1], y - 1), city.client(r[0], r[1], y - 1),
      city.client(l[0], l[1], y + 21), city.client(r[0], r[1], y + 21),
    ];
    const frames = [];
    const span = next > i ? next - i : next + n - i;
    for (let k = 0; k <= span; k += frameStride) {
      const index = (i + k) % n;
      const [x, z] = sample.points[index];
      frames.push({ position: city.client(x, z, sample.elevation[index] + 1), storedForward: forward(index), up: [0, 0, 1] });
    }
    const lastIndex = next;
    const [lx, lz] = sample.points[lastIndex];
    const last = frames[frames.length - 1];
    if ((lastIndex - i + n) % n !== Math.floor(span / frameStride) * frameStride)
      frames.push({ position: city.client(lx, lz, sample.elevation[lastIndex] + 1), storedForward: forward(lastIndex), up: [0, 0, 1] });
    else if (last) { last.position = city.client(lx, lz, sample.elevation[lastIndex] + 1); last.storedForward = forward(lastIndex); }
    records.push({ name: `g${String(g).padStart(3, "0")}`, positions, gateIndices: [[0, 1, 3], [0, 3, 2]], surface: "", surfaceIndices: [], frames });
  }
  return records;
}
