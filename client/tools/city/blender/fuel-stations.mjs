#!/usr/bin/env node
// 卡丁城 fuel stations: writes the Tripo station props and the `kind: "fuel"`
// POIs into the staged design (build/vice-city/out/kartcity-design.json) so the
// next import places them. Ground heights come from the solid triangles of the
// archived kartcity.glb; the station geometry (slab, pump gap) from the asset.
//
//   cd client && node --max-old-space-size=12000 tools/city/blender/fuel-stations.mjs [--design FILE] [--glb FILE] [--dry-run]
//
// Each Tripo station is c_gasstation scaled to SIZE: its long axis (model z)
// runs along `heading`, parallel to the adjacent road, and the pump side
// (model +x, heading + 90) faces that road. Karts drive through the gap
// between the two pump islands, across the long axis; the park pose sits in
// that gap on the slab, facing the road. The POI heading is the same facing.
// Where the straight way from the park pose to the nearest road meets a kerb
// (a 0.1–0.25 m step the half-size city karts cannot climb), a dropped-kerb
// `ramp` prop in the kerb's own pavement material is added.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readGlb, transformPoint } from "./glb.mjs";
import { DEFAULT_LIFT, loadPropAsset, MAX_LIFT, propPlacement } from "./design-props.mjs";
import { nearestRoadPoint } from "./fuel-station-checks.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return path.resolve(i >= 0 ? args[i + 1] : fallback); };

export const ASSET = "c_gasstation";
/** Scaled bounding box [across, along, height]: vertical scale 0.751 of the horizontal one. */
export const SIZE = [14, 20, 10];
/** The refuel zone is the canopy footprint grown by this margin. */
export const ZONE_MARGIN = 3;
const MIN_LIFT = 0.01;

/** New stations: centre, long-axis heading (design degrees) and a ground height hint. */
export const TRIPO_STATIONS = [
  { id: "fuel-washington", name: "华盛顿海滩加油站", at: [-306, -288], heading: 357, hintY: 9.9, desc: "华盛顿海滩临街停车场里的卡通加油站，加油机朝向东侧海滨大道。" },
  { id: "fuel-vice-point", name: "罪恶角加油站", at: [-798, -1175], heading: 15, hintY: 9.9, desc: "罪恶角海边大广场上的卡通加油站，加油机朝向东侧道路。" },
  { id: "fuel-havana", name: "小哈瓦那加油站", at: [-1610, 504], heading: 358, hintY: 10.06, desc: "小哈瓦那滨水大道西侧铺装场地上的卡通加油站，加油机朝向大道。" },
  { id: "fuel-haiti", name: "小海地加油站", at: [-1889, -24], heading: 88, hintY: 10.4, desc: "小海地沥青停车场里的卡通加油站，加油机朝向南侧街道。" },
  { id: "fuel-downtown", name: "市中心加油站", at: [-1714, -1606], heading: 90, hintY: 10.1, desc: "市中心直升机坪旁广场上的卡通加油站，加油机朝向南侧街道。" },
  { id: "fuel-airport", name: "机场加油站", at: [-2449.5, 375], heading: 90, hintY: 13.85, desc: "机场航站楼进场道路北侧停车场里的卡通加油站，加油机朝向进场道路；停机坪有围栏，车辆进不去。" },
];

/**
 * The original Vice City station by Ocean Beach (pumps PETROLPUMPBASE_256 /
 * PETROLPUMPTOP_128, roofs ROOF09L256 at y 15.36, pillars GARAGELEDGE1_128,
 * forecourt ROAD_UPT_CONC FLOORCLEAN at y 9.423), measured in kartcity.glb:
 * canopy A x[-740.72,-721.74] z[764.17,781.54] over an E-W pump island
 * (curb x[-739.64,-722.88] z[772.07,773.57], pumps at x -736.1/-733.0/-729.3/-726.3);
 * canopy B x[-719.87,-702.49] z[780.53,799.51] over a N-S island
 * (curb x[-711.90,-710.40] z[781.60,798.37]). The zone is both canopies + 3 m;
 * the park pose is canopy A's south lane between the middle pumps, facing
 * east to the forecourt exit onto the road east of the station.
 */
