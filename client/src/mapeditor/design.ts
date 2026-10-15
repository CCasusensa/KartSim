/**
 * 自制地图的设计数据（地图工坊保存、上传和生成赛道包的唯一输入）。
 *
 * 坐标一律是客户端赛道坐标：x 向东、y 向北、z 向上，单位与官方 track.1s
 * 相同。编辑器的 three.js 视口按游戏的约定换成 (x, z, -y) 显示。
 */

export const MAP_FORMAT = "kartsim-map";
export const MAP_VERSION = 1;
/** 自制地图的赛道 id 前缀；容器名为 `track_<trackId>.rho`。 */
export const CUSTOM_TRACK_PREFIX = "custom_";

export type Vec3 = [number, number, number];

/** 官方赛道里的一张贴图：按那条赛道的目录和贴图主题解析。 */
export interface TextureRef {
  track: string;
  name: string;
  /** 原版贴图槽的透明方式：test 镂空（护栏、树叶），blend 半透明。 */
  alpha?: "test" | "blend";
}

/** 路面贴图另带原版贴图槽上的 road 属性（surface、sound、dust …）。 */
export interface RoadTextureRef extends TextureRef {
  road: [string, string][];
}

export interface RoadPoint {
  x: number;
  y: number;
  z: number;
  /** 该点的路宽，缺省用道路的 width。 */
  width?: number;
  /** 横向倾斜（度），正值左高右低。 */
  bank?: number;
}

export interface WallDesign {
  texture: TextureRef;
  height: number;
  /** false：只留碰撞、不显示（贴图换成全透明）。 */
  visible: boolean;
}

export interface RoadDesign {
  id: string;
  name: string;
  /** 闭合成环。比赛路线必须闭合。 */
  closed: boolean;
  /** 比赛路线：圈数、检查门、起点和小地图都按它生成；最多一条。 */
  route: boolean;
  points: RoadPoint[];
  width: number;
  surface: RoadTextureRef;
  /** 沿路方向每张贴图覆盖的长度（米）。 */
  uvLength: number;
  /** 路面下方的侧壁和底板，悬空路段看起来不是一张纸。 */
  thickness: number;
  underside?: TextureRef;
  walls: { left: WallDesign | null; right: WallDesign | null };
}

export interface PieceDesign {
  id: string;
  /** 来源赛道 id（官方赛道目录名，如 village_R01）。 */
  track: string;
  /** 从 Scene Root 起按子节点下标走到这个物件的路径。 */
  path: number[];
  /** 物件原名，仅用于显示。 */
  label: string;
  /** 一起取来的物件共用一个组，编辑器里整组选中、移动。 */
  group?: string;
  /** 来源赛道坐标里的对齐点（取件时是包围盒底面中心），放置后落在 position。 */
  origin: Vec3;
  position: Vec3;
  /** 绕 z（偏航）、x（俯仰）、y（横滚）的角度（度），按偏航→俯仰→横滚依次作用。 */
  rotation: Vec3;
  scale: Vec3;
}

export interface GroundDesign {
  texture: TextureRef;
  /** 正方形边长（米），以原点为中心。 */
  size: number;
  z: number;
  /** 每张贴图覆盖的边长（米）。 */
  tile: number;
  /** 地面能否行驶（带碰撞）。 */
  drivable: boolean;
}

/** 一排道具箱：沿某条道路量 distance 米处横跨路面摆 count 个。 */
export interface ItemBoxRow {
  id: string;
  road: string;
  distance: number;
  count: number;
}

export interface ItemsDesign {
  rows: ItemBoxRow[];
}

/** 起跑线上方的原版起点拱门：取自哪条官方赛道的哪个物件（摆放位置按起跑线自动算）。 */
export interface StartArch {
  track: string;
  path: number[];
  label: string;
  /** 来源赛道坐标里的包围盒和底面中心（与摆件的 origin 相同）。 */
  origin: Vec3;
  min: Vec3;
  max: Vec3;
}

export interface StartDesign {
  /** 起点线到比赛路线第一个控制点的距离（米，沿路线）。 */
  offset: number;
  /** 起点拱门：null 表示不要；缺省（旧地图）时编辑器按主题补上。 */
  arch?: StartArch | null;
}

export interface MapDesign {
  format: typeof MAP_FORMAT;
  version: typeof MAP_VERSION;
  id: string;
  name: string;
  laps: number;
  /** 选图界面的难度星级 1–5。 */
  difficulty: number;
  /** 背景音乐与载入画面的主题，如 village。 */
  theme: string;
  /** 天空盒、雾和光照取自哪条官方赛道。 */
  sky: string;
  ground: GroundDesign | null;
  roads: RoadDesign[];
  pieces: PieceDesign[];
  start: StartDesign;
  /** 道具赛的道具箱；没有道具箱的地图只能用于竞速。 */
  items: ItemsDesign;
  updatedAt: number;
}

export const MAP_LIMITS = {
  nameLength: 24,
  laps: [1, 9] as const,
  roads: 64,
  roadPoints: 512,
  pieces: 4000,
  itemRows: 64,
  itemsPerRow: [1, 8] as const,
  width: [4, 80] as const,
  extent: 8000,
  wallHeight: [0.2, 30] as const,
};

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId(length = 10): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

