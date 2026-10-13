#!/usr/bin/env node
// 喜羊羊赛道重建：p3553 没有 track_xyy_I01/R01/R02.rho（赛道表、计时赛
// 评级、AI 线、theme_xyy 贴图和 BGM 都在，只缺赛道模型）。这里按原版 7 条
// AI 线还原走向、路宽和高低，路面和路边用 theme_xyy 的原版贴图，景物用
// Tripo 摆件（tools/xyy/assets.mjs），生成与官方同格式的赛道包：
// track.1s（场景、路线门含岔路 <branch>、道具箱、小地图、赛道设置）、
// skydome.1s（forest_I01 的天空盒，贴图名 skydome_F 由 theme_xyy 提供）、
// track.xml、xt_minimap / xt_bigmap / xt_trackCard / xt_trackThumb。
//
//   cd client && node --import tsx tools/xyy/build.mjs [--only xyy_I01,xyy_R01]
//     [--out build/xyy] [--mirror CHECKOUT] [--register --register-into CHECKOUT]
//     [--cards DIR]   （DIR/<id>_card.png、<id>_thumb.png：游戏里截的预览图）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadResourceLibrary } from "../economy-export/resource-library.mjs";
import { packRhoArchive } from "../../src/codecs/rho-writer.ts";
import { RgbaCanvas } from "../../src/mapeditor/png.ts";
import { pointAtDistance, rotateClosedSample, roadEdge, sampleRoad } from "../../src/mapeditor/road-geometry.ts";
import { encodeTrackModel, makeNode, makeTrackContainer, makeXml } from "../../src/resources/track-binary-writer.ts";
import { decodeKap, estimateCenterline, extractBranches, smoothClosed, splitLaps } from "./ai-path.mjs";
import { ASSETS, REUSED, assetFile } from "./assets.mjs";
import { buildCourse } from "./route.mjs";
import { Scene, prepareProp } from "./scene.mjs";
import { BILLBOARDS, TRACKS } from "./tracks.mjs";
import { XYY_TRACK_OFFSETS } from "../../src/resources/xyy-tracks.ts";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = path.resolve(clientDir, "..");

// ---------------------------------------------------------------------------
// 小工具

/** 确定性的伪随机数（同一张图每次生成一样）。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smoothstep = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (random, list) => list[Math.floor(random() * list.length) % list.length];
const hash = text => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** 所有道路采样点的空间索引：最近点的距离、路面高度、半宽。 */
class RoadIndex {
  constructor(roads, cell = 20) {
    this.cell = cell;
    this.grid = new Map();
    roads.forEach((road, r) => road.sample.points.forEach((p, i) => {
      const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, list = []);
      list.push({ p, hw: road.sample.widths[i] / 2, road: r, i });
    }));
  }
  /** 半径 radius 内最近的采样点（按「离路边」的距离 d - hw 排序）。 */
  nearest(x, y, radius = 120) {
    const r = Math.ceil(radius / this.cell), cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best;
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gy = cy - r; gy <= cy + r; gy++) {
      const list = this.grid.get(`${gx},${gy}`);
      if (!list) continue;
      for (const item of list) {
        const d = Math.hypot(item.p[0] - x, item.p[1] - y);
        const edge = d - item.hw;
        if (!best || edge < best.edge) best = { ...item, d, edge };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// 1. 原版 AI 线 → 路网

async function aiLaps(library, id) {
  const files = library.files.filter(f => new RegExp(`aiPath/${id}_\\d+\\.kap$`, "i").test(f.virtualPath))
    .sort((a, b) => a.virtualPath.localeCompare(b.virtualPath, "en", { numeric: true }));
  if (!files.length) throw new Error(`${id}：track_common 里没有 AI 线。`);
  const laps = [];
  let start;
  for (const file of files) {
    const split = splitLaps(decodeKap(await file.bytes()));
    laps.push(...split.laps);
    start ??= split.start;
  }
  return { laps, start, files: files.length };
}

/** 车身中心到路面边缘至少留的距离（车宽一半 + 路面贴图两侧的草边）。 */
const AI_EDGE = 4;

/**
 * 原版每条 AI 线都要落在路面上：逐个采样点统计所有 AI 线的横向范围，
 * 哪一侧跑出了路面（比如 R01 底部发卡弯外甩 17 米的线），就把那一侧
 * 扩出去。中线随之横移、宽度加大，路面仍是对称的一条带子。走岔路的点
 * 不算（它们在岔路上）。
 */
function widenToAiLines(sample, laps, branches, maxWiden) {
  const m = sample.points.length;
  const cell = 20, grid = new Map();
  sample.points.forEach((p, i) => {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)).push(i);
  });
  const nearest = p => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    let best = -1, bd = Infinity;
    for (let gx = cx - 3; gx <= cx + 3; gx++) for (let gy = cy - 3; gy <= cy + 3; gy++)
      for (const i of grid.get(`${gx},${gy}`) ?? []) {
        const d = Math.hypot(sample.points[i][0] - p[0], sample.points[i][1] - p[1]);
        if (d < bd) { bd = d; best = i; }
      }
    return best;
  };
  const onBranch = p => branches.some(b => b.points.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < b.width / 2 + 6));
  const left = new Array(m).fill(-Infinity), right = new Array(m).fill(Infinity);
  for (const lap of laps) for (const p of lap) {
    const i = nearest(p);
    if (i < 0) continue;
    const q = sample.points[i], l = sample.lefts[i];
    const lateral = (p[0] - q[0]) * l[0] + (p[1] - q[1]) * l[1];
    if (Math.abs(lateral) > sample.widths[i] / 2 + maxWiden + 10 || onBranch(p)) continue;
    left[i] = Math.max(left[i], lateral);
    right[i] = Math.min(right[i], lateral);
  }
  const ring = i => ((i % m) + m) % m;
  const side = values => {
    // 先取邻近 8 米内的最大值再平滑，扩宽的地方过渡自然
    const peak = values.map((_, i) => Math.max(...[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(d => values[ring(i + d)])));
    return smoothClosed(peak, 10);
  };
  const halfLeft = side(sample.widths.map((w, i) => Math.min(w / 2 + maxWiden, Math.max(w / 2, left[i] + AI_EDGE))));
  const halfRight = side(sample.widths.map((w, i) => Math.min(w / 2 + maxWiden, Math.max(w / 2, -right[i] + AI_EDGE))));
  const control = [];
  for (let i = 0; i < m; i += 6) {
    const shiftBy = (halfLeft[i] - halfRight[i]) / 2;
    const p = sample.points[i], l = sample.lefts[i];
    control.push({ x: p[0] + l[0] * shiftBy, y: p[1] + l[1] * shiftBy, z: p[2], width: halfLeft[i] + halfRight[i] });
  }
  return sampleRoad({ points: control, closed: true, width: 24 }, 2);
}

