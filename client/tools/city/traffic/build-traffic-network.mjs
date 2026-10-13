/**
 * Builds the NPC traffic network of 卡丁城 (server-go/CITY-NPC.md) from the
 * published Vice City asphalt: road-raster.mjs → road-skeleton.mjs →
 * road-graph.mjs → traffic-lanes.mjs, with the junction signals where the
 * original signal heads are (traffic-signal-heads.json,
 * extract-signal-heads.mjs). Writes the design copy and the two copies the
 * browser and the game node load:
 *
 *   design/open-world/vice-city/traffic-network.json
 *   client/src/city/traffic-network.json
 *   server-go/internal/game/city/traffic-network.json
 *
 * Usage: node tools/city/traffic/build-traffic-network.mjs [--check]
 * (--check only compares the result with the committed copies).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoadRaster } from "./road-raster.mjs";
import { skeletonLines, thin } from "./road-skeleton.mjs";
import { buildRoadGraph, polylineLength } from "./road-graph.mjs";
import { buildTrafficNetwork } from "./traffic-lanes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const NETWORK_COPIES = [
  "design/open-world/vice-city/traffic-network.json",
  "client/src/city/traffic-network.json",
  "server-go/internal/game/city/traffic-network.json",
];
/** Medians and seams up to twice this (m) are closed before the centre lines are traced. */
const CLOSE_RADIUS = 4;

export function buildNetwork(log = () => {}) {
  const map = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/city-map.json"), "utf8"));
  const raster = loadRoadRaster(resolve(ROOT, "design/open-world/vice-city/assets/source-road-surfaces.json"), map.meta.extent);
  const closed = raster.closed(2, CLOSE_RADIUS);
  const lines = skeletonLines(closed, thin(closed));
  const graph = buildRoadGraph(lines, closed, undefined, log, raster);
  const heads = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/traffic-signal-heads.json"), "utf8")).heads;
  const network = buildTrafficNetwork(graph, raster, undefined, heads);
  const body = JSON.stringify({ paths: network.paths, junctions: network.junctions });
  const id = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const streets = [...graph.edges.values()].reduce((sum, e) => sum + polylineLength(e.points), 0);
  // The wire carries a car's distance along its path in 1/16 m (uint16).
  for (const [index, path] of network.paths.entries()) {
    let length = 0;
    for (let i = 3; i < path.p.length; i += 3) length += Math.hypot(path.p[i] - path.p[i - 3], path.p[i + 1] - path.p[i - 2]);
    if (length >= 4000) throw new Error(`路径 ${index} 长 ${Math.round(length)} m，超出协议上限 4000 m。`);
  }
  return {
    version: 1,
    id,
    source: "design/open-world/vice-city/assets/source-road-surfaces.json + client/tools/city/traffic",
    streetsM: Math.round(streets),
    ...network,
  };
}

/** One path per line keeps the files diffable. */
export function formatNetwork(network) {
  const { paths, junctions, ...head } = network;
  const lines = JSON.stringify(head).slice(0, -1);
  return `${lines},\n"paths":[\n${paths.map(p => JSON.stringify(p)).join(",\n")}\n],\n"junctions":[\n${
    junctions.map(j => JSON.stringify(j)).join(",\n")}\n]}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const network = buildNetwork(message => console.log(message));
  const text = formatNetwork(network);
  const lanes = network.paths.filter(p => p.kind === "lane"), links = network.paths.filter(p => p.kind === "link");
  const controls = {};
  for (const j of network.junctions) controls[j.control] = (controls[j.control] ?? 0) + 1;
  console.log(`街道 ${network.streetsM} m，车道 ${lanes.length} 条，路口连接 ${links.length} 条，路口 ${network.junctions.length} 个`, controls,
    `，${(text.length / 1024).toFixed(0)} KB，id ${network.id}`);
  let stale = false;
  for (const copy of NETWORK_COPIES) {
    const path = resolve(ROOT, copy);
    if (check) {
      let old = "";
      try { old = readFileSync(path, "utf8"); } catch { /* missing */ }
      if (old !== text) { console.error(`过期：${copy}`); stale = true; }
    } else {
      writeFileSync(path, text);
      console.log(`写入 ${copy}`);
    }
  }
  if (stale) process.exit(1);
}
