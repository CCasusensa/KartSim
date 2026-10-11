// 卡丁城 v2 districts: whole official tracks (meshes, textures with their
// road properties, controllers) placed under one group each, with the
// connector corridors cut through their fences and their routes exported
// for resets, spawns and the minimap.
import { TextureIndex, themePrefixes } from "./textures.mjs";
import { group, yawBasis } from "./model.mjs";

const mul = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2] + m[9], m[1] * v[0] + m[4] * v[1] + m[7] * v[2] + m[10], m[2] * v[0] + m[5] * v[1] + m[8] * v[2] + m[11]];
const compose = (p, c) => {
  const r = new Array(12);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r[col * 3 + row] = p[row] * c[col * 3] + p[3 + row] * c[col * 3 + 1] + p[6 + row] * c[col * 3 + 2];
  const t = mul(p, [c[9], c[10], c[11]]); r[9] = t[0]; r[10] = t[1]; r[11] = t[2];
  return r;
};
const localMatrix = n => { const [a, b, c] = n.transform, s = n.scale; return [a[0] * s[0], b[0] * s[0], c[0] * s[0], a[1] * s[1], b[1] * s[1], c[1] * s[1], a[2] * s[2], b[2] * s[2], c[2] * s[2], n.position[0], n.position[1], n.position[2]]; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const FACING = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }; // track-local (x east, y north) direction the road comes from
/** How far (m) a connector street and its corridor reach past the entrance point into the district. */
export const CORRIDOR_INWARD = 12;

/**
 * The triangles of a mesh node as index triples: a ReTriList as is, a
 * ReTriStrip expanded (degenerate triangles skipped, odd ones swapped so
 * the winding stays consistent). Most official meshes are strips.
 */
export function meshTriangles(node) {
  const geometry = node.vertexData ?? node.rigidGeometry;
  const indices = geometry?.indices;
  if (!indices?.length) return [];
  const out = [];
  if (node.className === "ReTriStrip") {
    // Raw strip order (the loader's collision walk uses it as is); the
    // triangle's start index is kept so a rewritten strip can keep parity.
    for (let i = 2; i < indices.length; i++) {
      const a = indices[i - 2], b = indices[i - 1], c = indices[i];
      if (a === b || b === c || a === c) continue;
      const triangle = [a, b, c];
      triangle.start = i - 2;
      out.push(triangle);
    }
  } else {
    for (let i = 0; i + 2 < indices.length; i += 3) out.push([indices[i], indices[i + 1], indices[i + 2]]);
  }
  return out;
}

/**
 * A strip's index buffer without the cut triangles: each kept triangle is
 * re-emitted at an index of its original parity, joined to the previous one
 * by degenerate triangles, so the node stays a ReTriStrip and every
 * surviving triangle keeps its winding for the renderer and the collision.
 */
function restrip(indices, triangles, kept) {
  const keptSet = new Set();
  for (let i = 0; i + 2 < kept.length; i += 3) keptSet.add(`${kept[i]},${kept[i + 1]},${kept[i + 2]}`);
  const out = [];
  for (const t of triangles) {
    if (!keptSet.has(`${t[0]},${t[1]},${t[2]}`)) continue;
    const [a, b, c] = t;
    if (out.length) { out.push(out[out.length - 1], a); } // degenerate bridge
    while (out.length % 2 !== t.start % 2) out.push(a);      // keep the triangle's parity
    out.push(a, b, c);
  }
  return out;
}

/** Texture lookup prefixes of a track: its folder, its themes, common, and the shared ad boards. */
function trackPrefixes(trackId, meta) {
  const themes = [trackId.split("_")[0], ...(meta?.texTheme?.split("|") ?? [])].filter(Boolean);
  return [...new Set([...themePrefixes(trackId, themes), ...themePrefixes(meta?.folder ?? trackId, themes), "theme_/xyy/texture"])];
}

/**
 * Rewrites every occurrence of a parsed track as "new" so the writer emits a
 * self-contained copy, renames textures into the city's texture set and
 * drops nodes whose texture is missing. Returns import statistics.
 */
