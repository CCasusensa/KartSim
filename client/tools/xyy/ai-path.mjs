// 原版 AI 行车线（track_common.rho:aiPath/<track>_<n>.kap）的解码与中线估计。
//
// .kap = uint32 长度 + KRData（与 KSV 相同：'S' 标记、flags、adler32、
// XOR 种子、解压长度、zlib）。解出来的正文是 17 字节头（第 13 字节起
// uint32 点数）加上每点 3 个 float32 的赛道坐标（客户端坐标，z 向上，
// 车身原点约在路面上方 1 米）。每个文件是一整场比赛（3 圈或 2 圈），
// 开头有一段停在发车位上的重复点。
//
// 喜羊羊三张赛道（xyy_I01/R01/R02）的模型 p3553 没有收录，这些线是
// 原版布局仅存的几何信息：中线取 7 条线、全部圈数的横向包络中点，
// 路宽取包络宽度加两侧余量，高度取平均后减去车身离地高度。
import { inflateSync } from "node:zlib";

const KRDATA_MARKER = 0x53;

function xorKrData(bytes, seed) {
  const key = Buffer.alloc(64);
  let word = (seed ^ 2222193601) >>> 0;
  for (let i = 0; i < 16; i++) { key.writeUInt32LE(word, i * 4); word = (word - 2072773695) >>> 0; }
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i & 63];
  return out;
}

