#!/usr/bin/env node
// Writes a contact sheet (HTML + PNGs) of the textures the city build uses.
//   node --import tsx tools/city/texture-sheet.mjs --out DIR [--mirror CHECKOUT]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { buildCity } from "./build-city.mjs";
import { decodeDds } from "./dds.mjs";
import { encodePng } from "./png.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = path.resolve(clientDir, "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : projectRoot;
const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "texture-sheet"));
const design = JSON.parse((await import("node:fs")).readFileSync(path.join(projectRoot, "design/open-world/city-map.json"), "utf8"));
const { library, formats } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
const built = await buildCity({ library, formats, design });
mkdirSync(outDir, { recursive: true });
const cells = [];
for (const entry of await built.city.textures.entries()) {
  const ext = path.extname(entry.path).slice(1).toLowerCase();
  let file = entry.path;
  let note = "";
  if (ext === "dds") {
    try { const { width, height, rgba } = decodeDds(entry.bytes); file = entry.path.replace(/\.dds$/i, ".png"); writeFileSync(path.join(outDir, file), encodePng(width, height, rgba)); note = `${width}×${height}`; }
    catch (error) { note = String(error.message); }
  } else writeFileSync(path.join(outDir, file), entry.bytes);
  cells.push(`<figure><img src="${file}"><figcaption>${entry.path} ${note}</figcaption></figure>`);
}
writeFileSync(path.join(outDir, "index.html"), `<!doctype html><meta charset="utf-8"><style>body{background:#333;color:#eee;font:12px sans-serif;margin:8px}figure{display:inline-block;margin:4px;width:150px;vertical-align:top}img{width:140px;height:140px;object-fit:cover;background:#888;image-rendering:auto}figcaption{word-break:break-all}</style>${cells.join("")}`);
console.log(`wrote ${cells.length} textures to ${outDir}`);
