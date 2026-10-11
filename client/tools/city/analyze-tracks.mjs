// Measures official tracks so 卡丁城 can follow their layout conventions:
//   node --import tsx tools/city/analyze-tracks.mjs --mirror <checkout> [track ids…]
// Prints, per track: mesh extents, triangle/node counts, road-textured
// meshes, route length, gate widths and the track XML (fog, camera).
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { meshTriangles } from "./city-districts.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : path.resolve(clientDir, "..");
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--mirror");
const DEFAULT = ["village_R01", "village_I01", "village_B01", "world_I02", "world_R04", "wkc_R01", "beach_R01", "beach_I02",
  "forest_I01", "ice_I01", "factory_I01", "china_I01", "nemo_R01", "park_R01", "mechanic_R01", "northeu_I01", "desert_I01"];

const mul = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2] + m[9], m[1] * v[0] + m[4] * v[1] + m[7] * v[2] + m[10], m[2] * v[0] + m[5] * v[1] + m[8] * v[2] + m[11]];
const compose = (p, c) => {
  const r = new Array(12);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r[col * 3 + row] = p[row] * c[col * 3] + p[3 + row] * c[col * 3 + 1] + p[6 + row] * c[col * 3 + 2];
  const t = mul(p, [c[9], c[10], c[11]]); r[9] = t[0]; r[10] = t[1]; r[11] = t[2];
  return r;
};
const localMatrix = n => { const [a, b, c] = n.transform, s = n.scale; return [a[0] * s[0], b[0] * s[0], c[0] * s[0], a[1] * s[1], b[1] * s[1], c[1] * s[1], a[2] * s[2], b[2] * s[2], c[2] * s[2], n.position[0], n.position[1], n.position[2]]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function walk(node, parent, acc) {
  const m = compose(parent, localMatrix(node));
  acc.nodes++;
  const geometry = node.vertexData ?? node.rigidGeometry;
  const positions = geometry?.positions;
  const texture = node.slots?.find(s => s?.kind === "texture");
  const road = texture?.property?.children?.find(c => c.name === "road");
  if (positions) {
    acc.meshes++;
    const triangles = meshTriangles(node).length;
    acc.triangles += triangles;
    if (road) { acc.roadMeshes++; acc.roadTriangles += triangles; }
    for (const p of positions) {
      const w = mul(m, p);
      for (let i = 0; i < 3; i++) { acc.min[i] = Math.min(acc.min[i], w[i]); acc.max[i] = Math.max(acc.max[i], w[i]); }
    }
  }
  if (texture?.name) acc.textures.add(texture.name);
  for (const c of node.children ?? []) walk(c, m, acc);
}

const { library, formats } = await loadResourceLibrary(path.resolve(clientDir, ".."), "p3553", mirrorRoot);
for (const id of ids.length ? ids : DEFAULT) {
  const file = library.files.find(f => f.virtualPath.toLowerCase() === `track_/${id.toLowerCase()}/track.1s`);
  if (!file) { console.log(`${id}: missing`); continue; }
  const root = formats.y9(await file.bytes()).root;
  const acc = { nodes: 0, meshes: 0, triangles: 0, roadMeshes: 0, roadTriangles: 0, textures: new Set(),
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const c of root.scene.children) walk(c, IDENTITY, acc);
  const roads = root.trackObjects.filter(o => o.kind === "ToRoad");
  const lines = [`\n=== ${id}: scene ${root.scene.name} top-level ${root.scene.children.length} nodes [${root.scene.children.slice(0, 12).map(n => n.name).join(", ")}]`];
  const size = acc.max.map((v, i) => Math.round(v - acc.min[i]));
  lines.push(`  extents x ${Math.round(acc.min[0])}..${Math.round(acc.max[0])} (${size[0]} m), y ${Math.round(acc.min[1])}..${Math.round(acc.max[1])} (${size[1]} m), z(up) ${Math.round(acc.min[2])}..${Math.round(acc.max[2])} (${size[2]} m)`);
  lines.push(`  nodes ${acc.nodes}, meshes ${acc.meshes}, triangles ${acc.triangles}, road meshes ${acc.roadMeshes} (${acc.roadTriangles} tris), textures ${acc.textures.size}`);
  for (const road of roads) {
    const records = road.records ?? [];
    const centers = records.map(r => { const [lb, rb] = r.positions; return [(lb[0] + rb[0]) / 2, (lb[1] + rb[1]) / 2, (lb[2] + rb[2]) / 2]; });
    const widths = records.map(r => dist(r.positions[0], r.positions[1]));
    let length = 0;
    for (let i = 0; i < centers.length; i++) length += dist(centers[i], centers[(i + 1) % centers.length]);
    const heights = centers.map(c => c[2]);
    const frames = records.reduce((n, r) => n + (r.frames?.length ?? 0), 0);
    lines.push(`  route ${road.name || "(unnamed)"}: ${records.length} gates, ${frames} frames, cyclic ${road.cyclic}, length ${Math.round(length)} m, gate width median ${median(widths).toFixed(1)} (min ${Math.min(...widths).toFixed(1)}, max ${Math.max(...widths).toFixed(1)}), height ${Math.min(...heights).toFixed(1)}..${Math.max(...heights).toFixed(1)}`);
  }
  for (const o of root.trackObjects) {
    if (o.kind === "TrackObject" && o.property) {
      const flat = n => `${n.name}${Object.keys(n.attributes ?? {}).length ? JSON.stringify(n.attributes) : ""}${(n.children ?? []).length ? `[${n.children.map(flat).join(" ")}]` : ""}`;
      lines.push(`  track xml: ${flat(o.property).slice(0, 700)}`);
    }
  }
  const kinds = {};
  for (const o of root.trackObjects) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  lines.push(`  track objects: ${JSON.stringify(kinds)}`);
  const names = [...acc.textures].filter(t => /wall|fence|guard|rail|curb|road|street|build|house|tree|lamp|sign/i.test(t)).slice(0, 25);
  lines.push(`  notable textures: ${names.join(", ")}`);
  console.log(lines.join("\n"));
}
