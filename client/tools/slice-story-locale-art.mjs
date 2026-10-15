#!/usr/bin/env node
/** Slice reviewed complete-image atlases; no lettering is rendered by this tool. */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/story");
const generation = JSON.parse(readFileSync(path.join(root, "generation.json"), "utf8"));
const entries = [];
generation.sha256 = {};
for (const locale of ["en", "ko"]) {
  const output = path.join(root, locale);
  mkdirSync(output, { recursive: true });
  for (let atlas = 1; atlas <= 4; atlas++) {
    const input = path.join(root, "source", `atlas-${atlas}-${locale}.png`);
    generation.sha256[`source/atlas-${atlas}-${locale}.png`] = createHash("sha256").update(readFileSync(input)).digest("hex");
    const bounds = generation.atlasBounds[`atlas-${atlas}-${locale}`];
    if (bounds?.rows?.length !== 9 || bounds?.columns?.length !== 5)
      throw new Error(`Missing inspected cell bounds for atlas-${atlas}-${locale}`);
    const groups = generation.groups.slice((atlas - 1) * 8, atlas * 8);
    for (let row = 0; row < groups.length; row++) {
      const group = groups[row];
      if (group === "chapter_abyss2") continue; // Independent 335×78 four-state atlas below.
      for (let state = 1; state <= 4; state++) {
        const name = `${group}${state}.png`;
        const x = bounds.columns[state - 1], y = bounds.rows[row];
        const width = bounds.columns[state] - x, height = bounds.rows[row + 1] - y;
        // Crop before resizing: generated atlas dividers are not perfectly uniform.
        // This keeps every complete card and excludes adjacent rows and button states.
        execFileSync("magick", [input, "-crop", `${width}x${height}+${x}+${y}`, "+repage", "-resize", "272x134!",
          ...(state === 4 ? ["-colorspace", "Gray", "-colorspace", "sRGB"] : []), "PNG32:" + path.join(output, name)]);
        entries.push({ canonicalPath: `${generation.sourceRoot}/${name}`, locale, file: `${locale}/${name}`,
          width: 272, height: 134, provenance: `imagegen text-localization of complete native chapter art; source/atlas-${atlas}-${locale}.png; inspected atlas-cell slicing and disabled-state grayscale normalization` });
      }
    }
  }
  const input = path.join(root, "source", `abyss2-${locale}.png`);
  generation.sha256[`source/abyss2-${locale}.png`] = createHash("sha256").update(readFileSync(input)).digest("hex");
  const sheet = path.join(output, "abyss2-sheet.png");
  execFileSync("magick", [input, "-resize", "335x312!", "PNG32:" + sheet]);
  for (let state = 1; state <= 4; state++) {
    const name = `chapter_abyss2${state}.png`;
    execFileSync("magick", [sheet, "-crop", `335x78+0+${(state - 1) * 78}`, "+repage",
      ...(state === 4 ? ["-colorspace", "Gray", "-colorspace", "sRGB"] : []), "PNG32:" + path.join(output, name)]);
    entries.push({ canonicalPath: `${generation.sourceRoot}/${name}`, locale, file: `${locale}/${name}`,
      width: 335, height: 78, provenance: `imagegen text-localization of complete native Abyss II art; source/abyss2-${locale}.png; fixed-grid slicing and disabled-state grayscale normalization` });
  }
  rmSync(sheet);
}
writeFileSync(path.join(root, "generation.json"), JSON.stringify(generation, null, 2) + "\n");
writeFileSync(path.join(root, "spec.json"), JSON.stringify({ version: 1, entries }, null, 2) + "\n");
console.log(`Prepared ${entries.length} localized chapter sprites.`);
