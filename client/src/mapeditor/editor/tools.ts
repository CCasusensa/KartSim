import { tr } from "../../i18n/locale";
/**
 * 视口里的工具（简单模式的主要操作）：
 *   放置：选好的物件跟着鼠标走，点一下放一个；滚轮转方向；长按左键再上下拖动
 *         调离地高度，松开放下；按住拖动是把它拖到别处再放（一次只放一个）；
 *   推土机：点到哪个摆件删哪个，按住拖动连片删除；
 *   道具箱：在比赛路线上点一下，横着放一排；
 *   选择：点选摆件或道路，按住拖动直接挪位置（不用手柄）；按住起跑线沿着赛道拖。
 * 自动吸附（app.snap，默认开）：放东西、拖东西靠近赛道边时贴到路边并顺着路摆正，
 * 加速板放在路上对准路中间；拖动的东西落到下面的地面、路面或别的东西上；位置按
 * 0.5 米、角度按 15° 对齐。
 */
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, LineSegments, Vector3, type Intersection } from "three";
import { MAP_LIMITS, type MapDesign, type PieceDesign, type Vec3 } from "../design";
import type { CatalogPiece, PieceCategory } from "../catalog";
import type { RoadDesign } from "../design";
import { START_ARCH_ID } from "../start-line";
import { sampleRoad, type RoadSample } from "../road-geometry";
import type { AssembledScene } from "./assets";
import type { EditorApp } from "./app";
import { boxLines } from "./map-views";
import { toClient, toThree } from "./viewport";

export type Tool =
  | { kind: "select" }
  | { kind: "place"; piece: CatalogPiece }
  | { kind: "bulldoze" }
  | { kind: "items" };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 放置中按下左键以后：先等着看是单击、长按（调高度）还是拖动（拖到别处再放）。 */
interface Press {
  x: number;
  y: number;
  /** 按下处的落点（调高度时物件就停在这里）。 */
  point: Vec3;
  stage: "pending" | "lift" | "move";
  timer?: ReturnType<typeof setTimeout>;
  lastY: number;
  liftStart?: { y: number; height: number };
}

/** 按住多久算长按（毫秒），以及移动多少像素算拖动。 */
const LONG_PRESS = 350;
const DRAG_START = 6;
/** 滚轮滚多少（deltaY）转一格，一格多少度。 */
const WHEEL_NOTCH = 100;
const WHEEL_STEP = 15;

interface Drag {
  start: Vec3;
  height: number;
  moved: boolean;
  pointer: { x: number; y: number };
  pieces?: Map<string, Vec3>;
  point?: { roadId: string; index: number; origin: Vec3 };
  /** 拖起跑线：比赛路线的采样（起点沿路距离就是采样的 s）。 */
  startLine?: { sample: RoadSample };
}

export class ToolController {
  /** 放置工具的朝向（度）、缩放和离地高度（米，加在落点上）。 */
  yaw = 0;
  scale = 1;
  lift = 0;
  private press?: Press;
  private wheelRest = 0;
  private guide?: Line;
  /** 自动吸附算出的朝向基准（贴路边时顺着路）；没吸附时 undefined，滚轮转的 yaw 加在它上面。 */
  private snapYaw?: number;
  private roadSamples?: { key: string; list: RoadSample[] };
  private ghost?: { piece: CatalogPiece; root: Group; offset: Group; box: LineSegments; scene?: AssembledScene };
  private ghostPoint?: Vec3;
  private drag?: Drag;
  private hoverBox?: LineSegments;
  private bulldozing?: Set<string>;

  constructor(private readonly app: EditorApp) {}

  // ------------------------------------------------------------------ 工具切换

  activate(tool: Tool): void {
    this.removeGhost();
    this.clearHover();
    if (tool.kind === "place") this.createGhost(tool.piece);
  }

  private createGhost(piece: CatalogPiece): void {
    const root = new Group();
    root.userData.noPick = true;
    root.visible = false;
    const offset = new Group();
    offset.position.set(-piece.origin[0], -piece.origin[1], -piece.origin[2]);
    const box = boxLines(piece.min, piece.max, 0x3ddc84);
    offset.add(box);
    root.add(offset);
    this.app.viewport.world.add(root);
    const ghost = { piece, root, offset, box, scene: undefined as AssembledScene | undefined };
    this.ghost = ghost;
    this.applyGhostTransform();
    void this.app.assets.assemblePiece(piece.track, piece.path).then(scene => {
      if (this.ghost !== ghost) { scene.dispose(); return; }
      ghost.scene = scene;
      offset.add(scene.object);
      this.app.viewport.addScene(scene);
    }).catch(error => this.app.say(tr("物件载入失败：{value}", { value: String((error as Error).message) })));
  }

