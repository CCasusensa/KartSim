#!/usr/bin/env node
// Export the 练习计时赛 missions the data service judges — the 赛道对决 (track
// duel) events and the 练习目标 (training goals) of every track — into
// server-go/internal/data/timeattack/missions.json.
//
// Usage, from client/:
//   node --import tsx tools/export-timeattack-missions.mjs            write missions.json
//   node --import tsx tools/export-timeattack-missions.mjs --check    exit 1 if it is stale
//   node --import tsx tools/export-timeattack-missions.mjs --out DIR  write elsewhere
//
// Sources (mirror/p3553, read through the browser's resource library):
//   zeta_/cn/content/timeAttack/timeAttackMission.xml   duelMissionList (events: track, period,
//                                                       NPC stages, rewards) and
//                                                       trainingMissionListSet (goal sets per track)
//   zeta_/cn/shop/data/stock.kml                        the items of each reward stock
//
// The release gave each duel stage an NPC .ksv ghost the server delivered;
// those files are not in the resource mirror, so the data service derives
// the NPC's time from the track's 达成赛道纪录 goal instead (timeattack.go).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDocument } from "./economy-export/canonical.mjs";
import { loadResourceLibrary, parseNormalizedXml, uniqueBytes } from "./economy-export/resource-library.mjs";
import { attr, parseStocks } from "./economy-export/shop-data.mjs";

const rewriteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(rewriteDir, "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1] ?? "")
  : path.join(projectRoot, "server-go/internal/data/timeattack");

const SOURCES = {
  missions: "zeta_/cn/content/timeAttack/timeAttackMission.xml",
  stocks: "zeta_/cn/shop/data/stock.kml",
};

/** Training goal types (timeAttackMission.xml missionSet.type). */
const GOAL_TYPES = { undefined: "finish", "0": "booster", "1": "crash", "2": "record" };
/** Reward types (rewardType / reward.type). */
const REWARD_TYPES = { "1": "stock", "2": "lucci", "3": "rp", "4": "emblem" };

const problems = [];
const problem = message => problems.push(message);

function integer(node, name, { min = 0, optional = false } = {}) {
  const raw = attr(node, name);
  if (raw === undefined && optional) return undefined;
  const value = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isSafeInteger(value) || value < min) {
    problem(`${node.name}.${name}: bad value ${JSON.stringify(raw)}`);
    return 0;
  }
  return value;
}

function reward(node, typeName, valueName, stocks) {
  const type = REWARD_TYPES[attr(node, typeName)];
  const value = integer(node, valueName, { min: 1 });
  if (!type) problem(`${node.name}: reward type ${JSON.stringify(attr(node, typeName))}`);
  if (type === "stock" && !stocks.has(value)) problem(`${node.name}: reward stock ${value} is not in stock.kml`);
  return { type: type ?? "stock", value };
}

/** One <duelMission> event: its track, period and NPC stages. */
export function duelRows(node, stocks) {
  const trackId = attr(node, "trackId") ?? "";
  const sets = node.children.filter(child => child.name === "missionSet");
  return sets.map(set => {
    const [from, to] = (attr(set, "period") ?? "").split("~");
    if (!from || !to) problem(`duel ${trackId}: period ${JSON.stringify(attr(set, "period"))}`);
    const stages = set.children.filter(child => child.name === "mission").map((mission, index) => {
      const itemOn = mission.children.find(child => child.name === "itemOn");
      const scenes = mission.children.filter(child => child.name === "scene");
      const scene = type => scenes.find(child => attr(child, "type") === type);
      const npcName = scenes.map(child => attr(child, "npcName")).find(Boolean) ?? "";
      if (!npcName) problem(`duel ${trackId} stage ${index + 1}: no npcName`);
      return {
        stage: index + 1,
        ksv: attr(mission, "ksv") ?? "",
        speed: integer(mission, "gameSpeed", { min: 1 }),
        teamBooster: attr(mission, "useTeamBooster") === "1",
        npc: {
          name: npcName,
          characterId: integer(mission, "npcId", { min: 1 }),
          kartId: itemOn ? integer(itemOn, "kart", { min: 1 }) : 0,
          color: itemOn ? integer(itemOn, "color", { optional: true }) ?? 0 : 0,
          dye: itemOn ? integer(itemOn, "dye", { optional: true }) ?? 0 : 0,
        },
        messages: {
          difficulty: (attr(scene("0"), "msg") ?? "").split("|"),
          win: (attr(scene("1"), "msg") ?? "").split("|"),
        },
        difficulties: mission.children.filter(child => child.name === "difficulty").map(child => ({
          point: integer(child, "point", { min: 1 }),
          advantageMs: integer(child, "advantage"),
          reward: reward(child, "rewardType", "rewardValue", stocks),
        })),
        reward: mission.children.filter(child => child.name === "reward").map(child =>
          reward(child, "type", "value", stocks))[0] ?? null,
      };
    });
    if (stages.length === 0) problem(`duel ${trackId}: no stages`);
    return { trackId, from: (from ?? "").trim(), to: (to ?? "").trim(), stages };
  });
}

