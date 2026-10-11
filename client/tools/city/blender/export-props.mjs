// Exports a library of official village props (houses, trees, lamps, the
// fountain, bridges…) and theme textures for Blender:
//   build/blender/props/<id>.obj + .mtl, textures/<stem>.png, props.json, textures.json
//
//   cd client && node --import tsx tools/city/blender/export-props.mjs [--mirror CHECKOUT] [--out DIR]
//
// Each prop is one or more named nodes of a track, baked to world space and
// re-anchored at its footprint centre / lowest point; a node that is really
// several objects (a row of lamps) is split into connected components and
// clustered by overlap, each cluster becoming <id>_<n>. OBJ carries vertex
// colours (the baked lighting) as the x y z r g b extension.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "../../economy-export/resource-library.mjs";
import { meshTriangles } from "../city-districts.mjs";
import { decodeDds } from "../dds.mjs";
import { encodePng } from "../png.mjs";
import { TextureIndex, themePrefixes } from "../textures.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : path.resolve(clientDir, "..");
const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "blender", "props"));

/** Props: id → the nodes (by name) of a track; `split` breaks a merged node into its objects. */
export const PROPS = [
  // 城镇运河街区 village_I02
  { id: "fountain", track: "village_I02", nodes: ["분수대", "물00", "물02", "Point01"], collider: "cylinder" },
  { id: "house_green", track: "village_I02", nodes: ["Green house"] },
  { id: "house_blue_s", track: "village_I02", nodes: ["Blue house15"] },
  { id: "house_blue_m", track: "village_I02", nodes: ["Blue house13"] },
  { id: "house_big_green", track: "village_I02", nodes: ["green bh"] },
  { id: "house_canal", track: "village_I02", nodes: ["road"] },
  { id: "lamp", track: "village_I02", nodes: ["Mesh103"], split: true, keep: 1, collider: "post" },
  { id: "tree_a", track: "village_I02", nodes: ["나무43"], collider: "post" },
  { id: "tree_b", track: "village_I02", nodes: ["나무54"], collider: "post" },
  { id: "tree_c", track: "village_I02", nodes: ["Plane1876"], collider: "post" },
  { id: "tree_far", track: "village_I02", nodes: ["far tree23"], collider: "post" },
  { id: "tree_small", track: "village_I02", nodes: ["small tree63"], split: true, keep: 1, collider: "post" },
  { id: "bus_stop", track: "village_I02", nodes: ["Box631"] },
  { id: "tent", track: "village_I02", nodes: ["Box702"], split: true, keep: 3 },
  { id: "bridge", track: "village_I02", nodes: ["bridge"], collider: "none" },
  { id: "start_arch", track: "village_I02", nodes: ["start_obj"], collider: "none" },
  { id: "flower_bed", track: "village_I02", nodes: ["flower309"], split: true, keep: 2, collider: "none" },
  { id: "tulip_red", track: "village_I02", nodes: ["flower61"], collider: "none" },
  { id: "tulip_yellow", track: "village_I02", nodes: ["flower57"], collider: "none" },
  { id: "signboard", track: "village_I02", nodes: ["sign_08"] },
  { id: "flags", track: "village_I02", nodes: ["flag00+"], collider: "none" },
  // 城镇居民区 village_I04
  { id: "house_violet_a", track: "village_I04", nodes: ["Violet house05"] },
  { id: "house_violet_b", track: "village_I04", nodes: ["Violet house02"] },
  { id: "house_violet_c", track: "village_I04", nodes: ["Violet house09"] },
  { id: "house_violet_d", track: "village_I04", nodes: ["Violet house15"] },
  { id: "house_violet_e", track: "village_I04", nodes: ["Violet house13"] },
  { id: "house_orange_a", track: "village_I04", nodes: ["Orange house02"] },
  { id: "house_orange_b", track: "village_I04", nodes: ["Orange house03"] },
  { id: "house_big_a", track: "village_I04", nodes: ["green bh01"] },
  { id: "tower", track: "village_I04", nodes: ["green bh02"] },
  { id: "windmill", track: "village_I04", nodes: ["Dummy13"], collider: "post" },
  { id: "hill_a", track: "village_I04", nodes: ["언덕"], collider: "none" },
  { id: "hill_b", track: "village_I04", nodes: ["언덕01"], collider: "none" },
];

