#!/usr/bin/env node
/** Geometry-only assembly of complete localized garage PNGs. No text is drawn. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/garage");
const source = path.join(root, "source");
const crops = JSON.parse(readFileSync(path.join(source, "label-crops.json"), "utf8"));
const magick = args => execFileSync("magick", args);
const entries = [];
const add = (name, locale, width, height, provenance) => {
  const file = `${locale}/${name.replace(/@cn$/, "")}.png`;
  entries.push({ canonicalPath: `stage_/garageX/${name}.png`, locale, file, width, height, provenance });
  return path.join(root, file);
};
const nativeRows = { classic: [0, 33, 65, 97, 129, 161, 204], xun: [0, 33, 65, 97, 129, 161, 192, 285] };
const accent = path.join(source, "header-accent.png");
// This two-pixel decorative rule contains no source-language lettering.
magick([path.join(source, "native/garage_img_textPerformList@cn.png"), "-crop", "2x18+0+0", "+repage", "-depth", "8", `PNG32:${accent}`]);

for (const locale of ["en", "ko"]) {
  mkdirSync(path.join(root, locale), { recursive: true });
  const labels = [];
  for (const [index, [x, y, width, height]] of crops[locale].entries()) {
    const file = path.join(source, `label-${locale}-${index}.png`);
    const targetWidth = Math.min(index >= 8 ? 38 : 85, Math.round(width * 16 / height));
    magick([path.join(source, "labels-generated.png"), "-crop", `${width}x${height}+${x}+${y}`, "+repage",
      "-resize", `${targetWidth}x16!`, "-depth", "8", `PNG32:${file}`]);
    labels.push(file);
  }
  for (const [kind, height, name] of [["classic", 240, "garage_img_textPerformList@cn"],
    ["xun", 310, "garage_img_textPerformList_2@cn"]]) {
    const file = add(name, locale, 94, height, "Complete transparent panel assembled offline from imagegen label sprites at native row coordinates; source Chinese pixels are not reused");
    const args = ["-size", `94x${height}`, "canvas:none"];
    for (const [index, y] of nativeRows[kind].entries()) {
      args.push(labels[index], "-geometry", `+8+${y + 1}`, "-composite");
      if (index === 0 || index >= 6) args.push(accent, "-geometry", `+0+${y}`, "-composite");
    }
    magick([...args, "-depth", "8", `PNG32:${file}`]);
  }
  for (const [type, index] of [[1, 9], [2, 8]]) {
    const file = add(`garage_img_textCarType${type}`, locale, 38, 22, "Complete imagegen Item/Speed label, geometrically fitted to native 38x22 extent");
    magick([labels[index], "-gravity", "West", "-background", "none", "-extent", "38x22", "-depth", "8", `PNG32:${file}`]);
  }
}

// Measured atlas cell borders; each output is a complete native-sized button.
const buttonXs = [0, 547, 1092, 1637, 2183], buttonYs = [0, 180, 361, 540, 720];
for (const [column, [locale, action]] of [["en", "reinforce"], ["en", "reset"], ["ko", "reinforce"], ["ko", "reset"]].entries()) {
  for (let state = 1; state <= 4; state++) {
    const x = buttonXs[column], y = buttonYs[state - 1];
    const file = add(`garage_btn_${action}_0${state}@cn`, locale, 194, 64,
      "Complete imagegen localized native button, all four original normal/hover/pressed/disabled states");
    magick([path.join(source, "buttons-generated.png"), "-crop", `${buttonXs[column + 1] - x}x${buttonYs[state] - y}+${x}+${y}`,
      "+repage", "-resize", "194x64!", "-depth", "8", `PNG32:${file}`]);
  }
}

const compareXs = [0, 915, 1909], compareYs = [0, 82, 165, 247, 330, 412, 494, 577, 659, 742, 824];
const classicOrder = [2, 3, 1, 4, 5];
for (const [localeIndex, locale] of ["en", "ko"].entries()) {
  for (let stat = 0; stat < 5; stat++) for (let column = 0; column < 2; column++) {
    const row = localeIndex * 5 + stat, x = compareXs[column], y = compareYs[row];
    const name = column === 0 ? `garage_img_compareBG_${classicOrder[stat]}@cn` : `garage_img_compareBG2_${stat + 1}@cn`;
    const width = column === 0 ? 356 : 386;
    const file = add(name, locale, width, 32, "Complete imagegen classic/XUN comparison bar; preserves numeric blank area and classic slash");
    magick([path.join(source, "compare-generated.png"), "-crop", `${compareXs[column + 1] - x}x${compareYs[row + 1] - y}+${x}+${y}`,
      "+repage", "-resize", `${width}x32!`, "-depth", "8", `PNG32:${file}`]);
  }
}
writeFileSync(path.join(root, "spec.json"), JSON.stringify({ version: 1,
  preparation: "node tools/prepare-garage-locale-art.mjs (requires ImageMagick)",
  prompts: ["source/labels-prompt.txt", "source/buttons-prompt.txt", "source/compare-prompt.txt"],
  nativePerformanceRows: nativeRows, entries }, null, 2) + "\n");
console.log(`Prepared ${entries.length} complete garage images.`);