function roadNetwork(config, laps, start) {
  const center = estimateCenterline(laps, { reference: 1, ...config.centerline });
  const branches = config.branches ? extractBranches(center, laps) : [];
  // 平移到正象限：游戏只收录 [0, 2000) 里的碰撞面
  let minX = Infinity, minY = Infinity;
  center.points.forEach((p, i) => { minX = Math.min(minX, p[0] - center.widths[i]); minY = Math.min(minY, p[1] - center.widths[i]); });
  for (const b of branches) for (const p of b.points) { minX = Math.min(minX, p[0] - b.width); minY = Math.min(minY, p[1] - b.width); }
  const offset = [Math.max(0, Math.ceil((120 - minX) / 10) * 10), Math.max(0, Math.ceil((120 - minY) / 10) * 10), 0];
  const declared = XYY_TRACK_OFFSETS[config.id];
  if (!declared || declared[0] !== offset[0] || declared[1] !== offset[1])
    throw new Error(`${config.id}：平移量 ${offset.slice(0, 2)} 与 src/resources/xyy-tracks.ts 的 ${declared} 不符，请同步。`);
  const shift = p => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];

  // 主路：每 3 个中线点一个控制点（12 米），宽度逐点
  const control = center.points.filter((_, i) => i % 3 === 0).map((p, k) => {
    const q = shift(p);
    return { x: q[0], y: q[1], z: q[2], width: center.widths[k * 3] };
  });
  let main = widenToAiLines(sampleRoad({ points: control, closed: true, width: 24 }, 2), laps.map(lap => lap.map(shift)),
    branches.map(b => ({ points: b.points.map(shift), width: b.width })), config.centerline?.maxWiden ?? 30);
  // 起点：原版 AI 发车位在主路上的投影
  const s0 = shift(start);
  let bestI = 0, bestD = Infinity;
  main.points.forEach((p, i) => { const d = Math.hypot(p[0] - s0[0], p[1] - s0[1]); if (d < bestD) { bestD = d; bestI = i; } });
  main = rotateClosedSample(main, main.s[bestI]);

  const nearestS = p => {
    let bi = 0, bd = Infinity;
    main.points.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bi = i; } });
    return main.s[bi];
  };
  const branchRoads = branches.map(b => {
    const pts = b.points.map(shift);
    const sample = sampleRoad({ points: pts.map(p => ({ x: p[0], y: p[1], z: p[2] })), closed: false, width: b.width }, 2);
    return { sample, fromS: nearestS(pts[0]), toS: nearestS(pts[pts.length - 1]), width: b.width, side: b.side };
  });
  return { center, main, branches: branchRoads, offset, start: s0 };
}

// ---------------------------------------------------------------------------
// 2. 场景

const ROAD_TILE = 13;
const VERGE = 5;
const FENCE_OFFSET = 2.5;