  private removeGhost(): void {
    this.cancelPress();
    this.removeGuide();
    const ghost = this.ghost;
    this.ghost = undefined;
    if (!ghost) return;
    ghost.root.removeFromParent();
    ghost.box.geometry.dispose();
    if (ghost.scene) { this.app.viewport.removeScene(ghost.scene); ghost.scene.dispose(); }
  }

  private applyGhostTransform(): void {
    const ghost = this.ghost;
    if (!ghost) return;
    ghost.root.rotation.set(0, 0, (this.effectiveYaw() * Math.PI) / 180);
    ghost.root.scale.setScalar(this.scale);
    if (this.ghostPoint) {
      ghost.root.position.set(this.ghostPoint[0], this.ghostPoint[1], this.ghostPoint[2] + this.lift);
      ghost.root.visible = true;
    }
    this.updateGuide();
  }

  private effectiveYaw(): number {
    return ((((this.snapYaw ?? 0) + this.yaw) % 360) + 360) % 360;
  }

  /** 鬼影对准一个落点：开着自动吸附时贴到路边 / 路中间（框变成青色）。返回实际落点。 */
  private aimGhost(point: Vec3): Vec3 {
    const ghost = this.ghost;
    const snap = this.app.snap && ghost ? this.roadSnap(point, ghost.piece, this.scale) : undefined;
    this.snapYaw = snap?.yaw;
    this.ghostPoint = snap ? snap.position : point;
    if (ghost) (ghost.box.material as LineBasicMaterial).color.setHex(snap ? 0x22c8ff : 0x3ddc84);
    this.applyGhostTransform();
    return this.ghostPoint;
  }

  /** 全部道路的采样（道路没变就复用）。 */
  private samples(): RoadSample[] {
    const roads: RoadDesign[] = this.app.state.design.roads;
    const key = JSON.stringify(roads.map(road => [road.points, road.width, road.closed]));
    if (this.roadSamples?.key !== key) {
      this.roadSamples = { key, list: roads.filter(road => road.points.length >= 2).map(road => sampleRoad(road, 2)) };
    }
    return this.roadSamples.list;
  }

