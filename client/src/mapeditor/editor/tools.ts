/**
 * 视口里的工具（简单模式的主要操作）：
 *   放置：选好的物件跟着鼠标走，点一下放一个，按住拖动像刷子一样连续摆放
 *         （围栏、路灯沿拖动方向排成一排；树、花、石头随机朝向撒开）；
 *   推土机：点到哪个摆件删哪个，按住拖动连片删除；
 *   道具箱：在比赛路线上点一下，横着放一排；
 *   选择：点选摆件或道路，按住拖动直接挪位置（不用手柄）。
 */
import { Group, LineSegments, type Intersection } from "three";
import { MAP_LIMITS, type MapDesign, type PieceDesign, type Vec3 } from "../design";
import { categoryInfo, pieceSize, type CatalogPiece, type PieceCategory } from "../catalog";
import { sampleRoad } from "../road-geometry";
import type { AssembledScene } from "./assets";
import type { EditorApp } from "./app";
import { boxLines } from "./map-views";
import { toClient } from "./viewport";

export type Tool =
  | { kind: "select" }
  | { kind: "place"; piece: CatalogPiece }
  | { kind: "bulldoze" }
  | { kind: "items" };

/** 连续摆放时两个物件之间至少隔多远（米）。 */
const MIN_SPACING: Partial<Record<PieceCategory, number>> = {
  light: 18, sign: 10, ad: 6, tree: 5, flower: 2, rock: 4, creature: 5, decor: 3,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

interface Stroke {
  pieces: PieceDesign[];
  last?: Vec3;
}

interface Drag {
  start: Vec3;
  height: number;
  moved: boolean;
  pointer: { x: number; y: number };
  pieces?: Map<string, Vec3>;
  point?: { roadId: string; index: number; origin: Vec3 };
}

export class ToolController {
  /** 放置工具的朝向（度）和缩放。 */
  yaw = 0;
  scale = 1;
  private ghost?: { piece: CatalogPiece; root: Group; offset: Group; box: LineSegments; scene?: AssembledScene };
  private ghostPoint?: Vec3;
  private stroke?: Stroke;
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
    }).catch(error => this.app.say(`物件载入失败：${(error as Error).message}`));
  }

  private removeGhost(): void {
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
    ghost.root.rotation.set(0, 0, (this.yaw * Math.PI) / 180);
    ghost.root.scale.setScalar(this.scale);
    if (this.ghostPoint) {
      ghost.root.position.set(...this.ghostPoint);
      ghost.root.visible = true;
    }
  }

  /** Q/E 旋转、[ ] 缩放放置中的物件。 */
  rotateGhost(step: number): void {
    this.yaw = ((this.yaw + step) % 360 + 360) % 360;
    this.applyGhostTransform();
  }

  scaleGhost(factor: number): void {
    this.scale = Math.min(5, Math.max(0.2, Math.round(this.scale * factor * 100) / 100));
    this.applyGhostTransform();
    this.app.say(`放置大小 ${Math.round(this.scale * 100)}%`, 1500);
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
      this.stroke = { pieces: [] };
      this.paintAt(point, true);
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
      const point = this.surfacePoint(event);
      if (!point) return;
      this.ghostPoint = point;
      this.applyGhostTransform();
      if (this.stroke && event.buttons & 1) this.paintAt(point, false);
      return;
    }
    if (tool.kind === "bulldoze") {
      if (this.bulldozing && event.buttons & 1) this.bulldozeAt(event);
      else this.hoverPiece(event, 0xff4040);
      return;
    }
    if (this.drag && event.buttons & 1) this.continueDrag(event);
  }

  pointerUp(event: PointerEvent): boolean {
    const tool = this.app.tool;
    if (tool.kind === "place" && this.stroke) {
      const placed = this.stroke.pieces.length;
      this.stroke = undefined;
      if (placed) {
        this.app.state.commit();
        this.app.say(placed > 1 ? `放好了 ${placed} 个「${tool.piece.label}」` : `放好了「${tool.piece.label}」`, 2000);
      }
      return true;
    }
    if (tool.kind === "bulldoze" && this.bulldozing) {
      const removed = this.bulldozing.size;
      this.bulldozing = undefined;
      if (removed) { this.app.state.commit(); this.app.say(`拆掉了 ${removed} 样东西`, 2000); }
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
      if (drag.moved) { this.app.state.commit(); return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------ 放置

  private makePiece(position: Vec3, yaw: number, scale: number): PieceDesign {
    const piece = this.ghost!.piece;
    return {
      id: this.app.state.newId("p"), track: piece.track, path: [...piece.path], label: piece.label,
      origin: [...piece.origin] as Vec3, position, rotation: [round2(yaw), 0, 0], scale: [scale, scale, scale],
    };
  }

  private paintAt(point: Vec3, first: boolean): void {
    const ghost = this.ghost, stroke = this.stroke;
    if (!ghost || !stroke) return;
    const piece = ghost.piece;
    const info = categoryInfo(piece.category);
    const size = pieceSize(piece);
    const design = this.app.state.design;
    const room = () => design.pieces.length < MAP_LIMITS.pieces;
    if (first) {
      if (!room()) { this.app.say(`摆件最多 ${MAP_LIMITS.pieces} 个。`); return; }
      const scatter = info.paint === "scatter";
      const yaw = scatter ? this.yaw + Math.random() * 360 : this.yaw;
      const scale = scatter ? round2(this.scale * (0.85 + Math.random() * 0.3)) : this.scale;
      const placed = this.makePiece(point, yaw, scale);
      this.app.views.popPieces.add(placed.id);
      stroke.pieces.push(placed);
      stroke.last = point;
      this.app.state.preview(d => { d.pieces.push(placed); });
      return;
    }
    if (info.paint === "single" || !stroke.last) return;
    const last = stroke.last;
    const dx = point[0] - last[0], dy = point[1] - last[1];
    const distance = Math.hypot(dx, dy);
    const along = info.paint === "line" ? Math.max(size[0], size[1]) : Math.max(size[0], size[1]) * 1.1;
    const spacing = Math.max(MIN_SPACING[piece.category] ?? 2, along * this.scale);
    if (distance < spacing) return;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const added: PieceDesign[] = [];
    let cursor = last;
    for (let travelled = spacing; travelled <= distance && room(); travelled += spacing) {
      const t = travelled / distance;
      const z = last[2] + (point[2] - last[2]) * t;
      if (info.paint === "line") {
        // 长边顺着拖动方向
        const yaw = angle + (size[0] >= size[1] ? 0 : 90) + this.yaw;
        cursor = [round2(last[0] + dx * t), round2(last[1] + dy * t), round2(z)];
        added.push(this.makePiece(cursor, yaw, this.scale));
      } else {
        const jitter = spacing * 0.35;
        cursor = [round2(last[0] + dx * t + (Math.random() - 0.5) * jitter), round2(last[1] + dy * t + (Math.random() - 0.5) * jitter), round2(z)];
        added.push(this.makePiece(cursor, this.yaw + Math.random() * 360, round2(this.scale * (0.85 + Math.random() * 0.3))));
      }
    }
    if (!added.length) return;
    for (const piece of added) this.app.views.popPieces.add(piece.id);
    stroke.pieces.push(...added);
    stroke.last = info.paint === "line" ? cursor : point;
    // 落到实际表面上（路、地面），沿线插值的高度可能悬空
    for (const piece of added) {
      const z = this.app.viewport.castDown([piece.position[0], piece.position[1], piece.position[2] + 60],
        [this.app.views.roads, this.app.views.ground]);
      if (z !== undefined) piece.position[2] = round2(z);
    }
    this.app.state.preview(d => { d.pieces.push(...added); });
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
    this.app.state.preview(d => { d.pieces = d.pieces.filter(piece => piece.id !== under.id); });
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
    if (!hit || !road) { this.app.say("要点在赛道上哦"); return; }
    if (design.items.rows.length >= MAP_LIMITS.itemRows) { this.app.say(`道具箱最多 ${MAP_LIMITS.itemRows} 排。`); return; }
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
    this.app.say("放好了一排道具箱", 2000);
  }

  // ------------------------------------------------------------------ 拖动挪位置

  private beginDrag(event: PointerEvent): boolean {
    if ((this.app.viewport.gizmo as unknown as { axis: string | null }).axis) return false;
    const app = this.app;
    const hit = app.viewport.pick(event, [app.views.handles, app.views.pieces]);
    if (!hit) return false;
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
    if (!pieceId) return false;
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
    if (drag.point) {
      const { roadId, index, origin } = drag.point;
      this.app.state.preview(d => {
        const point = d.roads.find(road => road.id === roadId)?.points[index];
        if (point) { point.x = round2(origin[0] + dx); point.y = round2(origin[1] + dy); }
      });
      return;
    }
    const pieces = drag.pieces!;
    this.app.state.preview(d => {
      for (const piece of d.pieces) {
        const origin = pieces.get(piece.id);
        if (origin) piece.position = [round2(origin[0] + dx), round2(origin[1] + dy), origin[2]];
      }
    });
  }

  get dragging(): boolean { return !!this.drag?.moved || !!this.stroke || !!this.bulldozing; }
}
