// Tripo props listed in the design's top-level `props` array, placed by the
// native importer on top of the converted city:
//
//   { "id": "prop-fuel-washington", "asset": "c_gasstation", "at": [x, z],
//     "y": groundY, "heading": deg, "size": [w, d, h], "lift": 0.04 }
//
// Model axes: glTF x = across (w), glTF z = the long axis (d), glTF y = up (h);
// `size` is the scaled bounding box. The bounding-box centre (x, z) lands on
// `at`. `heading` (design degrees, 0 = north/−z, clockwise) is where the
// model's −z end points; its +x side then faces heading + 90. The base slab's
// top (the biggest up-facing level in the lower quarter of the model) sits
// `lift` metres (default 0.04, at most 0.1) above `y`, so the slab is nearly
// flush with the ground and drivable. Props are solid (`kr_road: "{}"`).
//
// A `kind: "ramp"` prop is a dropped kerb generated here (no asset): a wedge
// that rises from the low side (`from`) to the kerb line at `at` (`to`, the
// high side), `heading` pointing uphill, `width` wide with sloped side flares
// and a short lip onto the high side. It uses the city material `material`
// (texture and collision) so karts can drive between a road and a lot that a
// kerb too high for the half-size city karts separates.
//
//   { "id": "ramp-fuel-washington", "kind": "ramp", "at": [x, z], "heading": deg,
//     "width": 5, "length": 2.2, "from": roadY, "to": kerbTopY, "material": "ROAD_KBPAVEMENT_TESTCONC" }
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readGlb, transformDirection, transformPoint } from "./glb.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const PROP_ASSET_DIR = path.resolve(clientDir, "..", "design", "open-world", "tripo");
export const DEFAULT_LIFT = 0.04;
export const MAX_LIFT = 0.1;
/** Vertical scale must stay ≥ this share of the mean horizontal scale. */
export const MIN_VERTICAL_RATIO = 0.75;

const normalize = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Triangles (model space, after the asset's node transforms) of every mesh primitive. */
function assetTriangles(glb) {
  const out = [];
  for (const { mesh, world } of glb.instances()) {
    if (!mesh) continue;
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positions = glb.accessor(primitive.attributes.POSITION).map(p => transformPoint(world, p));
      const indices = primitive.indices !== undefined ? glb.accessor(primitive.indices) : positions.map((_, i) => i);
      for (let i = 0; i + 2 < indices.length; i += 3) out.push([positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]]);
    }
  }
  return out;
}

/**
 * Asset geometry: bounds, the slab top (largest up-facing area level in the
 * lowest quarter) and the free gaps along the long axis (z) at the slab
 * centre line between blockers standing on the slab (pumps, pillars).
 */
export function analyzeAsset(glb) {
  const triangles = assetTriangles(glb);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) for (const p of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  const height = max[1] - min[1];
  const levels = new Map();
  for (const [a, b, c] of triangles) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    if (!length || n[1] / length < 0.9) continue;
    const y = (a[1] + b[1] + c[1]) / 3;
    if (y > min[1] + height * 0.25) continue;
    const key = Math.round(y / (height * 0.005));
    const level = levels.get(key) ?? { area: 0, y: 0, weight: 0, min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    level.area += length / 2; level.y += y * length; level.weight += length;
    for (const p of [a, b, c]) { level.min[0] = Math.min(level.min[0], p[0]); level.min[1] = Math.min(level.min[1], p[2]); level.max[0] = Math.max(level.max[0], p[0]); level.max[1] = Math.max(level.max[1], p[2]); }
    levels.set(key, level);
  }
  const top = [...levels.values()].sort((a, b) => b.area - a.area)[0];
  if (!top) throw new Error("prop asset has no up-facing base");
  const slabTop = top.y / top.weight;
  const slab = { min: top.min, max: top.max };
  // Blockers: geometry between 1% and 40% of the height above the slab top, projected on z.
  const lo = slabTop + height * 0.01, hi = slabTop + height * 0.4;
  const centreX = (slab.min[0] + slab.max[0]) / 2;
  const spans = [];
  for (const t of triangles) {
    const inBand = t.filter(p => p[1] > lo && p[1] < hi);
    if (!inBand.length) continue;
    spans.push([Math.min(...t.map(p => p[2])), Math.max(...t.map(p => p[2]))]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) { const last = merged.at(-1); if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]); }
  const gaps = [];
  for (let i = 0; i + 1 < merged.length; i++) gaps.push([merged[i][1], merged[i + 1][0]]);
  gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  return { triangles: triangles.length, min, max, slabTop, slab, blockers: merged, centreGap: gaps[0], centreX };
}

const assets = new Map();
/** Load (once) and analyse design/open-world/tripo/<asset>.glb. */
export function loadPropAsset(asset, dir = PROP_ASSET_DIR) {
  const file = path.join(dir, `${asset}.glb`);
  if (assets.has(file)) return assets.get(file);
  if (!/^[A-Za-z0-9_\-]+$/.test(asset) || !existsSync(file)) throw new Error(`prop asset ${asset}: ${file} not found`);
  const glb = readGlb(file);
  const entry = { asset, file, glb, geometry: analyzeAsset(glb) };
  assets.set(file, entry);
  return entry;
}

/**
 * Model → design glTF space (x east, y up, z south) for one prop: returns
 * point/normal transforms, the scale and the design-space slab top.
 */