export function customTrackId(mapId: string): string {
  return `${CUSTOM_TRACK_PREFIX}${mapId}`;
}

/** 本机草稿的赛道 id：与发布版本分开，草稿只在本机计时赛里出现。 */
export function draftTrackId(mapId: string): string {
  return `${CUSTOM_TRACK_PREFIX}${mapId}_draft`;
}

export function isCustomTrackId(trackId: unknown): trackId is string {
  return typeof trackId === "string" && /^custom_[0-9a-z]{6,16}(?:_draft)?$/.test(trackId);
}

export function isDraftTrackId(trackId: unknown): boolean {
  return isCustomTrackId(trackId) && trackId.endsWith("_draft");
}

/** 已发布地图的地图 id（草稿返回 undefined）。 */
export function mapIdOfTrack(trackId: string): string | undefined {
  return isCustomTrackId(trackId) && !trackId.endsWith("_draft") ? trackId.slice(CUSTOM_TRACK_PREFIX.length) : undefined;
}

/** 缺省素材（城镇 高速公路的柏油路面与护栏、城镇 宫殿的草地）。 */
export const DEFAULT_ROAD_SURFACE: RoadTextureRef = { track: "village_R01", name: "cement_00", road: [] };
export const DEFAULT_WALL: WallDesign = { texture: { track: "village_R01", name: "handrail", alpha: "test" }, height: 1.2, visible: true };

export function defaultGround(): GroundDesign {
  return { texture: { track: "village_I01", name: "tilegrass_128_03" }, size: 1200, z: -0.3, tile: 16, drivable: true };
}

export function newDesign(name = "我的赛道"): MapDesign {
  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    id: randomId(),
    name,
    laps: 3,
    difficulty: 2,
    theme: "village",
    sky: "village_R01",
    ground: null,
    roads: [],
    pieces: [],
    start: { offset: 0 },
    items: { rows: [] },
    updatedAt: Date.now(),
  };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(finite);
const textureRef = (value: unknown): value is TextureRef =>
  !!value && typeof value === "object" &&
  typeof (value as TextureRef).track === "string" && typeof (value as TextureRef).name === "string" &&
  /^[A-Za-z0-9_\-]{1,64}$/.test((value as TextureRef).track) && (value as TextureRef).name.length > 0 &&
  (value as TextureRef).name.length <= 96;

/** 检查设计数据；返回问题列表，空表示可以生成。 */
export function validateDesign(design: MapDesign): string[] {
  const issues: string[] = [];
  if (design.format !== MAP_FORMAT || design.version !== MAP_VERSION) issues.push("不是地图工坊的设计文件。");
  if (!/^[0-9a-z]{6,16}$/.test(design.id)) issues.push("地图 id 无效。");
  const name = design.name.trim();
  if (!name || [...name].length > MAP_LIMITS.nameLength) issues.push(`地图名需要 1–${MAP_LIMITS.nameLength} 个字。`);
  if (!Number.isInteger(design.laps) || design.laps < MAP_LIMITS.laps[0] || design.laps > MAP_LIMITS.laps[1])
    issues.push(`圈数需要 ${MAP_LIMITS.laps[0]}–${MAP_LIMITS.laps[1]}。`);
  if (!Number.isInteger(design.difficulty) || design.difficulty < 1 || design.difficulty > 5) issues.push("难度需要 1–5。");
  if (!/^[A-Za-z0-9_\-]{1,64}$/.test(design.sky)) issues.push("天空来源赛道无效。");
  if (!/^[A-Za-z]{2,16}$/.test(design.theme)) issues.push("主题无效。");
  if (design.roads.length > MAP_LIMITS.roads) issues.push(`道路最多 ${MAP_LIMITS.roads} 条。`);
  if (design.pieces.length > MAP_LIMITS.pieces) issues.push(`摆件最多 ${MAP_LIMITS.pieces} 个。`);
  const routes = design.roads.filter(road => road.route);
  if (routes.length !== 1) issues.push("需要恰好一条比赛路线（在道路属性里勾选“比赛路线”）。");
  for (const road of design.roads) {
    const label = road.name || road.id;
    if (road.points.length < 2 || road.points.length > MAP_LIMITS.roadPoints)
      issues.push(`道路「${label}」需要 2–${MAP_LIMITS.roadPoints} 个控制点。`);
    if (road.route && (!road.closed || road.points.length < 3)) issues.push(`比赛路线「${label}」必须闭合，至少 3 个控制点。`);
    if (!finite(road.width) || road.width < MAP_LIMITS.width[0] || road.width > MAP_LIMITS.width[1])
      issues.push(`道路「${label}」宽度需要 ${MAP_LIMITS.width[0]}–${MAP_LIMITS.width[1]} 米。`);
    if (!textureRef(road.surface)) issues.push(`道路「${label}」没有路面贴图。`);
    for (const point of road.points) {
      if (![point.x, point.y, point.z].every(finite) ||
        Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > MAP_LIMITS.extent) {
        issues.push(`道路「${label}」有控制点超出 ±${MAP_LIMITS.extent} 米。`);
        break;
      }
    }
    for (const wall of [road.walls.left, road.walls.right]) {
      if (wall && (!textureRef(wall.texture) || !finite(wall.height) ||
        wall.height < MAP_LIMITS.wallHeight[0] || wall.height > MAP_LIMITS.wallHeight[1]))
        issues.push(`道路「${label}」的护墙设置无效。`);
    }
  }
  for (const piece of design.pieces) {
    if (!/^[A-Za-z0-9_\-]{1,64}$/.test(piece.track) || !Array.isArray(piece.path) || !piece.path.length ||
      !piece.path.every(i => Number.isInteger(i) && i >= 0) || !vec3(piece.origin) ||
      !vec3(piece.position) || !vec3(piece.rotation) ||
      !vec3(piece.scale) || piece.scale.some(s => Math.abs(s) < 1e-3 || Math.abs(s) > 100) ||
      piece.position.some(v => Math.abs(v) > MAP_LIMITS.extent)) {
      issues.push(`摆件「${piece.label || piece.id}」的数据无效。`);
      break;
    }
  }
  if (design.items.rows.length > MAP_LIMITS.itemRows) issues.push(`道具箱最多 ${MAP_LIMITS.itemRows} 排。`);
  for (const row of design.items.rows) {
    if (!design.roads.some(road => road.id === row.road) || !finite(row.distance) || row.distance < 0 ||
      !Number.isInteger(row.count) || row.count < MAP_LIMITS.itemsPerRow[0] || row.count > MAP_LIMITS.itemsPerRow[1]) {
      issues.push("有一排道具箱的设置无效（所在道路被删了？）。");
      break;
    }
  }
  const arch = design.start.arch;
  if (!finite(design.start.offset) || design.start.offset < 0) issues.push("起跑线位置无效。");
  if (arch && (!/^[A-Za-z0-9_\-]{1,64}$/.test(arch.track) || !Array.isArray(arch.path) || !arch.path.length ||
    !arch.path.every(index => Number.isInteger(index) && index >= 0) || !vec3(arch.origin) || !vec3(arch.min) || !vec3(arch.max)))
    issues.push("起点拱门设置无效。");
  if (design.ground && (!textureRef(design.ground.texture) || !finite(design.ground.size) ||
    design.ground.size < 20 || design.ground.size > MAP_LIMITS.extent * 2 || !finite(design.ground.tile) ||
    design.ground.tile <= 0)) issues.push("地面设置无效。");
  return issues;
}

