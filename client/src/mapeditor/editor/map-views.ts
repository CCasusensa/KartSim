import { tr } from "../../i18n/locale";
/**
 * 设计数据在视口里的样子：摆件（游戏装配的官方物件）、道路（与赛道包同一
 * 套几何）、地面、起点线和方向箭头、道路控制点手柄。
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, EdgesGeometry, FrontSide, Group,
  LineBasicMaterial, LineSegments, Line, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry,
  RepeatWrapping, SphereGeometry, type Material, type Texture,
} from "three";
import type { MapDesign, PieceDesign, RoadDesign, Vec3 } from "../design";
import { pointAtDistance, roadEdge, sampleRoad } from "../road-geometry";
import { buildRoad, itemRowPositions, type TextureResolver } from "../track-builder";
import { startArchPiece, startLineFor } from "../start-line";
import type { PieceInfo } from "../source-tracks";
import type { AssembledScene, EditorAssets } from "./assets";
import type { Viewport } from "./viewport";

const DEG = Math.PI / 180;

interface PieceView {
  key: string;
  root: Group;
  /** 新放下时弹一下的缩放（夹在 root 和 offset 之间，不碰设计里的缩放）。 */
  pop: Group;
  offset: Group;
  box?: LineSegments;
  scene?: AssembledScene;
  info?: PieceInfo;
  placeholder?: Object3D;
}

export function applyPieceTransform(root: Object3D, piece: PieceDesign): void {
  root.position.set(piece.position[0], piece.position[1], piece.position[2]);
  root.rotation.set(piece.rotation[1] * DEG, piece.rotation[2] * DEG, piece.rotation[0] * DEG, "ZXY");
  root.scale.set(piece.scale[0], piece.scale[1], piece.scale[2]);
}

/** 从视口对象读回摆件变换（旋转顺序 ZXY：偏航、俯仰、横滚）。 */
export function readPieceTransform(root: Object3D): Pick<PieceDesign, "position" | "rotation" | "scale"> {
  const round = (v: number, step = 1000) => Math.round(v * step) / step;
  root.rotation.reorder("ZXY");
  return {
    position: [round(root.position.x), round(root.position.y), round(root.position.z)],
    rotation: [round(root.rotation.z / DEG, 100), round(root.rotation.x / DEG, 100), round(root.rotation.y / DEG, 100)],
    scale: [round(root.scale.x), round(root.scale.y), round(root.scale.z)],
  };
}

export function boxLines(min: Vec3, max: Vec3, color: number): LineSegments {
  const size: Vec3 = [Math.max(0.1, max[0] - min[0]), Math.max(0.1, max[1] - min[1]), Math.max(0.1, max[2] - min[2])];
  const geometry = new EdgesGeometry(new BoxGeometry(...size));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color, depthTest: false, transparent: true }));
  lines.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  lines.renderOrder = 10;
  lines.userData.noPick = true;
  return lines;
}

/** 道具箱预览：彩色方块上一个问号（游戏里是各主题的道具箱模型）。 */
function itemBoxMaterial(): Material {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 64, 64);
  gradient.addColorStop(0, "#ff6ad5"); gradient.addColorStop(0.5, "#ffd23f"); gradient.addColorStop(1, "#3fd1ff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  context.strokeStyle = "#fff"; context.lineWidth = 4; context.strokeRect(2, 2, 60, 60);
  context.fillStyle = "#fff"; context.font = "bold 44px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText("?", 32, 35);
  return new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, opacity: 0.92 });
}

export class MapViews {
  readonly pieces = new Group();
  readonly roads = new Group();
  readonly ground = new Group();
  readonly markers = new Group();
  readonly handles = new Group();
  readonly items = new Group();
  private builtItems = "";
  private readonly itemMaterial = itemBoxMaterial();
  private readonly pieceViews = new Map<string, PieceView>();
  private readonly roadMaterials = new Map<string, Material>();
  private roadVersion = 0;
  private builtRoads = "";
  private builtGround = "";
  /** 正在被手柄拖动的摆件不要被同步覆盖。 */
  draggingPieces = new Set<string>();
  /** 下次出现时要弹一下的摆件（刚放下的）。 */
  readonly popPieces = new Set<string>();
  private readonly popping = new Map<Group, number>();
  warnings: string[] = [];
  onPieceLoaded?: () => void;

  constructor(private readonly viewport: Viewport, private readonly assets: EditorAssets) {
    this.pieces.name = "pieces";
    this.roads.name = "roads";
    this.handles.name = "handles";
    this.markers.userData.noPick = true;
    this.items.userData.noPick = true;
    viewport.world.add(this.ground, this.roads, this.pieces, this.markers, this.items, this.handles);
    viewport.onFrame(time => this.animatePops(time));
  }

