// Buildings, trees, the map boundary and landmarks copied from existing tracks.
import { MeshBuilder, argb, bounds, densify2, pointInPolygon2, pointPolylineDistance2, polylineFrames2 } from "./geometry.mjs";
import { group, yawBasis } from "./model.mjs";
import { themePrefixes } from "./textures.mjs";
import { RgbaCanvas } from "./png.mjs";

const V = ["village"], W = ["world"], B = ["beach"], F = ["forest"], FA = ["factory"], K = ["wkc"], M = ["mechanic"], P = ["park"];

/** Building styles per district `buildings` value. */
const STYLES = {
  "dense-high": { count: 46, size: [18, 40], height: [28, 90], walls: [["f1_building00_m", K], ["f1_building01_m", K], ["f1_buildingM_m01", K]], tile: 10 },
  "dense-low": { count: 60, size: [10, 22], height: [7, 15], walls: [["building_128", V], ["cn_building00_j", V], ["cn_building01_j", V]], tile: 6 },
  "medium": { count: 14, size: [22, 48], height: [9, 20], walls: [["war_building01", M], ["fact_outwall", FA]], tile: 10 },
  "houses": { count: 0, size: [10, 14], height: [6, 9], walls: [["cn_building06_j", V], ["house_wallside_tw", W]], tile: 5 },
  "sparse": { count: 8, size: [10, 24], height: [5, 9], walls: [["bc_street_bg_00", B]], tile: 6 },
  "attractions": { count: 6, size: [12, 24], height: [6, 12], walls: [["wp_wall_m_pink_s", P], ["wp_wall_m_blue_s", P]], tile: 6 },
};

const clearOfRoads = (samples, x, z, margin) => {
  for (const sample of samples.values())
    if (pointPolylineDistance2([x, z], sample.points, !!sample.road.closed) < sample.width / 2 + margin) return false;
  return true;
};

/** An axis-aligned box with shaded walls (vertex colours) and a roof. */
export function pushBox(city, terrain, { x, z, w, d, h, wall, roof, tile = 8, yaw = 0 }) {
  const y0 = Math.max(0, terrain.height(x, z)) - 0.5;
  const c = Math.cos((yaw * Math.PI) / 180), s = Math.sin((yaw * Math.PI) / 180);
  const corner = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
  const p = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
  const shade = [1.0, 0.82, 0.72, 0.9];
  const wallBuilder = city.mesh("building", wall, x, z);
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const color = argb(shade[i], shade[i], shade[i]);
    // Outward-facing: with north-up client space the corner order above is
    // clockwise on the map, so a→b with the up edge gives an outward normal.
    wallBuilder.pushQuad(
      [city.client(b[0], b[1], y0), [0, h / tile]],
      [city.client(a[0], a[1], y0), [run / tile, h / tile]],
      [city.client(a[0], a[1], y0 + h), [run / tile, 0]],
      [city.client(b[0], b[1], y0 + h), [0, 0]],
      color,
    );
  }
  const roofBuilder = city.mesh("roof", roof, x, z);
  const uv = q => [q[0] / 8, q[1] / 8];
  roofBuilder.pushQuad(
    [city.client(p[0][0], p[0][1], y0 + h), uv(p[0])],
    [city.client(p[3][0], p[3][1], y0 + h), uv(p[3])],
    [city.client(p[2][0], p[2][1], y0 + h), uv(p[2])],
    [city.client(p[1][0], p[1][1], y0 + h), uv(p[1])],
    argb(0.75, 0.75, 0.75),
  );
}