/**
 * 一组摆件整体绕竖直轴转 degrees 度（正值逆时针，原地修改）：绕所有摆件位置的平均点
 * （与高级模式多选手柄的中心相同）转，彼此的相对位置不变；只有一个时就是原地转。
 * 平均点转完不变，所以连按 24 次 15° 会回到原处。
 */
export function rotatePiecesAboutCenter(pieces: Pick<PieceDesign, "position" | "rotation">[], degrees: number): void {
  if (!pieces.length) return;
  const cx = pieces.reduce((sum, piece) => sum + piece.position[0], 0) / pieces.length;
  const cy = pieces.reduce((sum, piece) => sum + piece.position[1], 0) / pieces.length;
  const cos = Math.cos((degrees * Math.PI) / 180), sin = Math.sin((degrees * Math.PI) / 180);
  const round = (value: number) => Math.round(value * 100) / 100 || 0; // 不留 -0
  for (const piece of pieces) {
    if (pieces.length > 1) {
      const dx = piece.position[0] - cx, dy = piece.position[1] - cy;
      piece.position[0] = round(cx + dx * cos - dy * sin);
      piece.position[1] = round(cy + dx * sin + dy * cos);
    }
    piece.rotation[0] = round(((piece.rotation[0] + degrees) % 360 + 360) % 360);
  }
}

/** 道具箱总数（道具赛需要至少一个）。 */
export function itemBoxCount(design: Pick<MapDesign, "items">): number {
  return design.items.rows.reduce((sum, row) => sum + row.count, 0);
}

/** 解析并补全一个设计文件（导入、读档）；格式不对时抛错。 */
export function parseDesign(text: string): MapDesign {
  const value = JSON.parse(text) as Partial<MapDesign>;
  if (value?.format !== MAP_FORMAT) throw new Error("不是地图工坊的设计文件。");
  if (value.version !== MAP_VERSION) throw new Error(`不支持的设计版本 ${String(value.version)}。`);
  const design: MapDesign = {
    ...newDesign(),
    ...value,
    roads: (value.roads ?? []).map(road => ({
      ...road,
      walls: { left: road.walls?.left ?? null, right: road.walls?.right ?? null },
      thickness: road.thickness ?? 0,
      uvLength: road.uvLength ?? road.width,
    })),
    pieces: value.pieces ?? [],
    start: value.start ?? { offset: 0 },
    items: { rows: value.items?.rows ?? [] },
    difficulty: value.difficulty ?? 2,
  } as MapDesign;
  return design;
}
