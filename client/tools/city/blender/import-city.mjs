#!/usr/bin/env node
// Blender city → track container: reads build/blender/out/kartcity.glb and
// kartcity-design.json (written by continent_scene.py), builds track.1s with the
// browser's own model constructors, the ring route, the minimap, textures
// (official ones by name from the mirror, Tripo ones from the glb images),
// packs track_kartcity.rho and writes city-map.json for client and server.
//
//   cd client && node --import tsx tools/city/blender/import-city.mjs [--in DIR] [--out DIR] [--mirror CHECKOUT] [--register --register-into CHECKOUT] [--validate]
//   --source-glbs DIR reads the audited Vice City source parts directly.
//   The design's top-level `props` (Tripo assets from design/open-world/tripo and
//   dropped-kerb ramps, see design-props.mjs) are added as solid meshes; --props-dir DIR overrides the asset folder.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "../../economy-export/resource-library.mjs";
import { encodePng } from "../png.mjs";
import { themePrefixes } from "../textures.mjs";
import { toMinimap, toRoad, trackContainer, trackObject, xml } from "../model.mjs";
import { createTerrain } from "../city-terrain.mjs";
import { routeRecords, sampleRoad } from "../city-roads.mjs";
import { validateModel } from "../build-city.mjs";
import { CityModel, renderMinimap, writeContainer } from "./city-container.mjs";
import { readGlb, transformDirection, transformPoint } from "./glb.mjs";
import { SurfaceMinimap } from "./surface-minimap.mjs";
import { coplanarRoadFilter } from "./road-collision-repair.mjs";
import { loadPropAsset, PROP_ASSET_DIR, propPrimitives, rampPrimitive } from "./design-props.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const projectRoot = path.resolve(clientDir, "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : projectRoot;
const inDir = path.resolve(option("--in") ?? path.join(clientDir, "build", "blender", "out"));
const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "kartcity"));

const safe = s => s.replace(/[^A-Za-z0-9_@\-\.]/g, "_");
const normalize = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const argb = (r, g, b) => ((255 << 24) | (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)) >>> 0;

/** A fully transparent 4×4 texture: alpha-tested away, so a collider mesh is invisible but solid. */
const TRANSPARENT_PNG = encodePng(4, 4, new Uint8Array(64));

