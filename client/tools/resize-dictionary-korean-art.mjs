#!/usr/bin/env node
/** Resize complete original Korean sprites to the authored dictionary layout. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/locale-ui/dictionary-ko");
const spec = JSON.parse(readFileSync(path.join(root, "spec.json"), "utf8"));
for (const entry of spec.entries) {
  const input = path.join(root, "source", path.basename(entry.file));
  execFileSync("magick", [input, "-resize", `${entry.width}x${entry.height}!`, "-depth", "8",
    `PNG32:${path.join(root, entry.file)}`]);
}
console.log(`Prepared ${spec.entries.length} original Korean dictionary sprites.`);
