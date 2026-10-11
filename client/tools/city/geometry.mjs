// Plain geometry helpers for the city builder. All functions work on arrays
// [x, y, z]; the builder decides which axis is "up".

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => { const l = length(a); return l > 0 ? scale(a, 1 / l) : [0, 0, 1]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (edge0, edge1, x) => { const t = clamp((x - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };

/** Deterministic pseudo-random generator (mulberry32). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from point p to segment ab in the plane (2D arrays). */
export function pointSegmentDistance2(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = a[0] + abx * t, y = a[1] + aby * t;
  return Math.hypot(p[0] - x, p[1] - y);
}

/** Distance from a 2D point to a polyline (optionally closed). */
export function pointPolylineDistance2(p, points, closed) {
  let best = Infinity;
  const n = points.length;
  for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) {
    const a = points[i % n], b = points[(i + 1) % n];
    best = Math.min(best, pointSegmentDistance2(p, a, b));
  }
  return best;
}

export function pointInPolygon2(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance to a polygon edge (positive inside). */
export function polygonInset2(p, polygon) {
  const d = pointPolylineDistance2(p, polygon, true);
  return pointInPolygon2(p, polygon) ? d : -d;
}

/**
 * Resample a 2D polyline so that consecutive samples are at most `step`
 * apart. Returns { points: [[x, y]…], s: cumulative distances }.
 */
export function densify2(points, step, closed) {
  const out = [], s = [];
  const n = points.length;
  let cursor = 0;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < count; k++) {
      const t = k / count;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      s.push(cursor + d * t);
    }
    cursor += d;
  }
  if (!closed) { out.push(points[n - 1].slice(0, 2)); s.push(cursor); }
  return { points: out, s, total: cursor };
}

/** Unit tangents and left normals of a 2D polyline (averaged at joints). */
export function polylineFrames2(points, closed) {
  const n = points.length;
  const tangents = [], normals = [];
  for (let i = 0; i < n; i++) {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0], ty = next[1] - prev[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    tangents.push([tx, ty]);
    normals.push([-ty, tx]);
  }
  return { tangents, normals };
}

/** Ear-clipping triangulation of a simple 2D polygon; returns index triples. */
export function triangulate2(polygon) {
  const n = polygon.length;
  if (n < 3) return [];
  const indices = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = polygon[i], [x1, y1] = polygon[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  const order = area > 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
  const left = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => left(a, b, p) >= 0 && left(b, c, p) >= 0 && left(c, a, p) >= 0;
  let guard = 0;
  while (order.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < order.length; i++) {
      const ia = order[(i - 1 + order.length) % order.length], ib = order[i], ic = order[(i + 1) % order.length];
      const a = polygon[ia], b = polygon[ib], c = polygon[ic];
      if (left(a, b, c) <= 1e-9) continue;
      let ear = true;
      for (const other of order) {
        if (other === ia || other === ib || other === ic) continue;
        if (inside(polygon[other], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      indices.push([ia, ib, ic]);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (order.length === 3) indices.push([order[0], order[1], order[2]]);
  return indices;
}

/** Axis-aligned bounds of a list of [x, y, z]. */
export function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
  return { min, max };
}

/**
 * A growable mesh with positions, normals, uvs, colors and triangle
 * indices. `pushQuad` takes four corners in order a, b, c, d (a quad with
 * diagonal a–c) and keeps the winding so the normal is cross(b−a, c−a).
 */
export class MeshBuilder {
  constructor() { this.positions = []; this.normals = []; this.uvs = []; this.colors = []; this.indices = []; }
  get vertexCount() { return this.positions.length; }
  vertex(position, uv, normal, color) {
    this.positions.push(position);
    this.uvs.push(uv ?? [0, 0]);
    this.normals.push(normal ?? [0, 0, 1]);
    this.colors.push(color ?? 0xffffffff);
    return this.positions.length - 1;
  }
  triangle(a, b, c) { this.indices.push(a, b, c); }
  /**
   * Quad from four corner vertices [position, uv] with an optional colour.
   * `facing` is the side the quad must face: the winding is flipped when the
   * natural normal points the other way (the design→client mapping mirrors
   * one axis, so corner orders written in design space come out reversed).
   */
  pushQuad(a, b, c, d, color, facing) {
    const n = normalize(cross(sub(b[0], a[0]), sub(c[0], a[0])));
    const flip = facing ? dot(n, facing) < 0 : false;
    const normal = flip ? scale(n, -1) : n;
    const ia = this.vertex(a[0], a[1], normal, color), ib = this.vertex(b[0], b[1], normal, color);
    const ic = this.vertex(c[0], c[1], normal, color), id = this.vertex(d[0], d[1], normal, color);
    if (flip) { this.triangle(ia, ic, ib); this.triangle(ia, id, ic); }
    else { this.triangle(ia, ib, ic); this.triangle(ia, ic, id); }
  }
  /** Triangle from three [position, uv] corners; `facing` as in pushQuad. */
  pushTriangle(a, b, c, color, facing) {
    const n = normalize(cross(sub(b[0], a[0]), sub(c[0], a[0])));
    const flip = facing ? dot(n, facing) < 0 : false;
    const normal = flip ? scale(n, -1) : n;
    const ia = this.vertex(a[0], a[1], normal, color), ib = this.vertex(b[0], b[1], normal, color), ic = this.vertex(c[0], c[1], normal, color);
    if (flip) this.triangle(ia, ic, ib); else this.triangle(ia, ib, ic);
  }
  isEmpty() { return this.indices.length === 0; }
  /** Split into pieces of at most `maxVertices` vertices (triangle granularity). */
  split(maxVertices = 60000) {
    if (this.positions.length <= maxVertices) return [this];
    const pieces = [];
    let current = new MeshBuilder();
    let map = new Map();
    const flush = () => { if (!current.isEmpty()) pieces.push(current); current = new MeshBuilder(); map = new Map(); };
    for (let i = 0; i < this.indices.length; i += 3) {
      if (current.positions.length + 3 > maxVertices) flush();
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const src = this.indices[i + k];
        let dst = map.get(src);
        if (dst === undefined) { dst = current.vertex(this.positions[src], this.uvs[src], this.normals[src], this.colors[src]); map.set(src, dst); }
        tri.push(dst);
      }
      current.triangle(tri[0], tri[1], tri[2]);
    }
    flush();
    return pieces;
  }
}

/** Pack an RGBA colour (0–1 floats) into the ARGB uint32 the format stores. */
export function argb(r, g, b, a = 1) {
  const c = v => Math.round(clamp(v, 0, 1) * 255);
  return ((c(a) << 24) | (c(r) << 16) | (c(g) << 8) | c(b)) >>> 0;
}
