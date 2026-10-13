/**
 * 设计数据 → 游戏能直接加载的赛道包（track_custom_<id>.rho）。
 *
 * 包内文件与官方赛道相同：track.1s（场景、路线、小地图、赛道设置）、
 * skydome.1s、track.xml（天气）、xt_minimap / xt_trackCard / xt_trackThumb
 * 图片，以及用到的全部贴图（从官方资源按游戏的查找规则复制，重名时改名）。
 * 容器不在 aaa.pk 里，游戏把它挂在 `track_custom_<id>/` 下。
 *
 * 设计坐标整体平移到正象限：游戏只收录 [0, roadExtent) 范围内的碰撞面。
 */
import { packRhoArchive } from "../codecs/rho-writer";
import {
  encodeTrackModel, makeAlphaProperty, makeBackFaceProperty, makeNode, makeTexProperty,
  makeTrackContainer, makeTriListNode, makeVertexData, makeXml,
  type TrackNode, type TrackObjectRecord, type TrackProperty, type TrackXmlNode,
} from "../resources/track-binary-writer";
import {
  customTrackId, validateDesign,
  type MapDesign, type RoadDesign, type TextureRef, type Vec3, type WallDesign,
} from "./design";
import { MeshBuilder, type Corner } from "./mesh-builder";
import { RgbaCanvas, encodePng, type Rgba } from "./png";
import { pointAtDistance, rotateClosedSample, roadEdge, sampleRoad, type RoadSample } from "./road-geometry";
import {
  applyAffine, loadSourceModel, measureSubtree, nodeAtPath, parentMatrix, placementMatrix,
  rotationRows, sourceTrackPath, type SourceEntry, type SourceFormats, type SourceLibrary,
} from "./source-tracks";

export interface BuildOptions {
  library: SourceLibrary;
  formats: SourceFormats;
  /** 编辑器截的预览图；缺省用小地图拼一张。 */
  card?: Uint8Array;
  thumb?: Uint8Array;
  onProgress?(message: string): void;
}

export interface BuiltFile { path: string; bytes: Uint8Array }

export interface BuiltTrack {
  trackId: string;
  containerName: string;
  files: BuiltFile[];
  container: Uint8Array;
  /** 设计坐标 + offset = 赛道坐标。 */
  offset: Vec3;
  roadExtent: number;
  /** 路线总长（米）。 */
  routeLength: number;
  stats: { meshes: number; triangles: number; textures: number; pieces: number; gates: number; itemBoxes: number };
  warnings: string[];
}

const MARGIN = 60;
const GATE_SPACING = 40;
const GATE_MARGIN = 6;
const CHUNK_LENGTH = 160;
const SAMPLE_STEP = 2;

const safeStem = (name: string) => name.replace(/[^A-Za-z0-9_@\-\.]/g, "_").slice(0, 60) || "tex";
const TRANSPARENT_PNG = encodePng(4, 4, new Uint8Array(64));

/** 道路生成用的贴图解析：返回网格里写的贴图名。 */
export interface TextureResolver {
  resolve(track: string, name: string): Promise<string | undefined>;
  generated(stem: string, bytes: Uint8Array): string;
}

/** 收集要放进赛道包的贴图，每个来源文件一个唯一的名字。 */
class TextureCollector implements TextureResolver {
  readonly files = new Map<string, { stem: string; extension: string; bytes: () => Promise<Uint8Array> }>();
  private readonly bySource = new Map<string, string>();
  private readonly byRef = new Map<string, string | null>();
  readonly missing = new Set<string>();

  constructor(private readonly library: SourceLibrary, private readonly formats: SourceFormats) {}

  /** 按某条官方赛道的查找规则解析贴图，返回包内名字；找不到返回 undefined。 */
  async resolve(track: string, name: string): Promise<string | undefined> {
    const key = `${track}\n${name}`;
    if (this.byRef.has(key)) return this.byRef.get(key) ?? undefined;
    const path = sourceTrackPath(track);
    const metadata = await this.library.trackMetadata(track);
    let stem: string | undefined;
    try {
      const found = this.formats.sn(this.library, path, metadata ?? { id: track }, { name });
      if (found.status === "found" && found.entry) stem = this.adopt(found.entry, found.extension ?? "dds", name);
    } catch { /* 当作缺失 */ }
    if (!stem) this.missing.add(`${track}/${name}`);
    this.byRef.set(key, stem ?? null);
    return stem;
  }

