#!/usr/bin/env node
/** Geometry-only preparation of whole native/generated menu image assets. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui");
const magick = args => execFileSync("magick", args);
const writeSpec = (root, entries) => writeFileSync(path.join(root, "spec.json"), JSON.stringify({
  version: 1, prompt: "source/prompt.txt",
  preparation: "node tools/prepare-menu-supplement-art.mjs (requires ImageMagick)", entries,
}, null, 2) + "\n");

const completion = path.join(assets, "menu-completion");
const entries = [];
for (const locale of ["en", "ko"]) {
  mkdirSync(path.join(completion, locale), { recursive: true });
  const source = path.join(completion, "source", locale === "en" ? "native-clear.png" : "korean-generated.png");
  for (const [name, width, height] of [["img_clearIcon", 96, 92], ["img_clearIcon_list", 70, 70]]) {
    const file = `${locale}/${name}.png`;
    magick([source, "-resize", `${width}x${height}`, "-gravity", "center", "-background", "none",
      "-extent", `${width}x${height}`, "-depth", "8", `PNG32:${path.join(completion, file)}`]);
    entries.push({ canonicalPath: `zeta_/cn/stage/mainMenu/${name}.png`, locale, file, width, height,
      provenance: locale === "en" ? "Whole native stage_common.rho clear_stamp@zz.png CLEAR artwork, contain resize only"
        : "Complete Korean 통과 stamp generated from original Chinese sprite; contain resize only" });
  }
  entries.push({ canonicalPath: "stage_/mainMenu/클리어라벨.png", locale,
    file: `${locale}/img_clearIcon_list.png`, width: 70, height: 70,
    provenance: "Story completion uses the same full localized stamp as the license step list" });
}
writeSpec(completion, entries);

const versus = path.join(assets, "timeattack-vs");
const vsEntries = [];
// The eight imagegen cells are delimited by one dark frame, not whitespace.
const xs = [[0, 632], [632, 632]];
const ys = [[0, 311], [311, 311], [622, 310], [932, 312]];
for (const [column, locale] of ["en", "ko"].entries()) {
  mkdirSync(path.join(versus, locale), { recursive: true });
  for (let state = 1; state <= 4; state++) {
    const [x, width] = xs[column], [y, height] = ys[state - 1];
    const file = `${locale}/btn_timeAttackVS_${state}.png`;
    magick([path.join(versus, "source/generated.png"), "-crop", `${width}x${height}+${x}+${y}`, "+repage",
      "-resize", "272x134!", "-depth", "8", `PNG32:${path.join(versus, file)}`]);
    vsEntries.push({ canonicalPath: `zeta_/cn/stage/mainMenu/btn_timeAttackVS_${state}.png`, locale, file,
      width: 272, height: 134,
      provenance: "Complete localized Practice Time Attack / Track Challenge artwork in all four original button states; geometry-only crop" });
  }
}
writeSpec(versus, vsEntries);
console.log(`Prepared ${entries.length} completion aliases and ${vsEntries.length} track challenge buttons.`);