export function buildBuildings(city, terrain, samples) {
  const design = city.design;
  const roofs = {
    tile: city.surface("roof-tile", "cn_jaroof00_j", ["common"], { road: {}, colors: true }),
    flat: city.surface("roof-flat", "cement_15", ["common"], { road: {}, colors: true }),
    home: city.surface("roof-home", "wp_house_outroof_t", P, { road: {}, colors: true }),
  };
  const placed = [];
  const keepOut = design.pois.map(poi => ({ at: poi.at, r: poi.kind === "landmark" || poi.kind === "function" ? 45 : 30 }));
  for (const district of design.districts) {
    const style = STYLES[district.buildings];
    if (!style || !district.polygon) continue;
    const xs = district.polygon.map(p => p[0]), zs = district.polygon.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const wallSurfaces = style.walls.map(([name, themes], i) =>
      city.surface(`wall-${district.id}-${i}`, name, themes, { road: {}, colors: true }));
    let done = 0, attempts = 0;
    while (done < style.count && attempts++ < style.count * 40) {
      const x = minX + city.rng() * (maxX - minX), z = minZ + city.rng() * (maxZ - minZ);
      const w = style.size[0] + city.rng() * (style.size[1] - style.size[0]);
      const d = style.size[0] + city.rng() * (style.size[1] - style.size[0]);
      const radius = Math.hypot(w, d) / 2;
      if (!pointInPolygon2([x, z], district.polygon)) continue;
      if (pointPolylineDistance2([x, z], district.polygon, true) < radius + 4) continue;
      if (terrain.water(x, z) > -radius - 6) continue;
      if (!clearOfRoads(samples, x, z, radius + 4)) continue;
      if (keepOut.some(k => Math.hypot(k.at[0] - x, k.at[1] - z) < k.r + radius)) continue;
      if (placed.some(b => Math.hypot(b.x - x, b.z - z) < b.r + radius + 3)) continue;
      const h = style.height[0] + city.rng() * (style.height[1] - style.height[0]);
      pushBox(city, terrain, { x, z, w, d, h, wall: wallSurfaces[Math.floor(city.rng() * wallSurfaces.length)], roof: district.buildings === "dense-low" ? roofs.tile : roofs.flat, tile: style.tile });
      placed.push({ x, z, r: radius });
      done++;
    }
  }
  // 小屋街: houses in rows along both streets.
  const homes = design.districts.find(d => d.id === "homes");
  if (homes) {
    const style = STYLES.houses;
    const walls = style.walls.map(([name, themes], i) => city.surface(`wall-homes-${i}`, name, themes, { road: {}, colors: true }));
    for (const streetId of ["home-h1", "home-h2"]) {
      const sample = samples.get(streetId);
      if (!sample) continue;
      for (const side of [1, -1]) {
        for (let s = 24; s < sample.total - 20; s += 20) {
          const i = sample.s.findIndex(v => v >= s);
          if (i < 0) continue;
          const [px, pz] = sample.points[i], [nx, nz] = sample.normals[i];
          const x = px + nx * side * (sample.width / 2 + 11), z = pz + nz * side * (sample.width / 2 + 11);
          if (!clearOfRoads(samples, x, z, 9)) continue;
          if (keepOut.some(k => Math.hypot(k.at[0] - x, k.at[1] - z) < 24)) continue;
          pushBox(city, terrain, { x, z, w: 11, d: 12, h: 6.5 + city.rng() * 2, wall: walls[Math.floor(city.rng() * walls.length)], roof: roofs.home, tile: style.tile });
        }
      }
    }
  }
  return placed;
}

/** Two crossed alpha-tested quads. */
function pushTree(city, terrain, surface, x, z, height, width) {
  const y = Math.max(0, terrain.height(x, z)) - 0.2;
  const builder = city.mesh("tree", surface, x, z);
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const a = [x - dx * width / 2, z - dz * width / 2], b = [x + dx * width / 2, z + dz * width / 2];
    builder.pushQuad(
      [city.client(a[0], a[1], y), [0, 1]],
      [city.client(b[0], b[1], y), [1, 1]],
      [city.client(b[0], b[1], y + height), [1, 0]],
      [city.client(a[0], a[1], y + height), [0, 0]],
    );
  }
}