function buildRoads(scene, net) {
  const road = scene.surface("road", "C_road00", { road: [] });
  const startStrip = scene.surface("road_start", "C_roadstart_B01", { road: [] });
  const branchSurface = scene.surface("road_branch", "C_road01", { road: [] });
  const ribbon = (sample, surfaceFor, skip = () => false, lift = 0) => {
    const m = sample.points.length;
    const count = sample.closed ? m : m - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % m;
      if (skip(i) && skip(j)) continue;
      const s0 = sample.s[i], s1 = sample.closed && j === 0 ? sample.total : sample.s[j];
      const surface = surfaceFor(s0, s1);
      const wi = sample.widths[i] / 2, wj = sample.widths[j] / 2;
      const v0 = surface.id === "road_start" ? (s0 + 4) / 8 : s0 / ROAD_TILE, v1 = surface.id === "road_start" ? (s1 + 4) / 8 : s1 / ROAD_TILE;
      const up = p => [p[0], p[1], p[2] + lift];
      const a = up(roadEdge(sample, i, wi)), b = up(roadEdge(sample, i, -wi)), c = up(roadEdge(sample, j, -wj)), d = up(roadEdge(sample, j, wj));
      scene.mesh(surface, sample.points[i][0], sample.points[i][1]).pushSmoothQuad(
        [[a, [0, v0]], [b, [1, v0]], [c, [1, v1]], [d, [0, v1]]],
        [sample.normals[i], sample.normals[i], sample.normals[j], sample.normals[j]], sample.normals[i]);
    }
  };
  const L = net.main.total;
  // 起点线：s ∈ [-4, 4] 用格子路面
  ribbon(net.main, (s0, s1) => (s0 < 4 || s1 > L - 4) && !(s0 >= 4 && s1 <= L - 4) ? startStrip : road);
  // 岔路：和主路重叠的部分不画，抬高 3 厘米防止交界闪烁
  const mainIndex = new RoadIndex([{ sample: net.main }]);
  for (const branch of net.branches) {
    const inside = i => { const n = mainIndex.nearest(branch.sample.points[i][0], branch.sample.points[i][1], 60); return n && n.d < n.hw - 1; };
    ribbon(branch.sample, () => branchSurface, inside, 0.03);
  }
}

/** 点是否在闭合折线围成的区域里（射线法）。 */
function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * 地形：路面下 0.3 米，向外 45 米过渡到起伏的草地；赛道围起来的里面
 * 保持平缓（羊村在里面，要从路上看得见），外圈远处才是小山。
 */
function terrainHeight(index, baseZ, x, y, loop) {
  const near = index.nearest(x, y, 140);
  const enclosed = loop && insidePolygon(loop, x, y);
  const hills = (d) => (enclosed ? 0 : smoothstep((d - 90) / 260) * 30) + Math.sin(x * 0.011 + y * 0.004) * (enclosed ? 1 : 2.5) + Math.cos(y * 0.013 - x * 0.006) * (enclosed ? 0.8 : 2);
  if (!near) return baseZ + hills(400);
  const roadZ = near.p[2] - 0.3;
  const edge = near.d - near.hw;
  if (edge < VERGE) return roadZ;
  const t = smoothstep((edge - VERGE) / 45);
  return lerp(roadZ, baseZ + hills(edge), t);
}

function buildTerrain(scene, index, net, bounds, baseZ, loop) {
  const cell = 10;
  const grass = scene.surface("grass", "C_tilegrass00", { road: [["surface", "DF4.0"], ["sound", "수풀바닥"]] });
  const far = scene.surface("grass_far", "C_tilegrass00", {});
  const [x0, y0] = bounds.min, [x1, y1] = bounds.max;
  const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
  const heights = [], edges = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell, y = y0 + j * cell;
    heights.push(terrainHeight(index, baseZ, x, y, loop));
    const n = index.nearest(x, y, 140);
    edges.push(n ? n.edge : 999);
  }
  const at = (i, j) => j * (nx + 1) + i;
  const tile = 12;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ids = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    const e = ids.map(k => edges[k]);
    if (Math.max(...e) < -2) continue; // 完全在路面下
    const p = ids.map((k, c) => [x0 + (i + (c === 1 || c === 2 ? 1 : 0)) * cell, y0 + (j + (c >= 2 ? 1 : 0)) * cell, heights[k]]);
    // 碰撞面只到路边 70 米内，正坐标里（游戏只收录 [0, 2000)）
    const collidable = Math.min(...e) < 70 && p.every(q => q[0] >= 0 && q[1] >= 0);
    const surface = collidable ? grass : far;
    const uv = q => [q[0] / tile, -q[1] / tile];
    scene.mesh(surface, p[0][0], p[0][1]).pushQuad([p[0], uv(p[0])], [p[1], uv(p[1])], [p[2], uv(p[2])], [p[3], uv(p[3])], [0, 0, 1]);
  }
}

const FENCES = {
  hedge: [{ texture: "C_fencetree00", height: 2.4, aspect: 2 }, { texture: "C_fencetree01", height: 2.4, aspect: 2 }],
  wood: [{ texture: "C_fence_B", height: 1.4, aspect: 4 }],
  flowers: [{ texture: "C_fencetree00", height: 2.0, aspect: 2 }],
  chevron: [{ texture: "F_fence08", height: 1.3, aspect: 2, opaque: true }],
  castle: [{ texture: "C_side_00", height: 5, aspect: 1, opaque: true }],
};