  /** 弹出：从 40% 放大到略超过原尺寸再回落（easeOutBack），约 0.3 秒。 */
  private animatePops(time: number): void {
    for (const [group, start] of this.popping) {
      const t = Math.min(1, (time - start) / 300);
      const back = 1.7;
      const eased = 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2;
      group.scale.setScalar(0.4 + 0.6 * eased);
      if (t >= 1) { group.scale.setScalar(1); this.popping.delete(group); }
    }
  }

  sync(design: MapDesign, selection: { roadId?: string; point?: number; pieceIds: string[] }): void {
    this.syncPieces(design);
    const roadsKey = JSON.stringify(design.roads) + design.start.offset;
    if (roadsKey !== this.builtRoads) { this.builtRoads = roadsKey; void this.rebuildRoads(design); }
    const itemsKey = JSON.stringify(design.items) + JSON.stringify(design.roads);
    if (itemsKey !== this.builtItems) { this.builtItems = itemsKey; this.rebuildItems(design); }
    const groundKey = JSON.stringify(design.ground);
    if (groundKey !== this.builtGround) { this.builtGround = groundKey; this.rebuildGround(design); }
    this.syncHandles(design, selection.roadId, selection.point);
    this.highlight(selection.pieceIds);
  }

  // ------------------------------------------------------------------ 摆件

  private syncPieces(design: MapDesign): void {
    const alive = new Set<string>();
    // 起点拱门跟着起跑线自动摆，和摆件一样显示（id 是 START_ARCH_ID）
    const arch = startArchPiece(design);
    for (const piece of arch ? [...design.pieces, arch] : design.pieces) {
      alive.add(piece.id);
      const key = `${piece.track}/${piece.path.join(".")}`;
      let view = this.pieceViews.get(piece.id);
      if (view && view.key !== key) { this.removePiece(piece.id); view = undefined; }
      if (!view) view = this.createPiece(piece, key);
      view.offset.position.set(-piece.origin[0], -piece.origin[1], -piece.origin[2]);
      if (!this.draggingPieces.has(piece.id)) applyPieceTransform(view.root, piece);
    }
    for (const id of [...this.pieceViews.keys()]) if (!alive.has(id)) this.removePiece(id);
  }

  private createPiece(piece: PieceDesign, key: string): PieceView {
    const root = new Group();
    root.name = `piece:${piece.id}`;
    root.userData.pieceId = piece.id;
    const pop = new Group();
    const offset = new Group();
    root.add(pop);
    pop.add(offset);
    this.pieces.add(root);
    const view: PieceView = { key, root, pop, offset };
    if (this.popPieces.delete(piece.id)) {
      pop.scale.setScalar(0.4);
      this.popping.set(pop, performance.now());
    }
    this.pieceViews.set(piece.id, view);
    void this.assets.pieces(piece.track).then(list => {
      const info = list.find(item => item.path.join(".") === piece.path.join("."));
      if (!info || this.pieceViews.get(piece.id) !== view) return;
      view.info = info;
      if (!view.scene) {
        // 载入前先显示包围盒
        const placeholder = new Mesh(new BoxGeometry(info.max[0] - info.min[0] || 1, info.max[1] - info.min[1] || 1, info.max[2] - info.min[2] || 1),
          new MeshBasicMaterial({ color: 0x88aadd, transparent: true, opacity: 0.35 }));
        placeholder.position.set((info.min[0] + info.max[0]) / 2, (info.min[1] + info.max[1]) / 2, (info.min[2] + info.max[2]) / 2);
        offset.add(placeholder);
        view.placeholder = placeholder;
      }
    }).catch(() => undefined);
    void this.assets.assemblePiece(piece.track, piece.path).then(scene => {
      if (this.pieceViews.get(piece.id) !== view) { scene.dispose(); return; }
      view.scene = scene;
      offset.add(scene.object);
      if (view.placeholder) { offset.remove(view.placeholder); view.placeholder = undefined; }
      this.viewport.addScene(scene);
      this.onPieceLoaded?.();
    }).catch(error => {
      console.warn("摆件载入失败", piece.track, piece.path, error);
      this.warnings.push(tr("摆件「{value}」载入失败：{value2}", { value: String(piece.label), value2: String((error as Error).message) }));
    });
    return view;
  }

  private removePiece(id: string): void {
    const view = this.pieceViews.get(id);
    if (!view) return;
    this.pieceViews.delete(id);
    view.root.removeFromParent();
    if (view.scene) { this.viewport.removeScene(view.scene); view.scene.dispose(); }
  }

  pieceObject(id: string): Group | undefined {
    return this.pieceViews.get(id)?.root;
  }