  adopt(entry: SourceEntry, extension: string, preferred: string): string {
    const key = (entry.canonicalPath ?? entry.virtualPath).toLowerCase();
    const known = this.bySource.get(key);
    if (known) return known;
    const base = safeStem(preferred.endsWith("@zz") ? preferred.slice(0, -3) : preferred);
    let stem = base, n = 2;
    while (this.files.has(stem.toLowerCase())) stem = `${base}_${n++}`;
    this.files.set(stem.toLowerCase(), { stem, extension: extension.toLowerCase(), bytes: () => entry.bytes() });
    this.bySource.set(key, stem);
    return stem;
  }

  generated(stem: string, bytes: Uint8Array): string {
    if (!this.files.has(stem.toLowerCase()))
      this.files.set(stem.toLowerCase(), { stem, extension: "png", bytes: async () => bytes });
    return stem;
  }

  async entries(): Promise<BuiltFile[]> {
    const out: BuiltFile[] = [];
    for (const { stem, extension, bytes } of this.files.values()) out.push({ path: `${stem}.${extension}`, bytes: await bytes() });
    return out;
  }
}

interface Surface {
  slots: TrackProperty[];
}

function roadProperty(attributes: [string, string][] | undefined): TrackXmlNode | undefined {
  if (!attributes) return undefined;
  return makeXml("property", {}, [makeXml("road", attributes.map(([name, value]) => ({ name, value })))]);
}

function surfaceSlots(stem: string, options: { road?: [string, string][]; alpha?: "test" | "blend"; doubleSided?: boolean }): Surface {
  const slots: TrackProperty[] = [makeTexProperty(stem, { magFilter: 3, property: roadProperty(options.road) }) as unknown as TrackProperty];
  if (options.alpha === "test") slots.push(makeAlphaProperty({ alphaTestEnable: 1, alphaRef: 128 }) as unknown as TrackProperty);
  if (options.alpha === "blend") slots.push(makeAlphaProperty({ blendEnable: 1, alphaTestEnable: 0, alphaRef: 0 }) as unknown as TrackProperty);
  if (options.doubleSided) slots.push(makeBackFaceProperty(1) as unknown as TrackProperty);
  return { slots };
}

function meshNodes(name: string, mesh: MeshBuilder, surface: Surface): TrackNode[] {
  if (mesh.isEmpty()) return [];
  return mesh.split(60000).map((piece, index) => makeTriListNode(`${name}${index ? `_${index}` : ""}`,
    makeVertexData({ positions: piece.positions, normals: piece.normals, uvs: piece.uvs, indices: piece.indices }),
    { properties: surface.slots }));
}

// ---------------------------------------------------------------------------
// 道路

export interface BuiltRoad { sample: RoadSample; nodes: TrackNode[] }

export const TRANSPARENT_TEXTURE = TRANSPARENT_PNG;

