// 比赛路线：主路线（闭合）每 40 米一道门，岔路按原版的写法生成
// <branch>：主路线拆成几段记录，分岔区间里主路和岔路各是一个备选
// <course>，汇合后接主路线的下一段（官方例子 abyss_I02、desert_I02）。
//
// 游戏的起点 = 第一段第一条记录的第一帧，圈数线 = 这条记录的门
// （src/resources/track-course-graph.ts）。所以主路线从起点处开始编号。
import { makeXml } from "../../src/resources/track-binary-writer.ts";
import { roadEdge, pointAtDistance } from "../../src/mapeditor/road-geometry.ts";

export const GATE_SPACING = 40;
const GATE_MARGIN = 6;
/** 分岔/汇合点前后不放门的距离：两条路在这里还重叠。 */
const JUNCTION_CLEAR = 30;

const forwardOf = (sample, i) => { const l = sample.lefts[i]; return [l[1], -l[0], 0]; };

/** 采样 i 处的门（四个角：左下、右下、左上、右上），宽度多留 margin。 */
function gatePositions(sample, i, extra = 0) {
  const half = sample.widths[i] / 2 + GATE_MARGIN + extra;
  const left = roadEdge(sample, i, half), right = roadEdge(sample, i, -half);
  const z = sample.points[i][2];
  return [[left[0], left[1], z - 1], [right[0], right[1], z - 1], [left[0], left[1], z + 19], [right[0], right[1], z + 19]];
}

/** 距离 s 处最近的采样下标（s 已按周长取模）。 */
function indexAt(sample, s) { return pointAtDistance(sample, s).index; }

/**
 * 采样 i 处的门（含两侧余量）离其他路面边缘还有多远：门不能伸到另一条
 * 路上，否则走那条路的车也会穿过这道门（岔路两端两条路贴得很近）。
 */
function gateClearance(sample, i, others) {
  const p = sample.points[i];
  const reach = sample.widths[i] / 2 + GATE_MARGIN;
  let clearance = Infinity;
  for (const other of others) {
    for (let k = 0; k < other.points.length; k++) {
      const q = other.points[k];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]) - other.widths[k] / 2 - reach;
      if (d < clearance) clearance = d;
    }
  }
  return clearance;
}

/**
 * 区间 [from, to] 里每 40 米一道门，只放在离 others 足够远（clear）的位置；
 * 一处都不够远时取最远的那处。
 */
function clearGates(sample, from, to, others, clear = 2) {
  const out = [];
  let best;
  for (let s = from; s <= to; s += 4) {
    const i = indexAt(sample, s);
    const c = gateClearance(sample, i, others);
    if (!best || c > best.c) best = { s, c };
    if (c >= clear && (!out.length || s - out[out.length - 1] >= GATE_SPACING)) out.push(s);
  }
  return out.length ? out : best ? [best.s] : [];
}

/**
 * 从采样 a 走到 b（闭合时可绕回）每 3 个点一帧，最后一帧在 b；
 * 帧在路面上方 1 米，前向水平。
 */
function framesBetween(sample, a, b, tail = []) {
  const m = sample.points.length;
  const span = b >= a ? b - a : b + m - a;
  const frames = [];
  const frame = i => ({ position: [sample.points[i][0], sample.points[i][1], sample.points[i][2] + 1], storedForward: forwardOf(sample, i), up: [0, 0, 1] });
  for (let k = 0; k < span; k += 3) frames.push(frame((a + k) % m));
  frames.push(frame(b % m));
  for (const extra of tail) frames.push(extra);
  return frames;
}

function record(name, sample, i, frames, extra = 0) {
  return { name, positions: gatePositions(sample, i, extra), gateIndices: [[0, 1, 3], [0, 3, 2]], surface: "", surfaceIndices: [], frames };
}

/**
 * main: 主路线采样（已旋转到起点）。branches: [{ sample, fromS, toS }]，
 * fromS/toS 是岔路离开/回到主路的主路线距离（按出现顺序，不跨起点）。
 * 返回 ToRoad 记录和 <course> 节点。
 */