export function buildTrees(city, terrain, samples) {
  const design = city.design;
  const kinds = [
    city.surface("tree-a", "tree01_c01", ["china"], { test: true, cull: 1 }),
    city.surface("tree-b", "tree02_c", ["china"], { test: true, cull: 1 }),
    city.surface("tree-c", "tree_re09", ["common"], { test: true, cull: 1 }),
    city.surface("tree-d", "tree_re09", V, { test: true, cull: 1 }),
  ];
  const blossom = city.surface("tree-blossom", "tree_re09", ["china"], { test: true, cull: 1 });
  const palm = city.surface("tree-palm", "T_tree_kaza01", V, { test: true, cull: 1 });
  const xmas = city.surface("tree-xmas", "ch_tree_b", ["ice"], { test: true, cull: 1 });
  const pick = () => kinds[Math.floor(city.rng() * kinds.length)];
  const scatter = (polygon, count, minHeight, maxHeight, kind = pick) => {
    const xs = polygon.map(p => p[0]), zs = polygon.map(p => p[1]);
    let done = 0, attempts = 0;
    while (done < count && attempts++ < count * 20) {
      const x = Math.min(...xs) + city.rng() * (Math.max(...xs) - Math.min(...xs));
      const z = Math.min(...zs) + city.rng() * (Math.max(...zs) - Math.min(...zs));
      if (!pointInPolygon2([x, z], polygon) || terrain.water(x, z) > -8 || !clearOfRoads(samples, x, z, 5)) continue;
      const h = minHeight + city.rng() * (maxHeight - minHeight);
      pushTree(city, terrain, kind(), x, z, h, h * 0.8);
      done++;
    }
  };
  for (const district of design.districts) {
    if (!district.polygon) continue;
    if (district.id === "forest") scatter(district.polygon, 260, 9, 15);
    else if (district.id === "homes") scatter(district.polygon, 40, 7, 10, () => (city.rng() < 0.5 ? blossom : pick()));
    else if (district.id === "oldtown" || district.id === "racepark") scatter(district.polygon, 40, 7, 11);
    else if (district.id === "harbor") scatter(district.polygon, 30, 9, 13, () => palm);
    else if (district.id === "funpark") scatter(district.polygon, 30, 7, 11, () => xmas);
  }
  // Avenue rows.
  for (const id of ["ave-ns", "ave-ew", "diag-ne", "diag-sw"]) {
    const sample = samples.get(id);
    if (!sample) continue;
    for (let s = 40; s < sample.total; s += 28) {
      const i = sample.s.findIndex(v => v >= s);
      if (i < 0) break;
      const [px, pz] = sample.points[i], [nx, nz] = sample.normals[i];
      for (const side of [1, -1]) {
        const x = px + nx * side * (sample.width / 2 + 4), z = pz + nz * side * (sample.width / 2 + 4);
        if (Math.hypot(x, z) < 250 || terrain.water(x, z) > -10 || !clearOfRoads(samples, x, z, 2.5)) continue;
        pushTree(city, terrain, pick(), x, z, 9, 7);
      }
    }
  }
}

/** A fence around the map so karts cannot leave the world. */
export function buildBoundary(city, terrain, surface) {
  const [min, max] = city.design.meta.extent;
  const corners = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]];
  const h = 4;
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4];
    const steps = 60;
    for (let k = 0; k < steps; k++) {
      const p = [a[0] + (b[0] - a[0]) * (k / steps), a[1] + (b[1] - a[1]) * (k / steps)];
      const q = [a[0] + (b[0] - a[0]) * ((k + 1) / steps), a[1] + (b[1] - a[1]) * ((k + 1) / steps)];
      const yp = Math.max(terrain.height(p[0], p[1]), -2) - 1, yq = Math.max(terrain.height(q[0], q[1]), -2) - 1;
      const builder = city.mesh("boundary", surface, p[0], p[1]);
      builder.pushQuad(
        [city.client(p[0], p[1], yp), [0, 1]],
        [city.client(q[0], q[1], yq), [8, 1]],
        [city.client(q[0], q[1], yq + h), [8, 0]],
        [city.client(p[0], p[1], yp + h), [0, 0]],
      );
    }
  }
}