/** 一条道路的路面、侧壁和护墙网格（编辑器预览与生成共用）。 */
export async function buildRoad(road: RoadDesign, textures: TextureResolver, warnings: string[]): Promise<BuiltRoad> {
  const sample = sampleRoad(road, SAMPLE_STEP);
  const nodes: TrackNode[] = [];
  const m = sample.points.length;
  if (m < 2) return { sample, nodes };
  const count = sample.closed ? m : m - 1;
  const label = road.name || road.id;
  const deckStem = await textures.resolve(road.surface.track, road.surface.name);
  if (!deckStem) warnings.push(`道路「${label}」的路面贴图 ${road.surface.name} 找不到，路面不显示贴图。`);
  const deck = surfaceSlots(deckStem ?? textures.generated("kr_missing", TRANSPARENT_PNG),
    { road: road.surface.road, alpha: road.surface.alpha });
  const sStart = (i: number) => sample.s[i]!;
  const sEnd = (j: number) => (sample.closed && j === 0 ? sample.total : sample.s[j]!);
  const uvLength = Math.max(1, road.uvLength || road.width);

  // 每 CHUNK_LENGTH 米一块，便于视锥剔除
  let chunk = new MeshBuilder(), chunkStart = 0, chunkIndex = 0;
  const flush = () => {
    nodes.push(...meshNodes(`road_${road.id}_${chunkIndex++}`, chunk, deck));
    chunk = new MeshBuilder();
  };
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % m;
    const wi = sample.widths[i]! / 2, wj = sample.widths[j]! / 2;
    const v0 = sStart(i) / uvLength, v1 = sEnd(j) / uvLength;
    const corners: [Corner, Corner, Corner, Corner] = [
      [roadEdge(sample, i, wi), [0, v0]],
      [roadEdge(sample, i, -wi), [1, v0]],
      [roadEdge(sample, j, -wj), [1, v1]],
      [roadEdge(sample, j, wj), [0, v1]],
    ];
    chunk.pushSmoothQuad(corners, [sample.normals[i]!, sample.normals[i]!, sample.normals[j]!, sample.normals[j]!], sample.normals[i]!);
    if (sEnd(j) - chunkStart >= CHUNK_LENGTH) { flush(); chunkStart = sEnd(j); }
  }
  flush();

  // 路面厚度：两侧侧壁和底板（只显示，不碰撞）
  if (road.thickness > 0.05) {
    const sideStem = road.underside ? await textures.resolve(road.underside.track, road.underside.name) : deckStem;
    const side = surfaceSlots(sideStem ?? textures.generated("kr_missing", TRANSPARENT_PNG), { doubleSided: true });
    const mesh = new MeshBuilder();
    const down = (p: Vec3): Vec3 => [p[0], p[1], p[2] - road.thickness];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % m;
      const wi = sample.widths[i]! / 2, wj = sample.widths[j]! / 2;
      const u0 = sStart(i) / uvLength, u1 = sEnd(j) / uvLength;
      for (const sideSign of [1, -1]) {
        const a = roadEdge(sample, i, sideSign * wi), b = roadEdge(sample, j, sideSign * wj);
        const out: Vec3 = [sample.lefts[i]![0] * sideSign, sample.lefts[i]![1] * sideSign, 0];
        mesh.pushQuad([a, [u0, 0]], [b, [u1, 0]], [down(b), [u1, 0.25]], [down(a), [u0, 0.25]], out);
      }
      const l0 = down(roadEdge(sample, i, wi)), r0 = down(roadEdge(sample, i, -wi));
      const l1 = down(roadEdge(sample, j, wj)), r1 = down(roadEdge(sample, j, -wj));
      mesh.pushQuad([l0, [0, u0]], [r0, [1, u0]], [r1, [1, u1]], [l1, [0, u1]], [0, 0, -1]);
    }
    nodes.push(...meshNodes(`road_${road.id}_side`, mesh, side));
  }

  // 护墙：带碰撞（road 属性为空），面朝路面
  const wall = async (design: WallDesign | null, sideSign: 1 | -1) => {
    if (!design) return;
    const stem = design.visible ? await textures.resolve(design.texture.track, design.texture.name) : undefined;
    if (design.visible && !stem) warnings.push(`道路「${label}」的护墙贴图 ${design.texture.name} 找不到，改为透明护墙。`);
    const surface = surfaceSlots(stem ?? textures.generated("kr_collider", TRANSPARENT_PNG),
      { road: [], alpha: stem ? design.texture.alpha ?? "test" : "test", doubleSided: true });
    const mesh = new MeshBuilder();
    const h = design.height;
    const uScale = Math.max(1, h * 2);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % m;
      const a = roadEdge(sample, i, sideSign * (sample.widths[i]! / 2 + 0.05));
      const b = roadEdge(sample, j, sideSign * (sample.widths[j]! / 2 + 0.05));
      const u0 = sStart(i) / uScale, u1 = sEnd(j) / uScale;
      const inward: Vec3 = [-sample.lefts[i]![0] * sideSign, -sample.lefts[i]![1] * sideSign, 0];
      mesh.pushQuad([a, [u0, 1]], [b, [u1, 1]], [[b[0], b[1], b[2] + h], [u1, 0]], [[a[0], a[1], a[2] + h], [u0, 0]], inward);
    }
    nodes.push(...meshNodes(`wall_${road.id}_${sideSign > 0 ? "l" : "r"}`, mesh, surface));
  };
  await wall(road.walls.left, 1);
  await wall(road.walls.right, -1);
  return { sample, nodes };
}

