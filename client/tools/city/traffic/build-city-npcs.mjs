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
 * 7 小强, 8 小乖, 12 R博士, 14 妮妮, 15 吉米), the rider dye (slot 70: 1 红 2 黄
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
  { id: "doctor-starfish", dye: 10, anchor: [-1150, 120], character: 12, name: "R博士", lines: [
    "这些车可都是我调教出来的好司机。",
    "它们会停车让你先过，可别欺负它们。",
  ] },
];

const round = v => Math.round(v * 100) / 100;

function lanes(network) {
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
function nearestLanePoint(list, x, z) {
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
        best = { d, x: px, z: pz, y: a[2] + (b[2] - a[2]) * t, dx: dx / l, dz: dz / l, path };
      }
    }
  }
  return best;
}

export function buildNpcs() {
  const map = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/city-map.json"), "utf8"));
  const network = JSON.parse(readFileSync(resolve(ROOT, "design/open-world/vice-city/traffic-network.json"), "utf8"));
  const raster = loadRoadRaster(resolve(ROOT, "design/open-world/vice-city/assets/source-road-surfaces.json"), map.meta.extent);
  const list = lanes(network);
  const npcs = NPCS.map(npc => {
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
