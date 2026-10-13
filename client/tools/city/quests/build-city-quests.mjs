/**
 * Builds the 卡丁城 quests (server-go/CITY-QUESTS.md) from
 * city-quests.data.mjs: each quest gets its giver's and receiver's spots
 * (city-npcs.json), the driving distance along the traffic network (lanes
 * and junction links, plus the walk from each spot to its nearest lane) —
 * through a collection's stops (nearest first), or to a search area and
 * back with an allowance for searching —, a search's hiding spots, the
 * time limit of a time quest and the 金币 / 经验 reward.
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

/**
 * Shortest road distance from lane point a to lane point b. A rider may take
 * a road either way (only the NPC traffic keeps to its lanes), so this is
 * Dijkstra over the junctions with every lane as a two-way edge: its length
 * plus the gaps from its ends to the junction centres.
 */
export function roadDistance(network, a, b) {
  if (a.path === b.path) return Math.abs(b.s - a.s);
  const graph = roadGraph(network);
  const ends = point => {
    const edge = graph.lanes.get(point.path);
    return [[edge.start, edge.gapStart + point.s], [edge.end, edge.gapEnd + edge.length - point.s]];
  };
  const dist = new Map();
  const queue = [];
  for (const [junction, d] of ends(a)) if (d < (dist.get(junction) ?? Infinity)) { dist.set(junction, d); queue.push(junction); }
  const done = new Set();
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (dist.get(queue[i]) < dist.get(queue[best])) best = i;
    const at = queue.splice(best, 1)[0];
    if (done.has(at)) continue;
    done.add(at);
    for (const [next, length] of graph.adjacent.get(at) ?? []) {
      const d = dist.get(at) + length;
      if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); queue.push(next); }
    }
  }
  let shortest = Infinity;
  for (const [junction, d] of ends(b)) shortest = Math.min(shortest, (dist.get(junction) ?? Infinity) + d);
  if (!Number.isFinite(shortest)) throw new Error("任务路线不连通。");
  return shortest;
}

const graphs = new WeakMap();

function roadGraph(network) {
  let graph = graphs.get(network);
  if (graph) return graph;
  const lanes = new Map();
  const adjacent = new Map();
  const link = (from, to, length) => {
    if (!adjacent.has(from)) adjacent.set(from, []);
    adjacent.get(from).push([to, length]);
  };
  for (const path of network.paths) {
    if (path.kind !== "lane") continue;
    const p = path.p, last = p.length - 3;
    const start = network.junctions[path.start], end = network.junctions[path.end];
    const gapStart = start ? Math.hypot(p[0] - start.x, p[1] - start.z) : 0;
    const gapEnd = end ? Math.hypot(p[last] - end.x, p[last + 1] - end.z) : 0;
    const edge = { start: path.start, end: path.end, length: pathLength(path), gapStart, gapEnd };
    lanes.set(path, edge);
    const total = gapStart + edge.length + gapEnd;
    link(path.start, path.end, total);
    link(path.end, path.start, total);
  }
  graph = { lanes, adjacent };
  graphs.set(network, graph);
  return graph;
}

const round10 = v => Math.round(v / 10) * 10;
const round1 = v => Math.round(v * 10) / 10;

/** Driven metres between two spots (lane points plus the walk to and from the lane). */
function legLength(network, from, to) {
  return roadDistance(network, from, to);
}

/**
 * Collection stops in the order a driver would take them: always the nearest
 * (by driving) stop next. Returns the order and the driven length from
 * `start` through every stop to `end`.
 */
function collectRoute(network, start, stops, end) {
  const left = stops.map((stop, index) => ({ stop, index }));
  let at = start, length = 0;
  const order = [];
  while (left.length) {
    let best = 0, bestLength = Infinity;
    left.forEach((entry, i) => {
      const leg = legLength(network, at, entry.stop.lane);
      if (leg < bestLength) { bestLength = leg; best = i; }
    });
    const [next] = left.splice(best, 1);
    length += bestLength + next.stop.lane.d * 2;
    order.push(next.index);
    at = next.stop.lane;
  }
  return { order, length: length + legLength(network, at, end) };
}

/**
 * Where a search's item may lie: `count` points along the lanes inside the
 * circle, spread out (farthest-point sampling from the point farthest from
 * the centre), so the same build always picks the same ones.
 */
function searchSpots(network, area, count) {
  const inside = [];
  for (const path of network.paths)
    for (let i = 0; i < path.p.length; i += 3) {
      const x = path.p[i], z = path.p[i + 1];
      if (Math.hypot(x - area.at[0], z - area.at[1]) <= area.radius * 0.9) inside.push([x, z]);
    }
  if (inside.length < count) throw new Error(`寻物范围 ${area.name} 里的车道太少。`);
  const far = point => Math.hypot(point[0] - area.at[0], point[1] - area.at[1]);
  const chosen = [inside.reduce((a, b) => (far(b) > far(a) ? b : a))];
  while (chosen.length < count) {
    let best, bestGap = -1;
    for (const point of inside) {
      const gap = Math.min(...chosen.map(c => Math.hypot(c[0] - point[0], c[1] - point[1])));
      if (gap > bestGap) { bestGap = gap; best = point; }
    }
    chosen.push(best);
  }
  return chosen.map(([x, z]) => ({ x: round1(x), z: round1(z) }));
}

