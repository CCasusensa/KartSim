/**
 * The task-point NPCs of 卡丁城 (server-go/CITY-NPC.md): riders standing
 * at fixed spots on the pavement beside the spawn points and a few
 * landmarks, facing the street. Each NPC's spot is the nearest traffic lane
 * to its anchor, then out across the asphalt on the lane's right to the
 * kerb and `PAVEMENT` m further.
 *
 *   node tools/city/traffic/build-city-npcs.mjs
 *
 * writes design/open-world/vice-city/city-npcs.json and its browser copy
 * client/src/city/city-npcs.json (run after build-traffic-network.mjs).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CITIZENS } from "../npcs/citizens.data.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoadRaster } from "./road-raster.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PAVEMENT = 1.6;
/** An anchor further than this (m) from any lane stands by its spawn point instead. */
const FAR_FROM_TRAFFIC = 40;

/**
 * Who stands where: an anchor (a spawn point id or design x/z), the
 * character item (catalog.json: 1 宝宝, 2 皮蛋, 3 黑妞, 4 葱头, 5 胖墩, 6 蓝蓝,
 * 7 小强, 8 小乖, 9 海盗船长, 14 妮妮, 15 吉米, 16 神秘工头, 18 嘟嘟, 25 雯雯;
 * those with a story-mode sprite, for the quest dialogues), the rider dye (slot 70: 1 红 2 黄
 * 3 朱黄 4 绿 5 青绿 6 蓝 7 紫 8 黑 9 粉 10 白 11 海蓝), the name tag and what
 * they say when someone stops by.
 */
const NPCS = [
  { id: "guide-beach", dye: 4, anchor: "spawn-main", character: 2, name: "导游 · 皮蛋", lines: [
    "欢迎来到卡丁城！这里的车都是五星好市民，红灯停、绿灯行。",
    "沿着海滨一直开，就能逛遍整个海洋海滩。",
    "想换车、换角色？随时按 G 打开车库。",
  ] },
  { id: "warden-washington", dye: 9, anchor: "spawn-washington", character: 8, name: "交通协管员 · 小乖", lines: [
    "过路口记得看红绿灯，黄灯也要减速哦！",
    "城里的车都靠右行驶，你也要遵守交通规则。",
    "挡在车道上的话，后面的车会打着双闪慢慢绕过去。",
  ] },
  { id: "citizen-vicepoint", dye: 1, anchor: "spawn-vice-point", character: 1, name: "热心市民 · 宝宝", lines: [
    "罪恶角的海边风景最好了！",
    "开慢一点嘛，城里又不是赛道。",
  ] },
  { id: "shop-havana", dye: 7, anchor: "spawn-havana", character: 3, name: "店主 · 黑妞", lines: [
    "小哈瓦那的街道窄，转弯时看清楚再走。",
    "听说市中心的大路口都装了红绿灯。",
  ] },
  { id: "mechanic-haiti", dye: 3, anchor: "spawn-haiti", character: 5, name: "修车师傅 · 胖墩", lines: [
    "车开到奇怪的地方了？按 R 就能回到路上。",
    "丁字路口支路的车要先停一下，让主路的车先走。",
  ] },
  { id: "marshal-airport", dye: 6, anchor: "spawn-airport", character: 4, name: "机场引导员 · 葱头", lines: [
    "停机坪可不是赛道哦！",
    "去市区的话，沿着这条路往东开。",
  ] },
  { id: "police-downtown", dye: 11, anchor: [-1700, -1500], character: 15, name: "巡警 · 吉米", lines: [
    "市中心路口多，注意红绿灯！",
    "今天的交通很顺畅，大家都很守规矩。",
  ] },
  { id: "postman-starfish", dye: 5, anchor: [-1150, 120], character: 7, name: "邮差 · 小强", lines: [
    "海星岛的信件和包裹都要经过我的手。",
    "最近包裹多得堆成了山，正缺人手帮忙送货呢！",
  ] },
  { id: "kite-beach", dye: 2, anchor: [-694, 1310], character: 25, name: "风筝摊主 · 雯雯", lines: [
    "今天的海风正适合放风筝！",
    "要不要买一只龙形风筝？全城最漂亮的哦。",
    "皮蛋说他开车比我快？哼，走着瞧！",
  ] },
  { id: "captain-vicepoint", dye: 8, anchor: [-547, -1555], character: 9, name: "船坞老板 · 海盗船长", lines: [
    "哟嚯——欢迎来到罪恶角船坞！",
    "坐船从来不晕，坐卡丁车倒是晕得厉害……",
    "听说罪恶角埋着宝藏，嘿嘿嘿。",
  ] },
  { id: "foreman-downtown", dye: 10, anchor: [-1444, -953], character: 16, name: "工地主管 · 神秘工头", lines: [
    "施工重地，戴好安全帽！",
    "这栋楼啊……好像永远也盖不完。",
    "别问我叫什么，叫我工头就行。",
  ] },
  { id: "busdriver-havana", dye: 5, anchor: [-1472, 1201], character: 18, name: "校车司机 · 嘟嘟", lines: [
    "嘟嘟——校车要出发啦！",
    "开车要稳，乘客才会开心哦。",
    "小哈瓦那的孩子们都认识我的校车。",
  ] },
  { id: "florist-washington", dye: 6, anchor: [-428, 428], character: 6, name: "花店店主 · 蓝蓝", lines: [
    "今天的花开得真好～",
    "要不要带一束花送给朋友？",
    "我家小狗又溜出去玩了，真让人头疼。",
  ] },
];

