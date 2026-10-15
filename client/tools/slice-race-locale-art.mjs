#!/usr/bin/env node
/** Geometry-only preparation of complete imagegen/native sprites; no text drawing. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/race");
const entries = [];
const read = name => JSON.parse(readFileSync(path.join(root, name), "utf8"));
const magick = args => execFileSync("magick", args);
function add(canonicalPath, locale, width, height, input, geometry, provenance, contain = false) {
  const file = `${locale}/${canonicalPath.replace(/@(cn|zz|kr)(?=\.png$)/, "")}`;
  const output = path.join(root, file);
  mkdirSync(path.dirname(output), { recursive: true });
  const args = [input];
  if (geometry) {
    // Transparent sheet pixels may retain RGB data. Measure the visible alpha
    // for the crop only; preserve the complete original RGBA pixels in output.
    const measured = execFileSync("magick", [input, "-crop", geometry, "+repage",
      "-alpha", "extract", "-threshold", "50%", "-bordercolor", "black", "-border", "1",
      "-format", "%@", "info:"], { encoding: "utf8" }).trim();
    const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(measured);
    if (!match || +match[1] === 0 || +match[2] === 0) throw new Error(`Empty sprite: ${canonicalPath}`);
    const bounds = `${match[1]}x${match[2]}+${+match[3] - 1}+${+match[4] - 1}`;
    args.push("-crop", geometry, "+repage", "-crop", bounds, "+repage");
  }
  args.push("-resize", `${width}x${height}${contain ? "" : "!"}`);
  if (contain) args.push("-background", "none", "-gravity", "center", "-extent", `${width}x${height}`);
  args.push("-depth", "8", `PNG32:${output}`); magick(args);
  entries.push({ canonicalPath, locale, file, width, height, provenance });
}
function sheet(name, width, height) {
  const output = path.join(root, `source/${name}-sized.png`);
  magick([path.join(root, `source/${name}-generated.png`), "-resize", `${width}x${height}!`, output]);
  return output;
}
const generated = "Complete imagegen localization of the source sprite; geometry-only resizing and slicing; prompt in source/prompts.json";
const pause = sheet("pause", 416, 424);
for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
  const name = row % 2 === 0 ? "btn_singleAgain_" : "btn_menu_";
  add(`stage_/common/${name}${column + 1}@cn.png`, row < 2 ? "en" : "ko", 104, 106,
    pause, `104x106+${column * 104}+${row * 106}`, generated);
}
const results = sheet("result", 1760, 640);
const folders = { result: "stage_/mqGameFinal", "roadblock-hud": "stage_/mqRoadBlockSpeedGame", "roadblock-result": "stage_/mqRoadBlockGameFinal" };
for (const [index, cell] of read("source/result-cells.json").entries()) {
  if (["greenWin", "yellowWin"].includes(cell.name)) continue;
  add(`${folders[cell.folder]}/${cell.name}@cn.png`, "en", cell.width, cell.height,
    results, `440x128+${index % 4 * 440}+${Math.floor(index / 4) * 128}`, generated,
    cell.name === "result_rankText");
}
// These two isolated lettering sprites were regenerated with transparent alpha;
// the first result atlas mistakenly supplied rectangular team-color panels.
for (const [row, name] of ["greenWin", "yellowWin"].entries()) {
  const cell = read("source/result-cells.json").find(cell => cell.name === name);
  add(`stage_/mqGameFinal/${name}@cn.png`, "en", cell.width, cell.height,
    path.join(root, "source/victory-generated.png"), `1239x635+0+${row * 635}`,
    "Complete transparent imagegen lettering; source/victory-generation.json; geometry-only crop and resize");
}
const room = sheet("room", 1056, 880);
// Generated button rows have small vertical offsets; use visually verified
// row bounds so no adjacent button edge is carried into the finished PNG.
const roomRows = [[14, 94], [102, 182], [190, 270], [278, 357], [366, 445],
  [464, 519], [540, 596], [620, 687], [704, 762], [784, 842]];
for (const cell of read("source/room-cells.json")) {
  if (cell.name === "slotReady" && cell.column > 0) continue;
  const [top, bottom] = roomRows[cell.row];
  add(`stage_/${cell.folder === "ready" ? "mqReady" : "common"}/${cell.name}@cn.png`,
    cell.locale, cell.width, cell.height, room,
    `264x${bottom - top}+${cell.column * 264}+${top}`, generated);
}
const modes = sheet("modes", 816, 536);
for (const cell of read("source/mode-cells.json")) {
  const states = cell.name.startsWith("rp-") ? [1, 2, 3, 4] : [1];
  for (const state of states) {
    const name = cell.name.replace("neutral-01", `neutral-0${state}`);
    add(`ui/multiplayer/${name}`, cell.locale, 272, 134, modes,
      `272x134+${cell.column * 272}+${cell.row * 134}`, generated);
  }
}
for (const native of read("source/native/manifest.json")) {
  // Caption-only result sprites retain their aspect ratio; controls retain the
  // original Chinese hit-area geometry while using the complete native bitmap.
  add(native.canonicalPath, native.locale, native.width, native.height,
    path.join(root, "source/native", native.file), undefined,
    `Original ${native.file.includes("@kr") ? "Korean" : "audited native"} artwork; whole-image size adaptation without changing lettering`,
    native.canonicalPath.includes("mqGameFinal") && !native.file.includes("scoreBox"));
}
writeFileSync(path.join(root, "spec.json"), JSON.stringify({ version: 1,
  preparation: "node tools/slice-race-locale-art.mjs (requires ImageMagick)", entries }, null, 2) + "\n");
console.log(`Prepared ${entries.length} complete race UI sprites.`);