/** 每条路两侧的护栏（可碰撞），岔口和别的路面上的点跳过。 */
function buildFences(scene, config, net, index) {
  const roads = [{ sample: net.main, main: true }, ...net.branches.map(b => ({ sample: b.sample }))];
  const inCastle = p => config.castle && p[0] >= config.castle.min[0] + net.offset[0] && p[0] <= config.castle.max[0] + net.offset[0] && p[1] >= config.castle.min[1] + net.offset[1] && p[1] <= config.castle.max[1] + net.offset[1];
  const placedFlowers = [];
  roads.forEach((road, r) => {
    const sample = road.sample;
    const m = sample.points.length;
    // 弯道：前后 30 米的航向变化
    const heading = i => Math.atan2(sample.tangents[i][1], sample.tangents[i][0]);
    const turn = i => {
      const a = sample.closed ? (i - 15 + m) % m : Math.max(0, i - 15), b = sample.closed ? (i + 15) % m : Math.min(m - 1, i + 15);
      let d = heading(b) - heading(a);
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    };
    for (const side of [1, -1]) {
      let run = [];
      const flush = () => {
        for (let k = 1; k < run.length; k++) {
          const a = run[k - 1], b = run[k];
          if (b.i !== (a.i + 1) % m) continue;
          const kind = b.kind;
          const style = FENCES[kind][Math.floor(b.s / 60) % FENCES[kind].length];
          const surface = scene.surface(`fence_${style.texture}`, style.texture, { road: [], alpha: style.opaque ? undefined : "test", doubleSided: true });
          const inward = [-sample.lefts[a.i][0] * side, -sample.lefts[a.i][1] * side, 0];
          const uScale = style.height * style.aspect;
          scene.wall(surface, a.p, b.p, style.height, a.s / uScale, b.s / uScale, inward);
        }
        run = [];
      };
      for (let i = 0; i < m; i++) {
        const hw = sample.widths[i] / 2;
        const p = roadEdge(sample, i, side * (hw + FENCE_OFFSET));
        p[2] -= 0.3;
        // 落在别的路面（或急弯里自己的另一段）上就断开
        const near = index.nearest(p[0], p[1], 60);
        const blocked = near && near.edge < FENCE_OFFSET - 1 && !(near.road === r && Math.min(Math.abs(near.i - i), m - Math.abs(near.i - i)) < 6);
        if (blocked) { flush(); continue; }
        const t = turn(i);
        const outside = Math.sign(t) === -side && Math.abs(t) > 0.9;
        const pattern = config.fence[Math.floor(sample.s[i] / 120) % config.fence.length];
        const kind = inCastle(p) ? "castle" : outside ? "chevron" : pattern;
        if (run.length && run[run.length - 1].kind !== kind) { const last = run[run.length - 1]; flush(); run.push({ ...last, kind }); }
        run.push({ p, i, s: sample.s[i], kind });
        if (kind === "flowers" && i % 6 === 0) placedFlowers.push(roadEdge(sample, i, side * (hw + FENCE_OFFSET + 1.2)));
      }
      flush();
    }
  });
  return placedFlowers;
}

/** 路边、空地上的公告板树丛和花。 */
function buildBillboards(scene, config, net, index, bounds, random, terrainAt, flowers) {
  const surface = t => scene.surface(`bb_${t}`, t, { alpha: "test", doubleSided: true });
  const place = (kind, p, w, h) => { const b = pick(random, BILLBOARDS[kind]); scene.billboard(surface(b.texture), [p[0], p[1], terrainAt(p[0], p[1]) - 0.2], w, h, b.uv, random() * Math.PI); };
  for (const p of flowers) place("flower", p, 1.6, 1.4);
  // 护栏外一圈灌木
  const roads = [net.main, ...net.branches.map(b => b.sample)];
  for (const sample of roads) {
    for (let i = 0; i < sample.points.length; i += 4 + Math.floor(random() * 4)) {
      for (const side of [1, -1]) {
        if (random() > 0.7 * config.scatter.bushes) continue;
        const off = sample.widths[i] / 2 + FENCE_OFFSET + 2 + random() * 5;
        const p = roadEdge(sample, i, side * off);
        const near = index.nearest(p[0], p[1], 60);
        if (near && near.edge < FENCE_OFFSET + 1) continue;
        place("bush", p, 4 + random() * 3, 3 + random() * 2);
      }
    }
  }
  // 空地上的树：离路边 15 米以上
  let placed = 0, tries = 0;
  while (placed < config.scatter.trees && tries++ < config.scatter.trees * 20) {
    const x = lerp(bounds.min[0] + 60, bounds.max[0] - 60, random()), y = lerp(bounds.min[1] + 60, bounds.max[1] - 60, random());
    const near = index.nearest(x, y, 200);
    if (near && near.edge < 15) continue;
    if (near && near.edge > 260) continue;
    const kind = random() < 0.35 ? "pine" : "tree";
    const h = 9 + random() * 8;
    place(kind, [x, y], h * 0.9, h);
    placed++;
  }
}