function relink(city, nodes, prefixes, label) {
  const stats = { nodes: 0, dropped: 0, controllers: 0, resets: 0, missing: new Set() };
  const seen = new Set();
  const visit = n => {
    stats.nodes++;
    for (let i = 0; i < n.slots.length; i++) {
      const slot = n.slots[i];
      if (!slot) { n.slotOccurrences[i] = undefined; continue; }
      if (i === 0 || i === 1) stats.controllers++;
      if (slot.kind === "texture") {
        if (!seen.has(slot)) {
          seen.add(slot);
          if (slot.name !== undefined) {
            const found = city.textures.index.resolve(slot.name, prefixes);
            if (found) slot.name = city.textures.adopt(found, slot.name);
            else stats.missing.add(slot.name);
          }
          if (slot.property) {
            // A "리셋" (reset) surface sends a kart back to its last route
            // gate, which in the city is the ring road: water and lake beds
            // become plain ground, and the city's own fall reset applies.
            const road = slot.property.children?.find(c => c.name === "road");
            if (road) {
              const surface = road.attributes.find(a => a.name === "surface");
              if (surface?.value === "리셋") { road.attributes = road.attributes.filter(a => a !== surface); stats.resets++; }
            }
            slot.propertyOccurrence = { encoding: "new", value: slot.property };
          }
          for (let u = 0; u < (slot.uvControllers?.length ?? 0); u++) {
            slot.uvControllerOccurrences[u] = slot.uvControllers[u] ? { encoding: "new", value: slot.uvControllers[u] } : undefined;
          }
          if (slot.alphaController) slot.alphaControllerOccurrence = { encoding: "new", value: slot.alphaController };
        }
        if (stats.missing.has(slot.name)) n.dropped = true;
      }
      n.slotOccurrences[i] = { encoding: "new", value: slot };
    }
    if (n.vertexData) n.vertexDataOccurrence = { encoding: "new", value: n.vertexData };
    if (n.rigidGeometry) n.rigidGeometryOccurrence = { encoding: "new", value: n.rigidGeometry };
    n.children.forEach(visit);
    const before = n.children.length;
    n.children = n.children.filter(c => !c.dropped);
    stats.dropped += before - n.children.length;
    n.childOccurrences = n.children.map(c => ({ encoding: "new", value: c }));
  };
  nodes.forEach(visit);
  if (stats.missing.size) console.warn(`${label}: textures not found, nodes dropped: ${[...stats.missing].join(", ")}`);
  return stats;
}

/**
 * Removes every triangle touching `box` (track-local, {min:[x,y,z],
 * max:[x,y,z]}) except flat drivable floor no higher than `floor` + 2.5 m:
 * the connector street continues through the cleared corridor onto the
 * district's own ground. Returns how many triangles went.
 */