// ---------------------------------------------------------------------------
// 摆件

const OCCURRENCE_KEYS = ["slotOccurrences", "childOccurrences", "vertexDataOccurrence",
  "rigidGeometryOccurrence", "additionalPropertyOccurrence"] as const;

class PieceCloner {
  private readonly slotCopies = new Map<object, unknown>();
  private readonly nodeCopies = new Map<object, TrackNode>();
  constructor(private readonly renames: Map<string, string | undefined>) {}

  private texture(slot: any): unknown {
    let copy = this.slotCopies.get(slot);
    if (copy) return copy;
    const next: any = { ...slot };
    delete next.nameOccurrence; delete next.propertyOccurrence;
    delete next.uvControllerOccurrences; delete next.alphaControllerOccurrence;
    if (typeof slot.name === "string") next.name = this.renames.get(slot.name) ?? slot.name;
    const road = slot.property?.children?.find((child: any) => child.name === "road");
    if (road?.attributes?.some((a: any) => a.name === "movable")) {
      // 单独摆出来的移动路面没有 ToMovableObject 驱动，按静止路面处理
      next.property = { ...slot.property, children: slot.property.children.map((child: any) => child === road
        ? { ...road, attributes: road.attributes.filter((a: any) => a.name !== "movable") } : child) };
    }
    this.slotCopies.set(slot, next);
    return next;
  }

  clone(node: any): TrackNode | undefined {
    if (node.className === "ReCamera") return undefined;
    const known = this.nodeCopies.get(node);
    if (known) return structuredCloneShallow(known);
    const copy: any = { ...node };
    for (const key of OCCURRENCE_KEYS) delete copy[key];
    copy.transform = node.transform.map((row: number[]) => [...row]);
    copy.position = [...node.position];
    copy.scale = [...node.scale];
    copy.slots = node.slots.map((slot: any) => slot?.kind === "texture" ? this.texture(slot) : slot);
    copy.children = node.children.flatMap((child: any) => this.clone(child) ?? []);
    this.nodeCopies.set(node, copy);
    return copy;
  }
}

/** 同一个来源节点再次摆放：节点对象要新的（父子关系不同），网格与贴图槽共享。 */
function structuredCloneShallow(node: TrackNode): TrackNode {
  return { ...node, children: node.children.map(structuredCloneShallow) };
}

function textureNamesOf(node: any, out: Set<string>): Set<string> {
  for (const slot of node.slots ?? []) if (slot?.kind === "texture" && typeof slot.name === "string") out.add(slot.name);
  for (const child of node.children ?? []) textureNamesOf(child, out);
  return out;
}

function transformGroup(name: string, source: { transform: number[][]; position: number[]; scale: number[] }, children: TrackNode[]): TrackNode {
  return makeNode("Relement", {
    name,
    transform: source.transform.map(row => [...row]) as TrackNode["transform"],
    position: [...source.position] as Vec3,
    scale: [...source.scale] as Vec3,
    children,
  });
}

// ---------------------------------------------------------------------------
// 路线与小地图

function routeRecords(sample: RoadSample, offset: Vec3) {
  const m = sample.points.length;
  const gates: number[] = [];
  let next = 0;
  for (let i = 0; i < m; i++) if (sample.s[i]! >= next - 1e-6) { gates.push(i); next += GATE_SPACING; }
  if (gates.length > 1 && sample.total - sample.s[gates[gates.length - 1]!]! < GATE_SPACING * 0.5) gates.pop();
  const shift = (p: Vec3): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
  const forward = (i: number): Vec3 => {
    const l = sample.lefts[i]!; // 水平前向 = 左向量顺时针转 90°
    return [l[1], -l[0], 0];
  };
  const frameAt = (i: number) => ({ position: shift([sample.points[i]![0], sample.points[i]![1], sample.points[i]![2] + 1]), storedForward: forward(i), up: [0, 0, 1] as Vec3 });
  return gates.map((i, g) => {
    const end = gates[(g + 1) % gates.length]!;
    const half = sample.widths[i]! / 2 + GATE_MARGIN;
    const left = roadEdge(sample, i, half), right = roadEdge(sample, i, -half);
    const z = sample.points[i]![2];
    const positions: Vec3[] = [
      shift([left[0], left[1], z - 1]), shift([right[0], right[1], z - 1]),
      shift([left[0], left[1], z + 19]), shift([right[0], right[1], z + 19]),
    ];
    const span = end > i ? end - i : end + m - i;
    const frames = [];
    for (let k = 0; k < span; k += 3) frames.push(frameAt((i + k) % m));
    frames.push(frameAt(end));
    return { name: `g${String(g).padStart(3, "0")}`, positions, gateIndices: [[0, 1, 3], [0, 3, 2]], surface: "", surfaceIndices: [], frames };
  });
}