/** 远景：外圈一排树林剪影。 */
function buildBackdrop(scene, bounds, terrainAt) {
  const rings = [{ texture: "C_mtree_back01", inset: 140, w: 48, h: 34 }, { texture: "C_treeleaf00_back", inset: 60, w: 40, h: 30 }];
  for (const ring of rings) {
    const surface = scene.surface(`back_${ring.texture}`, ring.texture, { alpha: "test", doubleSided: true });
    const x0 = bounds.min[0] + ring.inset, y0 = bounds.min[1] + ring.inset, x1 = bounds.max[0] - ring.inset, y1 = bounds.max[1] - ring.inset;
    const sides = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
    for (const [a, b] of sides) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.ceil(len / ring.w);
      for (let k = 0; k < n; k++) {
        const p = [lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)], q = [lerp(a[0], b[0], (k + 1) / n), lerp(a[1], b[1], (k + 1) / n)];
        const z = Math.min(terrainAt(p[0], p[1]), terrainAt(q[0], q[1])) - 3;
        const inward = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len, 0];
        scene.wall(surface, [p[0], p[1], z], [q[0], q[1], z], ring.h, 0, 1, inward);
      }
    }
  }
}

const ASSET_BY_ID = new Map(ASSETS.map(a => [a.id, a]));
/** 复用卡丁城摆件的尺寸和碰撞（tools/city/blender/assets.mjs）。 */
async function assetInfo(id) {
  if (ASSET_BY_ID.has(id)) return ASSET_BY_ID.get(id);
  if (id in REUSED) {
    const { ASSETS: CITY } = await import("../city/blender/assets.mjs");
    const found = CITY.find(a => a.id === id);
    if (found) return found;
  }
  throw new Error(`未知摆件 ${id}`);
}

async function buildProps(scene, config, net, index, bounds, random, terrainAt, cacheDir, warnings, stats = {}) {
  const prepared = new Map();
  const get = async id => {
    if (prepared.has(id)) return prepared.get(id);
    const info = await assetInfo(id);
    const file = assetFile(id);
    let result;
    if (!existsSync(file)) { warnings.push(`摆件 ${id} 还没生成（${file}），跳过。`); result = undefined; }
    else result = { info, prop: prepareProp(id, file, info.size, cacheDir) };
    prepared.set(id, result);
    return result;
  };
  const collider = scene.collider();
  const occupied = [];
  const place = async (id, x, y, { yaw, lift = 0, scale = 1 } = {}) => {
    const entry = await get(id);
    if (!entry) return false;
    const { info, prop } = entry;
    const radius = Math.max(prop.size[0], prop.size[1]) / 2 * scale;
    let facing = yaw;
    if (facing === undefined) {
      const near = index.nearest(x, y, 400);
      // 模型朝 +x：正面朝向最近的路
      facing = near ? Math.atan2(near.p[1] - y, near.p[0] - x) : 0;
    }
    const corners = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => terrainAt(x + a * radius * 0.6, y + b * radius * 0.6));
    const z = (lift ? Math.max(...corners) + lift : Math.min(...corners)) - 0.05;
    scene.placeProp(prop, [x, y, z], facing, scale);
    if (!lift && info.collider && info.collider !== "none") {
      const footprint = info.collider === "post" ? [Math.min(2, prop.size[0] * 0.25) * scale, Math.min(2, prop.size[1] * 0.25) * scale] : [prop.size[0] * 0.8 * scale, prop.size[1] * 0.8 * scale];
      scene.box(collider, [x, y, z], [footprint[0], footprint[1], Math.min(prop.size[2] * scale, 12)], facing);
    }
    occupied.push({ x, y, r: radius });
    return true;
  };
  const free = (x, y, r) => {
    const near = index.nearest(x, y, 200);
    if (near && near.edge < FENCE_OFFSET + 4 + r) return false;
    return occupied.every(o => Math.hypot(o.x - x, o.y - y) > o.r + r + 2);
  };
  const shift = p => [p[0] + net.offset[0], p[1] + net.offset[1]];
  for (const mark of config.landmarks) {
    let [x, y] = shift(mark.at);
    const entry = await get(mark.asset);
    if (!entry) continue;
    // 压到路边的地标沿远离最近路面的方向挪开（空中的热气球不用）
    const radius = Math.max(entry.prop.size[0], entry.prop.size[1]) / 2;
    for (let step = 0; !mark.lift && step < 40; step++) {
      const near = index.nearest(x, y, 200);
      if (!near || near.edge >= FENCE_OFFSET + 4 + radius * 0.8) break;
      const dx = x - near.p[0], dy = y - near.p[1], l = Math.hypot(dx, dy) || 1;
      x += dx / l * 2; y += dy / l * 2;
      if (step === 39) warnings.push(`地标 ${mark.asset} @${mark.at} 挪不出路边。`);
    }
    await place(mark.asset, x, y, { yaw: mark.yaw, lift: mark.lift });
  }
  // 沿主路线每隔一段摆一个（房子、草垛……），哪侧有空地放哪侧；
  // side 指定时只放那一侧（1 = 前进方向左侧）
  const rows = [];
  for (const spec of [config.roadside ?? []].flat()) {
    const { assets, every, offset: [near0, far0], start = 0.6, side: only } = spec;
    const main = net.main;
    let k = 0, placedHere = 0;
    for (let s = every * start; s < main.total - every * 0.3; s += every, k++) {
      const id = assets[k % assets.length];
      const entry = await get(id);
      if (!entry) continue;
      const radius = Math.max(entry.prop.size[0], entry.prop.size[1]) / 2;
      const { index: i } = pointAtDistance(main, s);
      const hw = main.widths[i] / 2;
      let done = false;
      for (const side of only ? [only] : k % 2 ? [-1, 1] : [1, -1]) {
        for (let extra = near0; extra <= far0 && !done; extra += 3) {
          const p = roadEdge(main, i, side * (hw + FENCE_OFFSET + extra + radius));
          if (!free(p[0], p[1], radius)) continue;
          done = await place(id, p[0], p[1]);
        }
        if (done) break;
      }
      if (done) placedHere++;
    }
    rows.push(`${placedHere}/${k}`);
  }
  stats.roadside = rows.join(",");
  // 路边空地随机摆 Tripo 树和小摆件
  const scatter = async (ids, count, minEdge, maxEdge) => {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 40) {
      const x = lerp(bounds.min[0] + 80, bounds.max[0] - 80, random()), y = lerp(bounds.min[1] + 80, bounds.max[1] - 80, random());
      const near = index.nearest(x, y, 300);
      if (!near || near.edge < minEdge || near.edge > maxEdge) continue;
      const id = pick(random, ids);
      const entry = await get(id);
      if (!entry) continue;
      const scale = 0.85 + random() * 0.3;
      const r = Math.max(entry.prop.size[0], entry.prop.size[1]) / 2 * scale;
      if (!free(x, y, r)) continue;
      if (await place(id, x, y, { yaw: random() * Math.PI * 2, scale })) placed++;
    }
  };
  await scatter(config.scatter.tripoTrees, 45, 10, 120);
  await scatter(config.scatter.props, 30, 8, 40);
}

