/**
 * 官方赛道素材：列出赛道、读取模型、列出可拿来摆放的物件，以及把物件
 * 连同它的祖先变换复制成新场景里的一棵子树。浏览器编辑器和 Node 测试
 * 共用，资源库与解码器由调用方传入（浏览器是游戏自己的 Sw/formats）。
 */
import type { TrackMetadata } from "../resources/track-catalog";
import type { Vec3 } from "./design";

export interface SourceEntry {
  readonly name: string;
  readonly virtualPath: string;
  readonly canonicalPath?: string;
  bytes(): Promise<Uint8Array>;
}

export interface TextureResolution {
  status: "found" | "missing" | "none" | "unresolved";
  entry?: SourceEntry;
  extension?: string;
  stem?: string;
  reason?: string;
}

/** 生成和取件需要的那部分资源库。 */
export interface SourceLibrary {
  get(path: string): SourceEntry | undefined;
  mapAssets(): SourceEntry[];
  findSibling(path: string, names: string[]): SourceEntry | undefined;
  trackMetadata(id: string): Promise<TrackMetadata | undefined>;
  trackMetadataCatalog(): Promise<TrackMetadata[]>;
}

/** formats.js 里用到的函数：y9 解码 .1s，sn 按游戏规则查贴图。 */
export interface SourceFormats {
  y9(bytes: Uint8Array): { root: any };
  sn(library: unknown, path: string, metadata: unknown, texture: { name?: string }, ads?: unknown[]): TextureResolution;
}

export interface SourceTrack {
  /** 目录名（track_/<folder>/track.1s）。 */
  folder: string;
  /** 赛道表 id（有的赛道 id 与目录不同）。 */
  id: string;
  title: string;
  theme: string;
  path: string;
  metadata?: TrackMetadata;
}

const THEMES = [
  "steam", "forest", "desert", "village", "ice", "tomb", "mine", "northeu",
  "factory", "pirate", "fairy", "moonhill", "gold", "china", "castle", "nymph",
  "mechanic", "xyy", "wkc", "brodi", "park", "beach", "transFormer",
  "jurassic", "world", "nemo", "sword", "god", "abyss", "camelot",
  "olympos", "korea", "mabi", "maple", "fengshen",
];

export const THEME_TITLES: Record<string, string> = {
  village: "城镇", forest: "森林", desert: "沙漠", ice: "冰河", tomb: "墓地", mine: "矿山",
  northeu: "北欧", factory: "工厂", pirate: "海盗", fairy: "童话", moonhill: "月光",
  gold: "黄金文明", china: "中国", castle: "城堡", nymph: "妖精", mechanic: "机械",
  xyy: "喜羊羊", wkc: "世界赛", brodi: "布罗迪", park: "公园", beach: "海滨",
  transFormer: "变形金刚", jurassic: "侏罗纪", world: "世界", nemo: "尼莫",
  sword: "剑", god: "神殿", abyss: "深渊", camelot: "卡美洛", olympos: "奥林匹斯",
  korea: "韩国", mabi: "洛奇", maple: "冒险岛", fengshen: "封神", steam: "蒸汽",
};

export function themeOf(id: string, metadata?: TrackMetadata): string {
  return metadata?.theme ?? THEMES.find(theme => id.startsWith(theme)) ?? "village";
}

function folderOf(path: string): string | undefined {
  const match = /^track_\/([^/]+)\/track\.1s$/i.exec(path);
  return match?.[1];
}

/** 所有官方赛道（每个 track_/<folder>/track.1s 一条），按主题和名字排序。 */
export async function listSourceTracks(library: SourceLibrary): Promise<SourceTrack[]> {
  const metadata = await library.trackMetadataCatalog();
  const byFolder = new Map<string, TrackMetadata>();
  for (const row of metadata) {
    const key = (row.folder ?? row.id).toLowerCase();
    if (!byFolder.has(key) || row.cnTitle) byFolder.set(key, row);
  }
  const tracks: SourceTrack[] = [];
  for (const asset of library.mapAssets()) {
    const path = asset.canonicalPath ?? asset.virtualPath;
    const folder = folderOf(path);
    if (!folder) continue;
    const row = byFolder.get(folder.toLowerCase());
    const theme = themeOf(row?.id ?? folder, row);
    tracks.push({ folder, id: row?.id ?? folder, title: row?.cnTitle ?? folder, theme, path: asset.virtualPath, metadata: row });
  }
  return tracks.sort((a, b) => a.theme.localeCompare(b.theme) ||
    Number(!a.metadata?.cnTitle) - Number(!b.metadata?.cnTitle) || a.title.localeCompare(b.title, "zh-CN"));
}

