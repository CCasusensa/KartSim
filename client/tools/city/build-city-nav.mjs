// Build the 卡丁城 navigation grid (src/city/city-nav.bin) the M map's route
// finder walks (src/city/city-nav.ts, design/open-world/PLAN.md "导航").
//
//   node --max-old-space-size=12000 --import ./src/physics/node-raw-test-hook.mjs --import tsx \
//     tools/city/build-city-nav.mjs [--check]
//
// Inputs: the registered city track (mirror/p3553/track_kartcity.rho, its
// native collision), the source road surfaces of Vice City
// (design/open-world/vice-city/assets/source-road-surfaces.json) and the
// design map (src/city/city-map.json, extent and sea level).
//
// The city is cut into 2 m cells. Every upward collision face (≤ 37°) gives a
// cell a ground layer (layers closer than 1.2 m merge, the upper one wins).
// A layer within 1 m of a road surface is road; ground reachable from a road
// within BAND cells (kerbs, sidewalks, grass strips, aprons, bridge decks
// of other materials) is kept as a slower connector, so the islands, the
// airport and the bridges join up; so is the forecourt of every gas station
// (its fuel POI zone and APPROACH m around it), so a route there ends at the
// pumps. Neighbouring layers connect when their
// heights differ by at most STEP (orthogonal) or STEP_DIAGONAL. Only the
// largest connected network is written; the browser snaps clicks and karts
// onto it.
//
// --check rebuilds and compares with the committed file.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { diskSource } from './register-container.mjs';
import { scanRhoArchiveIndex } from '../../src/codecs/rho-index-scan.ts';
import { RhoReader } from '../../src/codecs/rho.ts';
import { NAV_DIRECTIONS, NAV_MAGIC, NAV_VERSION } from '../../src/city/city-nav.ts';

const client = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return path.resolve(client, i < 0 ? fallback : args[i + 1]); };
const rhoFile = option('--rho', '../mirror/p3553/track_kartcity.rho');
const roadsFile = option('--roads', '../design/open-world/vice-city/assets/source-road-surfaces.json');
const designFile = option('--design', 'src/city/city-map.json');
const outFile = option('--out', 'src/city/city-nav.bin');
const check = args.includes('--check');

export const CELL = 2;
/** Layers per cell while rasterising; at most two survive in the network. */
const LAYERS = 3;
const MERGE = 1.2, ROAD_MATCH = 1, BAND = 4, STEP = 0.6, STEP_DIAGONAL = 0.8, UPWARD = 0.75, APPROACH = 16;

/** Rasterise a triangle (cell units x/z, height y) into cells: fn(cellIndex, height). */
function raster(width, height, [u, v, w], fn) {
  const den = (v[1] - w[1]) * (u[0] - w[0]) + (w[0] - v[0]) * (u[1] - w[1]);
  if (Math.abs(den) < 1e-12) return;
  const minX = Math.max(0, Math.floor(Math.min(u[0], v[0], w[0]))), maxX = Math.min(width - 1, Math.ceil(Math.max(u[0], v[0], w[0])));
  const minZ = Math.max(0, Math.floor(Math.min(u[1], v[1], w[1]))), maxZ = Math.min(height - 1, Math.ceil(Math.max(u[1], v[1], w[1])));
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, pz = z + 0.5;
    const f = ((v[1] - w[1]) * (px - w[0]) + (w[0] - v[0]) * (pz - w[1])) / den;
    const g = ((w[1] - u[1]) * (px - w[0]) + (u[0] - w[0]) * (pz - w[1])) / den;
    if (f < -0.02 || g < -0.02 || f + g > 1.02) continue;
    fn(z * width + x, f * u[2] + g * v[2] + (1 - f - g) * w[2]);
  }
}

/**
 * Cells (centres) of a gas station's forecourt: its fuel POI zone and the
 * approach around it (APPROACH m), which the road band may not reach.
 */
function stationCells(design, W, H, x0, z0) {
  const inside = new Uint8Array(W * H);
  for (const poi of design.pois ?? []) {
    if (poi.kind !== 'fuel' || !Array.isArray(poi.zone)) continue;
    const zone = poi.zone, slack = APPROACH;
    const xs = zone.map(p => p[0]), zs = zone.map(p => p[1]);
    const minX = Math.max(0, Math.floor((Math.min(...xs) - slack - x0) / CELL)), maxX = Math.min(W - 1, Math.ceil((Math.max(...xs) + slack - x0) / CELL));
    const minZ = Math.max(0, Math.floor((Math.min(...zs) - slack - z0) / CELL)), maxZ = Math.min(H - 1, Math.ceil((Math.max(...zs) + slack - z0) / CELL));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const px = x0 + (x + 0.5) * CELL, pz = z0 + (z + 0.5) * CELL;
      let within = false, near = Infinity;
      for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
        const [ax, az] = zone[i], [bx, bz] = zone[j];
        if ((az > pz) !== (bz > pz) && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) within = !within;
        const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
        near = Math.min(near, Math.hypot(px - ax - t * dx, pz - az - t * dz));
      }
      if (within || near <= slack) inside[z * W + x] = 1;
    }
  }
  return inside;
}