export async function importCity({ library, formats, design, glb, propDir = PROP_ASSET_DIR }) {
  const city = new CityModel(design, library, formats);
  const surfaces = new Map();
  const images = new Map();
  const surfaceMinimap = design.meta.minimapGeometry ? new SurfaceMinimap(design) : undefined;
  const suppressRoadShell = design.meta.drivableMaterials ? coplanarRoadFilter(glb, design.meta.drivableMaterials) : undefined;
  let instances = 0, triangles = 0, suppressedCoplanarFaces = 0;

  // `source` is the glb holding the material's images; props pass their own
  // asset glb, a key prefix and extras (collision) for the Tripo material.
  const surfaceFor = (material, index, renderOnly = false, source = { glb, key: '', extras: undefined }) => {
    const key = `${source.key}${index ?? -1}${renderOnly ? '_visual' : ''}`;
    if (surfaces.has(key)) return surfaces.get(key);
    const baseExtras = { ...material?.extras, ...source.extras };
    const extras = renderOnly ? { ...baseExtras, kr_road: '', kr_collider: '' } : baseExtras;
    const name = source.key + safe(material?.name ?? `material_${key}`) + (renderOnly ? '_visual' : '');
    let surface;
    if (extras.kr_collider) {
      surface = city.surface("collider", "", [], { road: {}, test: true, generated: { stem: "kr_collider", extension: "png", bytes: TRANSPARENT_PNG } });
    } else if (extras.kr_texture) {
      const theme = extras.kr_theme || "village";
      const road = extras.kr_road ? JSON.parse(extras.kr_road) : undefined;
      const prefixes = [...(extras.kr_source ? [`track_/${extras.kr_source}`] : []), ...themePrefixes("", [theme, "village", "common"]).slice(1)];
      surface = city.surface(name, extras.kr_texture, [theme], { road, blend: extras.kr_alpha === "blend", test: extras.kr_alpha === "test", cull: extras.kr_cull >= 0 ? extras.kr_cull : undefined, textureOp: extras.kr_textureop || undefined, colors: !!extras.kr_colors, prefixes });
    } else {
      // A Tripo (or any textured) material: its base colour image becomes a generated texture.
      const imageIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index !== undefined ? source.glb.json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source : undefined;
      let generated;
      if (imageIndex !== undefined) {
        const imageKey = `${source.key}${imageIndex}`;
        if (!images.has(imageKey)) {
          const image = source.glb.image(imageIndex);
          const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/png" ? "png" : "png";
          images.set(imageKey, { stem: `t_${source.key}${safe(image.name ?? `image${imageIndex}`).slice(0, 40)}_${imageIndex}`, extension, bytes: image.bytes });
        }
        generated = images.get(imageKey);
      } else {
        const c = material?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
        const rgba = new Uint8Array(64); for (let i = 0; i < 16; i++) { rgba[i * 4] = c[0] * 255; rgba[i * 4 + 1] = c[1] * 255; rgba[i * 4 + 2] = c[2] * 255; rgba[i * 4 + 3] = 255; }
        generated = { stem: `flat_${name}`, extension: "png", bytes: encodePng(4, 4, rgba) };
      }
      const road = extras.kr_road ? JSON.parse(extras.kr_road) : undefined;
      surface = city.surface(name, "", [], { road, generated, blend: material?.alphaMode === "BLEND", test: material?.alphaMode === "MASK", cull: material?.doubleSided ? 1 : undefined });
    }
    surfaces.set(key, surface);
    return surface;
  };

  for (const { node, mesh, world } of glb.instances()) {
    if (!mesh) continue;
    instances++;
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positions = glb.accessor(primitive.attributes.POSITION).map(p => transformPoint(world, p));
      const normals = primitive.attributes.NORMAL !== undefined ? glb.accessor(primitive.attributes.NORMAL).map(n => normalize(transformDirection(world, n))) : undefined;
      const uvs = primitive.attributes.TEXCOORD_0 !== undefined ? glb.accessor(primitive.attributes.TEXCOORD_0) : undefined;
      const colors = primitive.attributes.COLOR_0 !== undefined ? glb.accessor(primitive.attributes.COLOR_0) : undefined;
      const indices = primitive.indices !== undefined ? glb.accessor(primitive.indices) : positions.map((_, i) => i);
      const material = primitive.material !== undefined ? glb.json.materials[primitive.material] : undefined;
      const surface = surfaceFor(material, primitive.material);
      // Chunk by the primitive's centroid (glTF x, z → design x, z).
      let cx = 0, cz = 0;
      for (const p of positions) { cx += p[0]; cz += p[2]; }
      cx /= positions.length || 1; cz /= positions.length || 1;
      const builder = city.mesh(node.name ?? "mesh", surface, cx, cz);
      const map = new Map();
      let visualBuilder;
      const visualMap = new Map();
      const vertex = (i, target = builder, vertices = map) => {
        let v = vertices.get(i);
        if (v === undefined) {
          const p = positions[i];
          const n = normals?.[i] ?? [0, 1, 0];
          const c = colors?.[i];
          v = target.vertex(city.client(p[0], p[2], p[1]), uvs?.[i] ? [uvs[i][0], uvs[i][1]] : [0, 0], [n[0], -n[2], n[1]], c ? argb(c[0], c[1], c[2]) : undefined);
          vertices.set(i, v);
        }
        return v;
      };
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const points=[positions[indices[i]],positions[indices[i+1]],positions[indices[i+2]]];
        if(material?.extras?.kr_road && suppressRoadShell?.(points)) {
          visualBuilder ??= city.mesh(node.name ?? 'mesh', surfaceFor(material,primitive.material,true),cx,cz);
          visualBuilder.triangle(...[indices[i],indices[i+1],indices[i+2]].map(j=>vertex(j,visualBuilder,visualMap)));
          suppressedCoplanarFaces++;
        } else builder.triangle(vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2]));
        triangles++;
        surfaceMinimap?.triangle(positions[indices[i]],positions[indices[i+1]],positions[indices[i+2]],material?.name ?? '');
      }
      if (colors && !surface.colors) { surface.colors = true; surface.slot.textureOp = 4; }
      if (colors && visualBuilder && !visualBuilder.surface.colors) { visualBuilder.surface.colors=true; visualBuilder.surface.slot.textureOp=4; }
    }
  }

  // The design's top-level `props`: Tripo assets (fuel stations) are solid
  // (kr_road "{}") with their texture as a generated one; ramps reuse a city material.
  let props = 0, propTriangles = 0;
  for (const prop of design.props ?? []) {
    props++;
    if (prop.kind === "ramp") {
      // A dropped kerb in an existing city material (its texture and collision).
      const index = glb.json.materials.findIndex(m => m.name === prop.material);
      if (index < 0) throw new Error(`ramp ${prop.id}: material ${prop.material} is not in the city glb`);
      const { name, positions, normals, uvs, indices } = rampPrimitive(prop);
      const builder = city.mesh(name, surfaceFor(glb.json.materials[index], index), prop.at[0], prop.at[1]);
      const v = positions.map((p, i) => builder.vertex(city.client(p[0], p[2], p[1]), uvs[i], [normals[i][0], -normals[i][2], normals[i][1]]));
      for (let i = 0; i + 2 < indices.length; i += 3) {
        builder.triangle(v[indices[i]], v[indices[i + 1]], v[indices[i + 2]]);
        surfaceMinimap?.triangle(positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]], prop.material);
        propTriangles++;
      }
      continue;
    }
    const entry = loadPropAsset(prop.asset, propDir);
    for (const { name, positions, normals, uvs, colors, indices, material, primitive } of propPrimitives(prop, entry)) {
      const surface = surfaceFor(material, primitive.material, false, { glb: entry.glb, key: `${prop.asset}_`, extras: { kr_road: "{}" } });
      const builder = city.mesh(name, surface, prop.at[0], prop.at[1]);
      const map = new Map();
      const vertex = i => {
        let v = map.get(i);
        if (v === undefined) {
          const p = positions[i], n = normals?.[i] ?? [0, 1, 0], c = colors?.[i];
          v = builder.vertex(city.client(p[0], p[2], p[1]), uvs?.[i] ? [uvs[i][0], uvs[i][1]] : [0, 0], [n[0], -n[2], n[1]], c ? argb(c[0], c[1], c[2]) : undefined);
          map.set(i, v);
        }
        return v;
      };
      for (let i = 0; i + 2 < indices.length; i += 3) {
        builder.triangle(vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2]));
        surfaceMinimap?.triangle(positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]], `PROP_${prop.asset}`);
        propTriangles++;
      }
    }
  }
  triangles += propTriangles;

  // Route: the ring road of the design.
  const terrain = createTerrain(design);
  const ringRoad = design.roads.find(r => r.route) ?? design.roads.find(r => r.id === "ring");
  if (!ringRoad) throw new Error("the design has no ring road for the route");
  const sample = sampleRoad(design, ringRoad, terrain, design.meta.routeSampleSpacing ?? 6);
  const records = routeRecords(city, sample, { frameStride: design.meta.routeFrameStride ?? 3 });
  const route = toRoad("ring", records, true);
  const extent = design.meta.extent;
  const size = Math.max(extent[1][0] - extent[0][0], extent[1][1] - extent[0][1]);
  const minimap = toMinimap({ centerX: (extent[1][0] - extent[0][0]) / 2, centerY: (extent[1][1] - extent[0][1]) / 2, scale: 236 / size });
  const minimapPng = surfaceMinimap?.png() ?? renderMinimap(city, minimap);
  const settings = trackObject("track", xml("property", {}, [
    xml("camera", { far: String(design.meta.cameraFar ?? 1000) }),
    xml("fog", { mode: "3", r: "188", g: "206", b: "228", start: "0.55", end: "1.0" }),
    xml("sun", { x: "0", y: "0", z: "-1" }),
    xml("course", {}, [xml("road", { name: "ring" })]),
  ]));
  const { root, meshCount, triangles: assembled, chunks } = city.assemble();
  const model = trackContainer("", root, [route, minimap, settings]);
  return { city, model, minimapPng, stats: { instances, triangles, props, propTriangles, suppressedCoplanarFaces, meshCount, assembled, chunks, textures: city.textures.files.size, records: records.length, surfaces: surfaces.size } };
}

