/**
 * 画完、闭合、拖完路点后自动把路修顺，免得出现“漏出底图”的路段：
 *   - 去掉挨得太近的点（闭合时最后一个点落在起点旁边就不要了），否则那里会折出尖角；
 *   - 太急的弯往两边点的中间收一点，直到内侧边不翻折（转弯半径大于路宽的一部分）；
 *   - 路点至少比地面高 ROAD_CLEARANCE，太陡的坡分摊到相邻两个点上。
 * 高度在两个路点之间的插值本身不会冲过头（road-geometry.ts 的单调插值）。
 */
import type { RoadDesign, RoadPoint } from "./design";

/** 路面比地面至少高这么多（米）：再低就和地面打架、露出草地。 */
export const ROAD_CLEARANCE = 0.3;
/** 最陡的坡（高度差 / 水平距离）。 */
export const MAX_GRADE = 0.22;

export interface SettleResult {
  points: RoadPoint[];
  /** 去掉的太近的点。 */
  merged: number;
  /** 修圆的急弯。 */
  rounded: number;
  /** 抬高或摊平的点。 */
  lifted: number;
}

const flat = (a: RoadPoint, b: RoadPoint) => Math.hypot(b.x - a.x, b.y - a.y);
const round = (value: number) => Math.round(value * 100) / 100;

/** 某个点的转弯半径（按两边较短的一段估算）；直路返回 Infinity。 */
function cornerRadius(prev: RoadPoint, point: RoadPoint, next: RoadPoint): number {
  const ax = point.x - prev.x, ay = point.y - prev.y, bx = next.x - point.x, by = next.y - point.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  const turn = Math.acos(cos);
  if (turn < 1e-3) return Infinity;
  return (Math.min(la, lb) / 2) / Math.tan(turn / 2);
}

export function settleRoad(road: Pick<RoadDesign, "points" | "closed" | "width">, groundZ?: number): SettleResult {
  const closed = road.closed;
  const minimum = closed ? 3 : 2;
  let points = road.points.map(point => ({ ...point }));
  let merged = 0, rounded = 0, lifted = 0;

  // 1. 太近的点
  const spacing = Math.max(3, road.width * 0.35);
  for (let i = 1; i < points.length && points.length > minimum;) {
    if (flat(points[i - 1]!, points[i]!) < spacing) { points.splice(i, 1); merged++; } else i++;
  }
  if (closed) {
    while (points.length > minimum && flat(points[points.length - 1]!, points[0]!) < Math.max(spacing, road.width * 0.6)) {
      points.pop();
      merged++;
    }
  }

  // 2. 急弯：转弯半径小于路宽的 0.75 时内侧边会翻折，往两边点的中点收
  const target = road.width * 0.75;
  const touched = new Set<number>();
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    const count = points.length;
    for (let i = closed ? 0 : 1; i < (closed ? count : count - 1); i++) {
      const prev = points[(i - 1 + count) % count]!, point = points[i]!, next = points[(i + 1) % count]!;
      if (cornerRadius(prev, point, next) >= target) continue;
      const mx = (prev.x + next.x) / 2, my = (prev.y + next.y) / 2;
      point.x = round(point.x + (mx - point.x) * 0.3);
      point.y = round(point.y + (my - point.y) * 0.3);
      touched.add(i);
      changed = true;
    }
    if (!changed) break;
  }
  rounded = touched.size;

  // 3. 高度：贴地的点抬到地面上方，太陡的坡两头各让一半
  const floor = groundZ === undefined ? -Infinity : groundZ + ROAD_CLEARANCE;
  const before = points.map(point => point.z);
  for (const point of points) if (point.z < floor) point.z = round(floor);
  const segments = closed ? points.length : points.length - 1;
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < segments; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      const limit = MAX_GRADE * flat(a, b);
      const rise = b.z - a.z;
      if (Math.abs(rise) <= limit + 0.01) continue;
      const excess = (Math.abs(rise) - limit) / 2 * Math.sign(rise);
      a.z = round(Math.max(floor, a.z + excess));
      b.z = round(Math.max(floor, b.z - excess));
      changed = true;
    }
    if (!changed) break;
  }
  lifted = points.filter((point, i) => Math.abs(point.z - before[i]!) > 0.005).length;
  return { points, merged, rounded, lifted };
}
