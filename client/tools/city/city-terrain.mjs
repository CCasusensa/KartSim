// Terrain height field, water masks and the ground/water meshes.
import { MeshBuilder, clamp, densify2, lerp, pointInPolygon2, pointPolylineDistance2, polygonInset2, smoothstep, triangulate2 } from "./geometry.mjs";

export const WATER_DEPTH = -8;
export const WATER_LEVEL = -1.6;
export const TUNNEL_CEILING = 7;

/** Builds the height function h(x, z) (world metres) from the design. */
export function createTerrain(design) {
  // v2 (official-track districts): flat ground, no water or mountains.
  if (!design.water) return { height: () => 0, land: () => 0, water: () => -Infinity, isWater: () => false, flat: true };
  const sea = design.water.sea.polygon;
  const river = densify2(design.water.river.points, 15, false).points;
  const riverHalf = design.water.river.width / 2;
  const lake = design.water.lake;
  const tunnel = design.roads.find(road => road.id === "tunnel");
  const tunnelLine = tunnel ? tunnel.points.map(p => [p[0], p[1]]) : [];
  const forest = design.districts.find(d => d.id === "forest")?.polygon;

  const gauss = (x, z, cx, cz, sigma) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * sigma * sigma));
  const land = (x, z) => {
    let h = 150 * gauss(x, z, -1180, -1180, 200) + 40 * gauss(x, z, -800, -800, 120);
    if (forest && pointInPolygon2([x, z], forest)) {
      const inset = polygonInset2([x, z], forest);
      h += 5 * Math.sin(x / 90) * Math.cos(z / 70) * smoothstep(0, 60, inset);
    }
    return Math.max(0, h);
  };
  /** Positive inside water, negative outside (metres to the shoreline). */
  const waterDepthField = (x, z) => {
    let w = polygonInset2([x, z], sea);
    w = Math.max(w, riverHalf - pointPolylineDistance2([x, z], river, false));
    w = Math.max(w, lake.radius - Math.hypot(x - lake.center[0], z - lake.center[1]));
    return w;
  };
  const height = (x, z) => {
    const w = waterDepthField(x, z);
    const t = smoothstep(-16, 10, w);
    let h = lerp(land(x, z), WATER_DEPTH, t);
    if (tunnelLine.length && pointPolylineDistance2([x, z], tunnelLine, false) < 11)
      h = Math.max(h, TUNNEL_CEILING);
    return h;
  };
  return { height, land, water: waterDepthField, isWater: (x, z) => waterDepthField(x, z) > 0 };
}

/** Which district (by id) a world point belongs to, or undefined. */
export function districtAt(design, x, z) {
  for (const d of design.districts) {
    if (d.circle) { const [cx, cz, r] = d.circle; if (Math.hypot(x - cx, z - cz) <= r) return d; }
  }
  for (const d of design.districts) if (d.polygon && pointInPolygon2([x, z], d.polygon)) return d;
  return undefined;
}

/**
 * Emits ground tiles into `city.mesh(...)` grouped by surface texture.
 * `surfaceOf(x, z)` returns { texture, road } for a cell centre.
 */
export function buildGround(city, terrain, surfaceOf, { cell = 40, skip = () => false } = {}) {
  const [min, max] = city.design.meta.extent;
  const columns = Math.round((max[0] - min[0]) / cell), rows = Math.round((max[1] - min[1]) / cell);
  const heights = [];
  for (let j = 0; j <= rows; j++) {
    heights.push([]);
    for (let i = 0; i <= columns; i++) heights[j].push(terrain.height(min[0] + i * cell, min[1] + j * cell));
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x0 = min[0] + i * cell, z0 = min[1] + j * cell, x1 = x0 + cell, z1 = z0 + cell;
    if (skip(x0 + cell / 2, z0 + cell / 2)) continue;
    const surface = surfaceOf(x0 + cell / 2, z0 + cell / 2);
    const corners = [
      [x0, z0, heights[j][i]], [x1, z0, heights[j][i + 1]],
      [x1, z1, heights[j + 1][i + 1]], [x0, z1, heights[j + 1][i]],
    ];
    const uv = ([x, z]) => [x / 16, z / 16];
    // Ground quads: counter-clockwise seen from above once converted to client space.
    const builder = city.mesh(`ground:${surface.texture}`, surface, x0 + cell / 2, z0 + cell / 2);
    const [a, b, c, d] = corners.map(p => [city.client(p[0], p[1], p[2]), uv(p)]);
    builder.pushQuad(a, d, c, b, undefined, UP);
  }
}
const UP = [0, 0, 1];

/** Water surfaces at WATER_LEVEL (not drivable). */
export function buildWater(city, surfaces) {
  const level = WATER_LEVEL;
  const { sea, river, lake } = city.design.water;
  const seaUv = p => [p[0] / 40, p[1] / 40];
  // Sea: clip the polygon to the map extent by densifying and triangulating as is.
  const seaBuilder = city.mesh("water:sea", surfaces.sea, 900, 900);
  const polygon = sea.polygon.map(p => [clamp(p[0], -1200, 1200), clamp(p[1], -1200, 1200)]);
  for (const [ia, ib, ic] of triangulate2(polygon)) {
    const corner = index => [city.client(polygon[index][0], polygon[index][1], level), seaUv(polygon[index])];
    seaBuilder.pushTriangle(corner(ia), corner(ib), corner(ic), undefined, UP);
  }
  // River: a strip along the centreline.
  const { points } = densify2(river.points, 12, false);
  const half = river.width / 2 + 6;
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i], q = points[i + 1];
    const tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    const corners = [[p[0] + nx * half, p[1] + nz * half], [p[0] - nx * half, p[1] - nz * half], [q[0] - nx * half, q[1] - nz * half], [q[0] + nx * half, q[1] + nz * half]];
    const builder = city.mesh("water:river", surfaces.river, p[0], p[1]);
    const [a, b, c, d] = corners.map(v => [city.client(v[0], v[1], level), seaUv(v)]);
    builder.pushQuad(a, d, c, b, undefined, UP);
  }
  // Lake: a fan.
  const lakeBuilder = city.mesh("water:lake", surfaces.river, lake.center[0], lake.center[1]);
  const center = lakeBuilder.vertex(city.client(lake.center[0], lake.center[1], level), seaUv(lake.center), [0, 0, 1]);
  const ring = [];
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = [lake.center[0] + Math.cos(a) * (lake.radius + 8), lake.center[1] + Math.sin(a) * (lake.radius + 8)];
    ring.push(lakeBuilder.vertex(city.client(p[0], p[1], level), seaUv(p), [0, 0, 1]));
  }
  for (let i = 0; i < segments; i++) lakeBuilder.triangle(center, ring[(i + 1) % segments], ring[i]);
}