/** 起点拱门：两根木柱 + 横梁 + 原版「喜羊羊与灰太狼」横幅 + 羊角。 */
async function buildStartGate(scene, net, cacheDir) {
  const sample = net.main;
  const { index: i } = pointAtDistance(sample, 14);
  const hw = sample.widths[i] / 2 + 1.5;
  const p = sample.points[i];
  const left = roadEdge(sample, i, hw), right = roadEdge(sample, i, -hw);
  const yaw = Math.atan2(sample.lefts[i][1], sample.lefts[i][0]);
  const post = scene.surface("gate_post", "C_woodppl00", { road: [] });
  const beam = scene.surface("gate_beam", "C_woodppl01", {});
  const banner = scene.surface("gate_banner", "ad_start", { doubleSided: true });
  for (const q of [left, right]) scene.box(post, [q[0], q[1], q[2] - 0.5], [1.4, 1.4, 11], yaw, { uvScale: 2 });
  const height = 9;
  const mid = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, p[2] + height];
  scene.box(beam, mid, [hw * 2 + 1.4, 1.2, 1.6], yaw, { uvScale: 2 });
  // 横幅：前后两面，4:1
  const fwd = [sample.lefts[i][1], -sample.lefts[i][0]];
  for (const side of [-1, 1]) {
    const c = [mid[0] + fwd[0] * 0.65 * side, mid[1] + fwd[1] * 0.65 * side];
    const half = 8;
    const a = [c[0] - sample.lefts[i][0] * half * side, c[1] - sample.lefts[i][1] * half * side, mid[2] - 2.6];
    const b = [c[0] + sample.lefts[i][0] * half * side, c[1] + sample.lefts[i][1] * half * side, mid[2] - 2.6];
    scene.wall(banner, a, b, 4, 0, 1, [fwd[0] * side, fwd[1] * side, 0]);
  }
  const horns = assetFile("x_horns");
  if (existsSync(horns)) {
    const info = ASSET_BY_ID.get("x_horns");
    const prop = prepareProp("x_horns", horns, [info.size[0], info.size[1], info.size[2]], cacheDir);
    // 羊角面朝来车方向
    scene.placeProp(prop, [mid[0], mid[1], mid[2] + 0.8], yaw - Math.PI / 2 + Math.PI, 1);
  }
}

/** 急弯外侧的原版箭头路牌（C_sign00 图集：左上右转、右上左转、左下掉头）。 */
function buildCornerSigns(scene, net, index) {
  const sample = net.main;
  const m = sample.points.length;
  const board = scene.surface("sign_board", "C_sign00", { doubleSided: true });
  const post = scene.surface("sign_post", "C_woodppl00", { road: [] });
  const heading = i => Math.atan2(sample.tangents[i % m][1], sample.tangents[i % m][0]);
  let last = -1e9;
  for (let i = 0; i < m; i += 5) {
    let d = heading(i + 30) - heading(i);
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 1.2 || sample.s[i] - last < 150) continue;
    last = sample.s[i];
    const turnLeft = d > 0;
    const uv = Math.abs(d) > 2.4 ? [0, 0.5, 0.5, 1] : turnLeft ? [0.5, 0, 1, 0.5] : [0, 0, 0.5, 0.5];
    // 弯道外侧、弯前的位置，面朝来车
    const at = (i + 22) % m;
    const side = turnLeft ? -1 : 1;
    const p = roadEdge(sample, at, side * (sample.widths[at] / 2 + FENCE_OFFSET + 2));
    const near = index.nearest(p[0], p[1], 60);
    if (near && near.edge < FENCE_OFFSET) continue;
    const back = [-sample.tangents[i][0], -sample.tangents[i][1], 0];
    const l = sample.lefts[i];
    const size = 4.5;
    const a = [p[0] + l[0] * size / 2, p[1] + l[1] * size / 2, p[2] + 2], b = [p[0] - l[0] * size / 2, p[1] - l[1] * size / 2, p[2] + 2];
    scene.wall(board, a, b, size, uv[0], uv[2], back, uv[1], uv[3]);
    scene.box(post, [p[0] + back[0] * 0.4, p[1] + back[1] * 0.4, p[2] - 0.5], [0.5, 0.5, 3], 0);
  }
}

