/**
 * The Vice City traffic signal heads (CITY-NPC.md): every mesh of the
 * merged map drawn with the original TAFFICLIGHTS texture (the source's own
 * spelling; image vc_ae004d425ed11917e4b3b0dc, see
 * vice-city-source-report.json) is read from kartcity.glb and split into
 * heads (clusters of its vertices). A head is a horizontal three-lamp bar
 * hung over a junction; its long axis and centre are kept.
 *
 *   node tools/city/traffic/extract-signal-heads.mjs
 *
 * writes design/open-world/vice-city/traffic-signal-heads.json, which
 * build-traffic-network.mjs reads (the 270 MB GLB is only needed here).
 */
import { openSync, readSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const GLB = resolve(ROOT, "design/open-world/vice-city/assets/kartcity.glb");
const OUT = resolve(ROOT, "design/open-world/vice-city/traffic-signal-heads.json");
const SIGNAL_IMAGE = "vc_ae004d425ed11917e4b3b0dc";
/** Vertices closer than this (m, plan grid) belong to one head. */
const CLUSTER_CELL = 2.5;

function readChunk(fd, offset, length) {
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, 0, length, offset);
  return buffer;
}

export function extractHeads() {
  const fd = openSync(GLB, "r");
  const header = readChunk(fd, 0, 20);
  if (header.readUInt32LE(0) !== 0x46546c67) throw new Error("kartcity.glb 不是 GLB。");
  const jsonLength = header.readUInt32LE(12);
  const json = JSON.parse(readChunk(fd, 20, jsonLength).toString("utf8"));
  const binOffset = 20 + jsonLength + 8;
  const image = json.images.findIndex(i => i.name === SIGNAL_IMAGE);
  if (image < 0) throw new Error(`kartcity.glb 里没有 ${SIGNAL_IMAGE}。`);
  const textures = new Set(json.textures.flatMap((t, i) => (t.source === image ? [i] : [])));
  const materials = new Set(json.materials.flatMap((m, i) =>
    (textures.has(m.pbrMetallicRoughness?.baseColorTexture?.index) ? [i] : [])));
  const parent = new Map();
  json.nodes.forEach((node, i) => { for (const child of node.children ?? []) parent.set(child, i); });
  const transform = (index, p) => {
    for (let at = index; at !== undefined; at = parent.get(at)) {
      const node = json.nodes[at];
      if (node.rotation && node.rotation.some((v, k) => v !== [0, 0, 0, 1][k])) throw new Error("信号灯节点带旋转。");
      const s = node.scale ?? [1, 1, 1], t = node.translation ?? [0, 0, 0];
      p = [p[0] * s[0] + t[0], p[1] * s[1] + t[1], p[2] * s[2] + t[2]];
    }
    return p;
  };
  const points = [];
  json.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    for (const primitive of json.meshes[node.mesh].primitives) {
      if (!materials.has(primitive.material)) continue;
      const accessor = json.accessors[primitive.attributes.POSITION];
      const view = json.bufferViews[accessor.bufferView];
      const stride = view.byteStride ?? 12;
      const data = readChunk(fd, binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride * accessor.count);
      for (let k = 0; k < accessor.count; k++) {
        const p = [data.readFloatLE(k * stride), data.readFloatLE(k * stride + 4), data.readFloatLE(k * stride + 8)];
        points.push(transform(index, p));
      }
    }
  });
  // Clusters: connected occupied cells of a plan grid.
  const cells = new Map();
  for (const p of points) {
    const key = `${Math.floor(p[0] / CLUSTER_CELL)},${Math.floor(p[2] / CLUSTER_CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  }
  const seen = new Set();
  const heads = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start], members = [];
    while (stack.length) {
      const key = stack.pop();
      members.push(...cells.get(key));
      const [cx, cz] = key.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const next = `${cx + dx},${cz + dz}`;
        if (cells.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    heads.push(describe(members));
  }
  heads.sort((a, b) => a.x - b.x || a.z - b.z);
  return { source: "design/open-world/vice-city/assets/kartcity.glb (TAFFICLIGHTS)", heads };
}

/** Centre, height range and long axis (plan principal direction) of a head's vertices. */
function describe(points) {
  const n = points.length;
  const mean = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) mean[i] += p[i] / n;
  let xx = 0, xz = 0, zz = 0, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    const dx = p[0] - mean[0], dz = p[2] - mean[2];
    xx += dx * dx; xz += dx * dz; zz += dz * dz;
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  const ax = Math.cos(angle), az = Math.sin(angle);
  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    const t = (p[0] - mean[0]) * ax + (p[2] - mean[2]) * az;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  const round = v => Math.round(v * 100) / 100;
  return { x: round(mean[0] + ax * (lo + hi) / 2), z: round(mean[2] + az * (lo + hi) / 2), y: round((minY + maxY) / 2),
    height: round(maxY - minY), length: round(hi - lo), axis: [round(ax), round(az)] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const document = extractHeads();
  writeFileSync(OUT, `${JSON.stringify(document, null, 1)}\n`);
  console.log(`信号灯头 ${document.heads.length} 个 → ${OUT}`);
}
