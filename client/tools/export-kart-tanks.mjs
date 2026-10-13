#!/usr/bin/env node
// Export the 卡丁城 fuel tank of every kart into
// server-go/internal/data/economy/kart-tanks.json (embedded by the data
// service, internal/data/economy/tanks.go): the bigger the kart, the bigger
// its tank (and the dearer a fill). The original data has no usable size
// (physics mass is 100 for every kart, footprint overrides are mostly 0), so
// the size is the kart model's bounding box.
//
// Usage, from client/:
//   node --import tsx tools/export-kart-tanks.mjs             write kart-tanks.json
//   node --import tsx tools/export-kart-tanks.mjs --check     exit 1 if it is stale
//   node --import tsx tools/export-kart-tanks.mjs --out DIR   write elsewhere
//   node --import tsx tools/export-kart-tanks.mjs --report    also print the distribution
//
// Sources (mirror/p3553, read through the browser's resource library):
//   server-go/internal/data/economy/catalog.json   every shop kart (itemId, internalId, name)
//   timeAttackGarageCatalog()                      each kart's model path and the system karts
//                                                  (itemId 0, named by systemKey)
//   kart_/<internalId>/model.1s                    the ReKart root's rootBounds, resolved the way
//                                                  the game loads the kart (formats t3/IR: param
//                                                  addModelFolder, legacy practice families)
//
// Size: length = rootBounds axis 1, width = axis 0, height = axis 2 (game
// units, ~metres; the game's own half-width/half-length come from the same
// box, library.js el()), each rounded to 3 decimals; volume V = l × w × h of
// the rounded values. A kart whose model cannot be found or parsed gets the
// median length, width and height and "measured": false. The on-foot karts
// (run_*, 大马猴战车 迅: alwaysLinkCharacter, the rider is the vehicle) have
// a seat-only box 1.196 × 1.279 × 0.016 and are kept as measured: they land
// on the MIN_LITRES floor, small, which suits a rider without a kart.
//
// Capacity (litres), see FORMULA below:
//   Vmed      = median V over the measured catalog karts (rounded to 4 decimals)
//   capacityL = clamp(round(40 × (V / Vmed)^EXPONENT), MIN_LITRES, MAX_LITRES)
//   sizeClass = capacity < 30 small (小型), < 45 medium (中型), < 65 large (大型), else huge (巨型)
// EXPONENT 0.6 keeps the bulk of the karts (p10..p90 volume 2.56..6.31 m³)
// within 32..55 L while giant novelty karts (V up to 20 m³) reach the cap;
// classes come out small 55 / medium 1003 / large 437 / huge 50 (p3553).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadResourceLibrary } from "./economy-export/resource-library.mjs";

const rewriteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(rewriteDir, "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const report = args.includes("--report");
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1] ?? "")
  : path.join(projectRoot, "server-go/internal/data/economy");
const CATALOG = "server-go/internal/data/economy/catalog.json";

const BASE_LITRES = 40;
const EXPONENT = 0.6;
const MIN_LITRES = 20;
const MAX_LITRES = 100;
const CLASSES = [[30, "small"], [45, "medium"], [65, "large"], [Infinity, "huge"]];
const FORMULA = `V = length × width × height (rootBounds, m, 3 decimals); Vmed = median V of the measured ` +
  `catalog karts; capacity = clamp(round(${BASE_LITRES} × (V / Vmed)^${EXPONENT}), ${MIN_LITRES}, ` +
  `${MAX_LITRES}) litres; sizeClass: capacity < 30 small (小型), < 45 medium (中型), < 65 large (大型), ` +
  "else huge (巨型); an unmeasured kart (no model) gets the median length, width and height " +
  "(measured false); system karts (itemId 0) are keyed by their systemKart name";

const round = (value, digits) => { const scale = 10 ** digits; return Math.round(value * scale) / scale; };
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const { library, formats, manifest } = await loadResourceLibrary(projectRoot);
const { xa } = await import(pathToFileURL(path.join(rewriteDir, "src/generated/library.js")).href);
const { vehicleFolderName } = await import(pathToFileURL(path.join(rewriteDir, "src/resources/vehicle-identity.ts")).href);
const garage = await library.timeAttackGarageCatalog();
const catalogKarts = JSON.parse(readFileSync(path.join(projectRoot, CATALOG), "utf8")).items
  .filter(item => item.kind === "kart");