/** 道具箱：每排 4 个横跨路面，岔路中段各几个。 */
function itemCubes(config, net) {
  if (!config.itemRows) return [];
  const cubes = [];
  const cube = (p) => cubes.push({ kind: "ToItemCube", name: `ic${String(cubes.length + 1).padStart(2, "0")}`,
    transform: { basis: [[0.26614776253700256, 0, 0], [0, 0.26614776253700256, 0], [0, 0, 0.26614776253700256]], position: [p[0], p[1], p[2] + 1], scale: [1, 1, 1] }, instanceOrdinal: cubes.length + 1 });
  for (const s of config.itemRows) {
    const inBranch = net.branches.some(b => s > b.fromS - 40 && s < b.toS + 40);
    if (inBranch) throw new Error(`${config.id}：道具箱 ${s} 米处在岔路区间里。`);
    const { index: i } = pointAtDistance(net.main, s);
    const hw = net.main.widths[i] / 2;
    for (const f of [-0.45, -0.15, 0.15, 0.45]) cube(roadEdge(net.main, i, f * hw * 2 * 0.8));
  }
  for (const b of net.branches) {
    const { index: i } = pointAtDistance(b.sample, b.sample.total / 2);
    const hw = b.sample.widths[i] / 2;
    const n = config.branchItems ?? 0;
    for (let k = 0; k < n; k++) cube(roadEdge(b.sample, i, (n === 1 ? 0 : (k / (n - 1) - 0.5)) * hw));
  }
  return cubes;
}

// ---------------------------------------------------------------------------
// 3. 小地图和卡片

function minimapFrame(net) {
  const pts = [...net.main.points, ...net.branches.flatMap(b => b.sample.points)];
  const min = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))], max = [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  const size = Math.max(max[0] - min[0], max[1] - min[1], 50) * 1.08;
  return { centerX: (min[0] + max[0]) / 2, centerY: (min[1] + max[1]) / 2, scale: 236 / size };
}

function drawMinimap(frame, net, size, width) {
  const canvas = new RgbaCanvas(size, size, [0, 0, 0, 0]);
  const k = size / 256;
  const px = p => [k * (128 + (p[0] - frame.centerX) * frame.scale), k * (128 - (p[1] - frame.centerY) * frame.scale)];
  const stroke = (sample, w, color) => {
    const n = sample.points.length;
    for (let i = 0; i < (sample.closed ? n : n - 1); i++) { const a = px(sample.points[i]), b = px(sample.points[(i + 1) % n]); canvas.line(a[0], a[1], b[0], b[1], w, color); }
  };
  for (const b of net.branches) stroke(b.sample, width * 0.75 * k, [220, 220, 220, 255]);
  stroke(net.main, width * k, [255, 255, 255, 255]);
  return canvas;
}

function placeholderCard(width, height, minimap) {
  const canvas = new RgbaCanvas(width, height, [96, 168, 72, 255]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = y / height;
    canvas.set(x, y, [Math.round(lerp(150, 86, t)), Math.round(lerp(210, 150, t)), Math.round(lerp(250, 70, t)), 255]);
  }
  const scale = Math.min(width, height) / minimap.width * 0.9;
  const ox = (width - minimap.width * scale) / 2, oy = (height - minimap.height * scale) / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x - ox) / scale), sy = Math.floor((y - oy) / scale);
    if (sx < 0 || sy < 0 || sx >= minimap.width || sy >= minimap.height) continue;
    const i = (sy * minimap.width + sx) * 4;
    if (minimap.data[i + 3]) canvas.set(x, y, [235, 205, 120, 255]);
  }
  return canvas.png();
}

function utf16(text) {
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
}

// ---------------------------------------------------------------------------

