// Top-down renders of official tracks (road = grey, fences/walls = red,
// other meshes = faint, route gates = blue dots with indices) to choose
// where 卡丁城 connects to them.
//   node --import tsx tools/city/track-topdown.mjs --mirror <checkout> [--out DIR] track…
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { RgbaCanvas } from "./png.mjs";
import { meshTriangles } from "./city-districts.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : path.resolve(clientDir, "..");
const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "track-topdown"));
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--mirror" && args[i - 1] !== "--out");

const mul = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2] + m[9], m[1] * v[0] + m[4] * v[1] + m[7] * v[2] + m[10], m[2] * v[0] + m[5] * v[1] + m[8] * v[2] + m[11]];
const compose = (p, c) => {
  const r = new Array(12);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r[col * 3 + row] = p[row] * c[col * 3] + p[3 + row] * c[col * 3 + 1] + p[6 + row] * c[col * 3 + 2];
  const t = mul(p, [c[9], c[10], c[11]]); r[9] = t[0]; r[10] = t[1]; r[11] = t[2];
  return r;
};
const localMatrix = n => { const [a, b, c] = n.transform, s = n.scale; return [a[0] * s[0], b[0] * s[0], c[0] * s[0], a[1] * s[1], b[1] * s[1], c[1] * s[1], a[2] * s[2], b[2] * s[2], c[2] * s[2], n.position[0], n.position[1], n.position[2]]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const WALL = /fence|wall|rail|guard|턱|block|barrier/i;

function collect(node, parent, out) {
  const m = compose(parent, localMatrix(node));
  const geometry = node.vertexData ?? node.rigidGeometry;
  const texture = node.slots?.find(s => s?.kind === "texture");
  if (geometry?.positions && geometry.indices && node.nodeEnabled !== 0) {
    const road = !!texture?.property?.children?.find(c => c.name === "road");
    const wall = !road && WALL.test(texture?.name ?? "");
    const world = geometry.positions.map(p => mul(m, p));
    const kind = road ? "road" : wall ? "wall" : "other";
    for (const [ia, ib, ic] of meshTriangles(node)) {
      out.push({ kind, tri: [world[ia], world[ib], world[ic]], name: node.name, texture: texture?.name });
    }
  }
  for (const c of node.children ?? []) collect(c, m, out);
}

const { library, formats } = await loadResourceLibrary(path.resolve(clientDir, ".."), "p3553", mirrorRoot);
mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  const file = library.files.find(f => f.virtualPath.toLowerCase() === `track_/${id.toLowerCase()}/track.1s`);
  if (!file) { console.log(`${id}: missing`); continue; }
  const root = formats.y9(await file.bytes()).root;
  const tris = [];
  for (const c of root.scene.children) collect(c, IDENTITY, tris);
  const roadTris = tris.filter(t => t.kind === "road");
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const t of roadTris) for (const p of t.tri) { min[0] = Math.min(min[0], p[0]); min[1] = Math.min(min[1], p[1]); max[0] = Math.max(max[0], p[0]); max[1] = Math.max(max[1], p[1]); }
  // Fit the road extents (with margin) into 900 px; walls and props may spill beyond.
  const margin = 60;
  const size = Math.max(max[0] - min[0], max[1] - min[1]) + 2 * margin;
  const scale = 900 / size;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const px = (x, y) => [450 + (x - cx) * scale, 450 - (y - cy) * scale]; // north (client +y) up
  const canvas = new RgbaCanvas(900, 900, [245, 245, 240, 255]);
  const colors = { other: [205, 210, 200, 255], road: [120, 120, 125, 255], wall: [220, 50, 50, 255] };
  for (const kind of ["other", "road", "wall"]) {
    for (const t of tris) if (t.kind === kind) canvas.fillPolygon(t.tri.map(p => px(p[0], p[1])), colors[kind]);
  }
  // Grid every 100 m.
  for (let g = Math.ceil((cx - size / 2) / 100) * 100; g <= cx + size / 2; g += 100) {
    const [x] = px(g, 0); canvas.line(x, 0, x, 900, 1, [160, 160, 170, 120]);
    const [, y] = px(0, g); canvas.line(0, y, 900, y, 1, [160, 160, 170, 120]);
  }
  const roads = root.trackObjects.filter(o => o.kind === "ToRoad" && o.records?.length);
  const gates = [];
  for (const road of roads) {
    road.records.forEach((rec, i) => {
      const [lb, rb] = rec.positions;
      const c = [(lb[0] + rb[0]) / 2, (lb[1] + rb[1]) / 2, (lb[2] + rb[2]) / 2];
      canvas.line(...px(lb[0], lb[1]), ...px(rb[0], rb[1]), 2, [40, 90, 220, 255]);
      canvas.fillCircle(...px(c[0], c[1]), 4, i === 0 ? [20, 180, 60, 255] : [40, 90, 220, 255]);
      gates.push({ road: road.name, index: i, name: rec.name, center: c.map(v => Math.round(v * 10) / 10), left: lb.map(v => Math.round(v)), right: rb.map(v => Math.round(v)), width: Math.round(Math.hypot(lb[0] - rb[0], lb[1] - rb[1])) });
    });
  }
  const roadTextures = new Map();
  for (const t of roadTris) roadTextures.set(t.texture, (roadTextures.get(t.texture) ?? 0) + 1);
  const walls = tris.filter(t => t.kind === "wall");
  const wallNodes = new Map();
  for (const w of walls) wallNodes.set(w.name, (wallNodes.get(w.name) ?? 0) + 1);
  writeFileSync(path.join(outDir, `${id}.png`), canvas.png());
  writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ id, roadExtents: { min, max }, center: [cx, cy], scale, gates, wallNodes: [...wallNodes.entries()].slice(0, 40), roadTextures: [...roadTextures.entries()].sort((a, b) => b[1] - a[1]) }, null, 1));
  console.log(`  road textures: ${[...roadTextures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}(${c})`).join(" ")}`);
  for (const road of roads) console.log(`  ${road.name}: ${road.records.map((r, i) => { const g = gates.find(g => g.road === road.name && g.index === i); return `${i}@${g.center[0]},${g.center[1]},${g.center[2]}w${g.width}`; }).join(" ")}`);
  console.log(`${id}: road extents x ${Math.round(min[0])}..${Math.round(max[0])} y ${Math.round(min[1])}..${Math.round(max[1])}, ${roadTris.length} road tris, ${walls.length} wall tris in ${wallNodes.size} nodes, ${gates.length} gates → ${path.join(outDir, `${id}.png`)}`);
}