/** .kap 文件 → [[x, y, z], …]（去掉 (0,0,0) 空点）。 */
export function decodeKap(input) {
  const buf = Buffer.from(input);
  if (buf.length < 10 || buf[4] !== KRDATA_MARKER) throw new Error("不是 KRData 格式的 .kap。");
  const flags = buf[5];
  let offset = 10;
  let seed = 0;
  if (flags & 2) { seed = buf.readUInt32LE(offset); offset += 4; }
  let expected = -1;
  if (flags & 1) { expected = buf.readInt32LE(offset); offset += 4; }
  let payload = buf.subarray(offset);
  if (flags & 2) payload = xorKrData(payload, seed);
  const body = flags & 1 ? inflateSync(payload) : payload;
  if (expected >= 0 && body.length !== expected) throw new Error(`.kap 解压长度 ${body.length} 与头部 ${expected} 不符。`);
  const count = body.readUInt32LE(13);
  if (17 + count * 12 > body.length) throw new Error(".kap 点数超出正文。");
  const points = [];
  for (let k = 0; k < count; k++) {
    const o = 17 + k * 12;
    const p = [body.readFloatLE(o), body.readFloatLE(o + 4), body.readFloatLE(o + 8)];
    if (Math.hypot(p[0], p[1], p[2]) > 1) points.push(p);
  }
  return points;
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * 一场比赛切成单圈：从离开发车位开始，每次回到起点 25 米内（且距上次
 * 已跑 500 米以上）算一圈。不完整的尾段丢掉。
 */
export function splitLaps(points) {
  let k0 = 0;
  while (k0 + 1 < points.length && dist2(points[k0 + 1], points[0]) < 0.5) k0++;
  const start = points[k0];
  const laps = [];
  let length = 0, last = 0, current = [start];
  for (let k = k0 + 1; k < points.length; k++) {
    length += dist2(points[k], points[k - 1]);
    current.push(points[k]);
    if (length - last > 500 && dist2(points[k], start) < 25) {
      laps.push(current);
      current = [points[k]];
      last = length;
    }
  }
  return { start, laps };
}

/** 按水平弧长每 `step` 米重采样一条折线。 */
export function resample(points, step, closed = false) {
  const source = closed ? [...points, points[0]] : points;
  const out = [source[0]];
  let carry = 0;
  for (let k = 1; k < source.length; k++) {
    const a = source[k - 1], b = source[k];
    const seg = dist2(a, b);
    if (seg < 1e-6) continue;
    let t = step - carry;
    while (t <= seg) {
      const f = t / seg;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
      t += step;
    }
    carry = seg - (t - step);
  }
  if (closed && out.length > 1 && dist2(out[0], out[out.length - 1]) < step * 0.5) out.pop();
  return out;
}

/** 闭合序列的高斯平滑（半径 r 个采样点）。 */
export function smoothClosed(values, radius, closed = true) {
  const n = values.length;
  if (radius <= 0) return values.slice();
  const weights = [];
  for (let d = -radius; d <= radius; d++) weights.push(Math.exp(-(d * d) / (2 * (radius / 2) ** 2)));
  const isVec = Array.isArray(values[0]);
  return values.map((_, i) => {
    let w = 0;
    const acc = isVec ? values[0].map(() => 0) : [0];
    for (let d = -radius; d <= radius; d++) {
      let j = i + d;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      const v = isVec ? values[j] : [values[j]];
      const k = weights[d + radius];
      for (let c = 0; c < acc.length; c++) acc[c] += v[c] * k;
      w += k;
    }
    const r = acc.map(v => v / w);
    return isVec ? r : r[0];
  });
}

/**
 * 一条参考线上每个点沿水平法线方向与其他线的交点（横向偏移、高度）。
 * 只取同向（夹角 < 60°）、30 米内、高度差 4 米内的段，避开平行的
 * 另一笔画。
 */
function lateralHits(ref, traces, maxLateral = 30) {
  const n = ref.length;
  return ref.map((p, k) => {
    const a = ref[(k - 2 + n) % n], b = ref[(k + 2) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = -ty, ny = tx;
    const hits = [];
    for (const trace of traces) {
      let best;
      for (let j = 1; j < trace.length; j++) {
        const q0 = trace[j - 1], q1 = trace[j];
        const dx = q1[0] - q0[0], dy = q1[1] - q0[1];
        const sl = Math.hypot(dx, dy);
        if (sl < 1e-3 || (dx * tx + dy * ty) / sl < 0.5) continue;
        const s0 = (q0[0] - p[0]) * tx + (q0[1] - p[1]) * ty, s1 = (q1[0] - p[0]) * tx + (q1[1] - p[1]) * ty;
        if (s0 > 0 || s1 < 0) continue;
        const f = -s0 / (s1 - s0 || 1);
        const x = q0[0] + dx * f, y = q0[1] + dy * f, z = q0[2] + (q1[2] - q0[2]) * f;
        const lateral = (x - p[0]) * nx + (y - p[1]) * ny;
        if (Math.abs(lateral) > maxLateral || Math.abs(z - p[2]) > 4) continue;
        if (!best || Math.abs(lateral) < Math.abs(best.lateral)) best = { lateral, z };
      }
      if (best) hits.push(best);
    }
    return { normal: [nx, ny], hits };
  });
}

/**
 * 由多条单圈 AI 线估计一圈赛道：中线点、路宽、路面高度。
 *
 * options.step 采样间距（米）；options.margin 包络两侧各加的余量；
 * options.minWidth / maxWidth 路宽范围；options.clearance 车身离地高度；
 * options.outlierWidth 包络超过这个宽度时按岔路处理（只用离参考线近的点）。
 */
export function estimateCenterline(laps, options = {}) {
  const { step = 4, margin = 5, minWidth = 18, maxWidth = 34, clearance = 1, outlierWidth = 30, reference = 0 } = options;
  const ref = resample(laps[reference], step, true);
  const rows = lateralHits(ref, laps);
  const centers = [], widths = [], heights = [], spreads = [];
  rows.forEach(({ normal, hits }, k) => {
    let lats = hits.map(h => h.lateral).sort((a, b) => a - b);
    // 岔路：大部分线在一侧，少数绕远的线让包络过宽，只保留主流
    if (lats.length && lats[lats.length - 1] - lats[0] > outlierWidth) {
      const median = lats[lats.length >> 1];
      lats = lats.filter(v => Math.abs(v - median) <= outlierWidth / 2);
    }
    const lo = lats.length ? lats[0] : 0, hi = lats.length ? lats[lats.length - 1] : 0;
    const mid = (lo + hi) / 2;
    const z = hits.length ? hits.reduce((s, h) => s + h.z, 0) / hits.length : ref[k][2];
    centers.push([ref[k][0] + normal[0] * mid, ref[k][1] + normal[1] * mid]);
    spreads.push(hi - lo);
    widths.push(Math.min(maxWidth, Math.max(minWidth, hi - lo + margin * 2)));
    heights.push(z - clearance);
  });
  const smoothCenters = smoothClosed(centers, 6);
  const smoothWidths = smoothClosed(smoothClosed(widths, 8), 8);
  const smoothHeights = smoothClosed(heights, 5);
  const points = smoothCenters.map((c, k) => [c[0], c[1], smoothHeights[k]]);
  return { points, widths: smoothWidths, spreads, step };
}

/**
 * 岔路：沿每一圈跟踪它在主路中线上的位置，离主路中线超过半宽 + slack
 * 且连续 minLength 米以上的线段算一次绕行。按离开/回到主路的位置和
 * 偏向哪一侧聚类，同一类的线按弧长比例平均成岔路中线（两端各带几个
 * 主路上的点，接得顺）。
 *
 * 返回 [{ points, width, entry, exit, side, runs }]：entry/exit 是主路
 * 中线下标，side 1 = 左侧（前进方向），-1 = 右侧。
 */
export function extractBranches(center, laps, { slack = 4, minLength = 40, clearance = 1, minWidth = 14, maxWidth = 24, margin = 5 } = {}) {
  const { points, widths } = center;
  const n = points.length;
  const ring = i => ((i % n) + n) % n;
  const near = (p, around, back, ahead = back) => {
    let best = around, bd = Infinity;
    const from = back === undefined ? 0 : around - back, to = back === undefined ? n - 1 : around + ahead;
    for (let k = from; k <= to; k++) {
      const i = ring(k);
      const d = dist2(points[i], p);
      if (d < bd) { bd = d; best = i; }
    }
    return { index: best, distance: bd };
  };
  const lateralSide = (p, i) => {
    const a = points[ring(i - 2)], b = points[ring(i + 2)];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    return tx * (p[1] - points[i][1]) - ty * (p[0] - points[i][0]) > 0 ? 1 : -1;
  };
  const runs = [];
  for (const lap of laps) {
    let index = near(lap[0]).index;
    let run;
    let lastOn = 0;
    // 在路上时只在附近找；绕行时往前多找一段（回到主路的位置可能在
    // 几百米之后），平行的另一笔画离得远，不会误认
    let wasOff = false;
    const tracked = lap.map(p => {
      const r = wasOff ? near(p, index, 10, 120) : near(p, index, 25);
      const off = r.distance > widths[r.index] / 2 + slack;
      if (!off) index = r.index;
      wasOff = off;
      return { p, off, index: r.index };
    });
    for (let k = 0; k < tracked.length; k++) {
      const t = tracked[k];
      if (t.off) {
        if (!run) run = { start: k, entry: tracked[lastOn].index };
      } else {
        if (run) {
          const body = tracked.slice(run.start, k).map(x => x.p);
          let length = 0;
          for (let j = 1; j < body.length; j++) length += dist2(body[j], body[j - 1]);
          if (length >= minLength) {
            const pad = 4;
            const pts = tracked.slice(Math.max(0, run.start - pad), Math.min(tracked.length, k + pad)).map(x => x.p);
            const mid = body[body.length >> 1];
            runs.push({ points: pts, entry: run.entry, exit: t.index, length, side: lateralSide(mid, near(mid, run.entry, 0, ring(t.index - run.entry)).index) });
          }
          run = undefined;
        }
        lastOn = k;
      }
    }
  }
  // 聚类
  const clusters = [];
  const gap = (a, b) => Math.min(Math.abs(a - b), n - Math.abs(a - b));
  for (const r of runs) {
    const c = clusters.find(c => c.side === r.side && gap(c.entry, r.entry) <= 15 && gap(c.exit, r.exit) <= 15);
    if (c) c.runs.push(r); else clusters.push({ side: r.side, entry: r.entry, exit: r.exit, runs: [r] });
  }
  return clusters.map(c => {
    const count = Math.max(8, Math.round(Math.max(...c.runs.map(r => r.length)) / 4));
    const resampled = c.runs.map(r => {
      const total = r.points.reduce((s, p, i) => i ? s + dist2(p, r.points[i - 1]) : 0, 0);
      return resample(r.points, total / (count - 1));
    });
    const pts = [];
    for (let k = 0; k < count; k++) {
      const acc = [0, 0, 0];
      let w = 0;
      for (const line of resampled) { const p = line[Math.min(k, line.length - 1)]; acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; w++; }
      pts.push([acc[0] / w, acc[1] / w, acc[2] / w - clearance]);
    }
    let spread = 0;
    for (let k = 0; k < count; k++) for (const line of resampled) spread = Math.max(spread, dist2(line[Math.min(k, line.length - 1)], pts[k]) * 2);
    const width = Math.min(maxWidth, Math.max(minWidth, (c.runs.length > 1 ? spread : 0) + margin * 2));
    // 两端接在主路中线上（分岔前、汇合后各 3 个中线点），中间只留已经
    // 离开主路的点：平均出来的线在主路上会来回折，路面带会扭
    const outside = smoothClosed(pts, 3, false).filter(p => {
      let bd = Infinity, bi = 0;
      for (let i = 0; i < n; i++) { const d = dist2(points[i], p); if (d < bd) { bd = d; bi = i; } }
      return bd > widths[bi] * 0.45;
    });
    const at = i => [...points[ring(i)]];
    const joined = [at(c.entry - 3), at(c.entry), ...outside, at(c.exit), at(c.exit + 3)];
    return { points: joined, width, entry: c.entry, exit: c.exit, side: c.side, runs: c.runs.length };
  });
}