export function cutCorridor(nodes, box, floor = box.min[2] + 30) {
  let removed = 0;
  // Overlap test: the triangle's z range against the box's, then the 2D
  // separating-axis test (box edges and triangle edge normals), so a big
  // wall or stand triangle crossing the slot without a vertex inside goes too.
  const overlaps = (a, b, c) => {
    const zs = [a[2], b[2], c[2]];
    if (Math.max(...zs) < box.min[2] || Math.min(...zs) > box.max[2]) return false;
    const xs = [a[0], b[0], c[0]], ys = [a[1], b[1], c[1]];
    if (Math.max(...xs) < box.min[0] || Math.min(...xs) > box.max[0] || Math.max(...ys) < box.min[1] || Math.min(...ys) > box.max[1]) return false;
    const corners = [[box.min[0], box.min[1]], [box.max[0], box.min[1]], [box.max[0], box.max[1]], [box.min[0], box.max[1]]];
    const tri = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p = tri[i], q = tri[(i + 1) % 3];
      const nx = -(q[1] - p[1]), ny = q[0] - p[0];
      let tMin = Infinity, tMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of tri) { const d = nx * v[0] + ny * v[1]; tMin = Math.min(tMin, d); tMax = Math.max(tMax, d); }
      for (const v of corners) { const d = nx * v[0] + ny * v[1]; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (tMax < bMin || bMax < tMin) return false;
    }
    return true;
  };
  const visit = (n, parent) => {
    const m = compose(parent, localMatrix(n));
    const geometry = n.vertexData ?? n.rigidGeometry;
    if (geometry?.positions && geometry.indices?.length) {
      const world = geometry.positions.map(p => mul(m, p));
      const texture = n.slots.find(s => s?.kind === "texture");
      const road = !!(texture?.property ?? texture?.propertyOccurrence?.value)?.children?.find(c => c.name === "road");
      const triangles = meshTriangles(n);
      const kept = [];
      let cut = 0;
      for (const [ia, ib, ic] of triangles) {
        const a = world[ia], b = world[ib], c = world[ic];
        if (overlaps(a, b, c)) {
          // Flat drivable floor at street level stays (its triangles can span
          // the whole plaza); walls, fences, kerb faces, stands, raised
          // floors and decoration go.
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const flat = Math.abs(nz) / (Math.hypot(nx, ny, nz) || 1) > 0.7;
          const raised = Math.max(a[2], b[2], c[2]) > floor + 2.5; // a rim, a stand or a slope climbing away from the street
          if (!(flat && road) || raised) { cut++; continue; }
        }
        kept.push(ia, ib, ic);
      }
      if (cut > 0) {
        removed += cut;
        const survivors = n.className === "ReTriStrip" ? restrip(geometry.indices, triangles, kept) : kept;
        geometry.indices = geometry.indices instanceof Uint16Array ? Uint16Array.from(survivors)
          : geometry.indices instanceof Uint32Array ? Uint32Array.from(survivors) : survivors;
        if (n.vertexData) n.vertexDataOccurrence = { encoding: "new", value: n.vertexData };
        if (n.rigidGeometry) n.rigidGeometryOccurrence = { encoding: "new", value: n.rigidGeometry };
      }
    }
    for (const c of n.children) visit(c, m);
  };
  nodes.forEach(n => visit(n, IDENTITY));
  return removed;
}

/**
 * Height of the flat road-property surface under a track-local point
 * (x, y) nearest to `near` (an overpass above the road is not the road),
 * or undefined.
 */
export function surfaceHeightAt(nodes, x, y, near = 0) {
  let best;
  const visit = (n, parent) => {
    const m = compose(parent, localMatrix(n));
    const geometry = n.vertexData ?? n.rigidGeometry;
    const texture = n.slots.find(s => s?.kind === "texture");
    const road = !!texture?.property?.children?.find(c => c.name === "road");
    if (road && geometry?.positions && geometry.indices?.length) {
      const world = geometry.positions.map(p => mul(m, p));
      for (const [ia, ib, ic] of meshTriangles(n)) {
        const a = world[ia], b = world[ib], c = world[ic];
        const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
        const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
        const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
        if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(nz) < 1e-6 || Math.abs(nz) / Math.hypot(nx, ny, nz) < 0.7) continue;
        const z = a[2] - (nx * (x - a[0]) + ny * (y - a[1])) / nz;
        if (best === undefined || Math.abs(z - near) < Math.abs(best - near)) best = z;
      }
    }
    for (const c of n.children) visit(c, m);
  };
  nodes.forEach(n => visit(n, IDENTITY));
  return best;
}

/** The ToRoad records the track's course uses, in course order. */
function courseRoads(root) {
  const settings = root.trackObjects.find(o => o.kind === "TrackObject" && o.property?.children?.some(c => c.name === "course"));
  const course = settings?.property.children.find(c => c.name === "course");
  const names = [];
  const walk = node => { if (node.name === "road") names.push(node.attributes.find(a => a.name === "name")?.value); (node.children ?? []).forEach(walk); };
  if (course) walk(course);
  const roads = root.trackObjects.filter(o => o.kind === "ToRoad" && o.records?.length);
  const ordered = names.map(name => roads.find(r => r.name === name)).filter(Boolean);
  return ordered.length ? ordered : roads;
}