async function main() {
  const design = JSON.parse(readFileSync(path.join(inDir, "kartcity-design.json"), "utf8"));
  const glb = option("--source-glbs")
    ? await (await import("./vice-city-source.mjs")).loadViceCitySource({ sourceDir: path.resolve(option("--source-glbs")), classificationPath: path.join(inDir, "vice-city-surface-classes.json"), reportPath: path.join(outDir, "source-adapter-report.json") })
    : readGlb(path.join(inDir, "kartcity.glb"));
  const { library, formats } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
  const built = await importCity({ library, formats, design, glb, propDir: option("--props-dir") ? path.resolve(option("--props-dir")) : PROP_ASSET_DIR });
  console.log("model", JSON.stringify(built.stats));
  const [[minX, minZ], [maxX, maxZ]] = design.meta.extent;
  const report = validateModel(formats, built.model, { roadExtent: Math.max(maxX - minX, maxZ - minZ) + 1 });
  console.log("validate", JSON.stringify({ ...report, start: undefined, stats: undefined }));
  if (!report.collisionTriangles) throw new Error("City has no solid collision surfaces; check kr_road material extras");
  if (report.issues.length) throw new Error(`City validation failed: ${report.issues.join("; ")}`);
  if (args.includes("--validate")) return;
  const sourceRecord = path.join(inDir, "source.json");
  const extraFiles = existsSync(sourceRecord) ? [{ path: "source.json", bytes: readFileSync(sourceRecord) }] : [];
  await writeContainer({ library, formats, city: built.city, model: built.model, minimapPng: built.minimapPng, outDir, extraFiles, register: args.includes("--register"), registerInto: option("--register-into") });
  // An isolated conversion must not change the running city. Publish matching
  // client/server metadata only after the complete native archive is written.
  if (args.includes("--register") || args.includes("--publish-map")) {
    const mapJson = JSON.stringify(design, null, 2) + "\n";
    for (const target of [path.join(projectRoot, "design", "open-world", "city-map.json"), path.join(clientDir, "src", "city", "city-map.json"), path.join(projectRoot, "server-go", "internal", "game", "city", "city-map.json")]) writeFileSync(target, mapJson);
    console.log(`city-map.json published (${design.roads.length} roads, ${design.districts.length} districts, ${design.pois.length} pois)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