export function sourceTrackPath(folder: string): string {
  return `track_/${folder}/track.1s`;
}

// ---------------------------------------------------------------------------
// 3×4 仿射矩阵（列主序 12 个数：前 9 个是 3×3 列，后 3 个是平移）。

export type Affine = number[];
export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** 节点的局部矩阵：行向量 transform 乘列缩放，再平移 position。 */
export function localMatrix(node: { transform: number[][]; scale: number[]; position: number[] }): Affine {
  const [a, b, c] = node.transform as [number[], number[], number[]];
  const s = node.scale;
  return [
    a[0]! * s[0]!, b[0]! * s[0]!, c[0]! * s[0]!,
    a[1]! * s[1]!, b[1]! * s[1]!, c[1]! * s[1]!,
    a[2]! * s[2]!, b[2]! * s[2]!, c[2]! * s[2]!,
    node.position[0]!, node.position[1]!, node.position[2]!,
  ];
}

export function applyAffine(m: Affine, v: ArrayLike<number>): Vec3 {
  return [
    m[0]! * v[0]! + m[3]! * v[1]! + m[6]! * v[2]! + m[9]!,
    m[1]! * v[0]! + m[4]! * v[1]! + m[7]! * v[2]! + m[10]!,
    m[2]! * v[0]! + m[5]! * v[1]! + m[8]! * v[2]! + m[11]!,
  ];
}

export function composeAffine(p: Affine, c: Affine): Affine {
  const r = new Array<number>(12);
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++)
      r[col * 3 + row] = p[row]! * c[col * 3]! + p[3 + row]! * c[col * 3 + 1]! + p[6 + row]! * c[col * 3 + 2]!;
  const t = applyAffine(p, [c[9]!, c[10]!, c[11]!]);
  r[9] = t[0]; r[10] = t[1]; r[11] = t[2];
  return r;
}

/** 偏航（绕 z）→ 俯仰（绕 x）→ 横滚（绕 y）的旋转，R = Rz·Rx·Ry，返回行。 */
export function rotationRows([yaw, pitch, roll]: Vec3): [Vec3, Vec3, Vec3] {
  const r = (d: number) => (d * Math.PI) / 180;
  const cz = Math.cos(r(yaw)), sz = Math.sin(r(yaw));
  const cx = Math.cos(r(pitch)), sx = Math.sin(r(pitch));
  const cy = Math.cos(r(roll)), sy = Math.sin(r(roll));
  // three.js Euler 'ZXY' 的矩阵
  return [
    [cz * cy - sz * sx * sy, -sz * cx, cz * sy + sz * sx * cy],
    [sz * cy + cz * sx * sy, cz * cx, sz * sy - cz * sx * cy],
    [-cx * sy, sx, cx * cy],
  ];
}

/** 摆件的放置矩阵：把来源坐标 origin 搬到 position，先缩放再旋转。 */
export function placementMatrix(piece: { origin: Vec3; position: Vec3; rotation: Vec3; scale: Vec3 }): Affine {
  const rows = rotationRows(piece.rotation);
  const place = localMatrix({ transform: rows, scale: piece.scale, position: piece.position });
  return composeAffine(place, [1, 0, 0, 0, 1, 0, 0, 0, 1, -piece.origin[0], -piece.origin[1], -piece.origin[2]]);
}

// ---------------------------------------------------------------------------
// 物件

export interface PieceInfo {
  path: number[];
  name: string;
  /** 来源赛道坐标里的包围盒。 */
  min: Vec3;
  max: Vec3;
  /** 包围盒底面中心：放置时对齐到 position 的点。 */
  origin: Vec3;
  triangles: number;
  meshes: number;
  /** 子树里有可行驶（带 road 属性）的网格。 */
  drivable: boolean;
  /** 含 surface=리셋（掉落重置）区域。 */
  reset: boolean;
  textures: string[];
}

export function nodeAtPath(scene: any, path: readonly number[]): any {
  let node = scene;
  for (const index of path) {
    node = node?.children?.[index];
    if (!node) return undefined;
  }
  return node;
}

/** 从场景根到 path 指向节点的父节点的世界矩阵。 */
export function parentMatrix(scene: any, path: readonly number[]): Affine {
  let matrix = localMatrix(scene);
  let node = scene;
  for (const index of path.slice(0, -1)) {
    node = node.children[index];
    matrix = composeAffine(matrix, localMatrix(node));
  }
  return matrix;
}

const geometryOf = (node: any) => node.vertexData ?? node.rigidGeometry;