const round = v => Math.round(v * 100) / 100;

export function lanes(network) {
  const out = [];
  for (const path of network.paths) {
    if (path.kind !== "lane") continue;
    const points = [];
    for (let i = 0; i < path.p.length; i += 3) points.push([path.p[i], path.p[i + 1], path.p[i + 2]]);
    out.push({ path, points });
  }
  return out;
}

/** The nearest lane point (with its direction) to (x, z). */
export function nearestLanePoint(list, x, z) {
  let best;
  for (const { path, points } of list) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
      const px = a[0] + dx * t, pz = a[1] + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) {
        const l = Math.sqrt(l2) || 1;
        let s = 0;
        for (let k = 1; k < i; k++) s += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
        best = { d, x: px, z: pz, y: a[2] + (b[2] - a[2]) * t, dx: dx / l, dz: dz / l, path, s: s + l * t };
      }
    }
  }
  return best;
}

/** Citizens stand on ground-level streets (lanes this high or lower, m) … */
const STREET_MAX_Y = 12.5;
/** … mid-block: at least this far (m) from a junction centre. */
const JUNCTION_CLEARANCE = 25;

function inPolygon([x, z], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Where the citizens (citizens.data.mjs) stand: in its district, the lane
 * point farthest from everyone already placed (farthest-point sampling, in
 * file order), so the same build always picks the same spots.
 */
export function citizenAnchors(map, network, taken) {
  const pools = new Map();
  for (const path of network.paths) {
    if (path.kind !== "lane") continue;
    for (let i = 0; i < path.p.length; i += 12) {
      const x = path.p[i], z = path.p[i + 1], y = path.p[i + 2];
      if (y > STREET_MAX_Y) continue;
      if (network.junctions.some(j => Math.hypot(j.x - x, j.z - z) < JUNCTION_CLEARANCE)) continue;
      const district = map.districts.find(d => inPolygon([x, z], d.polygon));
      if (!district) continue;
      if (!pools.has(district.name)) pools.set(district.name, []);
      pools.get(district.name).push([x, z]);
    }
  }
  const placed = [...taken];
  const anchors = new Map();
  for (const citizen of CITIZENS) {
    const pool = pools.get(citizen.district);
    if (!pool?.length) throw new Error(`城区 ${citizen.district} 没有可站的街道。`);
    let best, bestGap = -1;
    for (const point of pool) {
      const gap = Math.min(...placed.map(p => Math.hypot(p[0] - point[0], p[1] - point[1])));
      if (gap > bestGap) { bestGap = gap; best = point; }
    }
    anchors.set(citizen.id, best);
    placed.push(best);
  }
  return anchors;
}

export function buildNpcs() {
  const map = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/city-map.json"), "utf8"));
  const network = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/traffic-network.json"), "utf8"));
  const raster = loadRoadRaster(resolve(ROOT, "design/open-world/vice-city/assets/source-road-surfaces.json"), map.meta.extent);
  const list = lanes(network);
  const main = NPCS.map(npc => typeof npc.anchor === "string" ? map.pois.find(p => p.id === npc.anchor)?.at : npc.anchor);
  const anchors = citizenAnchors(map, network, main.filter(Boolean));
  const everyone = [...NPCS, ...CITIZENS.map(citizen => ({ id: citizen.id, dye: citizen.dye, character: citizen.character,
    name: `${citizen.role} · ${citizen.name}`, lines: citizen.lines, anchor: anchors.get(citizen.id) }))];
  const npcs = everyone.map(npc => {
    let anchor = npc.anchor, poi;
    if (typeof anchor === "string") {
      poi = map.pois.find(p => p.id === anchor);
      if (!poi) throw new Error(`没有出生点 ${anchor}`);
      anchor = poi.at;
    }
    const lane = nearestLanePoint(list, anchor[0], anchor[1]);
    if (lane.d > FAR_FROM_TRAFFIC && poi) {
      // No traffic here (the airport): beside the spawn point, facing it.
      const h = (poi.heading * Math.PI) / 180;
      const rx = Math.cos(h), rz = Math.sin(h);
      return { id: npc.id, name: npc.name, character: npc.character, dye: npc.dye, x: round(anchor[0] + rx * 5),
        z: round(anchor[1] + rz * 5), y: round(poi.y), heading: Math.round((poi.heading + 270) % 360), lines: npc.lines };
    }
    // Right of the lane, across the asphalt to the kerb, then onto the pavement.
    const rx = -lane.dz, rz = lane.dx;
    const reach = raster.reach(lane.x, lane.z, rx, rz, 30, 0.6);
    const out = reach + PAVEMENT;
    const x = lane.x + rx * out, z = lane.z + rz * out;
    // Facing the street (left of the lane's right side).
    const heading = ((Math.atan2(-rx, rz) * 180) / Math.PI + 360) % 360;
    return { id: npc.id, name: npc.name, character: npc.character, dye: npc.dye, x: round(x), z: round(z), y: round(lane.y),
      heading: Math.round(heading), lines: npc.lines };
  });
  return { version: 1, network: network.id, npcs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const document = buildNpcs();
  const text = `${JSON.stringify(document, null, 1)}\n`;
  for (const copy of ["design/open-world/vice-city/city-npcs.json", "client/src/city/city-npcs.json"]) {
    writeFileSync(resolve(ROOT, copy), text);
    console.log(`写入 ${copy}`);
  }
  for (const npc of document.npcs) console.log(npc.id, npc.x, npc.z, npc.heading);
}
