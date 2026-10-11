#!/usr/bin/env node
// Contact sheet of library textures whose stem matches a regex.
//   node --import tsx tools/city/texture-search.mjs --match 'road' --themes village,world --out DIR [--mirror CHECKOUT] [--limit 160]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { decodeDds } from "./dds.mjs";
import { encodePng } from "./png.mjs";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = path.resolve(clientDir, "..");
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mirrorRoot = option("--mirror") ? path.resolve(option("--mirror")) : projectRoot;
const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "texture-search"));
const match = new RegExp(option("--match") ?? ".", "i");
const themes = (option("--themes") ?? "village,world,wkc,beach,china,mechanic,factory,park,forest,ice,common").split(",");
const limit = Number(option("--limit") ?? 160);
const { library } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
const prefixes = themes.map(t => `theme_/${t}/texture/`);
const files = library.files.filter(f => { const p = f.virtualPath.toLowerCase(); return prefixes.some(x => p.startsWith(x)) && match.test(p.split("/").at(-1)) && /\.(dds|png)$/i.test(p); }).slice(0, limit);
mkdirSync(outDir, { recursive: true });
const cells = [];
for (const file of files) {
  const name = file.virtualPath.split("/").at(-1), theme = file.virtualPath.split("/")[1];
  const bytes = await file.bytes();
  let out = `${theme}__${name}`, note = "";
  try {
    if (/\.dds$/i.test(name)) { const { width, height, rgba } = decodeDds(bytes); out = out.replace(/\.dds$/i, ".png"); writeFileSync(path.join(outDir, out), encodePng(width, height, rgba)); note = `${width}×${height}`; }
    else writeFileSync(path.join(outDir, out), bytes);
  } catch (error) { note = error.message; }
  cells.push(`<figure><img src="${encodeURIComponent(out)}"><figcaption>${theme}/${name} ${note}</figcaption></figure>`);
}
writeFileSync(path.join(outDir, "index.html"), `<!doctype html><meta charset="utf-8"><style>body{background:#333;color:#eee;font:11px sans-serif;margin:6px}figure{display:inline-block;margin:3px;width:118px;vertical-align:top}img{width:112px;height:112px;object-fit:cover;background:#888}figcaption{word-break:break-all}</style>${cells.join("")}`);
console.log(`${cells.length} textures → ${outDir}`);