function roadAttributes(node: any): { name: string; value: string }[] | undefined {
  const texture = node.slots?.[7];
  if (texture?.kind !== "texture") return undefined;
  const road = texture.property?.children?.find((child: any) => child.name === "road");
  return road ? road.attributes : undefined;
}

function triangleCount(node: any): number {
  const geometry = geometryOf(node);
  const indices = geometry?.indices?.length ?? 0;
  if (!indices) return 0;
  return node.className === "ReTriStrip" ? Math.max(0, indices - 2) : Math.floor(indices / 3);
}

/** 子树在给定父矩阵下的统计和包围盒。 */
export function measureSubtree(node: any, parent: Affine): Omit<PieceInfo, "path" | "name" | "origin"> {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const textures = new Set<string>();
  let triangles = 0, meshes = 0, drivable = false, reset = false;
  const walk = (n: any, m: Affine) => {
    const world = composeAffine(m, localMatrix(n));
    const geometry = geometryOf(n);
    if (geometry?.positions?.length) {
      meshes++;
      triangles += triangleCount(n);
      for (const p of geometry.positions) {
        const w = applyAffine(world, p);
        for (let i = 0; i < 3; i++) {
          if (w[i]! < min[i]!) min[i] = w[i]!;
          if (w[i]! > max[i]!) max[i] = w[i]!;
        }
      }
    }
    const texture = n.slots?.[7];
    if (texture?.kind === "texture" && texture.name) textures.add(texture.name);
    const road = roadAttributes(n);
    if (road) {
      drivable = true;
      if (road.some(a => a.name === "surface" && a.value === "리셋")) reset = true;
    }
    for (const child of n.children ?? []) walk(child, world);
  };
  walk(node, parent);
  if (!meshes) { min.fill(0); max.fill(0); }
  return { min, max, triangles, meshes, drivable, reset, textures: [...textures] };
}

/**
 * 一条赛道里可以单独拿出来的物件：Scene Root 这类分组的每个子节点，
 * 以及根下直接挂的网格。没有任何网格的节点不列出。
 */
export function listPieces(model: any): PieceInfo[] {
  const scene = model.kind === "track" ? model.scene : model;
  const pieces: PieceInfo[] = [];
  const rootMatrix = localMatrix(scene);
  scene.children.forEach((top: any, i: number) => {
    const isGroup = !geometryOf(top) && top.children?.length;
    const entries: [any, number[], Affine][] = isGroup
      ? top.children.map((child: any, j: number) => [child, [i, j], composeAffine(rootMatrix, localMatrix(top))])
      : [[top, [i], rootMatrix]];
    for (const [node, path, parent] of entries) {
      const info = measureSubtree(node, parent);
      if (!info.meshes) continue;
      pieces.push({
        path, name: node.name || node.className, ...info,
        origin: [(info.min[0] + info.max[0]) / 2, (info.min[1] + info.max[1]) / 2, info.min[2]],
      });
    }
  });
  return pieces;
}

export interface SurfaceTexture {
  name: string;
  /** 原版 road 属性；没有 road 属性的贴图（护栏、墙、地面）为 undefined。 */
  road?: [string, string][];
  alpha?: "test" | "blend";
  /** 用到这张贴图的三角形数（排序用）。 */
  triangles: number;
}

/** 一条赛道用到的贴图，带原版路面属性和透明方式，路面贴图在前。 */
export function listSurfaceTextures(model: any): SurfaceTexture[] {
  const scene = model.kind === "track" ? model.scene : model;
  const found = new Map<string, SurfaceTexture>();
  const walk = (node: any) => {
    const texture = node.slots?.[7];
    if (texture?.kind === "texture" && typeof texture.name === "string" && texture.name) {
      const attributes = roadAttributes(node);
      const road = attributes?.map(a => [a.name, a.value] as [string, string]);
      const alphaSlot = node.slots?.[3];
      const alpha = alphaSlot?.kind === "alpha"
        ? alphaSlot.blendEnable ? "blend" as const : alphaSlot.alphaTestEnable ? "test" as const : undefined : undefined;
      const key = `${texture.name}\n${JSON.stringify(road ?? null)}`;
      const entry = found.get(key) ?? { name: texture.name, road, alpha, triangles: 0 };
      entry.triangles += triangleCount(node);
      found.set(key, entry);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(scene);
  return [...found.values()].sort((a, b) => Number(!!b.road) - Number(!!a.road) || b.triangles - a.triangles);
}

export async function loadSourceModel(library: SourceLibrary, formats: SourceFormats, folder: string): Promise<any> {
  const entry = library.get(sourceTrackPath(folder));
  if (!entry) throw new Error(`找不到官方赛道 ${folder}。`);
  return formats.y9(await entry.bytes()).root;
}
