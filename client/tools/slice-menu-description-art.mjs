#!/usr/bin/env node
/** Geometry-only slicing of complete translated menu information boards. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/menu-descriptions");
const sheet = path.join(root, "source/localized-sized.png");
const generated = path.join(root, "source/localized-generated.png");
// Measured native atlas boundaries. Crop before resizing so the next row's
// dark upper edge cannot leak into the white foot of an English card.
const columns = [[0, 450], [451, 449], [901, 450]];
const rows = [[0, 581], [581, 583]];
const names = ["img_titleBlue", "img_titleRed", "img_titleYellow"];
const entries = [];
for (const [row, locale] of ["en", "ko"].entries()) {
  mkdirSync(path.join(root, locale), { recursive: true });
  for (const [column, name] of names.entries()) {
    const file = `${locale}/${name}.png`;
    const [x, width] = columns[column], [y, height] = rows[row];
    execFileSync("magick", [generated, "-crop", `${width}x${height}+${x}+${y}`, "+repage",
      "-resize", "246x318!", "-depth", "8", `PNG32:${path.join(root, file)}`]);
    entries.push({ canonicalPath: `zeta_/cn/stage/mainMenu/${name}.png`, locale, file,
      width: 246, height: 318,
      provenance: "Complete imagegen translation of original title and explanation paragraph; original character/trophy art retained; geometry-only slicing" });
  }
}
execFileSync("magick", ["(", ...names.map(name => path.join(root, `en/${name}.png`)), "+append", ")",
  "(", ...names.map(name => path.join(root, `ko/${name}.png`)), "+append", ")", "-append", "-depth", "8", `PNG32:${sheet}`]);
writeFileSync(path.join(root, "spec.json"), JSON.stringify({ version: 1, prompt: "source/prompt.txt",
  preparation: "node tools/slice-menu-description-art.mjs (requires ImageMagick)", entries }, null, 2) + "\n");
console.log(`Prepared ${entries.length} complete menu explanation boards.`);