/** One <trainingMissionList>: the goal sets of a track. */
export function trainingRow(node, stocks) {
  const trackId = attr(node, "trackId") ?? "";
  const sets = node.children.filter(child => child.name === "missionSet").map(set => {
    const type = GOAL_TYPES[attr(set, "type")];
    if (!type) problem(`training ${trackId}: goal type ${JSON.stringify(attr(set, "type"))}`);
    return {
      title: attr(set, "title") ?? "",
      type: type ?? "finish",
      hidden: attr(set, "isHidden") === "true",
      stages: set.children.filter(child => child.name === "mission").map(mission => ({
        count: integer(mission, "count", { min: 1 }),
        requirement: integer(mission, "requirementValue", { optional: true }) ?? 0,
        reward: reward(mission, "rewardType", "rewardValue", stocks),
      })),
    };
  });
  return { trackId, sets };
}

const { library, xml, manifest } = await loadResourceLibrary(projectRoot);
const parseXmlAt = async canonical =>
  parseNormalizedXml(xml.parseResourceXml, await uniqueBytes(library, canonical)).root;

const root = await parseXmlAt(SOURCES.missions);
const stocks = parseStocks(await parseXmlAt(SOURCES.stocks));
const find = name => root.children.find(child => child.name === name);
const duelList = find("duelMissionList");
const trainingList = find("trainingMissionListSet");
if (!duelList || !trainingList) problem("timeAttackMission.xml: missing duelMissionList or trainingMissionListSet");

const duels = (duelList?.children ?? []).filter(child => child.name === "duelMission")
  .flatMap(node => duelRows(node, stocks));
const training = {};
for (const node of (trainingList?.children ?? []).filter(child => child.name === "trainingMissionList")) {
  const row = trainingRow(node, stocks);
  if (training[row.trackId]) problem(`training ${row.trackId}: listed twice`);
  training[row.trackId] = row.sets;
}
const tracks = new Set(library.mapAssets().map(file =>
  path.posix.basename(path.posix.dirname(file.virtualPath)).replace(/^track_/, "").toLowerCase()));
// Reverse tracks (_rvs) run the forward track's model.
const shipped = trackId => tracks.has(trackId.toLowerCase().replace(/_rvs$/, ""));
for (const duel of duels) if (!shipped(duel.trackId)) problem(`duel track ${duel.trackId} has no model in the mirror`);
const unshipped = Object.keys(training).filter(trackId => !shipped(trackId));
for (const trackId of unshipped) delete training[trackId]; // goals of tracks the mirror does not ship

const rewardStocks = {};
const collect = item => {
  if (item.type !== "stock") return;
  const stock = stocks.get(item.value);
  if (stock) rewardStocks[item.value] = { name: stock.name, items: stock.items };
};
for (const duel of duels) for (const stage of duel.stages) {
  if (stage.reward) collect(stage.reward);
  for (const difficulty of stage.difficulties) collect(difficulty.reward);
}
for (const sets of Object.values(training)) for (const set of sets) for (const stage of set.stages) collect(stage.reward);

if (problems.length > 0) {
  for (const message of problems) console.error(`problem: ${message}`);
  process.exit(1);
}
const document = formatDocument({
  generatedFrom: `client/tools/export-timeattack-missions.mjs over mirror/${manifest.version} ` +
    `revision ${manifest.revision}: ${SOURCES.missions} (duel events and training goal sets) ` +
    `and the reward stocks' items from ${SOURCES.stocks}. Do not edit by hand.`,
  duels, training, rewardStocks,
});
const file = path.join(outDir, "missions.json");
if (checkOnly) {
  if (!existsSync(file) || readFileSync(file, "utf8") !== document.text) {
    console.error("missions.json stale; run tools/export-timeattack-missions.mjs");
    process.exit(1);
  }
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, document.text);
}
console.log(`duels ${duels.length}, training tracks ${Object.keys(training).length} ` +
  `(skipped unshipped: ${unshipped.join(", ") || "none"}), ` +
  `reward stocks ${Object.keys(rewardStocks).length}, version ${document.version}`);
