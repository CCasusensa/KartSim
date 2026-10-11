#!/usr/bin/env node
// 卡丁城 v3 pipeline: Tripo props → Blender city → glb → track container.
//
//   node tools/city/blender/blender-city.mjs assets [--concurrency 3] [--only id,id] [--force]
//   node tools/city/blender/blender-city.mjs props   [--mirror CHECKOUT]       (official textures/props for Blender)
//   node tools/city/blender/blender-city.mjs build   [--blender PATH]          (runs kartcity.py headless → build/blender/out/)
//   node tools/city/blender/blender-city.mjs import  [--mirror CHECKOUT] [--register --register-into CHECKOUT]
//   node tools/city/blender/blender-city.mjs all     (assets → props → build → import --register)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ASSETS, optionsOf, promptOf } from "./assets.mjs";
import { TRIPO_DIR, ensureModel } from "./tripo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
const command = args[0];
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const BLENDER = option("--blender") ?? process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
export const OUT_DIR = path.join(clientDir, "build", "blender", "out");

async function generateAssets() {
  const concurrency = Number(option("--concurrency") ?? 3);
  const only = option("--only")?.split(",");
  const force = args.includes("--force");
  const queue = ASSETS.filter(a => !only || only.includes(a.id));
  const results = { ok: [], failed: [] };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const asset = queue[next++];
      try {
        const r = await ensureModel(asset.id, promptOf(asset), optionsOf(asset), { force, log: line => console.log(`[${asset.id}] ${line}`) });
        console.log(`[${asset.id}] ${r.cached ? "cached" : "done"} ${r.entry.bytes} bytes`);
        results.ok.push(asset.id);
      } catch (error) {
        console.error(`[${asset.id}] FAILED ${error.message}`);
        results.failed.push(asset.id);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`assets: ${results.ok.length} ok, ${results.failed.length} failed${results.failed.length ? ` (${results.failed.join(", ")})` : ""}`);
  if (results.failed.length) process.exitCode = 1;
}

function run(cmd, cmdArgs, cwd = clientDir) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  if (r.status !== 0) { console.error(`${cmd} exited ${r.status}`); process.exit(r.status ?? 1); }
}

function buildInBlender() {
  if (!existsSync(BLENDER)) { console.error(`Blender not found at ${BLENDER} (brew install --cask blender, or --blender PATH)`); process.exit(1); }
  mkdirSync(OUT_DIR, { recursive: true });
  // The asset catalogue for the Blender script (sizes, colliders, themes).
  const assetsFile = path.join(clientDir, "build", "blender", "assets.json");
  writeFileSync(assetsFile, JSON.stringify(ASSETS, null, 1));
  run(BLENDER, ["-b", "--python", path.join(here, "kartcity.py"), "--", "--props", path.join(clientDir, "build", "blender", "props"), "--tripo", TRIPO_DIR, "--assets", assetsFile, "--out", OUT_DIR]);
}

const mirrorArgs = () => option("--mirror") ? ["--mirror", option("--mirror")] : [];
const nodeTsx = (script, extra) => run(process.execPath, ["--import", "tsx", path.join(here, script), ...extra]);

switch (command) {
  case "assets": await generateAssets(); break;
  case "props": nodeTsx("export-props.mjs", mirrorArgs()); break;
  case "build": buildInBlender(); break;
  case "import": nodeTsx("import-city.mjs", [...mirrorArgs(), ...(args.includes("--register") ? ["--register"] : []), ...(option("--register-into") ? ["--register-into", option("--register-into")] : [])]); break;
  case "all":
    await generateAssets();
    nodeTsx("export-props.mjs", mirrorArgs());
    buildInBlender();
    nodeTsx("import-city.mjs", [...mirrorArgs(), "--register", ...(option("--register-into") ? ["--register-into", option("--register-into")] : [])]);
    break;
  default: console.log("usage: blender-city.mjs assets|props|build|import|all"); process.exit(1);
}
