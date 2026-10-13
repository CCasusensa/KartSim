#!/usr/bin/env node
// Builds 卡丁城 as a normal track container (track_kartcity.rho) from
// design/open-world/city-map.json: terrain, water, roads, walls, buildings,
// trees, landmarks copied from existing tracks, the ring route, the minimap
// and the skydome.
//
//   cd client && node --import tsx tools/city/build-city.mjs [--validate] [--out DIR] [--mirror CHECKOUT]
//
// --validate   build the model in memory and run the browser's road
//              extraction and course-graph builder on it, write nothing
// --out DIR    write track_/kartcity/* loose files into DIR (default
//              client/build/kartcity) and pack track_kartcity.rho
// --mirror     checkout whose mirror/p3553 holds the original archives
//              (default: this checkout)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { MeshBuilder, argb, random } from "./geometry.mjs";
import { RgbaCanvas } from "./png.mjs";
import { TextureIndex, TextureSet } from "./textures.mjs";
import { alpha, backface, group, meshNode, texture, toMinimap, toRoad, trackContainer, trackObject, xml } from "./model.mjs";
import { buildGround, createTerrain } from "./city-terrain.mjs";
import { buildRoadSurface, buildRoadWall, routeRecords, sampleRoad } from "./city-roads.mjs";
import { buildBoundary } from "./city-props.mjs";
import { importDistricts } from "./city-districts.mjs";
import { pointInPolygon2 } from "./geometry.mjs";
import { SKY_TEXTURES } from "./city-sky.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = path.resolve(clientDir, "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : projectRoot;
const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "kartcity"));
const validateOnly = args.includes("--validate");

export const TRACK_ID = "kartcity";
export const CHUNK = 240;

/** Shared state of one build: coordinate mapping, mesh builders per chunk and surface. */
class City {
  constructor(design, library, formats) {
    this.design = design; this.library = library; this.formats = formats;
    const [min, max] = design.meta.extent;
    this.origin = { x: min[0], z: max[1] };
    this.textures = new TextureSet(new TextureIndex(library));
    this.builders = new Map();
    this.extraNodes = [];
    this.rng = random(20261011);
    this.surfaces = new Map();
  }
  /** World (x east, z south, y up) → client (x, y north, z up). */
  client(x, z, y = 0) { return [x - this.origin.x, this.origin.z - z, y]; }
  clientDirection(tx, tz) { return [tx, -tz]; }
  chunkKey(x, z) {
    const c = this.client(x, z, 0);
    return `${Math.floor(c[0] / CHUNK)}_${Math.floor(c[1] / CHUNK)}`;
  }
  /** A texture surface shared by many meshes. */
  surface(id, textureName, themes, { road, blend, test, cull, colors, textureOp, sortBias = 0, generated } = {}) {
    if (this.surfaces.has(id)) return this.surfaces.get(id);
    const stem = generated ? this.textures.generated(generated.stem, generated.extension, generated.bytes)
      : this.textures.theme(textureName, themes);
    const slot = texture(stem, { road, textureOp: textureOp ?? (colors ? 4 : 1) });
    const surface = {
      id, stem, slot, colors: !!colors, sortBias,
      alphaSlot: blend || test ? alpha({ blend, test }) : undefined,
      backfaceSlot: cull ? backface(cull) : undefined,
    };
    this.surfaces.set(id, surface);
    return surface;
  }
  /** The mesh builder for a surface inside the chunk containing world (x, z). */
  mesh(label, surface, x, z) {
    const key = `${this.chunkKey(x, z)}|${surface.id}`;
    let builder = this.builders.get(key);
    if (!builder) { builder = new MeshBuilder(); builder.surface = surface; builder.chunk = this.chunkKey(x, z); builder.label = label; this.builders.set(key, builder); }
    return builder;
  }
  /** Assemble the scene: one Relement per chunk holding its meshes. */
  assemble() {
    const chunks = new Map();
    let meshCount = 0, triangles = 0;
    for (const builder of this.builders.values()) {
      if (builder.isEmpty()) continue;
      let chunk = chunks.get(builder.chunk);
      if (!chunk) { chunk = group(`chunk_${builder.chunk}`); chunks.set(builder.chunk, chunk); }
      builder.split(60000).forEach((piece, index) => {
        const s = builder.surface;
        chunk.children.push(meshNode(`${s.id}_${builder.chunk}${index ? `_${index}` : ""}`, piece, s.slot,
          { alphaSlot: s.alphaSlot, backfaceSlot: s.backfaceSlot, sortDepthBias: s.sortBias, colors: s.colors }));
        meshCount++; triangles += piece.indices.length / 3;
      });
    }
    const sceneRoot = group("Scene Root", [...chunks.values(), ...this.extraNodes]);
    const root = group("rootRelement", [sceneRoot]);
    return { root, meshCount, triangles, chunks: chunks.size };
  }
}