export async function buildXyyTrack(config, { library, formats, cacheDir, cardsDir }) {
  const warnings = [];
  const { laps, start, files } = await aiLaps(library, config.id);
  const net = roadNetwork(config, laps, start);
  const roadsForIndex = [{ sample: net.main }, ...net.branches.map(b => ({ sample: b.sample }))];
  const index = new RoadIndex(roadsForIndex);
  const heights = net.main.points.map(p => p[2]).sort((a, b) => a - b);
  const baseZ = heights[heights.length >> 1] - 0.5;
  const pts = net.main.points;
  const bounds = {
    min: [Math.min(...pts.map(p => p[0])) - 360, Math.min(...pts.map(p => p[1])) - 360],
    max: [Math.max(...pts.map(p => p[0])) + 360, Math.max(...pts.map(p => p[1])) + 360],
  };
  const loop = net.main.points.filter((_, i) => i % 4 === 0);
  const terrainAt = (x, y) => terrainHeight(index, baseZ, x, y, loop);
  const random = rng(hash(config.id));
  const scene = new Scene();

  buildRoads(scene, net);
  buildTerrain(scene, index, net, bounds, baseZ, loop);
  const flowers = buildFences(scene, config, net, index);
  buildBillboards(scene, config, net, index, bounds, random, terrainAt, flowers);
  buildBackdrop(scene, bounds, terrainAt);
  await buildStartGate(scene, net, cacheDir);
  buildCornerSigns(scene, net, index);
  const propStats = {};
  await buildProps(scene, config, net, index, bounds, random, terrainAt, cacheDir, warnings, propStats);

  // 路线、道具箱、小地图、赛道设置
  const course = buildCourse(net.main, net.branches);
  const cubes = itemCubes(config, net);
  const frame = minimapFrame(net);
  const minimapObject = { kind: "ToMinimap", name: "", property: undefined, ...frame, canvasWidth: 256, canvasHeight: 256, padding: 4 };
  const settings = makeXml("property", {}, [
    makeXml("camera", { far: "600" }),
    makeXml("fog", { mode: "3", r: "196", g: "228", b: "250", start: "0.45", end: "1.0" }),
    makeXml("course", {}, course.course.children),
    makeXml("sun", { x: "0", y: "0", z: "-1" }),
  ]);
  const trackObject = { kind: "TrackObject", name: "track", property: settings };
  const { nodes, meshes, triangles } = scene.nodes();
  const sceneRoot = makeNode("Relement", { name: "rootRelement", children: [makeNode("Relement", { name: "Scene Root", children: nodes })] });
  const model = makeTrackContainer("", sceneRoot, [...course.roads, minimapObject, trackObject, ...cubes]);

  const out = [{ path: "track.1s", bytes: encodeTrackModel(model) }];
  // 天空盒：forest_I01 的（贴图名 skydome_F，theme_xyy 有同名的喜羊羊天空）
  const sky = library.files.find(f => f.virtualPath.toLowerCase() === "track_/forest_i01/skydome.1s");
  out.push({ path: "skydome.1s", bytes: new Uint8Array(await sky.bytes()) });
  out.push({ path: "track.xml", bytes: utf16("<?xml version='1.0' encoding='UTF-16'?>\n<trackInfo>\n\t<track filename='track'>\n\t\t<rainEffect enable='false' onStart='false'/>\n\t</track>\n</trackInfo>\n") });
  const minimap = drawMinimap(frame, net, 256, 7);
  out.push({ path: "xt_minimap.png", bytes: minimap.png() });
  out.push({ path: "xt_bigmap.png", bytes: drawMinimap(frame, net, 512, 7).png() });
  const card = cardsDir && path.join(cardsDir, `${config.id}_card.png`);
  const thumb = cardsDir && path.join(cardsDir, `${config.id}_thumb.png`);
  out.push({ path: "xt_trackCard.png", bytes: card && existsSync(card) ? readFileSync(card) : placeholderCard(352, 206, minimap) });
  out.push({ path: "xt_trackThumb.png", bytes: thumb && existsSync(thumb) ? readFileSync(thumb) : placeholderCard(222, 130, minimap) });
  for (const file of scene.generatedFiles()) out.push(file);

  const containerName = `track_${config.id}.rho`;
  const container = await packRhoArchive(containerName, out);
  return {
    containerName, container, files: out, offset: net.offset, warnings,
    stats: {
      aiFiles: files, laps: laps.length, lap: Math.round(net.main.total), branches: net.branches.map(b => `${b.fromS.toFixed(0)}-${b.toS.toFixed(0)}m`),
      gates: course.gates, cubes: cubes.length, meshes, triangles: Math.round(triangles), size: container.length,
      widths: [Math.min(...net.main.widths).toFixed(1), Math.max(...net.main.widths).toFixed(1)], ...propStats,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const only = option("--only")?.split(",");
  const outDir = path.resolve(option("--out") ?? path.join(clientDir, "build", "xyy"));
  const mirrorRoot = path.resolve(option("--mirror") ?? projectRoot);
  const cardsDir = option("--cards") ? path.resolve(option("--cards")) : path.join(projectRoot, "design", "xyy", "cards");
  const cacheDir = path.join(outDir, "cache");
  mkdirSync(outDir, { recursive: true });
  const { library, formats } = await loadResourceLibrary(projectRoot, "p3553", mirrorRoot);
  for (const config of TRACKS.filter(t => !only || only.includes(t.id))) {
    const built = await buildXyyTrack(config, { library, formats, cacheDir, cardsDir });
    const file = path.join(outDir, built.containerName);
    writeFileSync(file, built.container);
    console.log(`${config.id} ${config.title}: ${JSON.stringify(built.stats)} offset ${built.offset.join(",")}`);
    for (const w of built.warnings) console.warn(`  ! ${w}`);
    if (args.includes("--register")) {
      const { registerContainer } = await import("../city/register-container.mjs");
      const result = await registerContainer({ mirrorRoot: path.resolve(option("--register-into") ?? projectRoot), containerPath: file });
      for (const line of result.log ?? []) console.log(`  ${line}`);
      if (result.problems?.length) { console.error(result.problems); process.exit(1); }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