  /**
   * 自动吸附到路：离路边 12 米以内贴到路边外侧，长边顺着路（两边都朝着路面）；
   * 加速板（booster）在路面上时对准路中间、顺着路。不靠近路时返回 undefined。
   */
  roadSnap(point: Vec3, piece: { min: ArrayLike<number>; max: ArrayLike<number>; category?: PieceCategory }, scale: number):
    { position: Vec3; yaw: number } | undefined {
    let best: { sample: RoadSample; index: number; distance: number; edge: number } | undefined;
    for (const sample of this.samples()) {
      sample.points.forEach((center, index) => {
        const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
        const edge = distance - sample.widths[index]! / 2;
        if (!best || edge < best.edge) best = { sample, index, distance, edge };
      });
    }
    if (!best) return undefined;
    const { sample, index, distance } = best;
    const half = sample.widths[index]! / 2;
    const center = sample.points[index]!, left = sample.lefts[index]!, tangent = sample.tangents[index]!;
    const heading = (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI;
    const sizeX = (piece.max[0]! - piece.min[0]!) * scale, sizeY = (piece.max[1]! - piece.min[1]!) * scale;
    const alongX = sizeX >= sizeY;
    const depth = alongX ? sizeY : sizeX;
    const normalize = (yaw: number) => Math.round(((yaw % 360) + 360) % 360 * 100) / 100;
    if (piece.category === "booster") {
      if (distance > half) return undefined;
      return { position: [round2(center[0]), round2(center[1]), round2(center[2])], yaw: normalize(heading + (alongX ? 0 : 90)) };
    }
    if (distance < half - 2 || distance > half + 12 + depth) return undefined;
    const side = (point[0] - center[0]) * left[0] + (point[1] - center[1]) * left[1] >= 0 ? 1 : -1;
    const out = half + 0.8 + depth / 2;
    const x = center[0] + left[0] * side * out, y = center[1] + left[1] * side * out;
    const z = this.app.viewport.castDown([x, y, center[2] + 50], [this.app.views.ground]) ?? center[2];
    return { position: [round2(x), round2(y), round2(z)], yaw: normalize(heading + (alongX ? 0 : 90) + (side < 0 ? 180 : 0)) };
  }

  /** 离地时从落点到物件底部画一条竖线，看得出悬空多高。 */
  private updateGuide(): void {
    const point = this.ghostPoint;
    if (!this.ghost || !point || Math.abs(this.lift) < 0.05) { this.removeGuide(); return; }
    if (!this.guide) {
      this.guide = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0x3ddc84, depthTest: false, transparent: true }));
      this.guide.renderOrder = 30;
      this.guide.userData.noPick = true;
      this.app.viewport.world.add(this.guide);
    }
    this.guide.geometry.setAttribute("position", new BufferAttribute(new Float32Array([
      point[0], point[1], point[2], point[0], point[1], point[2] + this.lift]), 3));
    this.guide.geometry.computeBoundingSphere();
  }

  private removeGuide(): void {
    if (!this.guide) return;
    this.guide.removeFromParent();
    this.guide.geometry.dispose();
    this.guide = undefined;
  }

  /** 离地高度清零（贴地）。 */
  resetLift(): void {
    this.lift = 0;
    this.applyGhostTransform();
    this.app.queueRender();
  }

  /** 放置中滚轮转方向；返回 true 表示滚轮用掉了（不再缩放视角）。 */
  wheel(event: WheelEvent): boolean {
    if (this.app.tool.kind !== "place" || this.app.mode !== "select") return false;
    this.wheelRest += event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    const notches = Math.trunc(this.wheelRest / WHEEL_NOTCH);
    if (notches) {
      this.wheelRest -= notches * WHEEL_NOTCH;
      this.rotateGhost(-notches * (event.shiftKey ? 90 : WHEEL_STEP));
    }
    return true;
  }

  /** Q/E 旋转、[ ] 缩放放置中的物件。 */
  rotateGhost(step: number): void {
    this.yaw = ((this.yaw + step) % 360 + 360) % 360;
    this.applyGhostTransform();
  }

  scaleGhost(factor: number): void {
    this.scale = Math.min(5, Math.max(0.2, Math.round(this.scale * factor * 100) / 100));
    this.applyGhostTransform();
    this.app.say(tr("放置大小 {value}%", { value: String(Math.round(this.scale * 100)) }), 1500);
  }

  // ------------------------------------------------------------------ 指针

  /** 鼠标下的落点：路面、地面、摆件表面，都没有时取地面高度的水平面。 */
  private surfacePoint(event: PointerEvent | MouseEvent): Vec3 | undefined {
    const views = this.app.views;
    const hit = this.app.viewport.pick(event, [views.roads, views.ground, views.pieces]);
    const point = hit ? toClient(hit.point) : this.app.viewport.pickPlane(event, this.app.state.design.ground?.z ?? 0);
    if (!point) return undefined;
    if (this.app.snap) { point[0] = Math.round(point[0] * 2) / 2; point[1] = Math.round(point[1] * 2) / 2; }
    return [round2(point[0]), round2(point[1]), round2(point[2])];
  }

  /** 返回 true 表示事件已处理（不再当成普通点选）。 */
  pointerDown(event: PointerEvent): boolean {
    const tool = this.app.tool;
    if (event.button !== 0 || this.app.viewport.navigating(event) || this.app.mode !== "select") return false;
    if (tool.kind === "place") {
      const point = this.surfacePoint(event);
      if (!point) return true;
      this.cancelPress();
      const aimed = this.aimGhost(point);
      const press: Press = { x: event.clientX, y: event.clientY, point: aimed, stage: "pending", lastY: event.clientY };
      // 按住不动一会儿：进入调高度
      press.timer = setTimeout(() => {
        if (this.press !== press || press.stage !== "pending") return;
        press.stage = "lift";
        press.liftStart = { y: press.lastY, height: this.lift };
        this.app.say(tr("上下拖动调高度，松开就放下"), 2500);
        this.app.queueRender();
      }, LONG_PRESS);
      this.press = press;
      return true;
    }
    if (tool.kind === "bulldoze") {
      this.bulldozing = new Set();
      this.bulldozeAt(event);
      return true;
    }
    if (tool.kind === "items") return true;
    return this.beginDrag(event);
  }

  pointerMove(event: PointerEvent): void {
    const tool = this.app.tool;
    if (this.app.mode !== "select") return;
    if (tool.kind === "place") {
      const press = this.press;
      if (press && event.buttons & 1) { this.movePress(press, event); return; }
      const point = this.surfacePoint(event);
      if (!point) return;
      this.aimGhost(point);
      return;
    }
    if (tool.kind === "bulldoze") {
      if (this.bulldozing && event.buttons & 1) this.bulldozeAt(event);
      else this.hoverPiece(event, 0xff4040);
      return;
    }
    if (this.drag && event.buttons & 1) { this.continueDrag(event); return; }
    // 鼠标移到起跑线上变成小手，提示可以拖
    if (tool.kind === "select" && !event.buttons) {
      this.app.viewport.renderer.domElement.style.cursor = this.overStartLine(event) ? "grab" : "";
    }
  }

  pointerUp(event: PointerEvent): boolean {
    const tool = this.app.tool;
    if (tool.kind === "place" && this.press) {
      const press = this.press;
      this.cancelPress();
      // 单击、长按调高度、拖着走：一次都只放一个
      const at = press.stage === "move" ? this.ghostPoint ?? press.point : press.point;
      if (this.placeAt(at)) this.app.say(tr("放好了「{value}」", { value: String(tool.piece.label) }), 2000);
      if (press.stage === "lift") this.app.queueRender();
      return true;
    }
    if (tool.kind === "bulldoze" && this.bulldozing) {
      const removed = this.bulldozing.size;
      this.bulldozing = undefined;
      if (removed) { this.app.state.commit(); this.app.say(tr("拆掉了 {value} 样东西", { value: String(removed) }), 2000); }
      return true;
    }
    if (tool.kind === "items" && event.button === 0) {
      this.placeItemRow(event);
      return true;
    }
    if (this.drag) {
      const drag = this.drag;
      this.drag = undefined;
      this.app.views.draggingPieces.clear();
      if (drag.startLine) this.app.viewport.renderer.domElement.style.cursor = "";
      if (drag.moved) {
        // 拖完路点顺手修顺这条路（急弯、太近、太低）
        if (drag.point) this.app.commitRoad(drag.point.roadId); else this.app.state.commit();
        if (drag.startLine) this.app.say(tr("起跑线挪好了"), 2000);
        return true;
      }
      if (drag.startLine) { this.app.say(tr("按住起跑线拖动，可以沿着赛道挪位置"), 3000); return true; }
    }
    return false;
  }

  private movePress(press: Press, event: PointerEvent): void {
    press.lastY = event.clientY;
    if (press.stage === "pending" && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_START) {
      clearTimeout(press.timer);
      press.stage = "move";
    }
    if (press.stage === "lift" && press.liftStart) {
      // 物件跟着鼠标上下走：按物件所在深度把屏幕像素换成米
      const camera = this.app.viewport.camera;
      const distance = camera.position.distanceTo(toThree(press.point).add(new Vector3(0, this.lift, 0)));
      const metersPerPixel = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, this.app.viewport.renderer.domElement.clientHeight);
      const height = press.liftStart.height + (press.liftStart.y - event.clientY) * metersPerPixel;
      this.lift = Math.round(Math.min(300, Math.max(-30, height)) * 10) / 10;
      this.ghostPoint = press.point;
      this.applyGhostTransform();
      this.app.queueRender();
      return;
    }
    if (press.stage === "pending") return;
    const point = this.surfacePoint(event);
    if (!point) return;
    this.aimGhost(point);
  }

  private cancelPress(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = undefined;
  }

  /** 正在长按调高度（动作条显示高度用）。 */
  get lifting(): boolean { return this.press?.stage === "lift"; }

  // ------------------------------------------------------------------ 放置

  private makePiece(position: Vec3, yaw: number, scale: number): PieceDesign {
    const piece = this.ghost!.piece;
    return {
      id: this.app.state.newId("p"), track: piece.track, path: [...piece.path], label: piece.label,
      origin: [...piece.origin] as Vec3, position: [position[0], position[1], round2(position[2] + this.lift)],
      rotation: [round2(yaw), 0, 0], scale: [scale, scale, scale],
    };
  }

  /** 在一个点上放一个，方向、大小和鬼影一样；放不下（满了）返回 false。 */
  private placeAt(point: Vec3): boolean {
    if (!this.ghost) return false;
    if (this.app.state.design.pieces.length >= MAP_LIMITS.pieces) {
      this.app.say(tr("一张地图最多放 {value} 样东西", { value: String(MAP_LIMITS.pieces) }));
      return false;
    }
    const placed = this.makePiece(point, this.effectiveYaw(), this.scale);
    this.app.views.popPieces.add(placed.id);
    this.app.state.commit(design => { design.pieces.push(placed); });
    return true;
  }

  // ------------------------------------------------------------------ 推土机

  private pieceUnder(event: MouseEvent): { id: string; hit: Intersection } | undefined {
    const hit = this.app.viewport.pick(event, [this.app.views.pieces]);
    const id = hit ? this.app.views.pieceIdOf(hit.object) : undefined;
    return id && hit ? { id, hit } : undefined;
  }

  private bulldozeAt(event: MouseEvent): void {
    const under = this.pieceUnder(event);
    if (!under || !this.bulldozing) return;
    this.bulldozing.add(under.id);
    // 拆起点拱门 = 不要拱门
    if (under.id === START_ARCH_ID) this.app.state.preview(d => { d.start.arch = null; });
    else this.app.state.preview(d => { d.pieces = d.pieces.filter(piece => piece.id !== under.id); });
    this.clearHover();
  }

  private hoverPiece(event: MouseEvent, color: number): void {
    const under = this.pieceUnder(event);
    this.clearHover();
    if (!under) return;
    const info = this.app.views.pieceInfo(under.id);
    const offset = this.app.views.pieceOffset(under.id);
    if (!info || !offset) return;
    this.hoverBox = boxLines(info.min, info.max, color);
    offset.add(this.hoverBox);
  }

  clearHover(): void {
    if (!this.hoverBox) return;
    this.hoverBox.removeFromParent();
    this.hoverBox.geometry.dispose();
    this.hoverBox = undefined;
  }

  // ------------------------------------------------------------------ 道具箱

  private placeItemRow(event: MouseEvent): void {
    const design = this.app.state.design;
    const route = design.roads.find(road => road.route);
    const hit = this.app.viewport.pick(event, [this.app.views.roads]);
    const roadId = hit?.object.userData.roadId as string | undefined;
    const road = design.roads.find(r => r.id === roadId) ?? route;
    if (!hit || !road) { this.app.say(tr("要点在赛道上哦")); return; }
    if (design.items.rows.length >= MAP_LIMITS.itemRows) { this.app.say(tr("道具箱最多 {value} 排。", { value: String(MAP_LIMITS.itemRows) })); return; }
    const p = toClient(hit.point);
    const sample = sampleRoad(road, 2);
    let best = 0;
    sample.points.forEach((q, i) => {
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(sample.points[best]![0] - p[0], sample.points[best]![1] - p[1])) best = i;
    });
    const distance = Math.round(sample.s[best]!);
    this.app.state.commit((d: MapDesign) => {
      d.items.rows.push({ id: this.app.state.newId("i"), road: road.id, distance, count: 4 });
      d.items.rows.sort((a, b) => a.road === b.road ? a.distance - b.distance : 0);
    });
    this.app.say(tr("放好了一排道具箱"), 2000);
  }

  // ------------------------------------------------------------------ 拖动挪位置

  /** 鼠标下是不是起跑线（摆件、路点手柄挡在前面时不算）。 */
  overStartLine(event: MouseEvent): boolean {
    const views = this.app.views;
    if (this.app.viewport.pick(event, [views.handles, views.pieces])) return false;
    return !!this.app.viewport.pick(event, [views.roads])?.object.userData.startLine;
  }

  private beginDrag(event: PointerEvent): boolean {
    if ((this.app.viewport.gizmo as unknown as { axis: string | null }).axis) return false;
    const app = this.app;
    const hit = app.viewport.pick(event, [app.views.handles, app.views.pieces]);
    if (!hit) {
      const route = app.state.design.roads.find(road => road.route && road.closed);
      if (!route || !this.overStartLine(event)) return false;
      const at = app.viewport.pick(event, [app.views.roads]);
      this.drag = { start: [0, 0, 0], height: at ? toClient(at.point)[2] : 0, moved: false,
        pointer: { x: event.clientX, y: event.clientY }, startLine: { sample: sampleRoad(route, 2) } };
      this.app.viewport.renderer.domElement.style.cursor = "grabbing";
      return true;
    }
    const handle = hit.object.userData.handle as { roadId: string; index: number } | undefined;
    if (handle) {
      const road = app.state.road(handle.roadId);
      const point = road?.points[handle.index];
      if (!point) return false;
      app.state.select({ kind: "road", id: handle.roadId, point: handle.index });
      const start = app.viewport.pickPlane(event, point.z);
      if (!start) return true;
      this.drag = { start, height: point.z, moved: false, pointer: { x: event.clientX, y: event.clientY },
        point: { roadId: handle.roadId, index: handle.index, origin: [point.x, point.y, point.z] } };
      return true;
    }
    const pieceId = app.views.pieceIdOf(hit.object);
    // 起点拱门跟着起跑线走，不能单独拖；点它打开拱门栏（app.click）
    if (!pieceId || pieceId === START_ARCH_ID) return false;
    const piece = app.state.piece(pieceId);
    if (!piece || event.shiftKey) return false;
    // 按住没选中的东西：先选中它（一组的整组选中），再跟着鼠标走
    const current = app.state.selection?.kind === "pieces" ? app.state.selection.ids : [];
    if (!current.includes(pieceId)) {
      const ids = piece.group && !event.ctrlKey && !event.metaKey
        ? app.state.design.pieces.filter(p => p.group === piece.group).map(p => p.id) : [pieceId];
      app.state.select({ kind: "pieces", ids });
    }
    const start = app.viewport.pickPlane(event, piece.position[2]);
    if (!start) return false;
    const pieces = new Map<string, Vec3>();
    for (const selected of app.state.selectedPieces()) pieces.set(selected.id, [...selected.position] as Vec3);
    this.drag = { start, height: piece.position[2], moved: false, pointer: { x: event.clientX, y: event.clientY }, pieces };
    return true;
  }

  private continueDrag(event: PointerEvent): void {
    const drag = this.drag!;
    if (!drag.moved && Math.hypot(event.clientX - drag.pointer.x, event.clientY - drag.pointer.y) < 5) return;
    const now = this.app.viewport.pickPlane(event, drag.height);
    if (!now) return;
    let dx = now[0] - drag.start[0], dy = now[1] - drag.start[1];
    if (this.app.snap) { dx = Math.round(dx * 2) / 2; dy = Math.round(dy * 2) / 2; }
    drag.moved = true;
    if (drag.startLine) { this.dragStartLine(drag.startLine.sample, now); return; }
    if (drag.point) {
      const { roadId, index, origin } = drag.point;
      this.app.state.preview(d => {
        const point = d.roads.find(road => road.id === roadId)?.points[index];
        if (point) { point.x = round2(origin[0] + dx); point.y = round2(origin[1] + dy); }
      });
      return;
    }
    const pieces = drag.pieces!;
    const snap = this.app.snap;
    const views = this.app.views;
    // 自动吸附：落到下面的路面、地面或别的东西上；只拖一个时靠近路边贴过去并顺着路
    const below = snap ? [views.roads, views.ground, ...views.pieces.children.filter(child => !pieces.has(child.userData.pieceId))] : [];
    this.app.state.preview(d => {
      for (const piece of d.pieces) {
        const origin = pieces.get(piece.id);
        if (!origin) continue;
        const target: Vec3 = [round2(origin[0] + dx), round2(origin[1] + dy), origin[2]];
        if (snap) {
          const info = views.pieceInfo(piece.id);
          const catalog = this.app.dock.pieceFor(piece.track, piece.path);
          const road = pieces.size === 1 && info ? this.roadSnap(target, { min: info.min, max: info.max, category: catalog?.category }, piece.scale[0]) : undefined;
          if (road) { piece.position = road.position; piece.rotation[0] = road.yaw; continue; }
          const z = this.app.viewport.castDown([target[0], target[1], origin[2] + 200], below);
          if (z !== undefined) target[2] = round2(z);
        }
        piece.position = target;
      }
    });
  }

  /** 起跑线跟着鼠标沿赛道走：取赛道上离鼠标最近的采样点的沿路距离。 */
  private dragStartLine(sample: RoadSample, cursor: Vec3): void {
    let best = 0, bestDistance = Infinity;
    sample.points.forEach((point, i) => {
      const distance = Math.hypot(point[0] - cursor[0], point[1] - cursor[1]);
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    });
    const offset = Math.round(sample.s[best]!);
    if (offset === this.app.state.design.start.offset) return;
    this.app.state.preview(d => { d.start.offset = offset; });
  }

  get dragging(): boolean { return !!this.drag?.moved || !!this.press || !!this.bulldozing; }
}