export function buildCourse(main, branches = []) {
  const L = main.total;
  const sorted = [...branches].sort((a, b) => a.fromS - b.fromS);
  for (const b of sorted) if (!(b.fromS > JUNCTION_CLEAR && b.toS < L - JUNCTION_CLEAR && b.toS > b.fromS))
    throw new Error(`岔路区间 ${b.fromS.toFixed(0)}–${b.toS.toFixed(0)} 不合法（不能跨起点）。`);
  // 区间重叠的岔路（同一段路两侧各有一条）合成一个 <branch>
  const groups = [];
  sorted.forEach((b, bi) => {
    const last = groups[groups.length - 1];
    if (last && b.fromS < last.toS) { last.members.push(bi); last.fromS = Math.min(last.fromS, b.fromS); last.toS = Math.max(last.toS, b.toS); }
    else groups.push({ fromS: b.fromS, toS: b.toS, members: [bi] });
  });
  // 主路线的门位：每 40 米，分岔/汇合附近的去掉；分岔区间里的归入那个分岔组
  const nearJunction = s => sorted.some(b => Math.abs(s - b.fromS) < JUNCTION_CLEAR || Math.abs(s - b.toS) < JUNCTION_CLEAR);
  const gates = [];
  for (let s = 0; s < L - GATE_SPACING * 0.5; s += GATE_SPACING) {
    if (s > 0 && nearJunction(s)) continue;
    if (groups.some(g => s > g.fromS && s < g.toS)) continue;
    gates.push({ s, index: indexAt(main, s), group: -1 });
  }
  // 分岔组里的主路门：离组里的岔路足够远
  groups.forEach((g, gi) => {
    const others = g.members.map(bi => sorted[bi].sample);
    for (const s of clearGates(main, g.fromS + JUNCTION_CLEAR, g.toS - JUNCTION_CLEAR, others))
      gates.push({ s, index: indexAt(main, s), group: gi });
  });
  gates.sort((x, y) => x.s - y.s);
  const names = gates.map((_, k) => `m${String(k).padStart(3, "0")}`);
  // 主路线记录：帧走到下一道门（最后一道走回起点）
  const records = gates.map((g, k) => {
    const next = gates[(k + 1) % gates.length];
    return record(names[k], main, g.index, framesBetween(main, g.index, next.index));
  });
  const mainRoad = { kind: "ToRoad", name: "route", property: undefined, cyclic: true, records };

  // 岔路：自己的门，最后一条记录的帧经汇合点接到主路线下一道门
  const branchRoads = sorted.map((b, bi) => {
    const sample = b.sample;
    const len = sample.total;
    const group = groups.find(g => g.members.includes(bi));
    // 岔路自己的门：离主路和同组的其他岔路足够远
    const others = [main, ...group.members.filter(other => other !== bi).map(other => sorted[other].sample)];
    const own = clearGates(sample, Math.min(JUNCTION_CLEAR, len / 2), Math.max(len - JUNCTION_CLEAR, len / 2), others);
    const afterMerge = gates.find(g => g.s > group.toS && g.group < 0) ?? gates[0];
    const mergeIndex = indexAt(main, b.toS);
    const mainTail = framesBetween(main, mergeIndex, afterMerge.index).slice(1);
    const brRecords = own.map((s, k) => {
      const i = indexAt(sample, s);
      const endIndex = k + 1 < own.length ? indexAt(sample, own[k + 1]) : sample.points.length - 1;
      const frames = framesBetween(sample, i, endIndex, k + 1 < own.length ? [] : mainTail);
      return record(`b${bi}_${String(k).padStart(2, "0")}`, sample, i, frames);
    });
    return { kind: "ToRoad", name: `branch${bi}`, property: undefined, cyclic: false, records: brRecords };
  });

  // <course>
  const children = [];
  let k = 0;
  const run = (from, to) => makeXml("road", { name: "route", start: names[from], end: names[to] });
  groups.forEach((g, gi) => {
    const before = [];
    while (k < gates.length && gates[k].group !== gi) before.push(k++);
    if (before.length) children.push(run(before[0], before[before.length - 1]));
    const inside = [];
    while (k < gates.length && gates[k].group === gi) inside.push(k++);
    children.push(makeXml("branch", {}, [
      makeXml("course", {}, [run(inside[0], inside[inside.length - 1])]),
      ...g.members.map(bi => {
        const alt = branchRoads[bi];
        return makeXml("course", {}, [makeXml("road", { name: alt.name, start: alt.records[0].name, end: alt.records[alt.records.length - 1].name })]);
      }),
    ]));
  });
  if (k < gates.length) children.push(run(k, gates.length - 1));
  const course = makeXml("course", {}, children);
  return { roads: [mainRoad, ...branchRoads], course, gates: gates.length + branchRoads.reduce((n, r) => n + r.records.length, 0) };
}
