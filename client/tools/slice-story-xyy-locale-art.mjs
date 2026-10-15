#!/usr/bin/env node
/** Rebuild complete XYY chapter sprites from the reviewed, repository-local atlases. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/story-xyy");
const generation = JSON.parse(readFileSync(path.join(root, "generation.json"), "utf8"));
const entries = [];
for (const locale of ["zh-CN", "en", "ko"]) {
  const atlas = generation.atlases[locale];
  const input = path.join(root, atlas.file);
  atlas.sha256 = createHash("sha256").update(readFileSync(input)).digest("hex");
  if (atlas.cells.length !== 4) throw new Error(`Expected four inspected state rectangles: ${locale}`);
  mkdirSync(path.join(root, locale), { recursive: true });
  atlas.cells.forEach(([x, y, width, height], index) => {
    const state = index + 1, name = `xyy_1${state}.png`;
    execFileSync("magick", [input, "-crop", `${width}x${height}+${x}+${y}`, "+repage",
      "-resize", "272x134!", ...(state === 4 ? ["-colorspace", "Gray", "-colorspace", "sRGB"] : []),
      `PNG32:${path.join(root, locale, name)}`]);
    entries.push({ canonicalPath: `zeta_/cn/scenario/select/${name}`, locale, file: `${locale}/${name}`,
      width: 272, height: 134,
      provenance: `Generated complete XYY chapter artwork using native story characters and backgrounds; ${atlas.file}; inspected state slicing` });
  });
}
writeFileSync(path.join(root, "generation.json"), JSON.stringify(generation, null, 2) + "\n");
writeFileSync(path.join(root, "spec.json"), JSON.stringify({ version: 1, entries }, null, 2) + "\n");
console.log(`Prepared ${entries.length} complete XYY chapter sprites.`);
