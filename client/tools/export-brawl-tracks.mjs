#!/usr/bin/env node
// Export what the game node's 50人乱斗 AI racers drive on (server-go/BRAWL.md)
// into server-go/internal/game/brawl/tracks.json, and the track pool the
// browser's track picker offers into src/multiplayer/brawl-tracks.ts.
//
// Usage, from client/ (tsx comes from its node_modules):
//   node --import tsx tools/export-brawl-tracks.mjs                    write both files
//   node --import tsx tools/export-brawl-tracks.mjs --check            exit 1 if either is stale
//   node --import tsx tools/export-brawl-tracks.mjs --stats            print every closed course's
//                                                                       road width, write nothing
//   node --import tsx tools/export-brawl-tracks.mjs --mirror CHECKOUT  read mirror/ from another
//                                                                       checkout (a worktree without
//                                                                       mirror/p3553)
//
// Sources (mirror/p3553, read through the browser's resource library):
//   track_/common/track@zz.bml + trackLocale   laps (trackMetadataCatalog)
//   track_/<folder>/track.1s                   the route sections and the road collision triangles,
//                                              through the browser's own route builder (formats.YW)
// Each track row, in three.js world meters:
//   laps; lap, the length of one lap along each section's first way out from
//   the first section through the last one (the course the AI drives; the
//   browser counts route distance the same way, world/route-state.ts);
//   frames, [x, y, z, forward x, y, z, s] per route frame on that course,
//   s its lap distance from the first section's start; road, per frame the
//   road height (decimeters above the frame, null for no road) at the lateral
//   offsets ROAD_OFFSETS along the browser's start "right" vector; grid, the
//   50 start places [x, y, z, u, route distance] (the browser's
//   vehicle/race-start-slots.ts raceStartPosition, snapped to the road the
//   way local-race-construction.ts does; u its place on the closed course,
//   coursePlace).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "./economy-export/resource-library.mjs";
import { raceStartPosition, RACE_START_SLOTS } from "../src/vehicle/race-start-slots.ts";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(clientDir, "..");
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? path.resolve(args[index + 1] ?? "") : undefined;
};
const mirrorRoot = option("--mirror") ?? projectRoot;
const serverFile = path.join(projectRoot, "server-go/internal/game/brawl/tracks.json");
const clientFile = path.join(clientDir, "src/multiplayer/brawl-tracks.ts");

/**
 * The 50人乱斗 track pool: closed courses without warps whose road stays
 * wide (--stats), the familiar ones first. The browser's picker offers
 * these; a random track is drawn from them.
 */
export const BRAWL_TRACKS = [
  "village_R01", "village_I03", "village_R08", "village_I04", "desert_I01", "desert_I08",
  "forest_I01", "forest_I03", "forest_I07", "ice_I03", "ice_I07", "tomb_I01", "china_I01",
  "china_I04", "china_R08", "beach_I02", "factory_I04", "mabi_I01", "maple_I01", "maple_R01",
  "world_I02", "northeu_I02", "gold_I01", "brodi_R02",
];

/** Lateral sample offsets (m) of the road profile, along the start "right". */
export const ROAD_OFFSETS = [-14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14];

const f32 = Math.fround;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = a => Math.hypot(a.x, a.y, a.z);
const unit = (a, fallback) => {
  const size = length(a);
  return size > 1e-6 ? scale(a, 1 / size) : fallback;
};

/**
 * The kart's right vector on a route frame heading `forward` (three.js
 * world), as the browser's resetFromRouteFrame builds the body basis
 * (server-go/test/lib/item-bot-lib.mjs routeBasis): the start slots are laid
 * out along it.
 */
