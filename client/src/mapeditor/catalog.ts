/**
 * 地图工坊素材目录：素材栏里按类型、主题列出的官方物件、路面/护栏/地面
 * 贴图、天空和主题套装，以及它们的缩略图在雪碧图里的位置。
 *
 * 目录和雪碧图由 tools/mapeditor-catalog/build.mjs 从全部官方赛道生成
 * （catalog/catalog.json、catalog/sheet-N.webp），编辑器打开时不用现场下载
 * 赛道就能看到每一样东西的样子。
 */
import type { RoadTextureRef, TextureRef, Vec3 } from "./design";
import { THEME_TITLES } from "./source-tracks";

export type PieceCategory =
  | "building" | "tree" | "flower" | "rock" | "fence" | "light" | "sign" | "ad"
  | "booster" | "vehicle" | "creature" | "decor";

export interface CatalogPiece {
  id: string;
  category: PieceCategory;
  theme: string;
  label: string;
  /** 雪碧图格子号（所有雪碧图连续编号）。 */
  slot: number;
  track: string;
  path: number[];
  origin: Vec3;
  min: Vec3;
  max: Vec3;
}

export interface CatalogTexture {
  id: string;
  kind: "surface" | "wall" | "ground";
  theme: string;
  slot: number;
  track: string;
  name: string;
  road?: [string, string][];
  alpha?: "test" | "blend";
}

export interface CatalogSky {
  id: string;
  theme: string;
  /** 来源赛道的中文名。 */
  label: string;
  slot: number;
  track: string;
}

/** 主题套装：一键换上某个主题的天空、路面、护栏和地面。 */
export interface ThemePreset {
  theme: string;
  sky: string;
  surface: string;
  wall?: string;
  ground?: string;
}

export interface CatalogData {
  version: number;
  cell: number;
  columns: number;
  rows: number;
  pieces: CatalogPiece[];
  textures: CatalogTexture[];
  skies: CatalogSky[];
  presets: ThemePreset[];
}

/** 素材栏里物件的分类：名字、说明和摆放方式。 */
export interface PieceCategoryInfo {
  id: PieceCategory;
  title: string;
  /** 拖动连续摆放时：line 沿拖动方向排成一排（围栏、路灯），scatter 随机朝向撒开（树、花、石头）。 */
  paint: "line" | "scatter" | "single";
}

export const PIECE_CATEGORIES: PieceCategoryInfo[] = [
  { id: "building", title: "建筑", paint: "single" },
  { id: "tree", title: "树木", paint: "scatter" },
  { id: "flower", title: "花草", paint: "scatter" },
  { id: "rock", title: "山石", paint: "scatter" },
  { id: "fence", title: "围栏", paint: "line" },
  { id: "light", title: "路灯", paint: "line" },
  { id: "sign", title: "路标旗帜", paint: "line" },
  { id: "ad", title: "广告牌", paint: "line" },
  { id: "booster", title: "加速跳台", paint: "single" },
  { id: "vehicle", title: "交通工具", paint: "single" },
  { id: "creature", title: "动物人物", paint: "scatter" },
  { id: "decor", title: "装饰", paint: "scatter" },
];

export function categoryInfo(id: PieceCategory): PieceCategoryInfo {
  return PIECE_CATEGORIES.find(category => category.id === id)!;
}

export function themeTitle(theme: string): string {
  return THEME_TITLES[theme] ?? theme;
}

/** 物件的长宽高（米）。 */
export function pieceSize(piece: Pick<CatalogPiece, "min" | "max">): Vec3 {
  return [piece.max[0] - piece.min[0], piece.max[1] - piece.min[1], piece.max[2] - piece.min[2]];
}

