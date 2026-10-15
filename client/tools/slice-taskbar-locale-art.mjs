#!/usr/bin/env node
/** Geometry-only preparation of the imagegen taskbar sheet; never render captions. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/taskbar");
const input = path.join(root, "source/english-generated.png");
const output = path.join(root, "en");
mkdirSync(output, { recursive: true });
const sheet = path.join(output, "spritesheet.png");
execFileSync("magick", [input, "-resize", "624x264!", sheet]);
const buttons = [
  ["multiplayer", "btn_mainMulti_"], ["singleplayer", "btn_mainSingle_"],
  ["myroom", "btn_mainMyroom_"], ["shop", "btn_mainShop_"],
  ["garage", "튜닝_0"], ["club", "클럽_0"],
];
const entries = [];
for (let row = 0; row < 4; row++) for (let column = 0; column < buttons.length; column++) {
  const [name, stem] = buttons[column];
  const filename = `${name}-${row + 1}.png`;
  execFileSync("magick", [sheet, "-crop", `104x66+${column * 104}+${row * 66}`,
    "+repage", path.join(output, filename)]);
  entries.push({ canonicalPath: `gui_/window/menu/${stem}${row + 1}@zz.png`, locale: "en",
    file: `en/${filename}`, width: 104, height: 66,
    provenance: "imagegen English localization of native Korean gui_window.rho sprites; geometry-only resize and slicing" });
}
const sha256 = file => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
writeFileSync(path.join(root, "spec.json"), JSON.stringify({
  version: 1, generation: { tool: "imagegen", input: "source/native-ko.png",
    prompt: "source/imagegen-prompt.txt", output: "source/english-generated.png",
    inputSha256: sha256("source/native-ko.png"), outputSha256: sha256("source/english-generated.png"),
    preparation: "node tools/slice-taskbar-locale-art.mjs (requires ImageMagick)",
    cellWidth: 104, cellHeight: 66, columns: 6, rows: 4 }, entries,
}, null, 2) + "\n");
console.log(`Prepared ${entries.length} English taskbar sprites.`);
