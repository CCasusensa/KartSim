/**
 * 地图工坊主程序：工具栏、视口交互（选取、画路、从官方赛道取件、变换手柄）、
 * 撤销重做与快捷键。面板内容见 panels.ts，存取/试跑/发布见 actions.ts。
 */
import {
  AlwaysDepth, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PlaneGeometry, Quaternion, Scene, Vector3,
  WebGLRenderTarget, type Texture,
} from "three";
import { DEFAULT_ROAD_SURFACE, DEFAULT_WALL, MAP_LIMITS, defaultGround, newDesign, type MapDesign, type PieceDesign, type RoadDesign, type Vec3 } from "../design";
import type { PieceInfo, SourceTrack } from "../source-tracks";
import { objectForPath, type AssembledScene, type EditorAssets } from "./assets";
import { button, clear, h } from "./dom";
import { MapViews, boxLines, readPieceTransform } from "./map-views";
import { EditorState } from "./state";
import { isTyping, toClient, Viewport } from "./viewport";
import { renderLeftPanel, renderRightPanel } from "./panels";
import { EditorActions } from "./actions";

export type Mode = "select" | "draw" | "source";

export interface SourceSession {
  track: SourceTrack;
  scene: AssembledScene;
  model: any;
  pieces: PieceInfo[];
  objects: Map<Object3D, number>;
  selected: Set<number>;
  boxes: Group;
}

const SNAP_MOVE = 1;
const SNAP_ANGLE = 15;

export class EditorApp {
  readonly state = new EditorState();
  readonly viewport: Viewport;
  readonly views: MapViews;
  readonly actions: EditorActions;
  mode: Mode = "select";
  gizmoMode: "translate" | "rotate" | "scale" = "translate";
  snap = true;
  /** 素材库里当前打开的官方赛道。 */
  browsing?: SourceTrack;
  source?: SourceSession;
  /** 用户在素材库里点中的贴图（给道路、护墙、地面用）。 */
  pickedTexture?: { track: string; name: string; road?: [string, string][]; alpha?: "test" | "blend" };
  leftTab: "tracks" | "mine" = "tracks";
  /** 左侧面板内容变化（列表选择等）时加一。 */
  leftVersion = 0;
  private readonly picks = new Map<string, Set<number>>();
  sourceTab: "pieces" | "textures" = "pieces";
  trackFilter = { text: "", theme: "" };
  readonly bar: HTMLElement;
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  readonly status: HTMLElement;
  readonly hint: HTMLElement;
  readonly sourceBar: HTMLElement;
  private readonly helpTip: HTMLElement;
  private readonly pivot = new Group();
  private dragStart?: { pivot: Matrix4; pieces: Map<string, Matrix4> };
  private pointerDown?: { x: number; y: number; button: number };
  private skyScene?: AssembledScene;
  private skyFolder?: string;
  private readonly thumbs = new Map<string, Promise<string | undefined>>();
  private renderQueued = false;

  constructor(root: HTMLElement, readonly assets: EditorAssets) {
    this.bar = h("header", { class: "ed-bar k-black" });
    this.left = h("aside", { class: "ed-left k-dialog" });
    this.right = h("aside", { class: "ed-right k-dialog" });
    const view = h("main", { class: "ed-view" });
    this.status = h("footer", { class: "ed-status" });
    this.hint = h("div", { class: "ed-hint k-tip" });
    this.sourceBar = h("div", { class: "ed-source-bar" });
    root.append(h("div", { class: "ed-root" }, this.bar, this.left, view, this.right, this.status));
    this.viewport = new Viewport(view);
    this.helpTip = h("div", { class: "ed-help-tip k-tip" },
      "右键拖动：转视角　滚轮：缩放　中键/空格+左键：平移　方向键：移动视角", h("br"),
      "W/E/R：移动/旋转/缩放　D：画路　Ctrl+D：复制　Delete：删除　F：聚焦　Ctrl+Z/Y：撤销/重做");
    view.append(this.hint, this.sourceBar, this.helpTip);
    this.viewport.stageBinding = assets.stageBinding as unknown as { beginFrame(time: number): void };
    this.views = new MapViews(this.viewport, assets);
    this.views.onPieceLoaded = () => this.updateStatus();
    this.viewport.world.add(this.pivot);
    this.actions = new EditorActions(this);
    this.bindViewport();
    this.bindKeys();
    this.state.on(kind => this.onChange(kind));
    this.renderBar();
    this.refresh();
  }

