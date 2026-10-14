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
import { COLLECT_TEMPLATES, DELIVERY_TEMPLATES, PASSENGER_TEMPLATES, SEARCH_TEMPLATES } from "./city-quests.templates.mjs";
import { CITIZENS } from "../npcs/citizens.data.mjs";
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

/** Generated deliveries (city-quests.templates.mjs) each task-point NPC gives. */
const TEMPLATE_QUESTS_PER_NPC = 3;
/** A generated delivery's receiver stands this far (m, straight) from its giver, when anyone does. */
const RECEIVER_RANGE = [600, 2800];
/** A generated collection's stops lie this far (m) from its giver, at least STOP_GAP apart. */
const STOP_RANGE = [150, 650];
const STOP_GAP = 120;
/** A generated search's area is centred this far (m) from its giver, with this radius. */
const SEARCH_RANGE = [300, 1000];
const SEARCH_RADIUS = 170;
/** Streets the generator puts stops and search areas on: ground level, mid-block. */
const STREET_MAX_Y = 12.5;
const JUNCTION_CLEARANCE = 25;

/** FNV-1a: a stable order for the generator's choices. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

function inPolygon([x, z], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const shortName = name => name.slice(name.lastIndexOf("·") + 1).trim();
const roleOf = name => name.includes("·") ? name.slice(0, name.indexOf("·")).trim() : "";

/**
 * Street points (design x/z, every 12th lane vertex) on ground-level roads
 * away from junctions, with their district: where generated stops and
 * search areas go.
 */
function streetPoints(network, districts) {
  const points = [];
  for (const path of network.paths) {
    if (path.kind !== "lane") continue;
    for (let i = 0; i < path.p.length; i += 12) {
      const x = path.p[i], z = path.p[i + 1], y = path.p[i + 2];
      if (y > STREET_MAX_Y) continue;
      if (network.junctions.some(j => Math.hypot(j.x - x, j.z - z) < JUNCTION_CLEARANCE)) continue;
      const district = districts.find(d => inPolygon([x, z], d.polygon));
      if (district) points.push({ x, z, district });
    }
  }
  return points;
}

/** "罪恶角北部": the district and which part of it a point is in. */
function partOf(point) {
  const xs = point.district.polygon.map(p => p[0]), zs = point.district.polygon.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const dx = (point.x - cx) / (Math.max(...xs) - Math.min(...xs)), dz = (point.z - cz) / (Math.max(...zs) - Math.min(...zs));
  if (Math.max(Math.abs(dx), Math.abs(dz)) < 0.18) return `${point.district.name}中部`;
  // Design z grows southwards.
  return `${point.district.name}${Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "东部" : "西部") : (dz > 0 ? "南部" : "北部")}`;
}

/**
 * The template quests. Each task-point NPC (in file order) gets
 * TEMPLATE_QUESTS_PER_NPC deliveries and one ride, one collection and one
 * search, from the templates its trade may give (the least used so far
 * first; at most two deliveries of one limit). Deliveries, rides and
 * collections handed to someone else go to a different NPC each in
 * RECEIVER_RANGE (the least served so far first; a ride prefers its
 * template's trades). A collection's stops and a search's area are street
 * points near the giver; collections and searches come back to the giver
 * unless the template says otherwise. Ties go by a hash, so the same data
 * always builds the same quests.
 */