export async function buildCityNav({ rho, roads, design }) {
  const [[x0, z0], [x1, z1]] = design.meta.extent;
  const offsetX = -x0, offsetZ = z1, sea = design.world?.seaLevel ?? -Infinity;
  const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((z1 - z0) / CELL);
  const cells = W * H, N = cells * LAYERS;

  // Ground layers from the native collision (client world → design).
  globalThis.document ??= { createElement: () => ({ relList: { supports: () => true }, getContext: () => null, style: {} }) };
  const formats = await import('../../src/generated/formats.js');
  const source = diskSource(rho);
  const track = await new RhoReader(source, await scanRhoArchiveIndex(source)).read('track.1s');
  const roadExtent = Math.max(x1 - x0, z1 - z0) + 1;
  const admitted = formats.YW(formats.y9(new Uint8Array(track)), 'time-attack', { roadExtent });
  const layer = new Float32Array(N).fill(NaN);
  const put = (i, h) => {
    const base = i * LAYERS;
    for (let k = 0; k < LAYERS; k++) {
      const v = layer[base + k];
      if (Number.isNaN(v)) { layer[base + k] = h; return; }
      if (Math.abs(v - h) < MERGE) { if (h > v) layer[base + k] = h; return; }
    }
    let low = 0;
    for (let k = 1; k < LAYERS; k++) if (layer[base + k] < layer[base + low]) low = k;
    if (h > layer[base + low]) layer[base + low] = h;
  };
  for (const t of admitted.collisionTriangles) {
    if (t.normal.y < UPWARD) continue;
    raster(W, H, [t.a, t.b, t.c].map(p => [(p.x - offsetX - x0) / CELL, (p.z + offsetZ - z0) / CELL, p.y]), put);
  }
  // Each cell's layers bottom up, so a node's layer rank is its height order.
  for (let i = 0; i < cells; i++) {
    const values = [];
    for (let k = 0; k < LAYERS; k++) if (!Number.isNaN(layer[i * LAYERS + k])) values.push(layer[i * LAYERS + k]);
    values.sort((a, b) => a - b);
    for (let k = 0; k < LAYERS; k++) layer[i * LAYERS + k] = k < values.length ? values[k] : NaN;
  }

  // Road surfaces (source coordinates are design coordinates).
  const roadHeight = new Float32Array(cells).fill(NaN);
  for (const t of roads.triangles) {
    raster(W, H, t.points.map(p => [(p[0] - x0) / CELL, (p[2] - z0) / CELL, p[1]]), (i, h) => {
      if (Number.isNaN(roadHeight[i]) || h > roadHeight[i]) roadHeight[i] = h;
    });
  }
  const kind = new Uint8Array(N); // 1 road, 2 connector
  for (let i = 0; i < cells; i++) {
    if (Number.isNaN(roadHeight[i])) continue;
    for (let k = 0; k < LAYERS; k++) {
      const h = layer[i * LAYERS + k];
      if (!Number.isNaN(h) && Math.abs(h - roadHeight[i]) < ROAD_MATCH) kind[i * LAYERS + k] = 1;
    }
  }
  const each = (n, fn) => {
    const i = Math.floor(n / LAYERS), x = i % W, z = Math.floor(i / W), h = layer[n];
    NAV_DIRECTIONS.forEach(([dx, dz], d) => {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) return;
      const limit = dx && dz ? STEP_DIAGONAL : STEP, j = nz * W + nx;
      for (let k = 0; k < LAYERS; k++) {
        const m = j * LAYERS + k, other = layer[m];
        if (!Number.isNaN(other) && Math.abs(other - h) <= limit) fn(m, d, k);
      }
    });
  };
  let frontier = [];
  for (let n = 0; n < N; n++) if (kind[n] === 1) frontier.push(n);
  for (let ring = 0; ring < BAND; ring++) {
    const next = [];
    for (const n of frontier) each(n, m => { if (!kind[m] && layer[m] > sea + 0.1) { kind[m] = 2; next.push(m); } });
    frontier = next;
  }
  // Gas stations: their whole forecourt (the fuel POI zone) joins, so a route ends at the pumps.
  const forecourt = stationCells(design, W, H, x0, z0);
  frontier = [];
  for (let n = 0; n < N; n++) if (kind[n]) frontier.push(n);
  while (frontier.length) {
    const next = [];
    for (const n of frontier) each(n, m => {
      if (!kind[m] && forecourt[Math.floor(m / LAYERS)] && layer[m] > sea + 0.1) { kind[m] = 2; next.push(m); }
    });
    frontier = next;
  }

  // The network with the most road.
  const component = new Int32Array(N).fill(-1);
  let best = -1, bestRoad = -1, totalRoad = 0;
  for (let s = 0; s < N; s++) {
    if (!kind[s] || component[s] >= 0) continue;
    const id = s, stack = [s];
    component[s] = id;
    let road = 0;
    while (stack.length) {
      const n = stack.pop();
      if (kind[n] === 1) road++;
      each(n, m => { if (kind[m] && component[m] < 0) { component[m] = id; stack.push(m); } });
    }
    totalRoad += road;
    if (road > bestRoad) { bestRoad = road; best = id; }
  }
  const keep = n => kind[n] && component[n] === best;

  // Nodes in cell order (rows, then x, then height).
  const nodeOf = new Int32Array(N).fill(-1);
  const runs = [], multi = [], multiHeights = [];
  let count = 0, dropped = 0;
  for (let z = 0; z < H; z++) {
    let x = 0;
    while (x < W) {
      const has = cx => { const i = z * W + cx; for (let k = 0; k < LAYERS; k++) if (keep(i * LAYERS + k)) return true; return false; };
      if (!has(x)) { x++; continue; }
      const start = x;
      while (x < W && has(x)) {
        const i = z * W + x, kept = [];
        for (let k = 0; k < LAYERS; k++) if (keep(i * LAYERS + k)) kept.push(i * LAYERS + k);
        // Two network layers at most (a deck over a road); a third is rare and dropped.
        if (kept.length > 2) { dropped += kept.length - 2; kept.splice(0, kept.length - 2); }
        if (kept.length === 2) { multi.push(i); multiHeights.push(...kept.map(n => Math.round(layer[n] * 10))); }
        for (const n of kept) nodeOf[n] = count++;
        x++;
      }
      runs.push([z, start, x - start]);
    }
  }
  const edges = new Uint16Array(count), road = new Uint8Array(count);
  for (let n = 0; n < N; n++) {
    const id = nodeOf[n];
    if (id < 0) continue;
    road[id] = kind[n] === 1 ? 1 : 0;
    let bits = 0;
    each(n, (m, d) => {
      if (nodeOf[m] < 0 || bits & (1 << d)) return;
      // Which of the neighbour cell's network layers: the upper one of two sets the high bit.
      const j = Math.floor(m / LAYERS);
      let lower = true;
      for (let k = 0; k < LAYERS; k++) { const o = j * LAYERS + k; if (o < m && nodeOf[o] >= 0) lower = false; }
      bits |= (1 << d) | (lower ? 0 : 1 << (d + 8));
    });
    edges[id] = bits;
  }

  // Little-endian: header, runs (z, x, length), two-layer cells and their heights (dm), edges, road flags.
  const header = 40, size = header + runs.length * 6 + multi.length * 8 + count * 3;
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let at = 0;
  const u8 = v => { view.setUint8(at, v); at += 1; }, u16 = v => { view.setUint16(at, v, true); at += 2; };
  const i16 = v => { view.setInt16(at, v, true); at += 2; }, u32 = v => { view.setUint32(at, v, true); at += 4; };
  const f32 = v => { view.setFloat32(at, v, true); at += 4; };
  u32(NAV_MAGIC); u16(NAV_VERSION); u16(0); f32(CELL); f32(x0); f32(z0); u16(W); u16(H);
  u32(count); u32(runs.length); u32(multi.length); f32(sea);
  if (at !== header) throw new Error(`header ${at}`);
  for (const [z, x, length] of runs) { u16(z); u16(x); u16(length); }
  for (const i of multi) u32(i);
  for (const h of multiHeights) i16(h);
  for (const e of edges) u16(e);
  for (const r of road) u8(r);
  if (at !== size) throw new Error(`size ${at} != ${size}`);
  const roadNodes = road.reduce((a, b) => a + b, 0);
  return { bytes, stats: { cells: `${W}×${H}`, nodes: count, roadNodes, connectorNodes: count - roadNodes,
    runs: runs.length, twoLayerCells: multi.length, droppedLayers: dropped, roadShare: +(bestRoad / totalRoad).toFixed(4) } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const design = JSON.parse(readFileSync(designFile, 'utf8'));
  const roads = JSON.parse(readFileSync(roadsFile, 'utf8'));
  const { bytes, stats } = await buildCityNav({ rho: rhoFile, roads, design });
  const packed = gzipSync(bytes, { level: 9 });
  console.log(JSON.stringify({ ...stats, raw: bytes.length, gzip: packed.length }));
  if (check) {
    const committed = gunzipSync(readFileSync(outFile));
    if (Buffer.compare(Buffer.from(bytes), committed) !== 0) {
      console.error(`${path.relative(client, outFile)} 与重新生成的结果不同，请重新运行（不带 --check）。`);
      process.exit(1);
    }
    console.log(`${path.relative(client, outFile)} 与输入一致。`);
  } else {
    writeFileSync(outFile, packed);
    console.log(`已写入 ${path.relative(client, outFile)}`);
  }
}