export function routeRight(forward) {
  const client = { x: forward.x, y: -forward.z, z: forward.y };
  const reverse = length(client) > 1e-6 ? scale(client, -1) : { x: 0, y: -1, z: 0 };
  const right = unit(cross(reverse, { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 });
  return { x: right.x, y: right.z, z: -right.y };
}

/** Road triangles bucketed on a horizontal grid for downward rays. */
class RoadRays {
  constructor(triangles, cell = 16) {
    this.cell = cell;
    this.buckets = new Map();
    for (const triangle of triangles) {
      // Walls are not road: the browser's rayQuery(…, false) skips them too.
      if (!(triangle.normal.y > 0.2)) continue;
      const xs = [triangle.a.x, triangle.b.x, triangle.c.x];
      const zs = [triangle.a.z, triangle.b.z, triangle.c.z];
      for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++) {
        for (let j = Math.floor(Math.min(...zs) / cell); j <= Math.floor(Math.max(...zs) / cell); j++) {
          const key = `${i},${j}`;
          if (!this.buckets.has(key)) this.buckets.set(key, []);
          this.buckets.get(key).push(triangle);
        }
      }
    }
  }

  /** Heights of the road under (x, z), every triangle a vertical line crosses. */
  heights(x, z) {
    const bucket = this.buckets.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`) ?? [];
    const found = [];
    for (const { a, b, c } of bucket) {
      // Barycentric test in the horizontal plane.
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      found.push(u * a.y + v * b.y + w * c.y);
    }
    return found;
  }

  /** The first road a ray from `origin` straight down `depth` meters hits. */
  down(origin, depth) {
    const below = this.heights(origin.x, origin.z).filter(y => y <= origin.y && y >= origin.y - depth);
    return below.length ? { x: origin.x, y: Math.max(...below), z: origin.z } : undefined;
  }

  /** The road nearest to height y within ±window meters. */
  near(x, y, z, window) {
    let best;
    for (const height of this.heights(x, z)) {
      if (Math.abs(height - y) <= window && (best === undefined || Math.abs(height - y) < Math.abs(best - y))) {
        best = height;
      }
    }
    return best;
  }
}

/** The course the AI drives: each section's first way out from the first one. */
export function lapCourse(sections, firstSection, lastSection) {
  const course = [];
  let index = firstSection;
  for (let guard = 0; guard <= sections.length; guard++) {
    course.push(index);
    const next = sections[index].outgoing[0]?.section;
    if (next === undefined) return undefined;
    if (next === firstSection) return index === lastSection ? course : undefined;
    if (course.includes(next)) return undefined;
    index = next;
  }
  return undefined;
}

/**
 * Where a place near the start line lies on the closed course the AI
 * drives: u, meters driven along the frames from the first one (the span
 * from the last frame back to the first closes the loop; spans between
 * sections that do not meet count as driving but add no route distance),
 * and its route distance, negative behind the line. Only places within
 * 200 m of the line are considered.
 */
export function coursePlace(frames, lap, position) {
  const points = frames.map(frame => ({ x: frame[0], y: frame[1], z: frame[2] }));
  let u = 0;
  let best;
  for (let i = 0; i < frames.length; i++) {
    const j = (i + 1) % frames.length;
    const a = points[i];
    const span = sub(points[j], a);
    const size = length(span);
    const toS = j === 0 ? lap : frames[j][6];
    if (size > 1e-6) {
      const t = Math.min(1, Math.max(0, dot(sub(position, a), span) / (size * size)));
      const gap = length(sub(position, add(a, scale(span, t))));
      const routeS = frames[i][6] + t * (toS - frames[i][6]);
      if ((lap - routeS < 200 || routeS < 200) && (!best || gap < best.gap)) {
        best = { gap, u: u + t * size, distance: lap - routeS < 200 ? routeS - lap : routeS };
      }
    }
    u += size;
  }
  return best ?? { u: 0, distance: 0 };
}

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** One track's row, or a reason it cannot be a brawl track. */
export function brawlTrack(id, laps, road) {
  const { sections, firstSection, lastSection, start } = road;
  if (sections.some(section => section.surface === "warpnext")) return { id, problem: "warp" };
  const course = lapCourse(sections, firstSection, lastSection);
  if (!course) return { id, problem: "not a closed course" };
  const rays = new RoadRays(road.collisionTriangles);
  const frames = [];
  const roadProfile = [];
  let s = 0;
  for (const index of course) {
    const section = sections[index];
    section.frames.forEach((frame, i) => {
      if (i > 0) s += length(sub(frame.position, section.frames[i - 1].position));
      // A section starts where the one before ended: keep one frame there.
      const previous = frames.at(-1);
      if (i === 0 && previous && length(sub(frame.position, { x: previous[0], y: previous[1], z: previous[2] })) < 0.05) {
        frames.pop();
        roadProfile.pop();
      }
      const { position: p, forward: f } = frame;
      frames.push([round(p.x, 2), round(p.y, 2), round(p.z, 2), round(f.x, 4), round(f.y, 4), round(f.z, 4),
        round(s, 2)]);
      const right = routeRight(f);
      roadProfile.push(ROAD_OFFSETS.map(offset => {
        const at = add(p, scale(right, offset));
        const height = rays.near(at.x, p.y, at.z, 6);
        return height === undefined ? null : Math.round((height - p.y) * 10);
      }));
    });
    // The section length the browser counts may round differently from the
    // sum of its frame spans; the course follows the browser's lengths.
    const sectionEnd = course.slice(0, course.indexOf(index) + 1)
      .reduce((sum, at) => sum + sections[at].length, 0);
    s = sectionEnd;
  }
  const lap = course.reduce((sum, index) => sum + sections[index].length, 0);
  const last = sections[lastSection];
  const right = routeRight(start.forward);
  const back = unit({ x: start.forward.x, y: 0, z: start.forward.z }, { x: 0, y: 0, z: 1 });
  const grid = [];
  for (let slot = 0; slot < RACE_START_SLOTS; slot++) {
    const position = raceStartPosition(start.position, right, slot,
      (origin, direction) => rays.down(origin, -direction.y), back);
    // The browser projects onto the last section only (a kart behind it
    // reports -last.length until it gets there); the AI starts where it
    // really is on the course.
    const place = coursePlace(frames, lap, position);
    grid.push([round(position.x, 2), round(position.y, 2), round(position.z, 2), round(place.u, 2),
      round(place.distance, 2)]);
  }
  return { id, laps, lap: round(lap, 2), lastLength: round(last.length, 2), frames, road: roadProfile, grid };
}

/** The drivable width (m) around the course line at each frame: the run of road through offset 0. */
export function roadWidths(row) {
  return row.road.map(heights => {
    const center = ROAD_OFFSETS.indexOf(0);
    if (heights[center] === null) return 0;
    let left = center;
    let right = center;
    while (left > 0 && heights[left - 1] !== null && Math.abs(heights[left - 1] - heights[left]) <= 15) left--;
    while (right < heights.length - 1 && heights[right + 1] !== null &&
      Math.abs(heights[right + 1] - heights[right]) <= 15) right++;
    return ROAD_OFFSETS[right] - ROAD_OFFSETS[left];
  });
}

async function main() {
  const { library, formats } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
  const folder = file => file.virtualPath.split("/").filter(Boolean).at(-2).toLowerCase();
  const models = new Map(library.mapAssets().map(file => [folder(file), file]));
  const metadata = await library.trackMetadataCatalog();
  const stats = args.includes("--stats");
  const wanted = stats ? metadata.map(track => track.id) : BRAWL_TRACKS;
  const rows = [];
  for (const id of wanted) {
    const track = metadata.find(entry => entry.id === id);
    const model = track && models.get((track.folder ?? track.id).toLowerCase());
    if (!model || !Number.isSafeInteger(track.laps) || track.laps < 1) {
      if (!stats) throw new Error(`${id}: no raceable track in p3553`);
      continue;
    }
    const road = formats.YW(formats.y9(await model.bytes()), "speed-individual", {});
    const row = brawlTrack(id, track.laps, road);
    if (row.problem) {
      if (!stats) throw new Error(`${id}: ${row.problem}`);
      continue;
    }
    if (stats) {
      const widths = roadWidths(row).sort((a, b) => a - b);
      console.log([id, track.cnTitle ?? "", `laps ${row.laps}`, `lap ${Math.round(row.lap)}`,
        `min ${widths[0]}`, `p10 ${widths[Math.floor(widths.length / 10)]}`,
        `median ${widths[Math.floor(widths.length / 2)]}`].join("\t"));
      continue;
    }
    rows.push({ ...row, title: track.cnTitle ?? id });
  }
  if (stats) return;
  const serverText = `{\n  "generatedFrom": ${JSON.stringify("mirror/p3553 track metadata (laps) and track.1s " +
    "routes and road triangles (formats.YW), by client/tools/export-brawl-tracks.mjs")},\n` +
    `  "roadOffsets": ${JSON.stringify(ROAD_OFFSETS)},\n  "tracks": [\n` +
    rows.map(({ title, ...row }) => `    ${JSON.stringify(row)}`).join(",\n") + "\n  ]\n}\n";
  const clientText = `// Generated by client/tools/export-brawl-tracks.mjs; do not edit.\n` +
    `/** The 50人乱斗 track pool (server-go/BRAWL.md): the tracks the game node's AI racers can drive. */\n` +
    `export const BRAWL_TRACK_IDS: readonly string[] = [\n` +
    rows.map(row => `  ${JSON.stringify(row.id)}, // ${row.title}`).join("\n") + "\n];\n";
  if (args.includes("--check")) {
    let stale = false;
    for (const [file, text] of [[serverFile, serverText], [clientFile, clientText]]) {
      if ((existsSync(file) ? readFileSync(file, "utf8") : "") !== text) {
        console.error(`${file} is stale; run node --import tsx tools/export-brawl-tracks.mjs`);
        stale = true;
      }
    }
    if (stale) process.exit(1);
    console.log(`brawl tracks are up to date (${rows.length} tracks)`);
    return;
  }
  writeFileSync(serverFile, serverText);
  writeFileSync(clientFile, clientText);
  console.log(`wrote ${serverFile} and ${clientFile} (${rows.length} tracks)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