export function templateQuests(people, districts, network) {
  const used = new Map(), served = new Map();
  const streets = streetPoints(network, districts);
  const where = person => districts.find(d => inPolygon([person.x, person.z], d.polygon))?.name ?? "城外";
  const quests = [];
  for (const [giverId, giver] of Object.entries(people)) {
    const fit = templates => templates.filter(t => t.from.includes(giver.category) || t.from.includes("any"));
    const order = prefix => (a, b) => (used.get(prefix + a.key) ?? 0) - (used.get(prefix + b.key) ?? 0) ||
      hash(`${giverId}/${prefix}${a.key}`) - hash(`${giverId}/${prefix}${b.key}`);
    const take = (prefix, templates, count, mixLimits = false) => {
      const picked = [];
      for (const template of [...fit(templates)].sort(order(prefix))) {
        if (picked.length >= count) break;
        if (mixLimits && picked.filter(p => p.kind === template.kind).length >= 2) continue;
        picked.push(template);
        used.set(prefix + template.key, (used.get(prefix + template.key) ?? 0) + 1);
      }
      return picked;
    };
    const others = Object.entries(people).filter(([id]) => id !== giverId);
    const distance = ([, person]) => Math.hypot(person.x - giver.x, person.z - giver.z);
    const inRange = others.filter(entry => distance(entry) >= RECEIVER_RANGE[0] && distance(entry) <= RECEIVER_RANGE[1]);
    const pool = inRange.length >= TEMPLATE_QUESTS_PER_NPC + 2 ? inRange : others;
    const chosen = new Set();
    const receiverFor = (key, trades) => {
      const free = pool.filter(([id]) => !chosen.has(id));
      const preferred = trades ? free.filter(([, person]) => trades.includes(person.category)) : [];
      const [receiverId, receiver] = [...(preferred.length ? preferred : free)].sort((a, b) =>
        (served.get(a[0]) ?? 0) - (served.get(b[0]) ?? 0) ||
        hash(`${giverId}/${key}/${a[0]}`) - hash(`${giverId}/${key}/${b[0]}`))[0];
      chosen.add(receiverId);
      served.set(receiverId, (served.get(receiverId) ?? 0) + 1);
      return [receiverId, receiver];
    };
    const near = ([low, high]) => streets.filter(p => {
      const d = Math.hypot(p.x - giver.x, p.z - giver.z);
      return d >= low && d <= high;
    });
    const fillFor = (receiver, extra = {}) => text => Object.entries({
      "{from}": shortName(giver.name), "{to}": shortName(receiver.name), "{toRole}": roleOf(receiver.name),
      "{where}": where(receiver), ...extra,
    }).reduce((out, [key, value]) => out.replaceAll(key, value), text);
    const words = (template, fill) => ({ title: fill(template.title), kind: template.kind,
      ...(template.maxKmh ? { maxKmh: template.maxKmh } : {}),
      ...(template.maxCollisions !== undefined ? { maxCollisions: template.maxCollisions } : {}),
      synopsis: fill(template.synopsis), offer: template.offer.map(line => ({ who: line.who, text: fill(line.text) })),
      thanks: fill(template.thanks) });

    for (const template of take("", DELIVERY_TEMPLATES, TEMPLATE_QUESTS_PER_NPC, true)) {
      const [receiverId, receiver] = receiverFor(template.key);
      quests.push({ id: `${giverId}~${template.key}`, type: "delivery", giver: giverId, receiver: receiverId,
        item: template.item, ...words(template, fillFor(receiver)) });
    }
    for (const template of take("ride-", PASSENGER_TEMPLATES, 1)) {
      const [receiverId, receiver] = receiverFor(`ride-${template.key}`, template.to);
      quests.push({ id: `${giverId}~ride-${template.key}`, type: "passenger", giver: giverId, receiver: receiverId,
        item: shortName(giver.name), ...words(template, fillFor(receiver)) });
    }
    for (const template of take("collect-", COLLECT_TEMPLATES, 1)) {
      let candidates = near(STOP_RANGE);
      if (candidates.length < template.stops.length) candidates = near([STOP_RANGE[0], STOP_RANGE[1] * 2]);
      candidates.sort((a, b) => hash(`${giverId}/${template.key}/${a.x},${a.z}`) - hash(`${giverId}/${template.key}/${b.x},${b.z}`));
      const stops = [candidates[0]];
      while (stops.length < template.stops.length) {
        let best, bestGap = -1;
        for (const point of candidates) {
          const gap = Math.min(...stops.map(stop => Math.hypot(stop.x - point.x, stop.z - point.z)));
          if (gap > bestGap) { bestGap = gap; best = point; }
        }
        if (bestGap < STOP_GAP) throw new Error(`${giverId} 附近找不到分散的收集点。`);
        stops.push(best);
      }
      const [receiverId, receiver] = template.toOther ? receiverFor(`collect-${template.key}`) : [giverId, giver];
      quests.push({ id: `${giverId}~collect-${template.key}`, type: "collect", giver: giverId, receiver: receiverId,
        // Named in the order they are driven (第一个… comes first).
        item: template.item, stops: stops.map((stop, i) => ({ name: template.stops[i], at: [stop.x, stop.z] })),
        stopNames: template.stops,
        ...words(template, fillFor(receiver)) });
    }
    for (const template of take("search-", SEARCH_TEMPLATES, 1)) {
      const candidates = near(SEARCH_RANGE).sort((a, b) =>
        hash(`${giverId}/${template.key}/${a.x},${a.z}`) - hash(`${giverId}/${template.key}/${b.x},${b.z}`));
      // A centre with enough street around it for the hiding spots.
      const centre = candidates.find(c => streets.filter(p => Math.hypot(p.x - c.x, p.z - c.z) <= SEARCH_RADIUS * 0.8).length >= 8);
      if (!centre) throw new Error(`${giverId} 附近找不到寻物范围。`);
      const area = { name: partOf(centre), at: [Math.round(centre.x), Math.round(centre.z)], radius: SEARCH_RADIUS };
      quests.push({ id: `${giverId}~search-${template.key}`, type: "search", giver: giverId, receiver: giverId,
        item: template.item, area, ...words(template, fillFor(giver, { "{area}": area.name })) });
    }
  }
  return quests;
}