/** 官方道具箱一排里相邻两个的间距（forest_I01 ic02/ic33/ic34：3.85 米）。 */
const CUBE_SPACING = 3.85;
/** 道具箱离路面的高度（官方 +1.0 ~ +2.0）。 */
const CUBE_HEIGHT = 1.2;
const CUBE_BASIS: Vec3[] = [[0.266, 0, 0], [0, 0.266, 0], [0, 0, 0.266]];

/** 一排道具箱在设计坐标里的位置（编辑器预览与生成共用）。 */
export function itemRowPositions(sample: RoadSample, distance: number, count: number): Vec3[] {
  if (sample.points.length < 2) return [];
  const { index } = pointAtDistance(sample, distance);
  const width = sample.widths[index]!;
  const spacing = count > 1 ? Math.min(CUBE_SPACING, Math.max(1.5, (width - 3) / (count - 1))) : 0;
  return Array.from({ length: count }, (_, i) => {
    const p = roadEdge(sample, index, (i - (count - 1) / 2) * spacing);
    return [p[0], p[1], p[2] + CUBE_HEIGHT] as Vec3;
  });
}

function itemCubeRecords(design: MapDesign, samples: { id: string; sample: RoadSample }[], offset: Vec3): TrackObjectRecord[] {
  const records: TrackObjectRecord[] = [];
  for (const row of design.items.rows) {
    const sample = samples.find(entry => entry.id === row.road)?.sample;
    if (!sample) continue;
    for (const position of itemRowPositions(sample, row.distance, row.count)) {
      const ordinal = records.length + 1;
      records.push({ kind: "ToItemCube", name: `ic${String(ordinal).padStart(2, "0")}`, property: undefined,
        transform: { basis: CUBE_BASIS.map(row => [...row]), position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
          scale: [1, 1, 1] }, instanceOrdinal: ordinal });
    }
  }
  return records;
}

interface MinimapFrame { centerX: number; centerY: number; scale: number }

function minimapFrame(bounds: { min: Vec3; max: Vec3 }): MinimapFrame {
  const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], 50) * 1.08;
  return { centerX: (bounds.min[0] + bounds.max[0]) / 2, centerY: (bounds.min[1] + bounds.max[1]) / 2, scale: 236 / size };
}

function drawMinimap(frame: MinimapFrame, roads: { sample: RoadSample; route: boolean }[], offset: Vec3, density: number, size: number, background: Rgba): RgbaCanvas {
  const canvas = new RgbaCanvas(size, size, background);
  const k = (size / 256);
  const px = (p: Vec3): [number, number] => [k * (128 + (p[0] + offset[0] - frame.centerX) * frame.scale), k * (128 - (p[1] + offset[1] - frame.centerY) * frame.scale)];
  for (const { sample, route } of [...roads].sort((a, b) => Number(a.route) - Number(b.route))) {
    const width = route ? 7 * density : 4 * density;
    const color: Rgba = route ? [255, 255, 255, 255] : [200, 200, 200, 255];
    const n = sample.points.length;
    const segments = sample.closed ? n : n - 1;
    for (let i = 0; i < segments; i += 1) {
      const a = px(sample.points[i]!), b = px(sample.points[(i + 1) % n]!);
      canvas.line(a[0], a[1], b[0], b[1], width * k / density, color);
    }
  }
  return canvas;
}