export function buildQuests() {
  const npcs = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/city-npcs.json"), "utf8"));
  const network = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/traffic-network.json"), "utf8"));
  const laneList = lanes(network);
  const spots = new Map(npcs.npcs.map(npc => [npc.id, npc]));
  const people = {};
  for (const [id, profile] of Object.entries(QUEST_NPCS)) {
    const npc = spots.get(id);
    if (!npc) throw new Error(`任务点人物 ${id} 不在 city-npcs.json 里。`);
    people[id] = { name: npc.name, character: npc.character, dye: npc.dye, ...profile, x: npc.x, z: npc.z };
  }
  const seen = new Set();
  const quests = QUESTS.map(quest => {
    if (seen.has(quest.id)) throw new Error(`任务 id ${quest.id} 重复。`);
    seen.add(quest.id);
    const type = quest.type ?? "delivery";
    const typeRule = QUEST_RULES.types[type];
    if (!typeRule) throw new Error(`任务 ${quest.id} 的类型 ${type} 不存在。`);
    const giver = spots.get(quest.giver), receiver = spots.get(quest.receiver);
    if (!giver || !receiver || !QUEST_NPCS[quest.giver] || !QUEST_NPCS[quest.receiver])
      throw new Error(`任务 ${quest.id} 的托付人或收件人不对。`);
    if ((type === "delivery" || type === "passenger") && quest.giver === quest.receiver)
      throw new Error(`任务 ${quest.id} 要送到另一个人那里。`);
    const kind = QUEST_RULES.kinds[quest.kind];
    if (!kind) throw new Error(`任务 ${quest.id} 的限制 ${quest.kind} 不存在。`);
    const from = nearestLanePoint(laneList, giver.x, giver.z), to = nearestLanePoint(laneList, receiver.x, receiver.z);
    const extra = {};
    let driven;
    if (type === "collect") {
      if (!Array.isArray(quest.stops) || quest.stops.length < 2) throw new Error(`收集任务 ${quest.id} 至少要两个收集点。`);
      const stops = quest.stops.map(stop => {
        const lane = nearestLanePoint(laneList, stop.at[0], stop.at[1]);
        if (lane.d > 40) throw new Error(`收集点 ${stop.name} 离车道 ${Math.round(lane.d)} m，太远了。`);
        return { name: stop.name, lane };
      });
      const route = collectRoute(network, from, stops, to);
      driven = route.length;
      // Listed in the order a driver takes them.
      extra.stops = route.order.map(i => ({ name: stops[i].name, x: round1(stops[i].lane.x), y: round1(stops[i].lane.y),
        z: round1(stops[i].lane.z) }));
    } else if (type === "search") {
      const area = quest.area;
      if (!area || !(area.radius >= 80)) throw new Error(`寻物任务 ${quest.id} 缺少范围。`);
      const centre = nearestLanePoint(laneList, area.at[0], area.at[1]);
      driven = legLength(network, from, centre) + QUEST_RULES.search.allowance * area.radius + legLength(network, centre, to);
      extra.area = { name: area.name, x: area.at[0], z: area.at[1], radius: area.radius,
        spots: searchSpots(network, area, QUEST_RULES.search.spots) };
    } else {
      driven = roadDistance(network, from, to);
    }
    const distanceM = Math.round(from.d + driven + to.d);
    const km = distanceM / 1000;
    const multiplier = typeRule.multiplier * kind.multiplier;
    const out = {
      id: quest.id, type, giver: quest.giver, receiver: quest.receiver, item: quest.item, title: quest.title,
      kind: quest.kind, distanceM,
      lucci: round10((QUEST_RULES.lucciBase + QUEST_RULES.lucciPerKm * km) * multiplier),
      exp: Math.round((QUEST_RULES.expBase + QUEST_RULES.expPerKm * km) * multiplier),
      ...extra,
      synopsis: quest.synopsis, offer: quest.offer, thanks: quest.thanks,
    };
    if (quest.kind === "speed") {
      if (!(quest.maxKmh > 0)) throw new Error(`限速任务 ${quest.id} 缺少 maxKmh。`);
      out.maxKmh = quest.maxKmh;
    }
    if (quest.kind === "collision") {
      if (!(quest.maxCollisions >= 0)) throw new Error(`小心驾驶任务 ${quest.id} 缺少 maxCollisions。`);
      out.maxCollisions = quest.maxCollisions;
    }
    if (quest.kind === "time") {
      const slack = QUEST_RULES.timeSlackS + (type === "search" ? QUEST_RULES.search.extraTimeS : 0);
      out.timeLimitMs = Math.ceil((distanceM / QUEST_RULES.timeSpeed + slack) / 5) * 5000;
    }
    return out;
  });
  for (const id of Object.keys(QUEST_NPCS))
    if (!quests.some(q => q.giver === id)) throw new Error(`任务点人物 ${id} 没有任务可托付。`);
  return { version: 2, network: network.id, rules: QUEST_RULES, npcs: people, quests };
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
    console.log(`${q.id.padEnd(20)} ${q.type.padEnd(9)} ${q.kind.padEnd(9)} ${String(q.distanceM).padStart(5)} m  ${String(q.lucci).padStart(4)} 金币 ${String(q.exp).padStart(3)} 经验${q.timeLimitMs ? `  限时 ${q.timeLimitMs / 1000}s` : ""}`);
  if (stale) process.exit(1);
}
