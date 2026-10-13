/**
 * 样条道路的采样：控制点之间用向心 Catmull-Rom 曲线插值，宽度和倾斜
 * 线性插值。结果给编辑器预览、路面网格、护墙和比赛路线共同使用，保证
 * 看到的和生成的完全一致。坐标是客户端坐标（z 向上）。
 */
import type { RoadDesign, RoadPoint, Vec3 } from "./design";

export interface RoadSample {
  /** 中线点。 */
  points: Vec3[];
  /** 单位切线（三维）。 */
  tangents: Vec3[];
  /** 水平左侧方向（单位向量，z = 0）。 */
  lefts: Vec3[];
  /** 计入倾斜后的横向方向（从中线指向左边缘）。 */
  laterals: Vec3[];
  /** 路面法线（向上）。 */
  normals: Vec3[];
  widths: number[];
  /** 沿中线的累计长度。 */
  s: number[];
  total: number;
  closed: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : [1, 0, 0]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const position = (p: RoadPoint): Vec3 => [p.x, p.y, p.z];

/** 向心 Catmull-Rom（alpha = 0.5），t ∈ [0, 1] 在 p1 与 p2 之间。 */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const knot = (a: Vec3, b: Vec3) => Math.max(Math.sqrt(len(sub(b, a))), 1e-4);
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: Vec3, b: Vec3, ta: number, tb: number) => {
    const w = (u - ta) / (tb - ta);
    return add(mul(a, 1 - w), mul(b, w));
  };
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * 按约 `step` 米的间距采样一条道路。闭合道路最后一个采样点不重复第一个。
 */
export function sampleRoad(road: Pick<RoadDesign, "points" | "closed" | "width">, step = 2): RoadSample {
  const control = road.points;
  const n = control.length;
  const closed = road.closed && n >= 3;
  const empty: RoadSample = { points: [], tangents: [], lefts: [], laterals: [], normals: [], widths: [], s: [], total: 0, closed };
  if (n < 2) return empty;
  const at = (i: number): RoadPoint => {
    if (closed) return control[((i % n) + n) % n]!;
    if (i < 0) { // 外推端点，曲线在端点处不弯折
      const a = control[0]!, b = control[1]!;
      return { ...a, x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
    }
    if (i >= n) {
      const a = control[n - 1]!, b = control[n - 2]!;
      return { ...a, x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
    }
    return control[i]!;
  };
  const segments = closed ? n : n - 1;
  const raw: Vec3[] = [];
  const widths: number[] = [];
  const banks: number[] = [];
  for (let i = 0; i < segments; i++) {
    const p0 = position(at(i - 1)), p1 = position(at(i)), p2 = position(at(i + 1)), p3 = position(at(i + 2));
    const chord = len(sub(p2, p1));
    const count = Math.max(1, Math.ceil(chord / step));
    const w1 = at(i).width ?? road.width, w2 = at(i + 1).width ?? road.width;
    const b1 = at(i).bank ?? 0, b2 = at(i + 1).bank ?? 0;
    for (let k = 0; k < count; k++) {
      const t = k / count;
      raw.push(chord < 1e-6 ? p1 : catmullRom(p0, p1, p2, p3, t));
      // 平滑插值，宽度和倾斜在控制点附近不出现折角
      const e = t * t * (3 - 2 * t);
      widths.push(w1 + (w2 - w1) * e);
      banks.push(b1 + (b2 - b1) * e);
    }
  }
  if (!closed) {
    raw.push(position(control[n - 1]!));
    widths.push(control[n - 1]!.width ?? road.width);
    banks.push(control[n - 1]!.bank ?? 0);
  }
  // 去掉重合点
  const points: Vec3[] = [], keptWidths: number[] = [], keptBanks: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const last = points[points.length - 1];
    if (last && len(sub(raw[i]!, last)) < 1e-3) continue;
    points.push(raw[i]!); keptWidths.push(widths[i]!); keptBanks.push(banks[i]!);
  }
  if (closed && points.length > 1 && len(sub(points[0]!, points[points.length - 1]!)) < 1e-3) {
    points.pop(); keptWidths.pop(); keptBanks.pop();
  }
  const m = points.length;
  if (m < 2) return empty;
  const tangents: Vec3[] = [], lefts: Vec3[] = [], laterals: Vec3[] = [], normals: Vec3[] = [], s: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const prev = closed ? points[(i - 1 + m) % m]! : points[Math.max(0, i - 1)]!;
    const next = closed ? points[(i + 1) % m]! : points[Math.min(m - 1, i + 1)]!;
    const tangent = norm(sub(next, prev));
    const flat = norm([tangent[0], tangent[1], 0]);
    const left: Vec3 = [-flat[1], flat[0], 0];
    const bank = (keptBanks[i]! * Math.PI) / 180;
    // 横向方向绕切线转 bank 角：正值左边抬高
    const lateral = norm(add(mul(left, Math.cos(bank)), [0, 0, Math.sin(bank)]));
    let normal = norm(cross(lateral, tangent));
    if (normal[2] < 0) normal = mul(normal, -1);
    if (i > 0) total += len(sub(points[i]!, points[i - 1]!));
    tangents.push(tangent); lefts.push(left); laterals.push(lateral); normals.push(normal); s.push(total);
  }
  if (closed) total += len(sub(points[0]!, points[m - 1]!));
  return { points, tangents, lefts, laterals, normals, widths: keptWidths, s, total, closed };
}

/** 采样点 i 处偏离中线 `offset` 米（正值向左）的路面点。 */
export function roadEdge(sample: RoadSample, i: number, offset: number): Vec3 {
  return add(sample.points[i]!, mul(sample.laterals[i]!, offset));
}

/** 沿中线距离 s 处的位置和切线（闭合道路按周长取模）。 */
export function pointAtDistance(sample: RoadSample, distance: number): { index: number; position: Vec3; tangent: Vec3 } {
  const m = sample.points.length;
  let d = distance;
  if (sample.closed) d = ((d % sample.total) + sample.total) % sample.total;
  else d = Math.max(0, Math.min(sample.s[m - 1]!, d));
  let i = 0;
  while (i + 1 < m && sample.s[i + 1]! <= d) i++;
  const j = sample.closed ? (i + 1) % m : Math.min(i + 1, m - 1);
  const end = j === 0 && sample.closed ? sample.total : sample.s[j]!;
  const span = end - sample.s[i]!;
  const t = span > 1e-9 ? (d - sample.s[i]!) / span : 0;
  const a = sample.points[i]!, b = sample.points[j]!;
  return { index: i, position: add(mul(a, 1 - t), mul(b, t)), tangent: sample.tangents[i]! };
}

/**
 * 把闭合道路的采样旋转到从距离 `offset` 开始（起点线位置），返回新的
 * 采样；开放道路原样返回。
 */
export function rotateClosedSample(sample: RoadSample, offset: number): RoadSample {
  if (!sample.closed || !sample.points.length) return sample;
  const { index } = pointAtDistance(sample, offset);
  if (index === 0) return sample;
  const order = (array: Vec3[] | number[]) => [...array.slice(index), ...array.slice(0, index)];
  const points = order(sample.points) as Vec3[];
  const s: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += len(sub(points[i]!, points[i - 1]!));
    s.push(total);
  }
  return {
    ...sample,
    points,
    tangents: order(sample.tangents) as Vec3[],
    lefts: order(sample.lefts) as Vec3[],
    laterals: order(sample.laterals) as Vec3[],
    normals: order(sample.normals) as Vec3[],
    widths: order(sample.widths) as number[],
    s,
  };
}