export const ORIGINAL_STATION = {
  id: "fuel-ocean-beach", name: "海洋海滩加油站", source: "original", y: 9.423,
  canopies: [[[-740.72, 764.17], [-721.74, 781.54]], [[-719.87, 780.53], [-702.49, 799.51]]],
  park: { at: [-731.2, 777.6], heading: 90 },
  desc: "罪恶都市原有的海洋海滩加油站（两座雨棚、八台加油机），向东驶出前场即回到大道。",
};

const round = (v, digits = 2) => Number(v.toFixed(digits));
const wrap = degrees => ((degrees % 360) + 360) % 360;

/** Solid up-facing triangles of the city near the given points (design x/z within `radius`). */
export function groundSampler(glb, points, radius = 60) {
  const CELL = 4, cells = new Map();
  for (const { mesh, world } of glb.instances()) {
    if (!mesh) continue;
    for (const primitive of mesh.primitives) {
      const material = primitive.material !== undefined ? glb.json.materials[primitive.material] : undefined;
      if (!material?.extras?.kr_road) continue; // visual-only
      const positions = glb.accessor(primitive.attributes.POSITION).map(p => transformPoint(world, p));
      const indices = primitive.indices !== undefined ? glb.accessor(primitive.indices) : positions.map((_, i) => i);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const t = [positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]];
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
        if (!points.some(p => Math.abs(p[0] - cx) < radius && Math.abs(p[1] - cz) < radius)) continue;
        const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const length = Math.hypot(...n);
        if (!length || n[1] / length < 0.65) continue;
        t.material = material.name;
        for (let i = Math.floor(Math.min(t[0][0], t[1][0], t[2][0]) / CELL); i <= Math.floor(Math.max(t[0][0], t[1][0], t[2][0]) / CELL); i++)
          for (let j = Math.floor(Math.min(t[0][2], t[1][2], t[2][2]) / CELL); j <= Math.floor(Math.max(t[0][2], t[1][2], t[2][2]) / CELL); j++) {
            const key = `${i},${j}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(t);
          }
      }
    }
  }
  /** Highest solid upward surface at x/z between hintY − 2 and hintY + 1.2 (what a kart rests on); `withMaterial` also returns its material. */
  return (x, z, hintY, withMaterial = false) => {
    let best, material;
    for (const triangle of cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const [a, b, c] = triangle;
      if (x < Math.min(a[0], b[0], c[0]) || x > Math.max(a[0], b[0], c[0]) || z < Math.min(a[2], b[2], c[2]) || z > Math.max(a[2], b[2], c[2])) continue;
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (y < hintY - 2 || y > hintY + 1.2) continue;
      if (best === undefined || y > best) { best = y; material = triangle.material; }
    }
    return withMaterial ? (best === undefined ? undefined : { y: best, material }) : best;
  };
}

/** Ramps rise at most this much: a taller step is a wall, not a kerb. */
const KERB_MAX = 0.25, KERB_MIN = 0.1;
export const RAMP = { width: 5, length: 2.2 };

/** First jump in ground height along a ray (0.02 m samples): distance, low/high heights and the high side's material. */
function kerbAlong(ground, start, heading, hintY, maxDistance) {
  const [dx, dz] = [Math.sin(heading * Math.PI / 180), -Math.cos(heading * Math.PI / 180)];
  let previous = ground(start[0], start[1], hintY);
  for (let t = 0.02; t <= maxDistance; t += 0.02) {
    const current = ground(start[0] + dx * t, start[1] + dz * t, hintY);
    if (current !== undefined && previous !== undefined && Math.abs(current - previous) > KERB_MIN) {
      const before = ground(start[0] + dx * (t - 0.3), start[1] + dz * (t - 0.3), hintY, true), after = ground(start[0] + dx * (t + 0.3), start[1] + dz * (t + 0.3), hintY, true);
      if (!before || !after) return undefined;
      const [lowSide, highSide] = before.y < after.y ? [before, after] : [after, before];
      return { t: t - 0.01, low: lowSide.y, high: highSide.y, material: highSide.material, rising: after.y > before.y };
    }
    previous = current;
  }
  return undefined;
}

/**
 * A dropped kerb where the straight drive from the park pose to the nearest
 * road meets a kerb: the kerb line comes from two parallel rays half a ramp
 * width to either side; the ramp points uphill, perpendicular to that line.
 */
export function stationRamp(id, ground, park, hintY, roadDistance) {
  const maxDistance = roadDistance + 4;
  const centre = kerbAlong(ground, park.at, park.heading, hintY, maxDistance);
  if (!centre) return undefined;
  if (centre.high - centre.low > KERB_MAX) throw new Error(`${id}: a ${(centre.high - centre.low).toFixed(2)} m step on the way to the road is a wall`);
  const r = park.heading * Math.PI / 180, side = [Math.cos(r), Math.sin(r)], f = [Math.sin(r), -Math.cos(r)];
  const half = RAMP.width / 2;
  const hits = [-half, half].map(s => kerbAlong(ground, [park.at[0] + side[0] * s, park.at[1] + side[1] * s], park.heading, hintY, maxDistance));
  let kerbPoint = [park.at[0] + f[0] * centre.t, park.at[1] + f[1] * centre.t], uphill = centre.rising ? park.heading : park.heading + 180;
  if (hits.every(h => h && Math.abs(h.t - centre.t) < 3)) {
    // Kerb line through the two side hits; uphill is its normal toward the high side.
    const a = [park.at[0] - side[0] * half + f[0] * hits[0].t, park.at[1] - side[1] * half + f[1] * hits[0].t];
    const b = [park.at[0] + side[0] * half + f[0] * hits[1].t, park.at[1] + side[1] * half + f[1] * hits[1].t];
    const along = Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI;
    const normal = along - 90; // one of the two kerb-line normals; flipped below to point uphill
    uphill = Math.abs(((normal - uphill) % 360 + 540) % 360 - 180) < 90 ? normal : normal + 180;
    kerbPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  return { id: `ramp-${id}`, kind: "ramp", at: kerbPoint.map(c => round(c)), heading: round(wrap(uphill), 1), width: RAMP.width, length: RAMP.length, from: round(centre.low, 3), to: round(centre.high, 3), material: centre.material };
}

/** Prop entry and fuel POI for one Tripo station. */
export function tripoStation(spec, geometry, ground) {
  const probe = propPlacement({ id: spec.id, at: spec.at, y: 0, heading: spec.heading, size: SIZE }, geometry);
  const [sx, , sz] = probe.scale, [cx, cz] = probe.centre;
  // Ground under the slab (0.5 m grid over its scaled footprint).
  const slabU = [(geometry.slab.min[0] - cx) * sx, (geometry.slab.max[0] - cx) * sx];
  const slabV = [-(geometry.slab.max[1] - cz) * sz, -(geometry.slab.min[1] - cz) * sz];
  let low = Infinity, high = -Infinity;
  for (let u = slabU[0]; u <= slabU[1] + 1e-9; u += 0.5) for (let v = slabV[0]; v <= slabV[1] + 1e-9; v += 0.5) {
    const [x, z] = probe.local(u, v), g = ground(x, z, spec.hintY);
    if (g === undefined) throw new Error(`${spec.id}: no ground under the slab at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    low = Math.min(low, g); high = Math.max(high, g);
  }
  const range = high - low;
  // The slab top stays ≤ MAX_LIFT above every ground point under it and ≥ MIN_LIFT above the highest.
  const lift = Math.min(DEFAULT_LIFT, MAX_LIFT - range);
  if (lift < MIN_LIFT) throw new Error(`${spec.id}: ground under the slab varies by ${range.toFixed(3)} m`);
  const y = round(high, 3);
  const prop = { id: `prop-${spec.id}`, asset: ASSET, at: spec.at, y, heading: spec.heading, size: SIZE, lift: round(lift, 3) };
  const placement = propPlacement(prop, geometry);
  const halfU = SIZE[0] / 2 + ZONE_MARGIN, halfV = SIZE[1] / 2 + ZONE_MARGIN;
  const zone = [[-halfU, halfV], [halfU, halfV], [halfU, -halfV], [-halfU, -halfV]].map(([u, v]) => placement.local(u, v).map(c => round(c)));
  // Park in the gap between the pump islands, on the slab centre line, facing the pump side (the road).
  const gapZ = (geometry.centreGap[0] + geometry.centreGap[1]) / 2;
  const park = { at: placement.local((geometry.centreX - cx) * sx, -(gapZ - cz) * sz).map(c => round(c)), y: round(placement.slabTopY, 3), heading: wrap(spec.heading + 90) };
  const poi = { id: spec.id, name: spec.name, kind: "fuel", at: spec.at, y, heading: park.heading, zone, park, source: "tripo", desc: spec.desc };
  const ramp = spec.roadDistance !== undefined ? stationRamp(spec.id, ground, park, spec.hintY, spec.roadDistance) : undefined;
  return { prop, ramp, poi, ground: { low: round(low, 3), high: round(high, 3), range: round(range, 3) } };
}

export function originalStation(spec) {
  const xs = spec.canopies.flatMap(c => [c[0][0], c[1][0]]), zs = spec.canopies.flatMap(c => [c[0][1], c[1][1]]);
  const min = [Math.min(...xs) - ZONE_MARGIN, Math.min(...zs) - ZONE_MARGIN], max = [Math.max(...xs) + ZONE_MARGIN, Math.max(...zs) + ZONE_MARGIN];
  const zone = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]].map(p => p.map(c => round(c)));
  const at = [round((min[0] + max[0]) / 2), round((min[1] + max[1]) / 2)];
  return { id: spec.id, name: spec.name, kind: "fuel", at, y: spec.y, heading: spec.park.heading, zone, park: { at: spec.park.at, y: spec.y, heading: spec.park.heading }, source: spec.source, desc: spec.desc };
}