/**
 * Imports every district of the design. Each track is placed so the centre
 * of its road extents lands on the district centre, rotated by `yaw`, and
 * lowered so the first entrance's road sits at ground level. Returns the
 * exported routes (design coordinates with elevation), spawns and stats.
 */
export async function importDistricts(city) {
  const { library, formats, design } = city;
  const metadata = new Map((await library.trackMetadataCatalog()).map(row => [row.id.toLowerCase(), row]));
  const loops = [], spawns = [], placed = [], entranceAt = new Map();
  for (const district of design.districts) {
    if (!district.track) continue;
    const trackId = district.track.toLowerCase();
    const file = library.files.find(f => f.virtualPath.toLowerCase() === `track_/${trackId}/track.1s`);
    if (!file) throw new Error(`district ${district.id}: track ${district.track} not found`);
    const root = formats.y9(await file.bytes()).root;
    let nodes = root.scene.children;
    if (district.drop) {
      // Props the city does not want (e.g. the arena's floating coins): nodes whose texture matches.
      const pattern = new RegExp(district.drop, "i");
      const prune = n => { n.children = n.children.filter(c => !c.slots.some(s => s?.kind === "texture" && pattern.test(s.name ?? ""))); n.children.forEach(prune); };
      nodes = nodes.filter(n => !n.slots.some(s => s?.kind === "texture" && pattern.test(s.name ?? "")));
      nodes.forEach(prune);
      root.scene.children = nodes;
    }
    const stats = relink(city, nodes, trackPrefixes(district.track, metadata.get(trackId)), `district ${district.id}`);
    const roads = courseRoads(root);
    const records = roads.flatMap(r => r.records);
    const centerOf = rec => { const [lb, rb] = rec.positions; return [(lb[0] + rb[0]) / 2, (lb[1] + rb[1]) / 2, (lb[2] + rb[2]) / 2]; };
    const nearest = ([x, y]) => records.reduce((best, rec) => {
      const c = centerOf(rec); const d = Math.hypot(c[0] - x, c[1] - y);
      return d < best.d ? { d, rec, c } : best;
    }, { d: Infinity });
    const { min, max } = district.extents;
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
    // Road level: the route's road surface at the gate nearest the first
    // entrance (an arena: its field, not the rim around it).
    const first = district.entrances[0];
    const gate = first ? nearest(first.local) : undefined;
    const roadLevel = (gate && surfaceHeightAt(nodes, gate.c[0], gate.c[1], gate.c[2])) ?? gate?.c[2]
      ?? (records.length ? centerOf(records[0])[2] : 0);
    // Entrances snap inward (2 m steps, up to 120 m) to where the district's
    // ground near that level begins, so the street never ends over a void
    // or on a rim above the road; the corridor then clears what is in
    // between. Ground up to 8 m off the road level counts (a plaza the road
    // ramps down from, a stadium's rim around its sunken field); an arch
    // over the road does not (`snapTolerance` overrides the 8 m).
    const tolerance = district.snapTolerance ?? 8;
    const snapped = district.entrances.map(entrance => {
      const [fx, fy] = FACING[entrance.facing];
      for (let d = 0; d <= 120; d += 2) {
        const x = entrance.local[0] - fx * d, y = entrance.local[1] - fy * d;
        const h = surfaceHeightAt(nodes, x - fx * 3, y - fy * 3, roadLevel);
        if (h !== undefined && Math.abs(h - roadLevel) <= tolerance) return { ...entrance, local: [x, y] };
      }
      console.warn(`district ${district.id}: no ground at road level inward of entrance ${entrance.id}`);
      return entrance;
    });
    // Ground level: the district's ground where the street arrives (3 m
    // inside the snapped entrance), so the street meets it flush; an arena
    // bowl or a plaza above its road then sits below or above street level
    // the way the original does.
    const arrival = snapped[0] ? [snapped[0].local[0] - FACING[snapped[0].facing][0] * 3, snapped[0].local[1] - FACING[snapped[0].facing][1] * 3] : undefined;
    const lower = (arrival && surfaceHeightAt(nodes, arrival[0], arrival[1], roadLevel)) ?? roadLevel;
    // Corridors: everything from the entrance point (where the district's
    // own ground begins) out to `reach` m (default 12; a stadium's stands
    // need ~100) past the footprint edge is cleared, the street width +
    // margin wide and tall enough for berms, trees and cliffs.
    let cut = 0;
    const reach = district.reach ?? 12;
    // CORRIDOR_INWARD m past the entrance too (kerbs and trims at the
    // district's edge; floors at or below street level stay, so the street
    // overlapping the first metres loses nothing). A district whose field
    // lies behind a fence inside the entrance (the stadium) sets
    // `corridorInward` deep enough to open that fence as well.
    const inward = district.corridorInward ?? CORRIDOR_INWARD;
    for (const entrance of snapped) {
      const [fx, fy] = FACING[entrance.facing];
      const half = entrance.width / 2 + 3;
      const [lx, ly] = entrance.local;
      const edge = fx > 0 ? max[0] + reach : fx < 0 ? min[0] - reach : fy > 0 ? max[1] + reach : min[1] - reach;
      const box = fx !== 0
        ? { min: [Math.min(lx - fx * inward, edge), ly - half, lower - 30], max: [Math.max(lx - fx * inward, edge), ly + half, lower + 40] }
        : { min: [lx - half, Math.min(ly - fy * inward, edge), lower - 30], max: [lx + half, Math.max(ly - fy * inward, edge), lower + 40] };
      cut += cutCorridor(nodes, box, lower);
    }
    // Placement: track-local (cx, cy, lower) → the district centre at ground level.
    const basis = yawBasis(district.yaw ?? 0);
    const target = city.client(district.center[0], district.center[1], 0);
    const rot = p => [basis[0][0] * p[0] + basis[0][1] * p[1], basis[1][0] * p[0] + basis[1][1] * p[1], p[2]];
    const rc = rot([cx, cy, lower]);
    const position = [target[0] - rc[0], target[1] - rc[1], -lower];
    const node = group(`district_${district.id}`, nodes.filter(n => !n.dropped), { transform: basis, position });
    city.extraNodes.push(node);
    // Exported routes: record centres with elevation, in design coordinates.
    const toDesign = p => {
      const r = rot(p);
      const client = [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
      return [Math.round((client[0] + city.origin.x) * 10) / 10, Math.round((city.origin.z - client[1]) * 10) / 10, Math.round(client[2] * 10) / 10];
    };
    for (const road of roads) {
      const points = road.records.map(rec => toDesign(centerOf(rec)));
      loops.push({ id: `${district.id}:${road.name}`, name: `${district.name}赛道`, type: "district", closed: !!road.cyclic, points, district: district.id, generated: true });
    }
    const start = roads[0]?.records[0];
    if (start) {
      const c = toDesign(centerOf(start));
      const forward = start.frames?.[0]?.storedForward ?? [0, 1, 0];
      const f = rot(forward);
      // Design heading: 0 = north (client +y), clockwise.
      const heading = Math.round(((Math.atan2(f[0], f[1]) * 180) / Math.PI + 360) % 360) % 360;
      spawns.push({ id: `spawn-${district.id}`, name: `${district.name}出生点`, kind: "spawn", at: [c[0], c[1]], y: c[2], heading, district: district.id, generated: true });
    }
    const entrances = snapped.map((entrance, index) => {
      const d = toDesign([entrance.local[0], entrance.local[1], lower]);
      return { ...district.entrances[index], at: [d[0], d[1]], local: entrance.local };
    });
    placed.push({ id: district.id, track: district.track, nodes: stats.nodes, dropped: stats.dropped, controllers: stats.controllers, resets: stats.resets, lower: Math.round(lower * 10) / 10, cut,
      entrances: entrances.map(e => `${e.id}@${e.at}`) });
    entranceAt.set(district.id, entrances);
  }
  return { loops, spawns, placed, entrances: entranceAt };
}