/** Theme textures the Blender script builds roads, ground, fences and water from. */
export const THEME_TEXTURES = [
  ["tilegrass", "village"], ["F_tilegrass00", "village"], ["F_tilegrass03", "village"],
  ["cement04", "village"], ["cement01", "village"], ["cement_15", "village"], ["cement_16", "village"], ["cement_17", "village"], ["cement08", "village"], ["cement_12", "village"], ["cement06", "village"], ["cement_14", "village"],
  ["b_side", "village"], ["side_rode", "village"],
  ["fence00", "village"], ["fence01", "village"], ["fence12", "village"], ["fence04", "village"],
  ["v_wall00", "village"], ["v_wall", "village"], ["v_brick", "village"], ["boro_stone copu", "village"],
  ["F_water00", "village"], ["F_water01", "village"], ["r_water01", "village"],
  ["sign_stick", "village"], ["ad_fence_a", "village"], ["ad_fence_b", "village"],
  ["cement05", "common"], ["cement08", "common"],
  // other themes: ground, roads, water, fences (names as the mirror has them)
  ["F_tilegrass03", "forest"], ["F_grass09", "forest"], ["F_road01", "forest"], ["F_road02", "forest"], ["F_road00", "forest"], ["F_roadside", "forest"], ["F_fence01", "forest"], ["F_fence04", "forest"], ["F_water00", "forest"], ["F_wood00", "forest"],
  ["ice_glacial terrain_A", "ice"], ["ice_glacial terrain_B", "ice"], ["ice_p_A", "ice"], ["ice_p_B", "ice"], ["ice_mr_road01", "ice"], ["ice_mr_road02", "ice"], ["ice_carroad00_t", "ice"], ["ice_edge", "ice"], ["fence_A", "ice"], ["fence_D", "ice"], ["ice_fence_a", "ice"], ["ice_line_side_aa", "ice"],
  ["sand", "desert"], ["sand_01", "desert"], ["sand_light", "desert"], ["road_sand", "desert"], ["de_road", "desert"], ["de_road02", "desert"], ["de_road01", "desert"], ["road_ston", "desert"], ["de_wall02", "desert"], ["de_fence01", "desert"], ["fence_woodB", "desert"], ["water", "desert"],
  ["bc_sand01_j", "beach"], ["bc_sand03_j", "beach"], ["bc_road01", "beach"], ["bc_road04", "beach"], ["bc_road05", "beach"], ["bc_road06", "beach"], ["bc_side01", "beach"], ["bc_sea03", "beach"], ["bc_sea02", "beach"], ["bc_fence_01", "beach"], ["bc_fence00_j", "beach"], ["bc_tile01_cj", "beach"],
];

const mul = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2] + m[9], m[1] * v[0] + m[4] * v[1] + m[7] * v[2] + m[10], m[2] * v[0] + m[5] * v[1] + m[8] * v[2] + m[11]];
const mulDir = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const compose = (p, c) => { const r = new Array(12); for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r[col * 3 + row] = p[row] * c[col * 3] + p[3 + row] * c[col * 3 + 1] + p[6 + row] * c[col * 3 + 2]; const t = mul(p, [c[9], c[10], c[11]]); r[9] = t[0]; r[10] = t[1]; r[11] = t[2]; return r; };
const localMatrix = n => { const [a, b, c] = n.transform, s = n.scale; return [a[0] * s[0], b[0] * s[0], c[0] * s[0], a[1] * s[1], b[1] * s[1], c[1] * s[1], a[2] * s[2], b[2] * s[2], c[2] * s[2], n.position[0], n.position[1], n.position[2]]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const normalize = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** All triangles of a node subtree in world space, with their material. */
function collectTriangles(node, parent, out) {
  const m = compose(parent, localMatrix(node));
  const geometry = node.vertexData ?? node.rigidGeometry;
  const texture = node.slots?.find(s => s?.kind === "texture");
  if (geometry?.positions && geometry.indices && node.nodeEnabled !== 0 && texture) {
    const roadXml = texture.property?.children?.find(c => c.name === "road");
    const alphaSlot = node.slots[3], backfaceSlot = node.slots[4];
    const material = {
      texture: texture.name, textureOp: texture.textureOp ?? 1,
      road: roadXml ? Object.fromEntries((roadXml.attributes ?? []).map(a => [a.name, a.value])) : null,
      alpha: alphaSlot?.blendEnable ? "blend" : alphaSlot?.alphaTestEnable ? "test" : null,
      cull: backfaceSlot?.cull ?? null,
    };
    const positions = geometry.positions.map(p => mul(m, p));
    const normals = geometry.normals?.length === geometry.positions.length ? geometry.normals.map(n => normalize(mulDir(m, n))) : null;
    const uvs = geometry.uvs?.map(set => set?.[0] ?? [0, 0]) ?? null;
    const colors = geometry.diffuseColors?.length === geometry.positions.length ? geometry.diffuseColors : null;
    for (const [ia, ib, ic] of meshTriangles(node)) {
      out.push({ material, v: [ia, ib, ic].map(i => ({
        p: positions[i], n: normals?.[i], uv: uvs?.[i] ?? [0, 0],
        c: colors ? [((colors[i] >>> 16) & 255) / 255, ((colors[i] >>> 8) & 255) / 255, (colors[i] & 255) / 255] : null,
      })) });
    }
  }
  for (const c of node.children ?? []) collectTriangles(c, m, out);
}

/** Connected components by shared vertex positions, then clusters of overlapping component boxes. */
function clusterTriangles(tris, gap = 0.5) {
  const key = p => `${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}`;
  const parent = tris.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const byVertex = new Map();
  tris.forEach((t, i) => { for (const v of t.v) { const k = key(v.p); const j = byVertex.get(k); if (j === undefined) byVertex.set(k, i); else union(i, j); } });
  const components = new Map();
  tris.forEach((t, i) => { const r = find(i); if (!components.has(r)) components.set(r, []); components.get(r).push(t); });
  const boxes = [...components.values()].map(list => ({ list, box: boxOf(list) }));
  // Clusters: boxes that overlap (grown by `gap`) belong together.
  const cp = boxes.map((_, i) => i);
  const cfind = i => (cp[i] === i ? i : (cp[i] = cfind(cp[i])));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].box, b = boxes[j].box;
    const overlap = a.min[0] - gap <= b.max[0] && b.min[0] - gap <= a.max[0] && a.min[1] - gap <= b.max[1] && b.min[1] - gap <= a.max[1] && a.min[2] - gap <= b.max[2] && b.min[2] - gap <= a.max[2];
    if (overlap) cp[cfind(i)] = cfind(j);
  }
  const clusters = new Map();
  boxes.forEach((b, i) => { const r = cfind(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(...b.list); });
  return [...clusters.values()].sort((a, b) => b.length - a.length);
}