/** Landmarks: subtrees of existing tracks placed at points of interest. */
const LANDMARKS = [
  { id: "ferris", track: "world_I02", node: "Group001", at: [-700, -650], yaw: 0, scale: 1 },
  { id: "bigben", track: "world_I02", node: "빅벤", at: [700, -470], yaw: 0, scale: 0.55 },
  { id: "gallery", track: "world_I02", node: "Object274366515@s1", at: [560, -300], yaw: 0, scale: 0.8 },
  { id: "tower-north", track: "world_R04", textures: /^lm_rondon_towerbridge/, at: [1040, 100], yaw: 0, scale: 1 },
  { id: "tower-south", track: "world_R04", textures: /^lm_rondon_towerbridge/, at: [400, 1040], yaw: 0, scale: 1 },
  { id: "cruise", track: "world_I02", node: "Object274366729@s1", at: [1000, 340], yaw: 20, scale: 1.2, floor: -1.2 },
  { id: "big-ship", track: "beach_I02", node: "QO00", at: [1120, 520], yaw: -30, scale: 1, floor: -1.2 },
  { id: "boat-a", track: "beach_I02", node: "통통배", at: [900, 420], yaw: 60, scale: 1, floor: -1.2 },
  { id: "boat-b", track: "beach_I02", node: "통통배02", at: [860, 640], yaw: -40, scale: 1, floor: -1.2 },
  { id: "skyline-a", track: "wkc_R01", node: "빌딩A05@s0", at: [620, -880], yaw: 0, scale: 0.8 },
  { id: "skyline-b", track: "wkc_R01", node: "Object12@s0", at: [930, -880], yaw: 90, scale: 0.9 },
  { id: "skyline-c", track: "wkc_R01", node: "Box17352910@s0", at: [900, -420], yaw: 0, scale: 0.7 },
  { id: "factory", track: "mechanic_R01", node: "Object274359188@s0", at: [80, 650], yaw: 0, scale: 0.6 },
  { id: "park-houses", track: "park_R01", node: "q", at: [-760, -560], yaw: 0, scale: 0.7 },
  { id: "santa-house", track: "nemo_I01", node: "cave_house006", at: [-880, -720], yaw: 30, scale: 1 },
  { id: "santa-house-b", track: "nemo_I01", node: "Group284", at: [-820, -900], yaw: -20, scale: 1 },
  { id: "pines-a", track: "forest_I01", node: "Group02", at: [-820, 420], yaw: 0, scale: 1 },
  { id: "pines-b", track: "forest_I01", node: "Group02", at: [-620, 700], yaw: 120, scale: 0.9 },
  { id: "pines-c", track: "forest_I01", node: "Group02", at: [-900, 950], yaw: 200, scale: 1.1 },
];

const mul = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2] + m[9], m[1] * v[0] + m[4] * v[1] + m[7] * v[2] + m[10], m[2] * v[0] + m[5] * v[1] + m[8] * v[2] + m[11]];
const compose = (p, c) => {
  const r = new Array(12);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r[col * 3 + row] = p[row] * c[col * 3] + p[3 + row] * c[col * 3 + 1] + p[6 + row] * c[col * 3 + 2];
  const t = mul(p, [c[9], c[10], c[11]]); r[9] = t[0]; r[10] = t[1]; r[11] = t[2];
  return r;
};
const localMatrix = n => { const [a, b, c] = n.transform, s = n.scale; return [a[0] * s[0], a[1] * s[0], a[2] * s[0], b[0] * s[1], b[1] * s[1], b[2] * s[1], c[0] * s[2], c[1] * s[2], c[2] * s[2], n.position[0], n.position[1], n.position[2]]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function subtreeBounds(node, parent = IDENTITY, acc = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }) {
  const m = compose(parent, localMatrix(node));
  const positions = node.vertexData?.positions ?? node.rigidGeometry?.positions;
  if (positions) for (const p of positions) { const w = mul(m, p); for (let i = 0; i < 3; i++) { acc.min[i] = Math.min(acc.min[i], w[i]); acc.max[i] = Math.max(acc.max[i], w[i]); } }
  for (const c of node.children) subtreeBounds(c, m, acc);
  return acc;
}

function findNodes(scene, spec) {
  const out = [];
  const walk = n => {
    if (spec.node && n.name.normalize("NFC") === spec.node.normalize("NFC")) { out.push(n); return; }
    if (spec.textures && n.slots.some(s => s?.kind === "texture" && spec.textures.test(s.name ?? ""))) { out.push(n); return; }
    n.children.forEach(walk);
  };
  scene.children.forEach(walk);
  return out;
}