/** 原版路面属性值（韩文）→ 中文。 */
const ROAD_VALUES: Record<string, string> = {
  모래바닥: "沙地", 눈바닥: "雪地", 나무다리: "木桥", 돌바닥: "石地", 물밟기: "浅水", 강철바닥: "钢板",
  돌다리: "石桥", 수풀바닥: "草丛", 철바닥: "铁板", 강철다리: "钢桥",
};

const TEXTURE_WORDS: Array<[RegExp, string]> = [
  [/snow|눈/i, "雪地"], [/ice/i, "冰面"], [/sand|desert|모래/i, "沙地"], [/soil|dirt|mud|흙/i, "泥土"],
  [/grass|잔디|풀/i, "草地"], [/wood|plank|나무/i, "木板"], [/brick/i, "砖"], [/ston|stone|돌/i, "石板"],
  [/tile/i, "地砖"], [/metal|steel|iron|철/i, "金属"], [/bridge/i, "桥面"], [/cement/i, "水泥"],
  [/floor|bottom/i, "地板"], [/road|길/i, "柏油"],
  [/handrail|난간/i, "扶手"], [/rail/i, "栏杆"], [/guard|barrier/i, "护栏"], [/fence|펜스/i, "栅栏"],
];

/** 贴图在素材栏上的名字：原版路面声音优先，否则看贴图名里的词。 */
export function textureLabel(texture: Pick<CatalogTexture, "kind" | "name" | "road">): string {
  const sound = texture.road?.find(([key]) => key === "sound")?.[1];
  if (sound && ROAD_VALUES[sound]) return ROAD_VALUES[sound]!;
  for (const [pattern, word] of TEXTURE_WORDS) if (pattern.test(texture.name)) return word;
  return texture.kind === "surface" ? "路面" : texture.kind === "wall" ? "护栏" : "地面";
}

export function surfaceRef(texture: CatalogTexture): RoadTextureRef {
  return { track: texture.track, name: texture.name, road: texture.road ?? [], ...(texture.alpha ? { alpha: texture.alpha } : {}) };
}

export function textureRef(texture: CatalogTexture): TextureRef {
  return { track: texture.track, name: texture.name, ...(texture.alpha ? { alpha: texture.alpha } : {}) };
}

/** 按主题、关键词筛物件；主题为空表示全部。 */
export function filterPieces(data: CatalogData, category: PieceCategory, theme: string, search: string): CatalogPiece[] {
  const text = search.trim().toLowerCase();
  return data.pieces.filter(piece => piece.category === category && (!theme || piece.theme === theme) &&
    (!text || piece.label.toLowerCase().includes(text) || themeTitle(piece.theme).includes(text) || piece.track.toLowerCase().includes(text)));
}

/** 雪碧图里某一格的 CSS 背景（显示成 size×size）。 */
export function spriteStyle(data: CatalogData, sheets: readonly string[], slot: number, size: number): string {
  const perSheet = data.columns * data.rows;
  const sheet = sheets[Math.floor(slot / perSheet)];
  const index = slot % perSheet;
  const scale = size / data.cell;
  const x = (index % data.columns) * size, y = Math.floor(index / data.columns) * size;
  return `background-image:url("${sheet}");background-size:${data.columns * data.cell * scale}px auto;background-position:-${x}px -${y}px;`;
}

/** 目录里出现过的主题，按物件数从多到少。 */
export function catalogThemes(data: CatalogData): string[] {
  const counts = new Map<string, number>();
  for (const piece of data.pieces) counts.set(piece.theme, (counts.get(piece.theme) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([theme]) => theme);
}

let loading: Promise<{ data: CatalogData; sheets: string[] }> | undefined;

/** 读入目录（编辑器里第一次打开素材栏时）。 */
export function loadCatalog(): Promise<{ data: CatalogData; sheets: string[] }> {
  return loading ??= Promise.all([import("./catalog/catalog.json"), import("./catalog/sheets")])
    .then(([json, sheets]) => ({ data: (json.default ?? json) as unknown as CatalogData, sheets: sheets.SHEETS }));
}