async function loadDesign() {
  // Always from the source: city-map.json also carries a previous build's
  // generated routes, spawns and shortened streets.
  const { designJson } = await import(pathToFileURL(path.join(projectRoot, "design", "open-world", "city-map.data.mjs")).href);
  return JSON.parse(JSON.stringify(designJson()));
}

/** 256×256 minimap drawn from the design (north up): district footprints, their routes and the roads. */
function renderMinimap(city, minimap, loops = []) {
  const canvas = new RgbaCanvas(256, 256, [18, 22, 28, 215]);
  const px = (x, z) => { const c = city.client(x, z, 0); return [128 + (c[0] - minimap.centerX) * minimap.scale, 128 - (c[1] - minimap.centerY) * minimap.scale]; };
  const tint = { village: [92, 84, 50, 255], forest: [60, 110, 70, 255], ice: [80, 110, 140, 255] };
  for (const d of city.design.districts) {
    if (d.polygon) canvas.fillPolygon(d.polygon.map(p => px(p[0], p[1])), tint[d.theme] ?? [52, 58, 70, 255]);
  }
  const stroke = (points, closed, width, color) => {
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) { const a = points[i], b = points[(i + 1) % points.length]; canvas.line(...px(a[0], a[1]), ...px(b[0], b[1]), width, color); }
  };
  for (const loop of loops) stroke(loop.points, loop.closed, Math.max(1.5, 20 * minimap.scale * 1.2), [190, 160, 255, 255]);
  for (const road of city.design.roads) {
    if (road.type === "district") continue;
    const width = Math.max(1.5, city.design.roadTypes[road.type].width * minimap.scale * 1.4);
    const color = road.type === "expressway" ? [255, 255, 255, 255] : [220, 220, 220, 255];
    stroke(road.points, road.closed, width, color);
  }
  return canvas.png();
}

