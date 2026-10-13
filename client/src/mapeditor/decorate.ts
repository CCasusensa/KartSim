/**
 * 新建向导生成的地图：主题套装 + 赛道形状 + 道具箱，再加“路边自动装饰”——
 * 沿比赛路线两侧种树、摆路灯，选的都是同一主题的官方物件，新手一开始就有
 * 一张像样、能直接试跑的地图，再慢慢改。
 */
import {
  DEFAULT_ROAD_SURFACE, DEFAULT_WALL, MAP_LIMITS, defaultGround, newDesign, randomId,
  type MapDesign, type PieceDesign, type Vec3,
} from "./design";
import { archRef, defaultArch, pieceSize, surfaceRef, textureRef, type CatalogData, type CatalogPiece, type PieceCategory, type ThemePreset } from "./catalog";
import { pointAtDistance, roadEdge, sampleRoad } from "./road-geometry";
import { templateRoad, type TrackTemplate } from "./templates";

const round = (value: number) => Math.round(value * 100) / 100;

/** 某主题里某类、高度合适的物件（没有就从全部主题里挑）。 */
function choose(data: CatalogData, theme: string, category: PieceCategory, height: [number, number], count: number): CatalogPiece[] {
  const fits = (piece: CatalogPiece) => {
    const size = pieceSize(piece);
    return piece.category === category && size[2] >= height[0] && size[2] <= height[1] && Math.max(size[0], size[1]) <= height[1];
  };
  const own = data.pieces.filter(piece => piece.theme === theme && fits(piece));
  return (own.length ? own : data.pieces.filter(fits)).slice(0, count);
}

export interface DecorateOptions {
  /** 树的间距（米，沿路）。 */
  treeSpacing?: number;
  lightSpacing?: number;
  maxPieces?: number;
  random?: () => number;
}

export function decorateRoute(design: MapDesign, data: CatalogData, options: DecorateOptions = {}): PieceDesign[] {
  const random = options.random ?? Math.random;
  const route = design.roads.find(road => road.route);
  if (!route || route.points.length < 3) return [];
  const trees = choose(data, design.theme, "tree", [3, 30], 2);
  const lights = choose(data, design.theme, "light", [3, 16], 1);
  const sample = sampleRoad(route, 4);
  const allRoads = design.roads.map(road => ({ sample: sampleRoad(road, 6), half: road.width / 2 }));
  const groundZ = design.ground ? design.ground.z : 0;
  /** 离所有道路都够远，不会长在路上。 */
  const clear = (x: number, y: number, margin: number) => allRoads.every(({ sample: other, half }) =>
    other.points.every(p => Math.hypot(p[0] - x, p[1] - y) >= half + margin));
  const pieces: PieceDesign[] = [];
  const limit = options.maxPieces ?? 160;
  const add = (piece: CatalogPiece, position: Vec3, yaw: number, scale = 1) => {
    pieces.push({
      id: `p${randomId(8)}`, track: piece.track, path: [...piece.path], label: piece.label,
      origin: [...piece.origin] as Vec3, position, rotation: [round(yaw), 0, 0], scale: [scale, scale, scale],
    });
  };
  const treeSpacing = options.treeSpacing ?? 34;
  const lightSpacing = options.lightSpacing ?? 70;
  let side = 1;
  for (let distance = 20; distance < sample.total && pieces.length < limit; distance += treeSpacing) {
    if (!trees.length) break;
    const { index } = pointAtDistance(sample, distance);
    const width = sample.widths[index]!;
    const offset = width / 2 + 8 + random() * 8;
    const p = roadEdge(sample, index, offset * side);
    side = -side;
    if (!clear(p[0], p[1], 6)) continue;
    const tree = trees[Math.floor(random() * trees.length)]!;
    add(tree, [round(p[0]), round(p[1]), round(Math.min(p[2], groundZ))], random() * 360, round(0.85 + random() * 0.3));
  }
  for (let distance = 10; distance < sample.total && pieces.length < limit; distance += lightSpacing) {
    if (!lights.length) break;
    const { index } = pointAtDistance(sample, distance);
    const width = sample.widths[index]!;
    const p = roadEdge(sample, index, -(width / 2 + 3));
    // 路抬高的地方路灯会悬在半空，跳过
    if (p[2] > groundZ + 1.5 || !clear(p[0], p[1], 2)) continue;
    const tangent = sample.tangents[index]!;
    const light = lights[0]!;
    add(light, [round(p[0]), round(p[1]), round(p[2])], (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI);
  }
  return pieces;
}

/** 按新建向导的选择生成设计。 */
export function wizardDesign(data: CatalogData, choice: {
  name: string; preset?: ThemePreset; template?: TrackTemplate; decorate: boolean; items: boolean;
}): MapDesign {
  const design = newDesign(choice.name);
  const find = (id: string | undefined) => id ? data.textures.find(texture => texture.id === id) : undefined;
  const preset = choice.preset;
  const surface = find(preset?.surface), wall = find(preset?.wall), ground = find(preset?.ground);
  if (preset) {
    design.theme = preset.theme;
    const sky = data.skies.find(entry => entry.id === preset.sky);
    if (sky) design.sky = sky.track;
  }
  design.ground = defaultGround();
  if (ground) design.ground.texture = textureRef(ground);
  // 起跑线上方的原版起点拱门（主题套装里的那种）
  const arch = defaultArch(data, design.theme);
  design.start.arch = arch ? archRef(arch) : null;
  if (choice.template) {
    const road = templateRoad(choice.template, `r${randomId(8)}`, surface ? surfaceRef(surface) : DEFAULT_ROAD_SURFACE,
      wall ? textureRef(wall) : DEFAULT_WALL.texture);
    design.roads.push(road);
    let extent = 0;
    for (const point of road.points) extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
    design.ground.size = Math.min(MAP_LIMITS.extent * 2, Math.ceil((extent * 2 + 500) / 100) * 100);
    if (choice.items) {
      const total = Math.floor(sampleRoad(road, 2).total);
      const spacing = Math.max(150, Math.min(400, total / 4));
      for (let d = 80; d < 80 + total - spacing / 2; d += spacing)
        design.items.rows.push({ id: `i${randomId(8)}`, road: road.id, distance: Math.round(d) % total, count: 4 });
    }
    if (choice.decorate) design.pieces.push(...decorateRoute(design, data));
  }
  return design;
}