  // ------------------------------------------------------------------ 刷新

  private onChange(kind: string): void {
    if (kind === "design" || kind === "selection") this.syncViews();
    if (kind === "design" && this.state.design.sky !== this.skyFolder) void this.loadSky(this.state.design.sky);
    this.queueRender();
  }

  queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => { this.renderQueued = false; this.refresh(); });
  }

  refresh(): void {
    renderLeftPanel(this);
    renderRightPanel(this);
    this.renderBar();
    this.updateStatus();
    this.updateHint();
  }

  syncViews(): void {
    const selection = this.state.selection;
    this.views.sync(this.state.design, {
      roadId: selection?.kind === "road" ? selection.id : undefined,
      point: selection?.kind === "road" ? selection.point : undefined,
      pieceIds: selection?.kind === "pieces" ? selection.ids : [],
    });
    this.attachGizmo();
  }

  private renderBar(): void {
    clear(this.bar);
    const mode = (label: string, value: typeof this.gizmoMode, key: string) => {
      const b = button(`${label} ${key}`, () => this.setGizmoMode(value), { class: this.gizmoMode === value ? "k-on" : "" });
      return b;
    };
    this.bar.append(
      h("span", { class: "ed-title" }, "地图工坊"),
      button("新建", () => this.actions.newMap()),
      button("打开", () => this.actions.openDialog()),
      button("保存", () => void this.actions.save(), { title: "保存到本机（Ctrl+S）" }),
      button("导入", () => this.actions.importFile()),
      button("另存为", () => this.actions.saveAs(), { title: "复制成一张新地图" }),
      button("导出", () => this.actions.exportDialog(), { title: "导出地图包、赛道包或设计文件" }),
      h("span", { class: "ed-sep" }),
      button("撤销", () => this.state.undo(), { disabled: !this.state.canUndo }),
      button("重做", () => this.state.redo(), { disabled: !this.state.canRedo }),
      h("span", { class: "ed-sep" }),
      mode("移动", "translate", "W"), mode("旋转", "rotate", "E"), mode("缩放", "scale", "R"),
      button(this.snap ? "吸附：开" : "吸附：关", () => { this.snap = !this.snap; this.attachGizmo(); this.renderBar(); },
        { class: this.snap ? "k-on" : "", title: "移动按 1 米、旋转按 15° 吸附" }),
      h("span", { class: "ed-sep" }),
      button("新道路", () => this.startRoad(), { title: "在视口里依次点击放置控制点" }),
      button(this.mode === "draw" ? "结束画路" : "画路 D", () => this.mode === "draw" ? this.setMode("select") : this.startDraw(),
        { class: this.mode === "draw" ? "k-on" : "" }),
      h("span", { class: "ed-spacer" }),
      button("检查", () => this.actions.check()),
      button("试跑", () => void this.actions.testDrive(), { class: "ed-primary", title: "生成赛道包，在游戏的计时赛里试跑" }),
      button("发布", () => void this.actions.publish(), { class: "ed-primary", title: "上传到服务器，多人竞速房可选" }),
      button("帮助", () => this.actions.help()),
    );
  }

  updateStatus(): void {
    clear(this.status);
    const design = this.state.design;
    const selection = this.state.selection;
    const what = selection?.kind === "pieces" ? `已选 ${selection.ids.length} 个摆件`
      : selection?.kind === "road" ? `已选道路「${this.state.road(selection.id)?.name ?? ""}」${selection.point !== undefined ? ` 第 ${selection.point + 1} 点` : ""}` : "";
    this.status.append(
      h("span", { class: "ed-grow" }, this.message || what),
      h("span", {}, "地图 ", h("b", {}, design.name), `　道路 ${design.roads.length}　摆件 ${design.pieces.length}`),
      h("span", {}, this.state.dirty ? "未保存" : "已保存"),
      h("span", {}, this.actions.accountLabel()),
    );
  }

  message = "";
  private messageTimer?: ReturnType<typeof setTimeout>;
  say(text: string, ms = 5000): void {
    this.message = text;
    this.updateStatus();
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => { this.message = ""; this.updateStatus(); }, ms);
  }

  private updateHint(): void {
    const road = this.state.selectedRoad();
    this.hint.textContent = this.mode === "draw"
      ? `画路：点击放下控制点${road && road.points.length >= 3 ? "，点回起点（绿色）闭合成环" : ""}；Enter/Esc 结束`
      : this.mode === "source" && this.source
        ? `正在查看官方赛道「${this.source.track.title}」：点击物件选取（Shift 多选），再点左下角“放到我的地图”`
        : "";
    clear(this.sourceBar);
    this.helpTip.style.display = this.mode === "source" ? "none" : "";
    if (this.mode === "source" && this.source) {
      const count = this.source.selected.size;
      this.sourceBar.append(
        button(`放到我的地图（${count}）`, () => this.placeSourceSelection(), { class: "ed-primary", disabled: !count }),
        button("全选", () => this.selectAllSource()),
        button("清除选择", () => { this.source!.selected.clear(); this.updateSourceBoxes(); this.queueRender(); }),
        button("回到我的地图", () => this.closeSource()),
      );
    }
  }

  // ------------------------------------------------------------------ 天空

  private async loadSky(folder: string): Promise<void> {
    this.skyFolder = folder;
    const previous = this.skyScene;
    this.skyScene = undefined;
    if (previous) { this.viewport.removeScene(previous); previous.object.removeFromParent(); previous.dispose(); }
    try {
      const sky = await this.assets.assembleSky(folder);
      if (!sky || this.skyFolder !== folder) { sky?.dispose(); return; }
      this.skyScene = sky;
      // 与游戏相同（vehicle.js configureSkydome）：天空不写深度、总在最后面，先画
      sky.object.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.renderOrder = -1000;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material.depthFunc = AlwaysDepth;
          material.depthWrite = false;
        }
      });
      sky.object.userData.noPick = true;
      this.viewport.scene.add(sky.object);
      this.viewport.addScene(sky);
    } catch (error) {
      console.warn("天空盒载入失败", error);
      // 下次改动时再试
      if (this.skyFolder === folder) this.skyFolder = undefined;
    }
  }

  // ------------------------------------------------------------------ 模式

  setMode(mode: Mode): void {
    if (this.mode === "source" && mode !== "source") this.hideSource();
    this.mode = mode;
    this.attachGizmo();
    this.queueRender();
  }

  setGizmoMode(mode: typeof this.gizmoMode): void {
    this.gizmoMode = mode;
    this.attachGizmo();
    this.renderBar();
  }

  /** 新建一条道路并进入画路。 */
  startRoad(): void {
    if (this.mode === "source") this.closeSource();
    const isFirst = !this.state.design.roads.some(road => road.route);
    const texture = this.pickedTexture?.road ? this.pickedTexture : undefined;
    const road: RoadDesign = {
      id: this.state.newId("r"), name: isFirst ? "主赛道" : `道路 ${this.state.design.roads.length + 1}`,
      closed: false, route: isFirst, points: [], width: 24,
      surface: texture ? { track: texture.track, name: texture.name, road: texture.road ?? [], alpha: texture.alpha } : { ...DEFAULT_ROAD_SURFACE },
      uvLength: 24, thickness: 1.5,
      walls: { left: { ...DEFAULT_WALL, texture: { ...DEFAULT_WALL.texture } }, right: { ...DEFAULT_WALL, texture: { ...DEFAULT_WALL.texture } } },
    };
    this.state.design.roads.push(road);
    this.state.select({ kind: "road", id: road.id });
    this.setMode("draw");
    this.say("在视口里依次点击放置控制点。");
  }

  startDraw(): void {
    if (!this.state.selectedRoad()) { this.startRoad(); return; }
    if (this.mode === "source") this.closeSource();
    this.setMode("draw");
  }

  // ------------------------------------------------------------------ 视口交互

  private bindViewport(): void {
    const canvas = this.viewport.renderer.domElement;
    canvas.addEventListener("pointerdown", event => {
      this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
      canvas.focus();
    });
    canvas.addEventListener("pointerup", event => {
      const down = this.pointerDown;
      this.pointerDown = undefined;
      if (!down || down.button !== 0 || event.altKey || this.viewport.gizmo.dragging) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      if ((this.viewport.gizmo as unknown as { axis: string | null }).axis) return;
      this.click(event);
    });
    canvas.addEventListener("dblclick", event => {
      if (this.mode === "draw") this.finishDraw();
      else if (this.mode === "select") {
        const hit = this.viewport.pick(event, [this.views.pieces]);
        if (hit) this.focusSelection();
      }
    });
    const gizmo = this.viewport.gizmo;
    gizmo.addEventListener("mouseDown", () => this.beginGizmoDrag());
    gizmo.addEventListener("objectChange", () => this.gizmoChanged(false));
    gizmo.addEventListener("mouseUp", () => this.gizmoChanged(true));
  }

  private click(event: MouseEvent): void {
    if (this.mode === "draw") { this.drawClick(event); return; }
    if (this.mode === "source") { this.sourceClick(event); return; }
    const hit = this.viewport.pick(event, this.views.pickTargets());
    if (!hit) { this.state.select(undefined); return; }
    const handle = hit.object.userData.handle as { roadId: string; index: number } | undefined;
    if (handle) { this.state.select({ kind: "road", id: handle.roadId, point: handle.index }); return; }
    const pieceId = this.views.pieceIdOf(hit.object);
    if (pieceId) {
      const piece = this.state.piece(pieceId);
      const groupIds = piece?.group && !event.ctrlKey && !event.metaKey
        ? this.state.design.pieces.filter(p => p.group === piece.group).map(p => p.id) : [pieceId];
      const current = this.state.selection?.kind === "pieces" ? this.state.selection.ids : [];
      if (event.shiftKey) {
        const has = groupIds.every(id => current.includes(id));
        const ids = has ? current.filter(id => !groupIds.includes(id)) : [...new Set([...current, ...groupIds])];
        this.state.select(ids.length ? { kind: "pieces", ids } : undefined);
      } else this.state.select({ kind: "pieces", ids: groupIds });
      return;
    }
    const roadId = hit.object.userData.roadId as string | undefined;
    if (roadId) { this.state.select({ kind: "road", id: roadId }); return; }
    this.state.select(undefined);
  }

  /** 画路：点到的位置（道路、摆件、地面，否则所在高度的水平面）。 */
  private drawClick(event: MouseEvent): void {
    let road = this.state.selectedRoad();
    if (!road) { this.startRoad(); road = this.state.selectedRoad()!; }
    const last = road.points[road.points.length - 1];
    const hit = this.viewport.pick(event, [this.views.roads, this.views.pieces, this.views.ground]);
    let point: Vec3 | undefined;
    if (hit) {
      const p = toClient(hit.point);
      // 点在自己这条路上时沿用上一个点的高度，免得越画越高
      point = hit.object.userData.roadId === road.id && last ? [p[0], p[1], last.z] : [p[0], p[1], p[2] + 0.05];
    } else point = this.viewport.pickPlane(event, last?.z ?? this.state.design.ground?.z ?? 0);
    if (!point) return;
    const first = road.points[0];
    if (first && road.points.length >= 3 && Math.hypot(point[0] - first.x, point[1] - first.y) < Math.max(8, road.width * 0.6)) {
      const id = road.id;
      this.state.commit(design => { const r = design.roads.find(x => x.id === id)!; r.closed = true; });
      this.setMode("select");
      this.say("道路已闭合成环。");
      return;
    }
    if (road.points.length >= MAP_LIMITS.roadPoints) { this.say("控制点太多了。"); return; }
    const id = road.id;
    const rounded: Vec3 = [Math.round(point[0] * 10) / 10, Math.round(point[1] * 10) / 10, Math.round(point[2] * 10) / 10];
    this.state.commit(design => {
      const r = design.roads.find(x => x.id === id)!;
      r.points.push({ x: rounded[0], y: rounded[1], z: rounded[2] });
    });
    this.state.select({ kind: "road", id, point: road.points.length - 1 });
  }

  finishDraw(): void {
    const road = this.state.selectedRoad();
    this.setMode("select");
    if (road && road.points.length < 2) {
      const id = road.id;
      this.state.commit(design => { design.roads = design.roads.filter(r => r.id !== id); });
      this.state.select(undefined);
    }
  }

  // ------------------------------------------------------------------ 变换手柄

  attachGizmo(): void {
    const gizmo = this.viewport.gizmo;
    gizmo.detach();
    if (this.mode !== "select") return;
    gizmo.setTranslationSnap(this.snap ? SNAP_MOVE : null);
    gizmo.setRotationSnap(this.snap ? (SNAP_ANGLE * Math.PI) / 180 : null);
    gizmo.setScaleSnap(this.snap ? 0.05 : null);
    const selection = this.state.selection;
    if (selection?.kind === "road" && selection.point !== undefined) {
      const handle = this.views.handleObject(selection.point);
      if (handle) { gizmo.setMode("translate"); gizmo.attach(handle); }
      return;
    }
    if (selection?.kind !== "pieces" || !selection.ids.length) return;
    gizmo.setMode(this.gizmoMode);
    if (selection.ids.length === 1) {
      const object = this.views.pieceObject(selection.ids[0]!);
      if (object) gizmo.attach(object);
      return;
    }
    // 多选：手柄挂在选中摆件的中心
    const center = new Vector3();
    let count = 0;
    for (const id of selection.ids) {
      const object = this.views.pieceObject(id);
      if (object) { center.add(object.position); count++; }
    }
    if (!count) return;
    this.pivot.position.copy(center.divideScalar(count));
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrix();
    gizmo.attach(this.pivot);
  }

  private beginGizmoDrag(): void {
    const selection = this.state.selection;
    if (selection?.kind !== "pieces") return;
    this.pivot.updateMatrix();
    const pieces = new Map<string, Matrix4>();
    for (const id of selection.ids) {
      const object = this.views.pieceObject(id);
      if (!object) continue;
      object.updateMatrix();
      pieces.set(id, object.matrix.clone());
      this.views.draggingPieces.add(id);
    }
    this.dragStart = { pivot: this.pivot.matrix.clone(), pieces };
  }

  private gizmoChanged(done: boolean): void {
    const selection = this.state.selection;
    if (selection?.kind === "road" && selection.point !== undefined) {
      const handle = this.views.handleObject(selection.point);
      const road = this.state.road(selection.id);
      if (!handle || !road) return;
      const radius = Math.max(1.2, road.width * 0.07);
      const index = selection.point;
      const x = Math.round(handle.position.x * 100) / 100, y = Math.round(handle.position.y * 100) / 100;
      const z = Math.round((handle.position.z - radius * 0.8) * 100) / 100;
      const apply = (design: MapDesign) => { const point = design.roads.find(r => r.id === road.id)!.points[index]!; point.x = x; point.y = y; point.z = z; };
      if (done) this.state.commit(apply); else this.state.preview(apply);
      return;
    }
    if (selection?.kind !== "pieces") return;
    const updates = new Map<string, ReturnType<typeof readPieceTransform>>();
    if (selection.ids.length === 1) {
      const object = this.views.pieceObject(selection.ids[0]!);
      if (object) updates.set(selection.ids[0]!, readPieceTransform(object));
    } else if (this.dragStart) {
      this.pivot.updateMatrix();
      const delta = this.pivot.matrix.clone().multiply(this.dragStart.pivot.clone().invert());
      for (const [id, start] of this.dragStart.pieces) {
        const object = this.views.pieceObject(id);
        if (!object) continue;
        const matrix = delta.clone().multiply(start);
        const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
        matrix.decompose(position, quaternion, scale);
        object.position.copy(position);
        object.quaternion.copy(quaternion);
        object.scale.copy(scale);
        updates.set(id, readPieceTransform(object));
      }
    }
    const apply = (design: MapDesign) => {
      for (const piece of design.pieces) {
        const update = updates.get(piece.id);
        if (update) Object.assign(piece, update);
      }
    };
    if (done) {
      this.views.draggingPieces.clear();
      this.dragStart = undefined;
      this.state.commit(apply);
    } else this.state.preview(apply);
  }

  // ------------------------------------------------------------------ 摆件操作

  deleteSelection(): void {
    const selection = this.state.selection;
    if (selection?.kind === "pieces") {
      const ids = new Set(selection.ids);
      this.state.commit(design => { design.pieces = design.pieces.filter(piece => !ids.has(piece.id)); });
      this.state.select(undefined);
    } else if (selection?.kind === "road") {
      const road = this.state.road(selection.id);
      if (!road) return;
      if (selection.point !== undefined && road.points.length > 2) {
        const index = selection.point;
        this.state.commit(design => {
          const r = design.roads.find(x => x.id === road.id)!;
          r.points.splice(index, 1);
          if (r.points.length < 3) r.closed = false;
        });
        this.state.select({ kind: "road", id: road.id, point: Math.min(index, road.points.length - 1) });
      } else if (confirm(`删除道路「${road.name}」？`)) {
        this.state.commit(design => {
          design.roads = design.roads.filter(r => r.id !== road.id);
          design.items.rows = design.items.rows.filter(row => row.road !== road.id);
        });
        this.state.select(undefined);
      }
    }
  }

  duplicateSelection(): void {
    const pieces = this.state.selectedPieces();
    if (!pieces.length) return;
    if (this.state.design.pieces.length + pieces.length > MAP_LIMITS.pieces) { this.say(`摆件最多 ${MAP_LIMITS.pieces} 个。`); return; }
    const group = pieces.length > 1 ? this.state.newId("g") : undefined;
    const copies = pieces.map(piece => ({
      ...structuredClone(piece), id: this.state.newId("p"), group,
      position: [piece.position[0] + 6, piece.position[1] + 6, piece.position[2]] as Vec3,
    }));
    this.state.commit(design => { design.pieces.push(...copies); });
    this.state.select({ kind: "pieces", ids: copies.map(copy => copy.id) });
  }

  /** 把选中的摆件放到正下方的道路、地面或其他摆件上。 */
  dropToGround(): void {
    const pieces = this.state.selectedPieces();
    if (!pieces.length) return;
    const ids = new Set(pieces.map(p => p.id));
    const targets: Object3D[] = [this.views.roads, this.views.ground,
      ...this.views.pieces.children.filter(child => !ids.has(child.userData.pieceId))];
    const heights = new Map<string, number>();
    for (const piece of pieces) {
      const z = this.viewport.castDown([piece.position[0], piece.position[1], piece.position[2] + 200], targets);
      heights.set(piece.id, z ?? this.state.design.ground?.z ?? 0);
    }
    this.state.commit(design => {
      for (const piece of design.pieces) {
        const z = heights.get(piece.id);
        if (z !== undefined) piece.position[2] = Math.round(z * 100) / 100;
      }
    });
  }

  focusSelection(): void {
    const selection = this.state.selection;
    if (selection?.kind === "pieces") {
      const object = this.views.pieceObject(selection.ids[0]!);
      if (object) this.viewport.lookAt([object.position.x, object.position.y, object.position.z], 80);
    } else if (selection?.kind === "road") {
      const road = this.state.road(selection.id);
      const point = selection.point !== undefined ? road?.points[selection.point] : road?.points[0];
      if (point) this.viewport.lookAt([point.x, point.y, point.z], 160);
    } else if (this.mode === "source" && this.source) {
      const first = [...this.source.selected][0];
      const piece = first !== undefined ? this.source.pieces[first] : undefined;
      if (piece) this.viewport.lookAt(piece.origin, 120);
    }
  }

  /** 在视角中心放一组官方物件，保持它们原来的相对位置。 */
  placePieces(track: string, infos: PieceInfo[], at?: Vec3): void {
    if (!infos.length) return;
    if (this.state.design.pieces.length + infos.length > MAP_LIMITS.pieces) { this.say(`摆件最多 ${MAP_LIMITS.pieces} 个。`); return; }
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const info of infos) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, info.min[i]!); max[i] = Math.max(max[i]!, info.max[i]!); }
    const anchor: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    const target = at ?? this.viewport.focusPoint();
    const groundZ = at ? target[2] : this.state.design.ground?.z ?? 0;
    const group = infos.length > 1 ? this.state.newId("g") : undefined;
    const pieces: PieceDesign[] = infos.map(info => ({
      id: this.state.newId("p"), track, path: [...info.path], label: info.name, group,
      origin: [...info.origin] as Vec3,
      position: [
        Math.round((target[0] + info.origin[0] - anchor[0]) * 100) / 100,
        Math.round((target[1] + info.origin[1] - anchor[1]) * 100) / 100,
        Math.round((groundZ + info.origin[2] - anchor[2]) * 100) / 100,
      ],
      rotation: [0, 0, 0], scale: [1, 1, 1],
    }));
    this.state.commit(design => { design.pieces.push(...pieces); });
    this.state.select({ kind: "pieces", ids: pieces.map(piece => piece.id) });
    this.say(`已放入 ${pieces.length} 个物件${group ? "（一组，点击时整组选中，Ctrl+点击选单个）" : ""}。`);
  }

  // ------------------------------------------------------------------ 取件视图

  /** 某条官方赛道里选中的物件（列表和取件视图共用）。 */
  listPicks(folder: string): Set<number> {
    let picks = this.picks.get(folder);
    if (!picks) { picks = new Set(); this.picks.set(folder, picks); }
    return picks;
  }

  /** 在视口里打开整条官方赛道，点选物件。 */
  async openSource(track: SourceTrack): Promise<void> {
    this.hideSource();
    this.browsing = track;
    this.say(`正在载入「${track.title}」…`, 20000);
    try {
      const [{ scene, model }, pieces] = await Promise.all([this.assets.assembleTrack(track.folder), this.assets.pieces(track.folder)]);
      if (this.browsing !== track) { scene.dispose(); return; }
      const objects = new Map<Object3D, number>();
      pieces.forEach((piece, index) => {
        const object = objectForPath(scene.object, model.scene, piece.path);
        if (object) objects.set(object, index);
      });
      const boxes = new Group();
      boxes.userData.noPick = true;
      this.source = { track, scene, model, pieces, objects, selected: this.listPicks(track.folder), boxes };
      this.updateSourceBoxes();
      this.viewport.world.add(scene.object, boxes);
      this.viewport.addScene(scene);
      this.views.pieces.visible = this.views.roads.visible = this.views.ground.visible = this.views.handles.visible = this.views.markers.visible = false;
      this.mode = "source";
      this.attachGizmo();
      this.sourceCameraBackup = { position: this.viewport.camera.position.clone(), target: this.viewport.controls.target.clone() };
      // 只看有一定大小的物件来框视角（远处的天空板、巨型背景会把范围撑得太大）
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const piece of pieces) {
        if (piece.max.some((v, i) => Math.abs(v - piece.min[i]!) > 3000)) continue;
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, piece.min[i]!); max[i] = Math.max(max[i]!, piece.max[i]!); }
      }
      if (Number.isFinite(min[0])) this.viewport.frameBounds(min, max);
      this.say(`「${track.title}」：${pieces.length} 个物件。`);
    } catch (error) {
      this.say(`官方赛道载入失败：${(error as Error).message}`);
    }
    this.queueRender();
  }

  private sourceCameraBackup?: { position: Vector3; target: Vector3 };

  private hideSource(): void {
    const source = this.source;
    if (!source) return;
    this.source = undefined;
    this.viewport.removeScene(source.scene);
    source.scene.object.removeFromParent();
    source.boxes.removeFromParent();
    source.scene.dispose();
    this.views.pieces.visible = this.views.roads.visible = this.views.ground.visible = this.views.handles.visible = this.views.markers.visible = true;
    if (this.sourceCameraBackup) {
      this.viewport.camera.position.copy(this.sourceCameraBackup.position);
      this.viewport.controls.target.copy(this.sourceCameraBackup.target);
      this.sourceCameraBackup = undefined;
    }
  }

  closeSource(): void {
    this.hideSource();
    this.mode = "select";
    this.attachGizmo();
    this.queueRender();
  }

  private sourceClick(event: MouseEvent): void {
    const source = this.source;
    if (!source) return;
    const hit = this.viewport.pick(event, [source.scene.object]);
    let index: number | undefined;
    for (let object: Object3D | null = hit?.object ?? null; object; object = object.parent) {
      const found = source.objects.get(object);
      if (found !== undefined) { index = found; break; }
    }
    if (index === undefined) { if (!event.shiftKey) source.selected.clear(); }
    else if (event.shiftKey) { if (source.selected.has(index)) source.selected.delete(index); else source.selected.add(index); }
    else { source.selected.clear(); source.selected.add(index); }
    this.updateSourceBoxes();
    this.queueRender();
  }

  selectSourcePiece(index: number, add: boolean): void {
    if (!this.source) return;
    if (!add) this.source.selected.clear();
    if (this.source.selected.has(index) && add) this.source.selected.delete(index); else this.source.selected.add(index);
    this.updateSourceBoxes();
    this.queueRender();
  }

  private selectAllSource(): void {
    if (!this.source) return;
    this.source.pieces.forEach((_, index) => this.source!.selected.add(index));
    this.updateSourceBoxes();
    this.queueRender();
  }

  updateSourceBoxes(): void {
    const source = this.source;
    if (!source) return;
    for (const child of [...source.boxes.children]) child.removeFromParent();
    if (source.selected.size > 200) return;
    for (const index of source.selected) {
      const piece = source.pieces[index]!;
      source.boxes.add(boxLines(piece.min, piece.max, 0xffc400));
    }
  }

  private placeSourceSelection(): void {
    const source = this.source;
    if (!source || !source.selected.size) return;
    const infos = [...source.selected].sort((a, b) => a - b).map(index => source.pieces[index]!);
    const folder = source.track.folder;
    this.closeSource();
    this.placePieces(folder, infos);
  }

  // ------------------------------------------------------------------ 贴图缩略图

  /** 把一张官方贴图画成 64×64 的缩略图（data URL）。 */
  textureThumb(track: string, name: string): Promise<string | undefined> {
    const key = `${track}\n${name}`;
    let pending = this.thumbs.get(key);
    if (!pending) {
      pending = this.assets.texture(track, name).then(texture => texture ? this.renderThumb(texture) : undefined);
      this.thumbs.set(key, pending);
    }
    return pending;
  }

  private renderThumb(texture: Texture): string {
    const size = 64;
    const renderer = this.viewport.renderer;
    const target = new WebGLRenderTarget(size, size);
    const scene = new Scene();
    const material = new MeshBasicMaterial({ map: texture, transparent: true });
    scene.add(new Mesh(new PlaneGeometry(2, 2), material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x333333, 1);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(null);
    target.dispose();
    material.dispose();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const image = new ImageData(size, size);
    for (let y = 0; y < size; y++) image.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    canvas.getContext("2d")!.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }

  // ------------------------------------------------------------------ 快捷键

  private bindKeys(): void {
    window.addEventListener("keydown", event => {
      if (isTyping(event) || document.querySelector(".ed-modal")) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.code === "KeyZ") { event.preventDefault(); if (event.shiftKey) this.state.redo(); else this.state.undo(); return; }
      if (ctrl && event.code === "KeyY") { event.preventDefault(); this.state.redo(); return; }
      if (ctrl && event.code === "KeyS") { event.preventDefault(); void this.actions.save(); return; }
      if (ctrl && event.code === "KeyD") { event.preventDefault(); this.duplicateSelection(); return; }
      if (ctrl) return;
      switch (event.code) {
        case "KeyW": this.setGizmoMode("translate"); break;
        case "KeyE": this.setGizmoMode("rotate"); break;
        case "KeyR": this.setGizmoMode("scale"); break;
        case "KeyD": if (this.mode === "draw") this.finishDraw(); else this.startDraw(); break;
        case "KeyF": this.focusSelection(); break;
        case "Delete": case "Backspace": event.preventDefault(); this.deleteSelection(); break;
        case "Enter": if (this.mode === "draw") this.finishDraw(); break;
        case "Escape":
          if (this.mode === "draw") this.finishDraw();
          else if (this.mode === "source") this.closeSource();
          else this.state.select(undefined);
          break;
        case "Space": event.preventDefault(); break;
      }
    });
  }

  /** 新地图（缺省给一块地面）。 */
  resetDesign(name?: string): void {
    const design = newDesign(name);
    design.ground = defaultGround();
    this.closeSource();
    this.state.load(design);
    this.viewport.lookAt([0, 0, 0], 460);
  }
}