/** 小地图描边叠在一张底色上，作为没有截图时的赛道卡片。 */
function placeholderCard(width: number, height: number, minimap: RgbaCanvas, color: Rgba): Uint8Array {
  const canvas = new RgbaCanvas(width, height, color);
  const scale = Math.min(width, height) / minimap.width * 0.9;
  const ox = (width - minimap.width * scale) / 2, oy = (height - minimap.height * scale) / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x - ox) / scale), sy = Math.floor((y - oy) / scale);
    if (sx < 0 || sy < 0 || sx >= minimap.width || sy >= minimap.height) continue;
    const i = (sy * minimap.width + sx) * 4;
    const a = minimap.data[i + 3]!;
    if (a) canvas.set(x, y, [minimap.data[i]!, minimap.data[i + 1]!, minimap.data[i + 2]!, Math.round(a * 0.85)]);
  }
  return canvas.png();
}

function utf16(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; }
  return out;
}

const THEME_GROUND: Record<string, Rgba> = {
  village: [86, 128, 70, 255], forest: [56, 104, 60, 255], desert: [190, 150, 90, 255], ice: [190, 215, 235, 255],
  beach: [210, 190, 140, 255], china: [120, 100, 80, 255], factory: [110, 100, 90, 255],
};

// ---------------------------------------------------------------------------