function boxOf(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t.v) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v.p[i]); max[i] = Math.max(max[i], v.p[i]); }
  return { min, max };
}

const safe = s => s.replace(/[^A-Za-z0-9_@\-\.]/g, "_");

function writeObj(id, tris, textureStems) {
  const box = boxOf(tris);
  const anchor = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
  const lines = [`# KartSim prop ${id}`, `mtllib ${id}.mtl`, `o ${id}`];
  const vIndex = new Map(), vtIndex = new Map(), vnIndex = new Map();
  const vLines = [], vtLines = [], vnLines = [];
  const faces = new Map(); // material key → face lines
  const materials = new Map();
  const vKey = v => `${v.p.map(x => x.toFixed(4)).join(",")}|${v.c ? v.c.map(x => x.toFixed(3)).join(",") : ""}`;
  for (const t of tris) {
    const stem = safe(t.material.texture);
    const mkey = `m_${stem}`;
    if (!materials.has(mkey)) materials.set(mkey, { ...t.material, stem });
    textureStems.add(t.material.texture);
    const refs = t.v.map(v => {
      const k = vKey(v);
      let vi = vIndex.get(k);
      if (vi === undefined) {
        vi = vLines.length + 1; vIndex.set(k, vi);
        const p = [v.p[0] - anchor[0], v.p[1] - anchor[1], v.p[2] - anchor[2]].map(x => x.toFixed(4));
        vLines.push(`v ${p.join(" ")}${v.c ? ` ${v.c.map(x => x.toFixed(3)).join(" ")}` : ""}`);
      }
      const tk = `${v.uv[0].toFixed(5)},${v.uv[1].toFixed(5)}`;
      let ti = vtIndex.get(tk);
      if (ti === undefined) { ti = vtLines.length + 1; vtIndex.set(tk, ti); vtLines.push(`vt ${v.uv[0].toFixed(5)} ${(1 - v.uv[1]).toFixed(5)}`); }
      const n = v.n ?? [0, 0, 1];
      const nk = n.map(x => x.toFixed(3)).join(",");
      let ni = vnIndex.get(nk);
      if (ni === undefined) { ni = vnLines.length + 1; vnIndex.set(nk, ni); vnLines.push(`vn ${n.map(x => x.toFixed(3)).join(" ")}`); }
      return `${vi}/${ti}/${ni}`;
    });
    if (!faces.has(mkey)) faces.set(mkey, []);
    faces.get(mkey).push(`f ${refs.join(" ")}`);
  }
  lines.push(...vLines, ...vtLines, ...vnLines);
  for (const [mkey, list] of faces) { lines.push(`usemtl ${mkey}`, ...list); }
  const mtl = [];
  for (const [mkey, m] of materials) {
    mtl.push(`newmtl ${mkey}`, "Ka 1 1 1", "Kd 1 1 1", "Ks 0 0 0", "illum 1", `map_Kd textures/${m.stem}.png`, "");
  }
  return {
    obj: lines.join("\n") + "\n", mtl: mtl.join("\n"),
    meta: { size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]].map(v => Math.round(v * 100) / 100),
      triangles: tris.length, materials: Object.fromEntries([...materials].map(([k, m]) => [k, { texture: m.texture, textureOp: m.textureOp, road: m.road, alpha: m.alpha, cull: m.cull }])) },
  };
}