export async function importLandmarks(city, terrain) {
  const { library, formats } = city;
  const parsedTracks = new Map();
  const metadata = new Map((await library.trackMetadataCatalog()).map(row => [row.id.toLowerCase(), row]));
  const invisible = city.surface("invisible", undefined, [], { road: {}, test: true, cull: 1,
    generated: { stem: "kc_invisible", extension: "png", bytes: new RgbaCanvas(4, 4, [0, 0, 0, 0]).png() } });
  const placed = [];
  for (const spec of LANDMARKS) {
    const trackId = spec.track.toLowerCase();
    let parsed = parsedTracks.get(trackId);
    if (!parsed) {
      const file = library.files.find(f => f.virtualPath.toLowerCase() === `track_/${trackId}/track.1s`);
      if (!file) { console.warn(`landmark ${spec.id}: missing track ${spec.track}`); continue; }
      parsed = formats.y9(await file.bytes()).root;
      parsedTracks.set(trackId, parsed);
    }
    const sources = findNodes(parsed.scene, spec);
    if (sources.length === 0) {
      const names = [];
      const walk = n => { names.push(n.name); n.children.forEach(walk); };
      parsed.scene.children.forEach(walk);
      const hint = spec.node ? names.filter(name => name.toLowerCase().includes(spec.node.slice(0, 3).toLowerCase())).slice(0, 8) : [];
      console.warn(`landmark ${spec.id}: no node matched (${hint.join(", ")})`);
      continue;
    }
    const meta = metadata.get(trackId);
    const themes = [spec.track.split("_")[0], ...(meta?.texTheme?.split("|") ?? [])].filter(Boolean);
    const prefixes = [...new Set([...themePrefixes(spec.track, themes), ...themePrefixes(meta?.folder ?? spec.track, themes)])];
    // Deep copy so repeated placements stay distinct objects (the loader rejects shared nodes).
    const copies = sources.map(source => structuredClone(source));
    const renamed = new Set();
    const relink = n => {
      for (let i = 0; i < n.slots.length; i++) {
        const slot = n.slots[i];
        if (slot?.kind === "texture") {
          if (!renamed.has(slot) && slot.name !== undefined) {
            const found = city.textures.index.resolve(slot.name, prefixes);
            if (found) slot.name = city.textures.adopt(found, slot.name);
            else { console.warn(`landmark ${spec.id}: texture ${slot.name} not found; hiding ${n.name}`); n.nodeEnabled = 0; }
            // Imported road descriptors are replaced by our own collision box.
            if (slot.property) { slot.property = undefined; slot.propertyOccurrence = undefined; }
            renamed.add(slot);
          }
        }
        n.slotOccurrences[i] = slot ? { encoding: "new", value: slot } : undefined;
      }
      if (n.vertexData) n.vertexDataOccurrence = { encoding: "new", value: n.vertexData };
      n.children.forEach(relink);
    };
    copies.forEach(relink);
    const box = copies.reduce((acc, c) => subtreeBounds(c, IDENTITY, acc), { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
    const basis = yawBasis(spec.yaw);
    const s = spec.scale;
    const rotated = [
      (basis[0][0] * center[0] + basis[1][0] * center[1]) * s,
      (basis[0][1] * center[0] + basis[1][1] * center[1]) * s,
      center[2] * s,
    ];
    const floor = spec.floor ?? Math.max(0, terrain.height(spec.at[0], spec.at[1]));
    const target = city.client(spec.at[0], spec.at[1], floor);
    const wrapper = group(`landmark_${spec.id}`, copies, {
      transform: basis, scale: [s, s, s],
      position: [target[0] - rotated[0], target[1] - rotated[1], target[2] - rotated[2]],
    });
    city.extraNodes.push(wrapper);
    // Collision: an invisible box around the footprint (slightly inset).
    const w = (box.max[0] - box.min[0]) * s * 0.9, d = (box.max[1] - box.min[1]) * s * 0.9, h = (box.max[2] - box.min[2]) * s;
    if (spec.floor === undefined && w > 4 && d > 4) {
      const yaw = spec.yaw;
      const c = Math.cos((yaw * Math.PI) / 180), sn = Math.sin((yaw * Math.PI) / 180);
      const corner = (dx, dz) => [spec.at[0] + dx * c - dz * sn, spec.at[1] + dx * sn + dz * c];
      const p = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
      const builder = city.mesh("landmark-collision", invisible, spec.at[0], spec.at[1]);
      for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i + 1) % 4];
        builder.pushQuad([city.client(b[0], b[1], floor - 1), [0, 1]], [city.client(a[0], a[1], floor - 1), [1, 1]],
          [city.client(a[0], a[1], floor + Math.min(h, 30)), [1, 0]], [city.client(b[0], b[1], floor + Math.min(h, 30)), [0, 0]]);
      }
    }
    placed.push({ id: spec.id, nodes: copies.length, size: [w, d, h].map(v => Math.round(v)) });
  }
  return placed;
}