export async function buildCity({ library, formats, design }) {
  // District routes and spawns are regenerated below; drop a previous build's copies.
  design = { ...design, roads: design.roads.filter(r => !r.generated), pois: design.pois.filter(p => !p.generated) };
  const city = new City(design, library, formats);
  const terrain = createTerrain(design);
  const V = ["village"], F = ["forest"], I = ["ice"];
  const footprints = design.districts.filter(d => d.polygon).map(d => d.polygon);
  const inFootprint = (x, z) => footprints.some(polygon => pointInPolygon2([x, z], polygon));

  // Ground: grass everywhere the districts do not cover (they bring their own ground).
  const grass = city.surface("grass", "F_tilegrass00", V, { road: { surface: "dirt" } });
  buildGround(city, terrain, () => grass, { skip: inFootprint });

  // Districts: whole official tracks. Their entrances snap inward to where
  // the official surface begins; the connector streets end there.
  const districts = await importDistricts(city);
  design = { ...design, districts: design.districts.map(d => districts.entrances.has(d.id)
    ? { ...d, entrances: districts.entrances.get(d.id) } : d) };
  // The street runs STREET_OVERLAP m past the entrance onto the district's own ground.
  const STREET_OVERLAP = 4;
  const INWARD = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] };
  const moved = [];
  for (const d of city.design.districts) for (const [index, e] of (d.entrances ?? []).entries()) {
    const now = districts.entrances.get(d.id)?.[index];
    if (!e.at || !now) continue;
    const [ix, iz] = INWARD[e.facing] ?? [0, 0];
    moved.push({ from: e.at, to: [now.at[0] + ix * STREET_OVERLAP, now.at[1] + iz * STREET_OVERLAP] });
  }
  design = { ...design, roads: design.roads.map(road => ({ ...road, points: road.points.map(point => {
    const hit = moved.find(m => Math.hypot(point[0] - m.from[0], point[1] - m.from[1]) < 1);
    return hit ? [hit.to[0], hit.to[1], ...point.slice(2)] : point;
  }) })) };
  city.design = design;

  // Roads with the village theme's fences; gaps at junctions and entrances.
  const roadSurfaces = {
    expressway: city.surface("road-expressway", "bc_road04", ["beach"], { road: {} }),
    avenue: city.surface("road-avenue", "cement08", ["common"], { road: {} }),
    street: city.surface("road-street", "cement05", ["common"], { road: {} }),
  };
  const rail = city.surface("rail", "fence00", V, { road: {}, cull: 1 });
  const openPoints = roadOpenings(design);
  const nearOpening = ([x, z]) => openPoints.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r);
  const samples = new Map();
  for (const road of design.roads) {
    if (road.type === "district") continue;
    const sample = sampleRoad(design, road, terrain);
    samples.set(road.id, sample);
    buildRoadSurface(city, sample, roadSurfaces[road.type] ?? roadSurfaces.street);
    const where = i => !nearOpening(sample.points[i]);
    const h = road.type === "expressway" ? 1.2 : 1.0;
    buildRoadWall(city, sample, rail, 1, h, where);
    buildRoadWall(city, sample, rail, -1, h, where);
  }
  buildBoundary(city, terrain, city.surface("boundary", "fence01", V, { road: {}, cull: 1, test: true }));

  // Route: the ring expressway.
  const ring = samples.get("ring");
  const records = routeRecords(city, ring);
  const route = toRoad("ring", records, true);

  // Minimap.
  const extent = design.meta.extent;
  const size = Math.max(extent[1][0] - extent[0][0], extent[1][1] - extent[0][1]);
  const minimap = toMinimap({ centerX: size / 2, centerY: size / 2, scale: 236 / size });
  const minimapPng = renderMinimap(city, minimap, districts.loops);

  const settings = trackObject("track", xml("property", {}, [
    xml("camera", { far: "1000" }),
    xml("fog", { mode: "3", r: "188", g: "206", b: "228", start: "0.55", end: "1.0" }),
    xml("sun", { x: "0", y: "0", z: "-1" }),
    xml("course", {}, [xml("road", { name: "ring" })]),
  ]));

  const { root, meshCount, triangles, chunks } = city.assemble();
  const model = trackContainer("", root, [route, minimap, settings]);
  const generated = { roads: districts.loops, pois: districts.spawns, districts: design.districts, connectors: design.roads.filter(r => r.type !== "district") };
  return { city, model, minimapPng, districts, generated,
    stats: { meshCount, triangles, chunks, textures: city.textures.files.size, records: records.length, districts: districts.placed } };
}

/** Points where road fences must leave a gap: road ends, crossings and district entrances. */
function roadOpenings(design) {
  const roads = design.roads.filter(r => r.type !== "district");
  const openings = [];
  const segments = [];
  for (const road of roads) {
    const pts = road.points;
    if (!road.closed) { openings.push([pts[0][0], pts[0][1], 26], [pts[pts.length - 1][0], pts[pts.length - 1][1], 26]); }
    const count = road.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) segments.push({ road: road.id, a: pts[i], b: pts[(i + 1) % pts.length] });
  }
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const s = segments[i], t = segments[j];
    if (s.road === t.road) continue;
    const hit = segmentIntersection(s.a, s.b, t.a, t.b);
    if (hit) openings.push([hit[0], hit[1], 26]);
  }
  // District entrances: the street's end at the district road (a gap for the join).
  for (const d of design.districts) for (const e of d.entrances ?? []) if (e.at) openings.push([e.at[0], e.at[1], 16]);
  return openings;
}

