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
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { MeshBuilder, argb, random } from "./geometry.mjs";
import { RgbaCanvas } from "./png.mjs";
import { TextureIndex, TextureSet } from "./textures.mjs";
import { alpha, backface, group, meshNode, texture, toMinimap, toRoad, trackContainer, trackObject, xml } from "./model.mjs";
import { WATER_LEVEL, buildGround, buildWater, createTerrain, districtAt } from "./city-terrain.mjs";
import { buildRoadCeiling, buildRoadSurface, buildRoadWall, routeRecords, sampleRoad } from "./city-roads.mjs";
import { buildBuildings, buildBoundary, buildTrees, importLandmarks } from "./city-props.mjs";

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

function loadDesign() {
  const file = path.join(projectRoot, "design", "open-world", "city-map.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

/** 256×256 minimap drawn from the design (north up). */
function renderMinimap(city, minimap) {
  const canvas = new RgbaCanvas(256, 256, [18, 22, 28, 215]);
  const px = (x, z) => { const c = city.client(x, z, 0); return [128 + (c[0] - minimap.centerX) * minimap.scale, 128 - (c[1] - minimap.centerY) * minimap.scale]; };
  for (const d of city.design.districts) {
    const color = d.id === "mountain" ? [120, 130, 145, 255] : d.id === "forest" ? [60, 110, 70, 255] : [52, 58, 70, 255];
    if (d.circle) canvas.fillCircle(...px(d.circle[0], d.circle[1]), d.circle[2] * minimap.scale, [92, 84, 50, 255]);
    else canvas.fillPolygon(d.polygon.map(p => px(p[0], p[1])), color);
  }
  const water = [60, 110, 190, 255];
  canvas.fillPolygon(city.design.water.sea.polygon.map(p => px(p[0], p[1])), water);
  const river = city.design.water.river.points;
  for (let i = 0; i + 1 < river.length; i++) canvas.line(...px(river[i][0], river[i][1]), ...px(river[i + 1][0], river[i + 1][1]), city.design.water.river.width * minimap.scale, water);
  canvas.fillCircle(...px(city.design.water.lake.center[0], city.design.water.lake.center[1]), city.design.water.lake.radius * minimap.scale, water);
  for (const road of city.design.roads) {
    const width = Math.max(1.5, city.design.roadTypes[road.type].width * minimap.scale * 1.4);
    const color = road.type === "expressway" ? [255, 255, 255, 255] : road.type === "circuit" ? [190, 150, 255, 255] : road.type === "tunnel" ? [150, 150, 150, 255] : [220, 220, 220, 255];
    const pts = road.points;
    const count = road.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; canvas.line(...px(a[0], a[1]), ...px(b[0], b[1]), width, color); }
  }
  return canvas.png();
}

export async function buildCity({ library, formats, design }) {
  const city = new City(design, library, formats);
  const terrain = createTerrain(design);
  const V = ["village"], W = ["world"], B = ["beach"], F = ["forest"], FA = ["factory"], I = ["ice"], K = ["wkc"], M = ["mechanic"], CN = ["china"], P = ["park"];

  // Ground surfaces by district.
  const ground = {
    grass: city.surface("grass", "F_tilegrass00", V, { road: { surface: "dirt" } }),
    sand: city.surface("sand", "bc_sand_01", B, { road: { sound: "모래바닥" } }),
    snow: city.surface("snow", "road_snow_D", I, { road: { sound: "눈바닥" } }),
    concrete: city.surface("concrete", "cement01", ["common"], { road: {} }),
    factory: city.surface("factory-floor", "fact_floor001", FA, { road: {} }),
    rock: city.surface("rock", "cliff_set", V, { road: {} }),
    seabed: city.surface("seabed", "bc_sand_01", B, { road: { sound: "물밟기", dust: "water" } }),
  };
  const surfaceOf = (x, z) => {
    if (terrain.water(x, z) > 0) return ground.seabed;
    const d = districtAt(design, x, z);
    if (!d) return terrain.land(x, z) > 30 ? ground.rock : ground.grass;
    if (d.id === "mountain") return terrain.land(x, z) > 25 ? ground.rock : ground.snow;
    if (d.id === "funpark") return ground.snow;
    if (d.id === "harbor") return ground.sand;
    if (d.id === "industrial") return ground.factory;
    if (d.id === "plaza" || d.id === "neon") return ground.concrete;
    return ground.grass;
  };
  buildGround(city, terrain, surfaceOf);
  buildWater(city, {
    sea: city.surface("sea", "bc_sea03", B, { sortBias: 1 }),
    river: city.surface("river", "F_water00", V, { sortBias: 1 }),
  });

  // Roads.
  const roadSurfaces = {
    expressway: city.surface("road-expressway", "bc_road04", B, { road: {} }),
    avenue: city.surface("road-avenue", "cement08", ["common"], { road: {} }),
    street: city.surface("road-street", "cement05", ["common"], { road: {} }),
    lane: city.surface("road-lane", "cement04", ["common"], { road: {} }),
    circuit: city.surface("road-circuit", "f1_road_m00", K, { road: {} }),
    tunnel: city.surface("road-tunnel", "war_road01_cj", M, { road: {} }),
  };
  const rail = city.surface("rail", "fence00", V, { road: {}, cull: 1 });
  const tunnelWall = city.surface("tunnel-wall", "war_road_wall01", M, { road: {}, cull: 1 });
  const cliff = city.surface("cliff-wall", "cliff_set", V, { road: {}, cull: 1 });
  const samples = new Map();
  for (const road of design.roads) {
    const sample = sampleRoad(design, road, terrain);
    samples.set(road.id, sample);
    buildRoadSurface(city, sample, roadSurfaces[road.type]);
    const overWater = i => terrain.height(sample.points[i][0], sample.points[i][1]) < -0.5;
    if (road.type === "expressway") {
      buildRoadWall(city, sample, rail, 1, 1.2);
      buildRoadWall(city, sample, rail, -1, 1.2);
    } else if (road.id === "tunnel") {
      buildRoadWall(city, sample, tunnelWall, 1, 6);
      buildRoadWall(city, sample, tunnelWall, -1, 6);
      buildRoadCeiling(city, sample, tunnelWall, 6);
    } else if (road.id === "mountain") {
      buildRoadWall(city, sample, cliff, 1, 1.0);
      buildRoadWall(city, sample, cliff, -1, 1.0);
    } else {
      buildRoadWall(city, sample, rail, 1, 1.0, overWater);
      buildRoadWall(city, sample, rail, -1, 1.0, overWater);
    }
  }
  buildBoundary(city, terrain, city.surface("boundary", "fence01", V, { road: {}, cull: 1, test: true }));

  // Buildings, trees, landmarks.
  buildBuildings(city, terrain, samples);
  buildTrees(city, terrain, samples);
  const landmarks = await importLandmarks(city, terrain);

  // Route: the ring expressway.
  const ring = samples.get("ring");
  const records = routeRecords(city, ring);
  const route = toRoad("ring", records, true);

  // Minimap.
  const extent = design.meta.extent;
  const size = Math.max(extent[1][0] - extent[0][0], extent[1][1] - extent[0][1]);
  const minimap = toMinimap({ centerX: size / 2, centerY: size / 2, scale: 236 / size });
  const minimapPng = renderMinimap(city, minimap);

  const settings = trackObject("track", xml("property", {}, [
    xml("camera", { far: "1000" }),
    xml("fog", { mode: "3", r: "188", g: "206", b: "228", start: "0.55", end: "1.0" }),
    xml("sun", { x: "0", y: "0", z: "-1" }),
    xml("course", {}, [xml("road", { name: "ring" })]),
  ]));

  const { root, meshCount, triangles, chunks } = city.assemble();
  const model = trackContainer("", root, [route, minimap, settings]);
  return { city, model, minimapPng, landmarks, stats: { meshCount, triangles, chunks, textures: city.textures.files.size, records: records.length } };
}

/** Run the browser's extraction and course graph on the in-memory model. */
export function validateModel(formats, model) {
  const parsed = { root: model, rootOccurrence: { encoding: "new", id: 0, value: model } };
  const road = formats.YW(parsed, "speed-individual", { forceReverse: false });
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
  const design = loadDesign();
  const { library, formats } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
  const built = await buildCity({ library, formats, design });
  console.log("model", JSON.stringify(built.stats));
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