async function textureBytesToPng(index, name, prefixes) {
  const found = index.resolve(name, prefixes);
  if (!found) return undefined;
  const bytes = await found.file.bytes();
  if (found.extension === "dds") { const { width, height, rgba } = decodeDds(bytes); return { png: encodePng(width, height, rgba), source: found.file.canonicalPath ?? found.file.virtualPath, width, height }; }
  if (found.extension === "png") return { png: bytes, source: found.file.canonicalPath ?? found.file.virtualPath };
  return undefined;
}

async function main() {
  const { library, formats } = await loadResourceLibrary(path.resolve(clientDir, ".."), "p3553", mirrorRoot);
  const index = new TextureIndex(library);
  mkdirSync(path.join(outDir, "textures"), { recursive: true });
  const roots = new Map();
  const rootOf = async track => {
    if (!roots.has(track)) {
      const file = library.files.find(f => f.virtualPath.toLowerCase() === `track_/${track.toLowerCase()}/track.1s`);
      if (!file) throw new Error(`track ${track} not found`);
      roots.set(track, formats.y9(await file.bytes()).root);
    }
    return roots.get(track);
  };
  const catalog = [];
  const textureNeeds = new Map(); // stem → prefixes
  const SEARCH = ["village_I02", "village_I04", "village_R01", "village_I01", "village_C01"];
  const topsOf = async track => { const root = await rootOf(track); return root.scene.children.length === 1 ? root.scene.children[0].children : root.scene.children; };
  for (const prop of PROPS) {
    const tris = [];
    for (const name of prop.nodes) {
      // The named node is looked for in the prop's track first, then the other village tracks.
      let found;
      for (const track of [prop.track, ...SEARCH.filter(t => t !== prop.track)]) {
        const node = (await topsOf(track)).find(n => n.name === name || n.name.startsWith(`${name}@`));
        if (node) { found = { node, track }; break; }
      }
      if (!found) { console.warn(`${prop.id}: node ${name} not found`); continue; }
      prop.track = found.track;
      collectTriangles(found.node, IDENTITY, tris);
    }
    if (!tris.length) { console.warn(`${prop.id}: no triangles`); continue; }
    const groups = prop.split ? clusterTriangles(tris).slice(0, prop.keep ?? 99) : [tris];
    groups.forEach((group, n) => {
      const id = groups.length > 1 ? `${prop.id}_${n + 1}` : prop.id;
      const stems = new Set();
      const { obj, mtl, meta } = writeObj(id, group, stems);
      writeFileSync(path.join(outDir, `${id}.obj`), obj);
      writeFileSync(path.join(outDir, `${id}.mtl`), mtl);
      for (const stem of stems) textureNeeds.set(stem, themePrefixes(prop.track, ["village"]));
      catalog.push({ id, source: prop.track, nodes: prop.nodes, collider: prop.collider ?? "box", ...meta });
      console.log(`${id}: ${meta.triangles} tris, ${meta.size.join("×")} m, ${Object.keys(meta.materials).length} materials`);
    });
  }
  for (const [name, theme] of THEME_TEXTURES) textureNeeds.set(name, themePrefixes("", [theme]).slice(1));
  const textures = [];
  for (const [name, prefixes] of textureNeeds) {
    const result = await textureBytesToPng(index, name, prefixes);
    if (!result) { console.warn(`texture ${name}: not found or unsupported`); continue; }
    writeFileSync(path.join(outDir, "textures", `${safe(name)}.png`), result.png);
    textures.push({ name, stem: safe(name), source: result.source });
  }
  writeFileSync(path.join(outDir, "props.json"), JSON.stringify(catalog, null, 1));
  writeFileSync(path.join(outDir, "textures.json"), JSON.stringify(textures, null, 1));
  console.log(`${catalog.length} props, ${textures.length} textures → ${outDir}`);
}

main().catch(error => { console.error(error); process.exit(1); });
