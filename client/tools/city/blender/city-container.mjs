// Shared pieces for building a track_kartcity.rho container from any source
// (the v2 builder's City class is mirrored here for the Blender importer):
// chunked mesh assembly, the minimap and the container packing/registration.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MeshBuilder } from "../geometry.mjs";
import { RgbaCanvas } from "../png.mjs";
import { TextureIndex, TextureSet } from "../textures.mjs";
import { alpha, backface, group, meshNode, texture } from "../model.mjs";
import { SKY_TEXTURES } from "../city-sky.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const projectRoot = path.resolve(clientDir, "..");
export const TRACK_ID = "kartcity";
export const CHUNK = 240;

/** Coordinate mapping, mesh builders per chunk and surface, texture set. */
export class CityModel {
  constructor(design, library, formats) {
    this.design = design; this.library = library; this.formats = formats;
    const [min, max] = design.meta.extent;
    this.origin = { x: min[0], z: max[1] };
    this.textures = new TextureSet(new TextureIndex(library));
    this.builders = new Map();
    this.extraNodes = [];
    this.surfaces = new Map();
  }
  /** Design (x east, z south, y up) → client (x, y north, z up). */
  client(x, z, y = 0) { return [x - this.origin.x, this.origin.z - z, y]; }
  clientDirection(tx, tz) { return [tx, -tz]; }
  chunkKey(x, z) { const c = this.client(x, z, 0); return `${Math.floor(c[0] / CHUNK)}_${Math.floor(c[1] / CHUNK)}`; }
  /** A texture surface shared by many meshes; `prefixes` overrides the theme lookup (track folders). */
  surface(id, textureName, themes, { road, blend, test, cull, colors, textureOp, sortBias = 0, generated, prefixes } = {}) {
    if (this.surfaces.has(id)) return this.surfaces.get(id);
    let stem;
    if (generated) stem = this.textures.generated(generated.stem, generated.extension, generated.bytes);
    else if (prefixes) {
      const found = this.textures.index.resolve(textureName, prefixes);
      if (!found) throw new Error(`找不到贴图 ${textureName}（${prefixes.join("|")}）。`);
      stem = this.textures.adopt(found, textureName);
    } else stem = this.textures.theme(textureName, themes);
    const slot = texture(stem, { road, textureOp: textureOp ?? (colors ? 4 : 1) });
    const surface = { id, stem, slot, colors: !!colors, sortBias, alphaSlot: blend || test ? alpha({ blend, test, ref: test ? 128 : 0 }) : undefined, backfaceSlot: cull !== undefined && cull !== null ? backface(cull) : undefined };
    this.surfaces.set(id, surface);
    return surface;
  }
  mesh(label, surface, x, z) {
    const key = `${this.chunkKey(x, z)}|${surface.id}`;
    let builder = this.builders.get(key);
    if (!builder) { builder = new MeshBuilder(); builder.surface = surface; builder.chunk = this.chunkKey(x, z); builder.label = label; this.builders.set(key, builder); }
    return builder;
  }
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

/** 256×256 minimap (north up): district tints, the roads, the route loops. */
export function renderMinimap(city, minimap, loops = []) {
  const canvas = new RgbaCanvas(256, 256, [18, 22, 28, 215]);
  const px = (x, z) => { const c = city.client(x, z, 0); return [128 + (c[0] - minimap.centerX) * minimap.scale, 128 - (c[1] - minimap.centerY) * minimap.scale]; };
  const tint = { village: [92, 84, 50, 255], forest: [60, 110, 70, 255], ice: [80, 110, 140, 255], desert: [150, 120, 70, 255], beach: [140, 130, 90, 255], city: [70, 70, 84, 255] };
  for (const d of city.design.districts ?? []) if (d.polygon) canvas.fillPolygon(d.polygon.map(p => px(p[0], p[1])), tint[d.theme] ?? [52, 58, 70, 255]);
  const stroke = (points, closed, width, color) => {
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) { const a = points[i], b = points[(i + 1) % points.length]; canvas.line(...px(a[0], a[1]), ...px(b[0], b[1]), width, color); }
  };
  for (const road of city.design.roads ?? []) {
    const type = city.design.roadTypes?.[road.type];
    const width = Math.max(1.5, (type?.width ?? 10) * minimap.scale * 1.4);
    const color = road.type === "expressway" ? [255, 255, 255, 255] : road.type === "water" ? [90, 140, 220, 255] : [220, 220, 220, 255];
    stroke(road.points, road.closed, width, color);
  }
  for (const loop of loops) stroke(loop.points, loop.closed, Math.max(1.5, 20 * minimap.scale * 1.2), [190, 160, 255, 255]);
  return canvas.png();
}

/**
 * Encode the model, add the skydome, minimap, track.xml and textures, pack
 * track_kartcity.rho into outDir and optionally register it in a mirror.
 */
export async function writeContainer({ library, formats, city, model, minimapPng, outDir, register = false, registerInto, extraFiles = [], skyTrack = "village_i11" }) {
  const { encodeTrackModel } = await import("../../../src/resources/track-binary-writer.ts");
  const { packRhoArchive } = await import("../../../src/codecs/rho-writer.ts");
  const files = [];
  files.push({ path: "track.1s", bytes: encodeTrackModel(model) });
  const skySource = library.files.find(f => f.virtualPath.toLowerCase() === `track_/${skyTrack}/skydome.1s`);
  const sky = formats.y9(await skySource.bytes()).root;
  const skyStem = city.textures.theme("village_skydome", ["village"]);
  const renameSky = n => { for (const s of n.slots) if (s?.kind === "texture") s.name = skyStem; n.children.forEach(renameSky); };
  renameSky(sky);
  files.push({ path: "skydome.1s", bytes: encodeTrackModel(sky) });
  files.push({ path: "xt_minimap.png", bytes: minimapPng });
  const trackXml = "<?xml version='1.0' encoding='UTF-16'?>\n<trackInfo>\n\t<track filename='track'>\n\t\t<rainEffect enable='true' onStart='false'/>\n\t</track>\n</trackInfo>\n";
  files.push({ path: "track.xml", bytes: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(trackXml, "utf16le")])) });
  for (const [stem, make] of Object.entries(SKY_TEXTURES)) files.push({ path: `${stem}.png`, bytes: make() });
  for (const entry of await city.textures.entries()) files.push({ path: entry.path, bytes: entry.bytes });
  files.push(...extraFiles);
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
  if (register) {
    const { registerContainer } = await import("../register-container.mjs");
    const result = await registerContainer({ mirrorRoot: path.resolve(registerInto ?? projectRoot), containerPath: archivePath });
    for (const line of result.log ?? []) console.log(line);
    if (result.problems?.length) { console.error(result.problems); process.exit(1); }
  }
  return { files: files.length, archivePath, size: archive.length };
}
