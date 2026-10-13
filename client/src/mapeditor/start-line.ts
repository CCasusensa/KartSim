/**
 * 起终点线：比赛路线的起点处铺一条原版的起跑线路面贴图（各主题的 *_start
 * 路面，城镇 cement06_start、森林 F_roadstart01、矿山 M_road_start00…），
 * 生成赛道包和编辑器预览都会自动加上，不用玩家自己摆。
 *
 * 原版贴图是 256×128 的路面块，有的整张是格子，有的只有中间一条格子带，
 * 所以每张记下格子所在的 v 范围；横向铺满路宽。
 */
import type { MapDesign, PieceDesign, Vec3 } from "./design";
import { pointAtDistance, sampleRoad } from "./road-geometry";

export interface StartLineTexture {
  /** 能解析到这张贴图的官方赛道。 */
  track: string;
  name: string;
  /** 用到的纵向范围（0–1），只取格子那一段。 */
  v0: number;
  v1: number;
}

const line = (track: string, name: string, v0 = 0, v1 = 1): StartLineTexture => ({ track, name, v0, v1 });

/** 通用的水泥起跑线（只取最上面那一排格子）。 */
const DEFAULT_LINE = line("beach_R05", "cement_start", 0, 0.33);

const THEME_LINES: Record<string, StartLineTexture> = {
  village: line("village_R06", "cement06_start", 0, 0.33),
  forest: line("forest_R03", "F_roadstart01", 0.3, 1),
  mine: line("mine_I01", "M_road_start00"),
  ice: line("ice_I03", "ice_road_start", 0, 0.72),
  abyss: line("abyss_R01", "Sea_road_start"),
  desert: line("desert_R03", "de_sand_road01_start"),
  beach: line("beach_R01", "bc_road_start"),
  pirate: line("pirate_R02", "p_road_start00", 0.33, 0.62),
  tomb: line("tomb_R04", "t_road_start _01"),
  moonhill: line("moonhill_I02", "ct_start_02"),
  factory: line("brodi_I01", "fac_road00_start"),
  brodi: line("brodi_I01", "fac_road00_start"),
  mechanic: line("brodi_I01", "fac_road00_start"),
  transFormer: line("brodi_I01", "fac_road00_start"),
  olympos: line("olympos_I01", "oly_city_road01_start"),
  god: line("olympos_I01", "oly_city_road01_start"),
  fairy: line("fairy_R01", "fai_start_j_001"),
  china: line("china_I08", "cement_start", 0, 0.33),
};

/** 某个主题用哪张起跑线贴图。 */
export function startLineFor(theme: string): StartLineTexture {
  return THEME_LINES[theme] ?? DEFAULT_LINE;
}

/** 起跑线沿路的长度（米）：保持贴图格子的比例，最多 8 米。 */
export function startLineDepth(width: number, texture: StartLineTexture): number {
  return Math.min(8, Math.max(2, width * 0.5 * (texture.v1 - texture.v0)));
}

/** 用到的全部起跑线贴图（测试核对每张都找得到）。 */
export function allStartLines(): StartLineTexture[] {
  return [DEFAULT_LINE, ...Object.values(THEME_LINES)];
}

// ---------------------------------------------------------------------------
// 起点拱门

/** 起点拱门在视口和赛道包里当作一个摆件，用这个固定 id（不在 design.pieces 里）。 */
export const START_ARCH_ID = "__start_arch";

/**
 * 起点拱门的摆放：立在起跑线中间，长边横跨路面（跟着路的方向转），整体缩放到
 * 比路宽两边各多出 5 米（0.3–3 倍）。没有拱门或还没有闭合的比赛路线时返回 undefined。
 */
export function startArchPiece(design: Pick<MapDesign, "roads" | "start">): PieceDesign | undefined {
  const arch = design.start.arch;
  const route = design.roads.find(road => road.route && road.closed && road.points.length >= 3);
  if (!arch || !route) return undefined;
  const sample = sampleRoad(route, 2);
  if (sample.points.length < 3) return undefined;
  const at = pointAtDistance(sample, design.start.offset);
  const width = sample.widths[at.index]!;
  const tangent = sample.tangents[at.index]!;
  const heading = (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI;
  const sizeX = arch.max[0] - arch.min[0], sizeY = arch.max[1] - arch.min[1];
  const span = Math.max(sizeX, sizeY, 1);
  const scale = Math.round(Math.min(3, Math.max(0.3, (width + 10) / span)) * 1000) / 1000;
  // 长边沿 x 时转 90° 横到路上；沿 y 时本来就横着
  const yaw = Math.round((((heading + (sizeX >= sizeY ? 90 : 0)) % 360) + 360) % 360 * 100) / 100;
  const position: Vec3 = [at.position[0], at.position[1], at.position[2]].map(v => Math.round(v * 100) / 100) as Vec3;
  return {
    id: START_ARCH_ID, track: arch.track, path: [...arch.path], label: arch.label,
    origin: [...arch.origin] as Vec3, position, rotation: [yaw, 0, 0], scale: [scale, scale, scale],
  };
}
