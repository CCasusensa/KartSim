/**
 * Builds the 卡丁城 delivery quests (server-go/CITY-QUESTS.md) from
 * city-quests.data.mjs: each quest gets its giver's and receiver's spots
 * (city-npcs.json), the driving distance between them along the traffic
 * network (lanes and junction links, plus the walk from each spot to its
 * nearest lane), the time limit of a time quest and the 金币 / 经验 reward.
 *
 *   node tools/city/quests/build-city-quests.mjs [--check]
 *
 * writes design/open-world/vice-city/city-quests.json and the copies the
 * browser and the game node load (run after build-city-npcs.mjs).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QUEST_NPCS, QUEST_RULES, QUESTS } from "./city-quests.data.mjs";
import { lanes, nearestLanePoint } from "../traffic/build-city-npcs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const QUEST_COPIES = [
  "design/open-world/vice-city/city-quests.json",
  "client/src/city/city-quests.json",
  "server-go/internal/game/city/city-quests.json",
];

function pathLength(path) {
  let length = 0;
  for (let i = 3; i < path.p.length; i += 3) length += Math.hypot(path.p[i] - path.p[i - 3], path.p[i + 1] - path.p[i - 2]);
  return length;
}

/** Shortest drive from lane point a to lane point b (Dijkstra over paths). */
export function driveDistance(network, a, b) {
  const paths = network.paths;
  const start = paths.indexOf(a.path), goal = paths.indexOf(b.path);
  if (start === goal && b.s >= a.s) return b.s - a.s;
  const lengths = paths.map(pathLength);
  // dist[i]: driven metres when entering path i at its start.
  const dist = new Float64Array(paths.length).fill(Infinity);
  const done = new Uint8Array(paths.length);
  const queue = [];
  for (const next of paths[start].next) { dist[next] = lengths[start] - a.s; queue.push(next); }
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (dist[queue[i]] < dist[queue[best]]) best = i;
    const at = queue.splice(best, 1)[0];
    if (done[at]) continue;
    done[at] = 1;
    if (at === goal) return dist[at] + b.s;
    for (const next of paths[at].next) {
      const d = dist[at] + lengths[at];
      if (d < dist[next]) { dist[next] = d; queue.push(next); }
    }
  }
  throw new Error("送货路线不连通。");
}

const round10 = v => Math.round(v / 10) * 10;

export function buildQuests() {
  const npcs = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/city-npcs.json"), "utf8"));
  const network = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/traffic-network.json"), "utf8"));
  const laneList = lanes(network);
  const spots = new Map(npcs.npcs.map(npc => [npc.id, npc]));
  const people = {};
  for (const [id, profile] of Object.entries(QUEST_NPCS)) {
    const npc = spots.get(id);
    if (!npc) throw new Error(`任务点人物 ${id} 不在 city-npcs.json 里。`);
    people[id] = { name: npc.name, character: npc.character, ...profile, x: npc.x, z: npc.z };
  }
  const seen = new Set();
  const quests = QUESTS.map(quest => {
    if (seen.has(quest.id)) throw new Error(`任务 id ${quest.id} 重复。`);
    seen.add(quest.id);
    const giver = spots.get(quest.giver), receiver = spots.get(quest.receiver);
    if (!giver || !receiver || !QUEST_NPCS[quest.giver] || !QUEST_NPCS[quest.receiver] || quest.giver === quest.receiver)
      throw new Error(`任务 ${quest.id} 的托付人或收件人不对。`);
    const kind = QUEST_RULES.kinds[quest.kind];
    if (!kind) throw new Error(`任务 ${quest.id} 的限制 ${quest.kind} 不存在。`);
    const from = nearestLanePoint(laneList, giver.x, giver.z), to = nearestLanePoint(laneList, receiver.x, receiver.z);
    const distanceM = Math.round(from.d + driveDistance(network, from, to) + to.d);
    const km = distanceM / 1000;
    const out = {
      id: quest.id, giver: quest.giver, receiver: quest.receiver, item: quest.item, title: quest.title,
      kind: quest.kind, distanceM,
      lucci: round10((QUEST_RULES.lucciBase + QUEST_RULES.lucciPerKm * km) * kind.multiplier),
      exp: Math.round((QUEST_RULES.expBase + QUEST_RULES.expPerKm * km) * kind.multiplier),
      synopsis: quest.synopsis, offer: quest.offer, thanks: quest.thanks,
    };
    if (quest.kind === "speed") {
      if (!(quest.maxKmh > 0)) throw new Error(`限速任务 ${quest.id} 缺少 maxKmh。`);
      out.maxKmh = quest.maxKmh;
    }
    if (quest.kind === "collision") {
      if (!(quest.maxCollisions >= 0)) throw new Error(`易碎品任务 ${quest.id} 缺少 maxCollisions。`);
      out.maxCollisions = quest.maxCollisions;
    }
    if (quest.kind === "time")
      out.timeLimitMs = Math.ceil((distanceM / QUEST_RULES.timeSpeed + QUEST_RULES.timeSlackS) / 5) * 5000;
    return out;
  });
  for (const id of Object.keys(QUEST_NPCS))
    if (!quests.some(q => q.giver === id)) throw new Error(`任务点人物 ${id} 没有任务可托付。`);
  return { version: 1, network: network.id, rules: QUEST_RULES, npcs: people, quests };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const document = buildQuests();
  const text = `${JSON.stringify(document, null, 1)}\n`;
  let stale = false;
  for (const copy of QUEST_COPIES) {
    const path = resolve(ROOT, copy);
    if (check) {
      let old = "";
      try { old = readFileSync(path, "utf8"); } catch { /* missing */ }
      if (old !== text) { console.error(`过期：${copy}`); stale = true; }
    } else {
      writeFileSync(path, text);
      console.log(`写入 ${copy}`);
    }
  }
  for (const q of document.quests)
    console.log(`${q.id.padEnd(20)} ${q.kind.padEnd(9)} ${String(q.distanceM).padStart(5)} m  ${String(q.lucci).padStart(4)} 金币 ${String(q.exp).padStart(3)} 经验${q.timeLimitMs ? `  限时 ${q.timeLimitMs / 1000}s` : ""}`);
  if (stale) process.exit(1);
}