/** Replace the design's props and fuel POIs (other POIs keep their order and content). */
export function applyStations(design, stations) {
  const fuel = stations.map((s, i) => ({ ...s.poi, n: i + 1 }));
  const others = design.pois.filter(p => p.kind !== "fuel");
  const props = (design.props ?? []).filter(p => p.asset !== ASSET && !(p.kind === "ramp" && p.id.startsWith("ramp-fuel-")));
  return { ...design, pois: [...others, ...fuel], props: [...props, ...stations.flatMap(s => [s.prop, s.ramp].filter(Boolean))] };
}

async function main() {
  const designFile = option("--design", path.join(clientDir, "build/vice-city/out/kartcity-design.json"));
  const glbFile = option("--glb", path.join(clientDir, "build/vice-city/out/kartcity.glb"));
  const design = JSON.parse(readFileSync(designFile, "utf8"));
  const { geometry } = loadPropAsset(ASSET);
  const ground = groundSampler(readGlb(glbFile), TRIPO_STATIONS.map(s => s.at));
  const stations = [{ poi: originalStation(ORIGINAL_STATION) }];
  for (const spec of TRIPO_STATIONS) {
    const road = nearestRoadPoint(design, spec.at[0], spec.at[1], { y: spec.hintY });
    const station = tripoStation({ ...spec, roadDistance: road?.distance }, geometry, ground);
    console.log(spec.id, JSON.stringify({ ground: station.ground, prop: station.prop, park: station.poi.park, ramp: station.ramp }));
    stations.push(station);
  }
  const updated = applyStations(design, stations);
  if (args.includes("--dry-run")) return;
  writeFileSync(designFile, JSON.stringify(updated, null, 2) + "\n");
  console.log(`wrote ${updated.props.length} props (${updated.props.filter(p => p.kind === "ramp").length} ramps) and ${stations.length} fuel POIs into ${designFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