// Direct kart models by folder name, case-insensitive and unique, as
// garage-catalog.ts finds them, for a catalog kart the garage lacks.
const directModels = new Map();
for (const file of library.files) {
  if (file.extension !== "1s" || file.name.toLowerCase() !== "model.1s" || !/(^|\/)kart[^/]*\//i.test(file.virtualPath))
    continue;
  const id = vehicleFolderName(file.virtualPath).toLowerCase();
  directModels.set(id, directModels.has(id) ? null : file.virtualPath);
}
const garageByItem = new Map(garage.karts.filter(kart => kart.itemId !== 0).map(kart => [kart.itemId, kart]));

/** rootBounds of the model the game loads for a kart path, or a reason it has none. */
async function measure(modelPath, systemKey) {
  let resource;
  try {
    resource = (await formats.t3(library, modelPath, systemKey)).find(["model.1s"]);
  } catch {
    // No usable param next to the model: read the model itself.
  }
  resource ??= library.get(modelPath) ?? library.exactCanonicalCandidates(modelPath)[0];
  if (!resource) return { reason: `${modelPath} not found` };
  try {
    const { min, max } = formats.J5(xa(await resource.bytes())).rootBounds;
    const dims = { length: round(max[1] - min[1], 3), width: round(max[0] - min[0], 3), height: round(max[2] - min[2], 3) };
    if (!Object.values(dims).every(value => Number.isFinite(value) && value > 0))
      return { reason: `${resource.virtualPath}: empty rootBounds` };
    return { dims };
  } catch (error) {
    return { reason: `${resource.virtualPath}: ${error instanceof Error ? error.message : error}` };
  }
}

const unmeasured = [];
const rows = [];
for (const item of catalogKarts) {
  const entry = garageByItem.get(item.itemId);
  if (entry && entry.internalId.toLowerCase() !== item.internalId.toLowerCase())
    throw new Error(`kart ${item.itemId}: catalog ${item.internalId}, garage ${entry.internalId}`);
  const modelPath = entry?.path ?? directModels.get(item.internalId.toLowerCase()) ?? `kart_/${item.internalId}/model.1s`;
  const result = await measure(modelPath, undefined);
  if (result.reason) unmeasured.push(`${item.itemId} ${item.internalId} ${item.name}: ${result.reason}`);
  rows.push({ head: { itemId: item.itemId, internalId: item.internalId, name: item.name }, dims: result.dims });
}
const systemRows = [];
for (const kart of garage.karts.filter(kart => kart.itemId === 0)) {
  if (!kart.systemKey) throw new Error(`system kart ${kart.internalId} without systemKey`);
  const result = await measure(kart.path, kart.systemKey);
  if (result.reason) unmeasured.push(`system ${kart.systemKey} ${kart.internalId}: ${result.reason}`);
  systemRows.push({ head: { key: kart.systemKey, internalId: kart.internalId, name: kart.title }, dims: result.dims });
}

const measured = rows.filter(row => row.dims);
if (measured.length === 0) throw new Error("no kart model could be measured");
const volume = dims => dims.length * dims.width * dims.height;
const medianVolume = round(median(measured.map(row => volume(row.dims))), 4);
const fallbackDims = Object.fromEntries(["length", "width", "height"]
  .map(axis => [axis, round(median(measured.map(row => row.dims[axis])), 3)]));

function capacityFor(v, vmed) {
  const litres = Math.round(BASE_LITRES * (v / vmed) ** EXPONENT);
  return Math.min(MAX_LITRES, Math.max(MIN_LITRES, litres));
}
const sizeClassFor = capacity => CLASSES.find(([below]) => capacity < below)[1];

const finish = ({ head, dims }) => {
  const size = dims ?? fallbackDims;
  const v = volume(size);
  const capacity = capacityFor(v, medianVolume);
  return { ...head, ...size, volume: round(v, 3), capacity, sizeClass: sizeClassFor(capacity), measured: !!dims };
};
const karts = rows.map(finish).sort((a, b) => a.itemId - b.itemId);
const system = systemRows.map(finish).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/* ---------- report ---------- */

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
const measuredKarts = karts.filter(kart => kart.measured);
const classCounts = Object.fromEntries(CLASSES.map(([, name]) => [name, karts.filter(kart => kart.sizeClass === name).length]));
if (report) {
  for (const axis of ["length", "width", "height", "volume"]) {
    const sorted = measuredKarts.map(kart => kart[axis]).sort((a, b) => a - b);
    console.log(`${axis.padEnd(6)} min ${sorted[0]} p10 ${percentile(sorted, 0.1)} median ${percentile(sorted, 0.5)} ` +
      `p90 ${percentile(sorted, 0.9)} max ${sorted[sorted.length - 1]}`);
  }
  const buckets = new Map();
  for (const kart of karts) {
    const bucket = Math.floor(kart.capacity / 5) * 5;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  for (const [bucket, count] of [...buckets].sort((a, b) => a[0] - b[0]))
    console.log(`  ${String(bucket).padStart(3)}-${String(bucket + 4).padEnd(3)} L ${String(count).padStart(4)} ${"#".repeat(Math.ceil(count / 10))}`);
  const line = kart => `${kart.itemId ?? kart.key} ${kart.internalId} ${kart.name} ${kart.length}×${kart.width}×${kart.height} ` +
    `V ${kart.volume} → ${kart.capacity} L ${kart.sizeClass}`;
  const byVolume = [...measuredKarts].sort((a, b) => a.volume - b.volume);
  console.log("smallest:"); for (const kart of byVolume.slice(0, 15)) console.log(`  ${line(kart)}`);
  console.log("largest:"); for (const kart of byVolume.slice(-25)) console.log(`  ${line(kart)}`);
  console.log("system:"); for (const kart of system) console.log(`  ${line(kart)}`);
}

/* ---------- write ---------- */

const document = { version: 1, source: `rootBounds of kart_/<id>/model.1s (${manifest.version}), ` +
  "client/tools/export-kart-tanks.mjs; do not edit by hand", formula: FORMULA, medianVolume };
const lines = Object.entries(document).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
for (const [key, list] of [["karts", karts], ["system", system]])
  lines.push(`  ${JSON.stringify(key)}: [\n${list.map(row => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
const text = `{\n${lines.join(",\n")}\n}\n`;
const file = path.join(outDir, "kart-tanks.json");
for (const message of unmeasured) console.error(`unmeasured: ${message}`);
if (checkOnly) {
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
    console.error("kart-tanks.json stale; run tools/export-kart-tanks.mjs");
    process.exit(1);
  }
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, text);
}
console.log(`${karts.length} karts (${karts.length - measuredKarts.length} unmeasured) + ${system.length} system, ` +
  `median volume ${medianVolume} m³, classes ${Object.entries(classCounts).map(([name, count]) => `${name} ${count}`).join(" ")}`);