function segmentIntersection(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return undefined;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export function validateModel(formats, model, options = {}) {
  const parsed = { root: model, rootOccurrence: { encoding: "new", id: 0, value: model } };
  const road = formats.YW(parsed, "speed-individual", { forceReverse: false, ...options });
  const issues = road.roadIssues ?? [];
  return {
    collisionTriangles: road.collisionTriangles.length,
    deferred: road.deferredRoadTriangles.length,
    sections: road.sections.length,
    firstSection: road.firstSection, lastSection: road.lastSection,
    start: road.start,
    issues: issues.slice(0, 5).map(issue => issue.reason ?? String(issue)),
    stats: road.collisionStats,
  };
}

async function main() {
  const design = await loadDesign();
  const { library, formats } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
  const built = await buildCity({ library, formats, design });
  console.log("model", JSON.stringify(built.stats));
  // The design plus the generated district routes and spawns, for the client and the node.
  const merged = { ...design, districts: built.generated.districts,
    roads: [...built.generated.connectors, ...built.generated.roads],
    pois: [...design.pois.filter(p => !p.generated), ...built.generated.pois] };
  const mergedJson = JSON.stringify(merged, null, 2) + "\n";
  for (const target of [path.join(projectRoot, "design", "open-world", "city-map.json"),
    path.join(clientDir, "src", "city", "city-map.json"),
    path.join(projectRoot, "server-go", "internal", "game", "city", "city-map.json")]) {
    writeFileSync(target, mergedJson);
  }
  console.log(`city-map.json: ${built.generated.roads.length} district routes, ${built.generated.pois.length} spawns written`);
  const report = validateModel(formats, built.model);
  console.log("validate", JSON.stringify({ ...report, start: undefined, stats: undefined }));
  console.log("start", JSON.stringify(report.start));
  if (report.issues.length) console.log("ISSUES", report.issues);
  if (validateOnly) return;

  // Encode, pack and register (the writer modules are built in parallel; fail clearly when absent).
  const { encodeTrackModel } = await import("../../src/resources/track-binary-writer.ts");
  const { packRhoArchive } = await import("../../src/codecs/rho-writer.ts");
  // The archive has no aaa.pk mount, so the browser mounts it at
  // `track_kartcity/`; files sit at the archive root.
  const files = [];
  files.push({ path: "track.1s", bytes: encodeTrackModel(built.model) });
  // Skydome: the village dome with our own texture name.
  const skySource = library.files.find(f => f.virtualPath.toLowerCase() === "track_/village_i11/skydome.1s");
  const sky = formats.y9(await skySource.bytes()).root;
  const skyStem = built.city.textures.theme("village_skydome", ["village"]);
  const renameSky = n => { for (const s of n.slots) if (s?.kind === "texture") s.name = skyStem; n.children.forEach(renameSky); };
  renameSky(sky);
  files.push({ path: "skydome.1s", bytes: encodeTrackModel(sky) });
  files.push({ path: "xt_minimap.png", bytes: built.minimapPng });
  // Weather config: the rain effect exists (off at start); the city clock turns it on.
  const trackXml = "<?xml version='1.0' encoding='UTF-16'?>\n<trackInfo>\n\t<track filename='track'>\n\t\t<rainEffect enable='true' onStart='false'/>\n\t</track>\n</trackInfo>\n";
  files.push({ path: "track.xml", bytes: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(trackXml, "utf16le")])) });
  for (const [stem, make] of Object.entries(SKY_TEXTURES)) files.push({ path: `${stem}.png`, bytes: make() });
  for (const entry of await built.city.textures.entries()) files.push({ path: entry.path, bytes: entry.bytes });
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const file of files) {
    const target = path.join(outDir, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
    total += file.bytes.length;
  }
  const archive = await packRhoArchive(`track_${TRACK_ID}.rho`, files);
  const archivePath = path.join(outDir, `track_${TRACK_ID}.rho`);
  writeFileSync(archivePath, archive);
  console.log(`wrote ${files.length} files (${(total / 1e6).toFixed(1)} MB) and ${archivePath} (${(archive.length / 1e6).toFixed(1)} MB)`);
  if (args.includes("--register")) {
    const { registerContainer } = await import("./register-container.mjs");
    const result = await registerContainer({ mirrorRoot: path.resolve(option("--register-into") ?? projectRoot), containerPath: archivePath });
    for (const line of result.log ?? []) console.log(line);
    if (result.problems?.length) { console.error(result.problems); process.exit(1); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