export function propPlacement(prop, geometry) {
  if (!Array.isArray(prop.at) || prop.at.length !== 2 || !prop.at.every(Number.isFinite)) throw new Error(`prop ${prop.id}: at must be [x, z]`);
  if (!Number.isFinite(prop.y) || !Number.isFinite(prop.heading)) throw new Error(`prop ${prop.id}: y and heading are required`);
  if (!Array.isArray(prop.size) || prop.size.length !== 3 || !prop.size.every(v => Number.isFinite(v) && v > 0)) throw new Error(`prop ${prop.id}: size must be [w, d, h]`);
  const lift = prop.lift ?? DEFAULT_LIFT;
  if (!(lift >= 0 && lift <= MAX_LIFT)) throw new Error(`prop ${prop.id}: lift must be 0…${MAX_LIFT} m`);
  const { min, max, slabTop } = geometry;
  const scale = [prop.size[0] / (max[0] - min[0]), prop.size[2] / (max[1] - min[1]), prop.size[1] / (max[2] - min[2])];
  const ratio = scale[1] / ((scale[0] + scale[2]) / 2);
  if (ratio < MIN_VERTICAL_RATIO) throw new Error(`prop ${prop.id}: vertical scale ${scale[1].toFixed(2)} is below ${MIN_VERTICAL_RATIO} of the horizontal scale (${ratio.toFixed(3)})`);
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const r = prop.heading * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const baseY = prop.y + lift;
  const point = p => {
    const mx = (p[0] - cx) * scale[0], my = (p[1] - slabTop) * scale[1], mz = (p[2] - cz) * scale[2];
    return [prop.at[0] + mx * cos - mz * sin, baseY + my, prop.at[1] + mx * sin + mz * cos];
  };
  const normal = n => { const m = [n[0] / scale[0], n[1] / scale[1], n[2] / scale[2]]; return normalize([m[0] * cos - m[2] * sin, m[1], m[0] * sin + m[2] * cos]); };
  /** Model-space x/z (centred, scaled metres: u across, v along −z) → design x/z. */
  const local = (u, v) => [prop.at[0] + u * cos + v * sin, prop.at[1] + u * sin - v * cos];
  return { point, normal, local, scale, ratio, lift, slabTopY: baseY, centre: [cx, cz] };
}

/** Every prop triangle in design glTF space with its asset material, for the importer. */
export function* propPrimitives(prop, entry) {
  const placement = propPlacement(prop, entry.geometry);
  const { glb } = entry;
  for (const { node, mesh, world } of glb.instances()) {
    if (!mesh) continue;
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positions = glb.accessor(primitive.attributes.POSITION).map(p => placement.point(transformPoint(world, p)));
      const normals = primitive.attributes.NORMAL !== undefined ? glb.accessor(primitive.attributes.NORMAL).map(n => placement.normal(normalize(transformDirection(world, n)))) : undefined;
      const uvs = primitive.attributes.TEXCOORD_0 !== undefined ? glb.accessor(primitive.attributes.TEXCOORD_0) : undefined;
      const colors = primitive.attributes.COLOR_0 !== undefined ? glb.accessor(primitive.attributes.COLOR_0) : undefined;
      const indices = primitive.indices !== undefined ? glb.accessor(primitive.indices) : positions.map((_, i) => i);
      yield { name: `${prop.id}_${node.name ?? "mesh"}`, primitive, positions, normals, uvs, colors, indices, material: primitive.material !== undefined ? glb.json.materials[primitive.material] : undefined };
    }
  }
}

/** Triangles of a ramp prop (design glTF space), each up-facing, with flat normals and planar UVs. */
export function rampPrimitive(prop) {
  const { width = 5, length = 2.2, flare = 1.6, lip = 0.3 } = prop;
  if (!Array.isArray(prop.at) || prop.at.length !== 2 || ![prop.heading, prop.from, prop.to, width, length].every(Number.isFinite)) throw new Error(`ramp ${prop.id}: at, heading, from, to, width and length are required`);
  if (!(prop.to > prop.from) || prop.to - prop.from > 0.3) throw new Error(`ramp ${prop.id}: to must be 0…0.3 m above from`);
  const r = prop.heading * Math.PI / 180, f = [Math.sin(r), -Math.cos(r)], side = [Math.cos(r), Math.sin(r)];
  const top = prop.to + 0.004, low = prop.from - 0.02, w = width / 2;
  const P = (s, t, y) => [prop.at[0] + side[0] * s + f[0] * t, y, prop.at[1] + side[1] * s + f[1] * t];
  const T1 = P(-w, 0, top), T2 = P(w, 0, top), K1 = P(-w, lip, top), K2 = P(w, lip, top);
  const F1 = P(-w, -length, low), F2 = P(w, -length, low), S1 = P(-w - flare, 0, low), S2 = P(w + flare, 0, low);
  const faces = [[T1, K1, K2], [T1, K2, T2], [F1, T1, T2], [F1, T2, F2], [S1, T1, F1], [T2, S2, F2]];
  const positions = [], normals = [], uvs = [], indices = [];
  for (let [a, b, c] of faces) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[1] < 0) { [b, c] = [c, b]; n = n.map(x => -x); } // keep every face up-facing
    const normal = normalize(n);
    for (const p of [a, b, c]) { indices.push(positions.length); positions.push(p); normals.push(normal); uvs.push([p[0] / 3, p[2] / 3]); }
  }
  return { name: prop.id, positions, normals, uvs, indices };
}
