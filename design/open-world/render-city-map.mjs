#!/usr/bin/env node
// 把 city-map.data.mjs 画成 city-map.svg，并导出 city-map.json（建城脚本再补上
// 城区赛道路线与出生点）。
//   node design/open-world/render-city-map.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROADS, ROAD_TYPES, DISTRICTS, POIS, BOOST_PADS, COINS, RULES, districtPolygon, entranceAt, designJson } from "./city-map.data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif";
const KIND = {
  function: { color: "#2563eb", label: "功能点（打开界面/传送）" },
  social:   { color: "#db2777", label: "聊天热区" },
  fun:      { color: "#ea580c", label: "玩法点" },
  landmark: { color: "#475569", label: "地标" },
  spawn:    { color: "#16a34a", label: "出生点" },
};

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const pts = list => list.map(([x, z]) => `${x},${z}`).join(" ");
const length = (list, closed) => {
  let t = 0;
  for (let i = 1; i < list.length; i++) t += Math.hypot(list[i][0] - list[i - 1][0], list[i][1] - list[i - 1][1]);
  if (closed && list.length > 1) {
    const a = list[0], b = list[list.length - 1];
    t += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return Math.round(t);
};

const out = [];
const w = s => out.push(s);
w(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1300 -1380 2600 3100" width="1300" height="1550" font-family="${FONT}">`);
w(`<title>卡丁城 · 开放世界城市地图 v2</title>`);
w(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#16a34a"/></marker></defs>`);

// 底色与网格
w(`<rect x="-1300" y="-1380" width="2600" height="3100" fill="#fbfaf6"/>`);
w(`<rect x="-1200" y="-1200" width="2400" height="2400" fill="#eef1e6" stroke="#9ca3af" stroke-width="3"/>`);
for (let v = -1000; v <= 1000; v += 500) {
  w(`<line x1="${v}" y1="-1200" x2="${v}" y2="1200" stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="12 12"/>`);
  w(`<line x1="-1200" y1="${v}" x2="1200" y2="${v}" stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="12 12"/>`);
  w(`<text x="${v}" y="-1215" font-size="30" fill="#6b7280" text-anchor="middle">x=${v}</text>`);
  w(`<text x="-1215" y="${v + 10}" font-size="30" fill="#6b7280" text-anchor="end">z=${v}</text>`);
}

// 城区（官方赛道的路面范围）
const polygons = DISTRICTS.map(d => ({ ...d, polygon: districtPolygon(d) }));
for (const d of polygons) {
  w(`<polygon points="${pts(d.polygon)}" fill="${d.color}" fill-opacity="0.65" stroke="#9ca3af" stroke-width="3" stroke-dasharray="14 10"/>`);
}

// 道路（先画宽的底，再画路面）
const byType = ROADS.slice().sort((a, b) => ROAD_TYPES[b.type].width - ROAD_TYPES[a.type].width);
for (const r of byType) {
  const t = ROAD_TYPES[r.type];
  const shape = r.closed ? "polygon" : "polyline";
  w(`<${shape} points="${pts(r.points)}" fill="none" stroke="#f8fafc" stroke-width="${t.width + 8}" stroke-linejoin="round" stroke-linecap="round"/>`);
}
for (const r of byType) {
  const t = ROAD_TYPES[r.type];
  const shape = r.closed ? "polygon" : "polyline";
  w(`<${shape} points="${pts(r.points)}" fill="none" stroke="${t.color}" stroke-width="${t.width}" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (r.type === "expressway" || r.type === "avenue")
    w(`<${shape} points="${pts(r.points)}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="26 18" stroke-linejoin="round"/>`);
}
const roadLabel = (r, i, dx = 0, dz = 0, rot = 0) => {
  const [x, z] = r.points[i];
  w(`<text x="${x + dx}" y="${z + dz}" font-size="28" fill="#111827" font-weight="bold" transform="rotate(${rot} ${x + dx} ${z + dz})" paint-order="stroke" stroke="#ffffff" stroke-width="6">${esc(r.name)}</text>`);
};
const R = Object.fromEntries(ROADS.map(r => [r.id, r]));
roadLabel(R.ring, 0, -440, 60);
roadLabel(R["ave-n"], 0, 16, 300, 90);
roadLabel(R["ave-s"], 1, 16, -300, 90);
roadLabel(R["ave-w"], 0, 300, -18);
roadLabel(R["ave-e"], 1, -500, -18);
roadLabel(R["st-north"], 1, 20, -16);
roadLabel(R["st-homes"], 0, 16, -120, 90);
roadLabel(R["st-forest"], 0, 16, 160, 90);
roadLabel(R["st-funpark"], 0, 16, -60, 90);

// 城区名、赛道、入口
for (const d of polygons) {
  const xs = d.polygon.map(p => p[0]), zs = d.polygon.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const dz = d.id === "plaza" ? -120 : 0;
  w(`<text x="${cx}" y="${cz + dz}" font-size="${d.id === "plaza" ? 40 : 54}" font-weight="bold" fill="#1f2937" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="10" opacity="0.95">${esc(d.name)}</text>`);
  w(`<text x="${cx}" y="${cz + dz + 40}" font-size="26" fill="#4b5563" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="6">官方赛道 ${esc(d.track)}</text>`);
  for (const e of d.entrances) {
    const [x, z] = entranceAt(d, e);
    w(`<rect x="${x - 16}" y="${z - 16}" width="32" height="32" fill="#7c3aed" stroke="#ffffff" stroke-width="3" transform="rotate(45 ${x} ${z})"/>`);
  }
}

// 兴趣点
const numbered = POIS.map((p, i) => ({ ...p, n: i + 1 }));
for (const p of numbered) {
  const [x, z] = p.at;
  const c = KIND[p.kind].color;
  if (p.kind === "spawn") {
    const a = ((p.heading ?? 0) - 90) * Math.PI / 180;
    w(`<line x1="${x}" y1="${z}" x2="${x + 50 * Math.cos(a)}" y2="${z + 50 * Math.sin(a)}" stroke="#16a34a" stroke-width="6" marker-end="url(#arrow)"/>`);
  }
  w(`<circle cx="${x}" cy="${z}" r="22" fill="${c}" stroke="#ffffff" stroke-width="4"/>`);
  w(`<text x="${x}" y="${z + 8}" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${p.n}</text>`);
}

// 标题、指北针、比例尺
w(`<text x="-1200" y="-1250" font-size="64" font-weight="bold" fill="#111827">卡丁城 · 开放世界城市地图 v2</text>`);
w(`<text x="420" y="-1250" font-size="30" fill="#4b5563">2.4 km × 2.4 km · 原点 = 广场中心 · x 向东 z 向南 · 单位：米</text>`);
w(`<g transform="translate(1120,-1120)"><circle r="60" fill="#ffffff" stroke="#374151" stroke-width="3"/><path d="M0 -48 L16 10 L0 0 L-16 10 z" fill="#dc2626"/><text y="-62" font-size="30" text-anchor="middle" fill="#111827" font-weight="bold">北</text></g>`);
w(`<g transform="translate(700,1240)"><rect width="500" height="16" fill="#111827"/><rect x="250" width="250" height="16" fill="#ffffff" stroke="#111827" stroke-width="2"/><text y="46" font-size="28" fill="#111827">0</text><text x="250" y="46" font-size="28" fill="#111827" text-anchor="middle">250</text><text x="500" y="46" font-size="28" fill="#111827" text-anchor="end">500 m</text></g>`);

// 图例
let ly = 1330;
w(`<text x="-1200" y="${ly}" font-size="40" font-weight="bold" fill="#111827">图例</text>`);
ly += 50;
let lx = -1200;
for (const [, t] of Object.entries(ROAD_TYPES)) {
  w(`<line x1="${lx}" y1="${ly}" x2="${lx + 90}" y2="${ly}" stroke="${t.color}" stroke-width="${Math.max(8, t.width)}" stroke-linecap="round"/>`);
  w(`<text x="${lx + 104}" y="${ly + 10}" font-size="28" fill="#111827">${t.label} ${t.width} m</text>`);
  lx += 560;
}
ly += 60; lx = -1200;
for (const [, k] of Object.entries(KIND)) {
  w(`<circle cx="${lx + 20}" cy="${ly}" r="18" fill="${k.color}" stroke="#ffffff" stroke-width="3"/>`);
  w(`<text x="${lx + 52}" y="${ly + 10}" font-size="28" fill="#111827">${k.label}</text>`);
  lx += 420;
}
w(`<rect x="${lx + 6}" y="${ly - 14}" width="28" height="28" fill="#7c3aed" stroke="#ffffff" stroke-width="3" transform="rotate(45 ${lx + 20} ${ly})"/>`);
w(`<text x="${lx + 52}" y="${ly + 10}" font-size="28" fill="#111827">城区入口（围栏裁开处）</text>`);
ly += 60;
const cols = 3, colW = 820;
numbered.forEach((p, i) => {
  const x = -1200 + (i % cols) * colW, y = ly + Math.floor(i / cols) * 40;
  w(`<circle cx="${x + 14}" cy="${y - 9}" r="13" fill="${KIND[p.kind].color}"/>`);
  w(`<text x="${x + 36}" y="${y}" font-size="26" fill="#111827">${p.n}. ${esc(p.name)} (${p.at[0]}, ${p.at[1]})</text>`);
});
w(`</svg>`);
writeFileSync(path.join(here, "city-map.svg"), out.join("\n"));

const json = designJson();
writeFileSync(path.join(here, "city-map.json"), JSON.stringify(json, null, 2) + "\n");
const total = json.roads.reduce((a, r) => a + r.lengthM, 0);
console.log(`roads ${json.roads.length}, total ${total} m; ring ${json.roads[0].lengthM} m; pois ${numbered.length}; districts ${DISTRICTS.length}`);