/** 生成整套赛道文件并打包。 */
export async function buildCustomTrack(design: MapDesign, options: BuildOptions): Promise<BuiltTrack> {
  const issues = validateDesign(design);
  if (issues.length) throw new Error(issues.join("\n"));
  const { library, formats } = options;
  const progress = options.onProgress ?? (() => undefined);
  const warnings: string[] = [];
  const textures = new TextureCollector(library, formats);
  const trackId = customTrackId(design.id);

  // 道路
  progress("生成道路");
  const roads: { design: RoadDesign; built: BuiltRoad }[] = [];
  for (const road of design.roads) roads.push({ design: road, built: await buildRoad(road, textures, warnings) });

  // 摆件：按来源赛道分组读取模型
  progress("复制官方摆件");
  const pieceNodes: TrackNode[] = [];
  const bounds = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
  const grow = (p: Vec3) => { for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i]!, p[i]!); bounds.max[i] = Math.max(bounds.max[i]!, p[i]!); } };
  const byTrack = new Map<string, typeof design.pieces>();
  for (const piece of design.pieces) byTrack.set(piece.track, [...(byTrack.get(piece.track) ?? []), piece]);
  let placed = 0;
  for (const [track, pieces] of byTrack) {
    let model: any;
    try { model = await loadSourceModel(library, formats, track); }
    catch (error) { warnings.push(`官方赛道 ${track} 读取失败，跳过 ${pieces.length} 个摆件：${(error as Error).message}`); continue; }
    const scene = model.scene;
    const renames = new Map<string, string | undefined>();
    const cloner = new PieceCloner(renames);
    for (const piece of pieces) {
      const target = nodeAtPath(scene, piece.path);
      if (!target) { warnings.push(`摆件「${piece.label}」在 ${track} 里找不到，已跳过。`); continue; }
      for (const name of textureNamesOf(target, new Set())) {
        if (!renames.has(name)) renames.set(name, await textures.resolve(track, name));
      }
      const clone = cloner.clone(target);
      if (!clone) continue;
      // 祖先只保留变换
      let chain = clone;
      const ancestors: any[] = [scene];
      let node = scene;
      for (const index of piece.path.slice(0, -1)) { node = node.children[index]; ancestors.push(node); }
      for (let k = ancestors.length - 1; k >= 0; k--) chain = transformGroup(`${ancestors[k].name || "group"}~`, ancestors[k], [chain]);
      const rows = rotationRows(piece.rotation);
      const offsetGroup = makeNode("Relement", { name: "origin", position: [-piece.origin[0], -piece.origin[1], -piece.origin[2]], children: [chain] });
      pieceNodes.push(makeNode("Relement", { name: `piece_${piece.id}`, transform: rows, scale: [...piece.scale] as Vec3, position: [...piece.position] as Vec3, children: [offsetGroup] }));
      // 包围盒
      const measured = measureSubtree(target, parentMatrix(scene, piece.path));
      const place = placementMatrix(piece);
      for (let c = 0; c < 8; c++) grow(applyAffine(place, [
        c & 1 ? measured.max[0] : measured.min[0], c & 2 ? measured.max[1] : measured.min[1], c & 4 ? measured.max[2] : measured.min[2],
      ]));
      placed++;
    }
  }
  for (const missing of textures.missing) warnings.push(`贴图 ${missing} 找不到。`);

  for (const { built } of roads) {
    for (let i = 0; i < built.sample.points.length; i++) {
      const w = built.sample.widths[i]! / 2 + GATE_MARGIN + 2;
      grow(roadEdge(built.sample, i, w)); grow(roadEdge(built.sample, i, -w));
    }
  }
  const ground = design.ground;
  if (ground) { grow([-ground.size / 2, -ground.size / 2, ground.z]); grow([ground.size / 2, ground.size / 2, ground.z]); }
  if (!Number.isFinite(bounds.min[0])) throw new Error("地图是空的。");
  const offset: Vec3 = [MARGIN - bounds.min[0], MARGIN - bounds.min[1], 0];
  const roadExtent = Math.ceil(Math.max(bounds.max[0] + offset[0], bounds.max[1] + offset[1]) + MARGIN);

  // 地面
  const groundNodes: TrackNode[] = [];
  if (ground) {
    const stem = await textures.resolve(ground.texture.track, ground.texture.name);
    if (!stem) warnings.push(`地面贴图 ${ground.texture.name} 找不到。`);
    const surface = surfaceSlots(stem ?? textures.generated("kr_missing", TRANSPARENT_PNG), { road: ground.drivable ? [] : undefined });
    const tile = 40, half = ground.size / 2, n = Math.max(1, Math.ceil(ground.size / tile));
    const step = ground.size / n;
    // 每 8×8 格一块
    for (let by = 0; by < n; by += 8) for (let bx = 0; bx < n; bx += 8) {
      const mesh = new MeshBuilder();
      for (let y = by; y < Math.min(n, by + 8); y++) for (let x = bx; x < Math.min(n, bx + 8); x++) {
        const x0 = -half + x * step, y0 = -half + y * step, x1 = x0 + step, y1 = y0 + step;
        const uv = (px: number, py: number): [number, number] => [px / ground.tile, -py / ground.tile];
        mesh.pushQuad([[x0, y0, ground.z], uv(x0, y0)], [[x1, y0, ground.z], uv(x1, y0)], [[x1, y1, ground.z], uv(x1, y1)], [[x0, y1, ground.z], uv(x0, y1)], [0, 0, 1]);
      }
      groundNodes.push(...meshNodes(`ground_${bx}_${by}`, mesh, surface));
    }
  }

  // 场景
  const roadNodes = roads.flatMap(({ built }) => built.nodes);
  const content = makeNode("Relement", { name: "custom", position: offset, children: [
    makeNode("Relement", { name: "ground", children: groundNodes }),
    makeNode("Relement", { name: "roads", children: roadNodes }),
    makeNode("Relement", { name: "pieces", children: pieceNodes }),
  ] });
  const sceneRoot = makeNode("Relement", { name: "rootRelement", children: [makeNode("Relement", { name: "Scene Root", children: [content] })] });

  // 路线：从起点线开始的闭合路线
  progress("生成路线和小地图");
  const routeRoad = roads.find(r => r.design.route)!;
  const routeSample = rotateClosedSample(routeRoad.built.sample, design.start.offset);
  const records = routeRecords(routeSample, offset);
  if (records.length < 4) throw new Error("比赛路线太短：至少需要 160 米。");
  const routeObject: TrackObjectRecord = { kind: "ToRoad", name: "route", property: undefined, cyclic: true, records };

  // 小地图只框住道路（官方小地图画的是路线）
  const roadMin: Vec3 = [Infinity, Infinity, 0], roadMax: Vec3 = [-Infinity, -Infinity, 0];
  for (const { built } of roads) for (const p of built.sample.points) {
    roadMin[0] = Math.min(roadMin[0], p[0] + offset[0]); roadMin[1] = Math.min(roadMin[1], p[1] + offset[1]);
    roadMax[0] = Math.max(roadMax[0], p[0] + offset[0]); roadMax[1] = Math.max(roadMax[1], p[1] + offset[1]);
  }
  const frame = minimapFrame({ min: roadMin, max: roadMax });
  const minimapRoads = roads.map(({ design: road, built }) => ({ sample: built.sample, route: road.route }));
  const minimapCanvas = drawMinimap(frame, minimapRoads, offset, 1, 256, [0, 0, 0, 0]);
  const bigmapCanvas = drawMinimap(frame, minimapRoads, offset, 2, 512, [0, 0, 0, 0]);
  const minimapObject: TrackObjectRecord = { kind: "ToMinimap", name: "", property: undefined, ...frame, canvasWidth: 256, canvasHeight: 256, padding: 4 };

  // 天空、雾、光照：取自 design.sky 那条赛道
  const skyPath = sourceTrackPath(design.sky);
  const skyModel = await loadSourceModel(library, formats, design.sky).catch(() => undefined);
  if (!skyModel) warnings.push(`天空来源 ${design.sky} 读取失败，用默认雾色。`);
  const skyTrackObject = skyModel?.trackObjects?.find((o: any) => o.kind === "TrackObject" && o.name === "track");
  const skyProperty = skyTrackObject?.property as TrackXmlNode | undefined;
  const keep = (name: string) => skyProperty?.children?.find(child => child.name === name);
  const settings = makeXml("property", {}, [
    makeXml("camera", { far: String(Math.max(400, Number(keep("camera")?.attributes.find(a => a.name === "far")?.value) || 400)) }),
    keep("fog") ?? makeXml("fog", { mode: "3", r: "184", g: "224", b: "255", start: "0.5", end: "1.0" }),
    ...(keep("sun") ? [keep("sun")!] : []),
    makeXml("course", {}, [makeXml("road", { name: "route" })]),
  ]);
  const trackObject: TrackObjectRecord = { kind: "TrackObject", name: "track", property: settings };

  // 道具箱（道具赛）：ToItemCube，网络编号 1..N
  const cubes = itemCubeRecords(design, roads.map(({ design: road, built }) => ({ id: road.id, sample: built.sample })), offset);
  const model = makeTrackContainer("", sceneRoot, [routeObject, minimapObject, trackObject, ...cubes]);
  const files: BuiltFile[] = [{ path: "track.1s", bytes: encodeTrackModel(model) }];

  const skyEntry = library.findSibling(skyPath, ["skydome.1s"]);
  if (skyEntry) {
    const sky = formats.y9(await skyEntry.bytes()).root;
    const names = textureNamesOf(sky.kind === "track" ? sky.scene : sky, new Set());
    const renames = new Map<string, string | undefined>();
    for (const name of names) renames.set(name, await textures.resolve(design.sky, name));
    const cloner = new PieceCloner(renames);
    const root = sky.kind === "track" ? { ...sky, scene: cloner.clone(sky.scene) } : cloner.clone(sky);
    for (const key of ["sceneOccurrence", "trackObjectOccurrences"]) delete (root as any)[key];
    files.push({ path: "skydome.1s", bytes: encodeTrackModel(root as any) });
  } else warnings.push(`${design.sky} 没有天空盒。`);

  files.push({ path: "track.xml", bytes: utf16("<?xml version='1.0' encoding='UTF-16'?>\n<trackInfo>\n\t<track filename='track'>\n\t\t<rainEffect enable='false' onStart='false'/>\n\t</track>\n</trackInfo>\n") });
  files.push({ path: "xt_minimap.png", bytes: minimapCanvas.png() });
  files.push({ path: "xt_bigmap.png", bytes: bigmapCanvas.png() });
  const tint = THEME_GROUND[design.theme] ?? [70, 90, 110, 255];
  files.push({ path: "xt_trackCard.png", bytes: options.card ?? placeholderCard(352, 206, minimapCanvas, tint) });
  files.push({ path: "xt_trackThumb.png", bytes: options.thumb ?? placeholderCard(222, 130, minimapCanvas, tint) });

  progress("复制贴图");
  const textureFiles = await textures.entries();
  files.push(...textureFiles);

  progress("打包");
  const containerName = `track_${trackId}.rho`;
  const container = await packRhoArchive(containerName, files);
  let meshes = 0, triangles = 0;
  const count = (node: TrackNode) => {
    const indices = node.vertexData?.indices?.length ?? 0;
    if (indices) { meshes++; triangles += node.className === "ReTriStrip" ? indices - 2 : indices / 3; }
    node.children.forEach(count);
  };
  count(sceneRoot);
  return {
    trackId, containerName, files, container, offset, roadExtent,
    routeLength: routeSample.total,
    stats: { meshes, triangles: Math.round(triangles), textures: textureFiles.length, pieces: placed, gates: records.length,
      itemBoxes: cubes.length },
    warnings,
  };
}