  /** 摆件里按来源坐标摆放的那一层（包围盒线框挂这里）。 */
  pieceOffset(id: string): Group | undefined {
    return this.pieceViews.get(id)?.offset;
  }

  pieceInfo(id: string): PieceInfo | undefined {
    return this.pieceViews.get(id)?.info;
  }

  /** 命中对象所属的摆件 id。 */
  pieceIdOf(object: Object3D): string | undefined {
    for (let current: Object3D | null = object; current; current = current.parent)
      if (typeof current.userData.pieceId === "string") return current.userData.pieceId;
    return undefined;
  }

  private highlight(ids: string[]): void {
    const selected = new Set(ids);
    for (const [id, view] of this.pieceViews) {
      if (selected.has(id) && view.info && !view.box) {
        view.box = boxLines(view.info.min, view.info.max, 0xffc400);
        view.offset.add(view.box);
      } else if (!selected.has(id) && view.box) {
        view.box.removeFromParent();
        view.box.geometry.dispose();
        view.box = undefined;
      }
    }
  }

  // ------------------------------------------------------------------ 道路

  /** decal：贴在路面上的一层（起跑线），远看时不和路面打架。 */
  private material(key: string, alpha: number | undefined, doubleSided: boolean, decal = false): Material {
    const id = `${key}|${alpha ?? 0}|${doubleSided}|${decal}`;
    let material = this.roadMaterials.get(id);
    if (material) return material;
    if (key.startsWith("gen:")) {
      material = new MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.22, side: DoubleSide, depthWrite: false });
    } else {
      const lambert = new MeshLambertMaterial({ color: 0xffffff, side: doubleSided ? DoubleSide : FrontSide });
      if (alpha === 1) lambert.alphaTest = 0.5;
      if (decal) { lambert.polygonOffset = true; lambert.polygonOffsetFactor = -2; lambert.polygonOffsetUnits = -2; }
      if (alpha === 2) lambert.transparent = true;
      const [track, name] = key.split("\n") as [string, string];
      void this.assets.texture(track, name).then(texture => {
        if (!texture) { lambert.color = new Color(0xb04040); return; }
        lambert.map = texture;
        lambert.needsUpdate = true;
      });
      material = lambert;
    }
    this.roadMaterials.set(id, material);
    return material;
  }

  private async rebuildRoads(design: MapDesign): Promise<void> {
    const version = ++this.roadVersion;
    const resolver: TextureResolver = {
      resolve: async (track, name) => `${track}\n${name}`,
      generated: stem => `gen:${stem}`,
    };
    const group = new Group();
    const warnings: string[] = [];
    for (const road of design.roads) {
      // 起跑线和生成的赛道包一模一样（原版起跑线贴图）
      const built = await buildRoad(road, resolver, warnings, { start: { offset: design.start.offset, texture: startLineFor(design.theme) } });
      if (version !== this.roadVersion) return;
      for (const node of built.nodes) {
        const data = node.vertexData!;
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(data.positions!.flat()), 3));
        geometry.setAttribute("normal", new BufferAttribute(new Float32Array(data.normals!.flat()), 3));
        geometry.setAttribute("uv", new BufferAttribute(new Float32Array(data.uvs.map(set => set[0]!).flat()), 2));
        geometry.setIndex(data.indices);
        const texture = node.slots[7] as { name: string } | undefined;
        const alpha = node.slots[3] as { blendEnable: number; alphaTestEnable: number } | undefined;
        const backface = node.slots[4] as { cull: number } | undefined;
        const mesh = new Mesh(geometry, this.material(texture?.name ?? "gen:none",
          alpha ? alpha.blendEnable ? 2 : alpha.alphaTestEnable ? 1 : 0 : undefined, backface?.cull === 1,
          String(node.name ?? "").startsWith("startline_")));
        mesh.userData.roadId = road.id;
        // 起跑线可以按住拖动挪位置（tools.ts）
        if (String(node.name ?? "").startsWith("startline_")) mesh.userData.startLine = true;
        group.add(mesh);
      }
      if (road.route) this.routeMarkers(road, design.start.offset, group);
    }
    if (version !== this.roadVersion) return;
    for (const child of [...this.roads.children]) {
      child.removeFromParent();
      child.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    }
    if (group.children.length) this.roads.add(...group.children);
  }

  /** 沿路的方向箭头（起跑线在 buildRoad 里，与赛道包相同）。 */
  private routeMarkers(road: RoadDesign, startOffset: number, group: Group): void {
    const sample = sampleRoad(road, 2);
    if (sample.points.length < 3) return;
    // 方向箭头：每 30 米一个
    const arrows: number[] = [];
    for (let d = 15; d < sample.total; d += 30) {
      const { index } = pointAtDistance(sample, startOffset + d);
      const p = sample.points[index]!, l = sample.lefts[index]!;
      const f: Vec3 = [l[1], -l[0], 0];
      const s = Math.min(4, sample.widths[index]! * 0.18);
      const tip: Vec3 = [p[0] + f[0] * s, p[1] + f[1] * s, p[2] + 0.12];
      const a: Vec3 = [p[0] - f[0] * s + l[0] * s * 0.7, p[1] - f[1] * s + l[1] * s * 0.7, p[2] + 0.12];
      const b: Vec3 = [p[0] - f[0] * s - l[0] * s * 0.7, p[1] - f[1] * s - l[1] * s * 0.7, p[2] + 0.12];
      arrows.push(...tip, ...a, ...b);
    }
    if (arrows.length) {
      const arrowGeometry = new BufferGeometry();
      arrowGeometry.setAttribute("position", new BufferAttribute(new Float32Array(arrows), 3));
      const mesh = new Mesh(arrowGeometry, new MeshBasicMaterial({ color: 0xffe14d, side: DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
      mesh.userData.noPick = true;
      group.add(mesh);
    }
  }

  // ------------------------------------------------------------------ 道具箱

  private rebuildItems(design: MapDesign): void {
    for (const child of [...this.items.children]) child.removeFromParent();
    const box = new BoxGeometry(2, 2, 2);
    for (const road of design.roads) {
      const rows = design.items.rows.filter(row => row.road === road.id);
      if (!rows.length) continue;
      const sample = sampleRoad(road, 2);
      for (const row of rows) for (const position of itemRowPositions(sample, row.distance, row.count)) {
        const cube = new Mesh(box, this.itemMaterial);
        cube.position.set(position[0], position[1], position[2]);
        cube.rotation.z = Math.PI / 4;
        this.items.add(cube);
      }
    }
  }

  // ------------------------------------------------------------------ 地面

  private rebuildGround(design: MapDesign): void {
    for (const child of [...this.ground.children]) { child.removeFromParent(); if (child instanceof Mesh) child.geometry.dispose(); }
    const ground = design.ground;
    this.viewport.grid.visible = !ground;
    if (!ground) return;
    const geometry = new PlaneGeometry(ground.size, ground.size);
    const repeat = ground.size / Math.max(1, ground.tile);
    const material = new MeshLambertMaterial({ color: 0xffffff });
    void this.assets.texture(ground.texture.track, ground.texture.name).then(texture => {
      if (!texture) { material.color = new Color(0x6d8a5a); return; }
      const copy = texture.clone();
      copy.wrapS = copy.wrapT = RepeatWrapping;
      copy.repeat.set(repeat, repeat);
      copy.needsUpdate = true;
      material.map = copy;
      material.needsUpdate = true;
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.z = ground.z;
    mesh.userData.ground = true;
    this.ground.add(mesh);
  }

  // ------------------------------------------------------------------ 控制点手柄

  private syncHandles(design: MapDesign, roadId: string | undefined, selectedPoint: number | undefined): void {
    for (const child of [...this.handles.children]) {
      child.removeFromParent();
      if (child instanceof Mesh || child instanceof Line) child.geometry.dispose();
    }
    const road = roadId ? design.roads.find(r => r.id === roadId) : undefined;
    if (!road) return;
    const radius = Math.max(1.2, road.width * 0.07);
    const sphere = new SphereGeometry(radius, 16, 12);
    road.points.forEach((point, index) => {
      const color = index === selectedPoint ? 0xff8a00 : index === 0 ? 0x3ddc84 : 0xffffff;
      const mesh = new Mesh(sphere, new MeshBasicMaterial({ color, depthTest: false, transparent: true }));
      mesh.position.set(point.x, point.y, point.z + radius * 0.8);
      mesh.renderOrder = 20;
      mesh.userData.handle = { roadId: road.id, index };
      this.handles.add(mesh);
    });
    const line = new Line(new BufferGeometry().setFromPoints([]), new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.6 }));
    const positions = road.points.flatMap(p => [p.x, p.y, p.z + 0.3]);
    if (road.closed && road.points.length > 2) positions.push(road.points[0]!.x, road.points[0]!.y, road.points[0]!.z + 0.3);
    line.geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    line.renderOrder = 19;
    line.userData.noPick = true;
    this.handles.add(line);
  }

  handleObject(index: number): Object3D | undefined {
    return this.handles.children.find(child => child.userData.handle?.index === index);
  }

  /** 视口中可选取的东西。 */
  pickTargets(): Object3D[] {
    return [this.handles, this.pieces, this.roads, this.ground];
  }
}
