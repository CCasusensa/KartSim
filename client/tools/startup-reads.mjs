#!/usr/bin/env node
// Builds src/resources/startup-reads.json, the byte ranges a first start
// reads before the home screen and while a first race loads, from a
// container read log.
//
// Record the log in a fresh browser profile (empty OPFS, a new account) with
// a production build: before the page's scripts run, set
// `globalThis.__KART_READ_LOG__ = []` (for example with the DevTools
// protocol's Page.addScriptToEvaluateOnNewDocument); the container store
// then appends [container, start, end, performance.now()] for every read.
// Note performance.now() when the login window shows, when the home screen
// (with a new account's 创建车手 window) has settled, and before and after a
// time attack race loads (计时挑战赛 → 开始); save the array as JSON and run:
//
//   node tools/startup-reads.mjs <log.json> --login <ms> --home <ms> --race <start-ms> <end-ms>
//
// Reads before --login form the "early" tier, reads up to --home the
// "late" one (without the blocks early already has), reads while the race
// loads the "race" one, without the containers that differ between races
// (tracks and their themes, music, karts, characters, pets).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK = 32 * 1024;
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  if (index < 0 || !Number.isFinite(Number(args[index + 1]))) throw new Error(`缺少 ${name} <ms>`);
  return Number(args[index + 1]);
};
const logPath = args.find(arg => !arg.startsWith("--") && !Number.isFinite(Number(arg)));
if (!logPath) throw new Error("用法：node tools/startup-reads.mjs <log.json> --login <ms> --home <ms>");
const login = option("--login");
const home = option("--home");
const raceStart = option("--race");
const raceEnd = Number(args[args.indexOf("--race") + 2]);
if (!(raceEnd > raceStart)) throw new Error("--race 需要开始与结束两个时间");
/** Containers a race reads only for its track, music, karts and riders. */
const PER_RACE = /^(track_|theme_(?!common\.)|sound_bgm_|DataPack[23]_|character_(?!common\.)|pet_|flyingPet_)/i;

const manifest = JSON.parse(readFileSync(path.join(project, "../mirror/__p3553/resources"), "utf8"));
const sizes = new Map(manifest.files.map(file => [file.name, file.size]));
const log = JSON.parse(readFileSync(logPath, "utf8"));

const tiers = { early: new Map(), late: new Map(), race: new Map() };
for (const [name, start, end, time] of log) {
  if (!sizes.has(name) || !(end > start)) continue;
  let tier;
  if (time <= login) tier = tiers.early;
  else if (time <= home) tier = tiers.late;
  else if (time >= raceStart && time <= raceEnd && !PER_RACE.test(name)) tier = tiers.race;
  else continue;
  let blocks = tier.get(name);
  if (!blocks) tier.set(name, blocks = new Set());
  for (let block = Math.floor(start / BLOCK); block <= Math.floor((end - 1) / BLOCK); block++) blocks.add(block);
}
for (const [name, blocks] of tiers.late) {
  for (const block of tiers.early.get(name) ?? []) blocks.delete(block);
  if (!blocks.size) tiers.late.delete(name);
}

/** Block sets as merged byte ranges, containers sorted by name. */
const ranges = tier => Object.fromEntries([...tier].sort(([a], [b]) => a.localeCompare(b)).map(([name, blocks]) => {
  const sorted = [...blocks].sort((a, b) => a - b);
  const merged = [];
  for (const block of sorted) {
    const start = block * BLOCK;
    const end = Math.min(sizes.get(name), start + BLOCK);
    const last = merged.at(-1);
    if (last && last[1] === start) last[1] = end;
    else merged.push([start, end]);
  }
  return [name, merged];
}));

const output = { version: manifest.version, revision: manifest.revision,
  early: ranges(tiers.early), late: ranges(tiers.late), race: ranges(tiers.race) };
const target = path.join(project, "src/resources/startup-reads.json");
writeFileSync(target, `${JSON.stringify(output)}\n`);
const total = tier => Object.values(output[tier]).flat().reduce((sum, [start, end]) => sum + end - start, 0);
console.log(`${path.relative(process.cwd(), target)}：` + ["early", "late", "race"].map(tier =>
  `${tier} ${Object.keys(output[tier]).length} 个容器 ${(total(tier) / 1048576).toFixed(1)} MiB`).join("，"));