export function buildQuests() {
  const npcs = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/city-npcs.json"), "utf8"));
  const network = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/traffic-network.json"), "utf8"));
  const map = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/city-map.json"), "utf8"));
  const laneList = lanes(network);
  const spots = new Map(npcs.npcs.map(npc => [npc.id, npc]));
  const profiles = { ...QUEST_NPCS };
  for (const citizen of CITIZENS)
    profiles[citizen.id] = { category: citizen.category, sprite: citizen.sprite, background: citizen.background, story: citizen.story };
  const people = {};
  for (const [id, profile] of Object.entries(profiles)) {
    const npc = spots.get(id);
    if (!npc) throw new Error(`任务点人物 ${id} 不在 city-npcs.json 里。`);
    people[id] = { name: npc.name, character: npc.character, dye: npc.dye, ...profile, x: npc.x, z: npc.z };
  }
  const seen = new Set();
  const quests = [...QUESTS, ...templateQuests(people, map.districts, network)].map(quest => {
    if (seen.has(quest.id)) throw new Error(`任务 id ${quest.id} 重复。`);
    seen.add(quest.id);
    const type = quest.type ?? "delivery";
    const typeRule = QUEST_RULES.types[type];
    if (!typeRule) throw new Error(`任务 ${quest.id} 的类型 ${type} 不存在。`);
    const giver = spots.get(quest.giver), receiver = spots.get(quest.receiver);
    if (!giver || !receiver || !profiles[quest.giver] || !profiles[quest.receiver])
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
      extra.stops = route.order.map((i, k) => ({ name: quest.stopNames?.[k] ?? stops[i].name, x: round1(stops[i].lane.x),
        y: round1(stops[i].lane.y), z: round1(stops[i].lane.z) }));
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
  for (const id of Object.keys(profiles))
    if (!quests.some(q => q.giver === id)) throw new Error(`任务点人物 ${id} 没有任务可托付。`);
  return { version: 2, network: network.id, rules: QUEST_RULES, npcs: people, quests };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const document = buildQuests();
  // Compact: 425 quests; the browser loads it with the city.
  const text = `${JSON.stringify(document)}\n`;
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
