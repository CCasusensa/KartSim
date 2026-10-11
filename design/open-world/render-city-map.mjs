#!/usr/bin/env node
// 把 city-map.data.mjs 画成 city-map.svg，并导出 city-map.json。
//   node design/open-world/render-city-map.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROADS, ROAD_TYPES, WATER, DISTRICTS, POIS, BOOST_PADS, COINS, RULES } from "./city-map.data.mjs";

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
w(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1300 -1380 2600 3440" width="1300" height="1720" font-family="${FONT}">`);
w(`<title>卡丁城 · 开放世界城市地图</title>`);
w(`<defs>
  <pattern id="mountain" width="60" height="60" patternUnits="userSpaceOnUse">
    <path d="M0 50 L15 20 L30 50 M30 50 L45 25 L60 50" fill="none" stroke="#94a3b8" stroke-width="3"/>
  </pattern>
  <pattern id="trees" width="50" height="50" patternUnits="userSpaceOnUse">
    <circle cx="12" cy="12" r="7" fill="#86efac"/><circle cx="37" cy="33" r="6" fill="#4ade80"/>
  </pattern>
  <pattern id="waves" width="80" height="40" patternUnits="userSpaceOnUse">
    <path d="M0 20 Q20 5 40 20 T80 20" fill="none" stroke="#60a5fa" stroke-width="3"/>
  </pattern>
  <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="#16a34a"/>
  </marker>
</defs>`);

// 底色与网格
w(`<rect x="-1300" y="-1380" width="2600" height="3440" fill="#fbfaf6"/>`);
w(`<rect x="-1200" y="-1200" width="2400" height="2400" fill="#eef1e6" stroke="#9ca3af" stroke-width="3"/>`);
for (let v = -1000; v <= 1000; v += 500) {
  w(`<line x1="${v}" y1="-1200" x2="${v}" y2="1200" stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="12 12"/>`);
  w(`<line x1="-1200" y1="${v}" x2="1200" y2="${v}" stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="12 12"/>`);
  w(`<text x="${v}" y="-1215" font-size="30" fill="#6b7280" text-anchor="middle">x=${v}</text>`);
  w(`<text x="-1215" y="${v + 10}" font-size="30" fill="#6b7280" text-anchor="end">z=${v}</text>`);
}

// 分区
for (const d of DISTRICTS) {
  const fill = d.id === "mountain" ? "url(#mountain)" : d.id === "forest" ? "url(#trees)" : d.color;
  if (d.circle) {
    const [cx, cz, r] = d.circle;
    w(`<circle cx="${cx}" cy="${cz}" r="${r}" fill="${d.color}" fill-opacity="0.8" stroke="#a16207" stroke-width="3" stroke-dasharray="14 10"/>`);
  } else {
    w(`<polygon points="${pts(d.polygon)}" fill="${d.id === "mountain" ? "#e2e8f0" : d.color}" fill-opacity="0.55" stroke="#9ca3af" stroke-width="3" stroke-dasharray="14 10"/>`);
    if (fill.startsWith("url")) w(`<polygon points="${pts(d.polygon)}" fill="${fill}" fill-opacity="0.6"/>`);
  }
}

// 水体
w(`<polygon points="${pts(WATER.sea.polygon)}" fill="#bfdbfe"/>`);
w(`<polygon points="${pts(WATER.sea.polygon)}" fill="url(#waves)" fill-opacity="0.7"/>`);
w(`<polyline points="${pts(WATER.river.points)}" fill="none" stroke="#bfdbfe" stroke-width="${WATER.river.width}" stroke-linejoin="round" stroke-linecap="round"/>`);
w(`<polyline points="${pts(WATER.river.points)}" fill="none" stroke="#60a5fa" stroke-width="3" stroke-dasharray="20 14" stroke-linejoin="round"/>`);
w(`<circle cx="${WATER.lake.center[0]}" cy="${WATER.lake.center[1]}" r="${WATER.lake.radius}" fill="#bfdbfe" stroke="#60a5fa" stroke-width="3"/>`);
w(`<circle cx="${WATER.lake.center[0]}" cy="${WATER.lake.center[1]}" r="26" fill="#86efac" stroke="#15803d" stroke-width="2"/>`);
w(`<text x="1050" y="1080" font-size="54" fill="#1d4ed8" font-weight="bold" transform="rotate(-45 1050 1080)">${WATER.sea.name}</text>`);
w(`<text x="-470" y="-700" font-size="36" fill="#1d4ed8" transform="rotate(-80 -470 -700)">${WATER.river.name}</text>`);

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
  const dash = r.type === "tunnel" ? ` stroke-dasharray="24 14"` : "";
  w(`<${shape} points="${pts(r.points)}" fill="none" stroke="${t.color}" stroke-width="${t.width}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
  if (r.type === "expressway" || r.type === "avenue")
    w(`<${shape} points="${pts(r.points)}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="26 18" stroke-linejoin="round"/>`);
  if (r.type === "circuit")
    w(`<${shape} points="${pts(r.points)}" fill="none" stroke="#f5f3ff" stroke-width="2" stroke-dasharray="10 10"/>`);
}

// 道路名
const roadLabel = (r, i, dx = 0, dz = 0, rot = 0) => {
  const [x, z] = r.points[i];
  w(`<text x="${x + dx}" y="${z + dz}" font-size="28" fill="#111827" font-weight="bold" transform="rotate(${rot} ${x + dx} ${z + dz})" paint-order="stroke" stroke="#ffffff" stroke-width="6">${esc(r.name)}</text>`);
};
const R = Object.fromEntries(ROADS.map(r => [r.id, r]));
roadLabel(R.ring, 0, -440, 60);
roadLabel(R.loop2, 0, 40, 36);
roadLabel(R["ave-ns"], 0, 16, 300, 90);
roadLabel(R["ave-ew"], 0, 1300, -18);
roadLabel(R["diag-ne"], 1, 20, -40, -45);
roadLabel(R["diag-sw"], 1, 20, 40, -45);
roadLabel(R["biz-v1"], 0, 16, 180, 90);
roadLabel(R["biz-h1"], 0, 20, -14);
roadLabel(R["biz-h2"], 0, 20, -14);
roadLabel(R["old-loop"], 1, -40, -30);
roadLabel(R.coast, 4, 30, 0, 60);
roadLabel(R["ind-loop"], 3, -16, -40, -90);
roadLabel(R.circuit, 2, 16, 0, 90);
roadLabel(R["forest-loop"], 2, -60, -14);
roadLabel(R["home-h1"], 0, 0, -14);
roadLabel(R["park-loop"], 1, -40, -14);
roadLabel(R.mountain, 1, -110, 0);
roadLabel(R.tunnel, 2, 24, -12, -45);

// 分区名
for (const d of DISTRICTS) {
  let cx, cz;
  if (d.circle) [cx, cz] = d.circle;
  else {
    const xs = d.polygon.map(p => p[0]), zs = d.polygon.map(p => p[1]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2; cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  }
  const dz = d.id === "plaza" ? 150 : d.id === "harbor" ? -120 : d.id === "racepark" ? 80 : d.id === "mountain" ? -80 : d.id === "neon" ? -280 : d.id === "funpark" ? 140 : -140;
  const dx = d.id === "racepark" ? -40 : d.id === "harbor" ? -60 : d.id === "mountain" ? -40 : d.id === "neon" ? -100 : d.id === "funpark" ? -20 : 0;
  w(`<text x="${cx + dx}" y="${cz + dz}" font-size="${d.id === "plaza" ? 44 : 54}" font-weight="bold" fill="#1f2937" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="10" opacity="0.95">${esc(d.name)}</text>`);
  w(`<text x="${cx + dx}" y="${cz + dz + 40}" font-size="26" fill="#4b5563" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="6">主题素材：${esc(d.theme)}</text>`);
}

// 加速带与金币
for (const [x, z] of BOOST_PADS) {
  w(`<polygon points="${x - 14},${z + 12} ${x},${z - 12} ${x + 14},${z + 12}" fill="#f97316" stroke="#7c2d12" stroke-width="2"/>`);
}
for (const [x, z] of COINS) w(`<circle cx="${x}" cy="${z}" r="9" fill="#facc15" stroke="#a16207" stroke-width="2"/>`);

// 兴趣点
const numbered = POIS.map((p, i) => ({ ...p, n: i + 1 }));
for (const p of numbered) {
  const [x, z] = p.at;
  const c = KIND[p.kind].color;
  if (p.kind === "spawn") {
    const a = ((p.heading ?? 0) - 90) * Math.PI / 180;
    const ex = x + 50 * Math.cos(a), ez = z + 50 * Math.sin(a);
    w(`<line x1="${x}" y1="${z}" x2="${ex}" y2="${ez}" stroke="#16a34a" stroke-width="6" marker-end="url(#arrow)"/>`);
  }
  w(`<circle cx="${x}" cy="${z}" r="22" fill="${c}" stroke="#ffffff" stroke-width="4"/>`);
  w(`<text x="${x}" y="${z + 8}" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${p.n}</text>`);
  const dx = p.labelDx ?? 30, dz = p.labelDz ?? 9;
  w(`<text x="${x + dx}" y="${z + dz}" font-size="26" fill="#111827" paint-order="stroke" stroke="#ffffff" stroke-width="6">${esc(p.name)}</text>`);
}

// 标题、指北针、比例尺
w(`<text x="-1200" y="-1250" font-size="64" font-weight="bold" fill="#111827">卡丁城 · 开放世界城市地图</text>`);
w(`<text x="420" y="-1250" font-size="30" fill="#4b5563">2.4 km × 2.4 km · 原点 = 中央喷泉 · x 向东 z 向南 · 单位：米</text>`);
w(`<g transform="translate(1120,-1120)"><circle r="60" fill="#ffffff" stroke="#374151" stroke-width="3"/><path d="M0 -48 L16 10 L0 0 L-16 10 z" fill="#dc2626"/><text y="-62" font-size="30" text-anchor="middle" fill="#111827" font-weight="bold">北</text></g>`);
w(`<g transform="translate(700,1240)"><rect width="500" height="16" fill="#111827"/><rect x="250" width="250" height="16" fill="#ffffff" stroke="#111827" stroke-width="2"/><text y="46" font-size="28" fill="#111827">0</text><text x="250" y="46" font-size="28" fill="#111827" text-anchor="middle">250</text><text x="500" y="46" font-size="28" fill="#111827" text-anchor="end">500 m</text></g>`);

// 图例
let ly = 1330;
w(`<text x="-1200" y="${ly}" font-size="40" font-weight="bold" fill="#111827">图例</text>`);
ly += 50;
let lx = -1200;
for (const [id, t] of Object.entries(ROAD_TYPES)) {
  const dash = id === "tunnel" ? ` stroke-dasharray="16 10"` : "";
  w(`<line x1="${lx}" y1="${ly}" x2="${lx + 90}" y2="${ly}" stroke="${t.color}" stroke-width="${Math.max(8, t.width)}" stroke-linecap="round"${dash}/>`);
  w(`<text x="${lx + 104}" y="${ly + 10}" font-size="28" fill="#111827">${t.label} ${t.width} m</text>`);
  lx += 420;
}
ly += 60; lx = -1200;
for (const [kind, k] of Object.entries(KIND)) {
  w(`<circle cx="${lx + 20}" cy="${ly}" r="18" fill="${k.color}" stroke="#ffffff" stroke-width="3"/>`);
  w(`<text x="${lx + 52}" y="${ly + 10}" font-size="28" fill="#111827">${k.label}</text>`);
  lx += 420;
}
w(`<polygon points="${lx - 14 + 20},${ly + 12} ${lx + 20},${ly - 12} ${lx + 34},${ly + 12}" fill="#f97316" stroke="#7c2d12" stroke-width="2"/>`);
w(`<text x="${lx + 52}" y="${ly + 10}" font-size="28" fill="#111827">加速带</text>`);
w(`<circle cx="${lx + 200}" cy="${ly}" r="9" fill="#facc15" stroke="#a16207" stroke-width="2"/>`);
w(`<text x="${lx + 222}" y="${ly + 10}" font-size="28" fill="#111827">隐藏金币</text>`);
ly += 60;
const cols = 3, colW = 820;
numbered.forEach((p, i) => {
  const x = -1200 + (i % cols) * colW, y = ly + Math.floor(i / cols) * 40;
  w(`<circle cx="${x + 14}" cy="${y - 9}" r="13" fill="${KIND[p.kind].color}"/>`);
  w(`<text x="${x + 36}" y="${y}" font-size="26" fill="#111827">${p.n}. ${esc(p.name)} (${p.at[0]}, ${p.at[1]})</text>`);
});
w(`</svg>`);
writeFileSync(path.join(here, "city-map.svg"), out.join("\n"));

const json = {
  meta: { name: "卡丁城", extent: [[-1200, -1200], [1200, 1200]], units: "world meters", origin: "中央喷泉", axes: "x 东, z 南, y 上" },
  roadTypes: ROAD_TYPES,
  roads: ROADS.map(r => ({ ...r, lengthM: length(r.points, r.closed) })),
  water: WATER,
  districts: DISTRICTS,
  pois: numbered,
  boostPads: BOOST_PADS,
  coins: COINS,
  rules: RULES,
};
writeFileSync(path.join(here, "city-map.json"), JSON.stringify(json, null, 2) + "\n");
const total = json.roads.reduce((a, r) => a + r.lengthM, 0);
console.log(`roads ${json.roads.length}, total ${total} m; ring ${json.roads[0].lengthM} m; pois ${numbered.length}; districts ${DISTRICTS.length}`);
