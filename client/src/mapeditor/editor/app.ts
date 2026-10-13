/**
 * 地图工坊主程序：工具栏、底部素材栏、视口交互（选取、放置、推土机、画路、
 * 拖动挪位置；高级模式另有从官方赛道取件和变换手柄）、撤销重做与快捷键。
 * 素材栏见 dock.ts，工具见 tools.ts，属性面板见 inspector.ts（简单模式）和
 * panels.ts（高级模式），存取/试跑/发布见 actions.ts。
 */
import {
  AlwaysDepth, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PlaneGeometry, Quaternion, Scene, Vector3,
  WebGLRenderTarget, type Texture,
} from "three";
import {
  DEFAULT_ROAD_SURFACE, DEFAULT_WALL, MAP_LIMITS, defaultGround, newDesign, type MapDesign, type PieceDesign, type RoadDesign,
  type TextureRef, type Vec3,
} from "../design";
import {
  archRef, defaultArch, surfaceRef, textureLabel, textureRef, themeTitle, type CatalogArch, type CatalogSky, type CatalogTexture,
  type ThemePreset,
} from "../catalog";
import { START_ARCH_ID } from "../start-line";
import { sampleRoad } from "../road-geometry";
import { ROAD_CLEARANCE, settleRoad, type SettleResult } from "../road-settle";
import type { PieceInfo, SourceTrack } from "../source-tracks";
import { templateRoad, type TrackTemplate } from "../templates";
import { objectForPath, type AssembledScene, type EditorAssets } from "./assets";
import { button, clear, h } from "./dom";
import { Dock } from "./dock";
import { Hud, openMapSettings } from "./hud";
import { MapViews, boxLines, readPieceTransform } from "./map-views";
import { EditorState } from "./state";
import { ToolController, type Tool } from "./tools";
import { isTyping, toClient, Viewport } from "./viewport";
import { renderLeftPanel, renderRightPanel } from "./panels";
import { EditorActions, modal } from "./actions";

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
const ADVANCED_KEY = "kartsim-mapeditor-advanced";

function storedSnap(): boolean {
  try { return localStorage.getItem("kartsim-mapeditor-snap") !== "0"; } catch { return true; }
}

function storedAdvanced(): boolean {
  try { return localStorage.getItem(ADVANCED_KEY) === "1"; } catch { return false; }
}

export class EditorApp {
  readonly state = new EditorState();
  readonly viewport: Viewport;
  readonly views: MapViews;
  readonly actions: EditorActions;
  readonly tools: ToolController;
  readonly dock: Dock;
  mode: Mode = "select";
  /** 简单模式下视口的工具：选择、放置、推土机、放道具箱。 */
  tool: Tool = { kind: "select" };
  /** 高级模式：左侧官方赛道浏览、变换手柄、完整属性面板。 */
  advanced = storedAdvanced();
  gizmoMode: "translate" | "rotate" | "scale" = "translate";
  /** 自动吸附（默认开，记在本机）：贴路边、顺着路摆正、落到表面、位置角度取整。 */
  snap = storedSnap();
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
  private readonly root: HTMLElement;
  private menu?: HTMLElement;
  /** 简单模式的游戏界面（工具条、任务卡、头顶按钮…）。 */
  readonly hud: Hud;
  /** 选中道路时点到的位置：头顶按钮挂在这里。 */
  selectionAnchor?: Vec3;
  private autosaveTimer?: ReturnType<typeof setTimeout>;
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
    this.root = h("div", { class: "ed-root" }, this.bar, this.left, view, this.right, this.status);
    root.append(this.root);
    this.viewport = new Viewport(view);
    this.helpTip = h("div", { class: "ed-help-tip k-tip" });
    view.append(this.hint, this.sourceBar, this.helpTip);
    this.viewport.stageBinding = assets.stageBinding as unknown as { beginFrame(time: number): void };
    this.views = new MapViews(this.viewport, assets);
    this.views.onPieceLoaded = () => this.updateStatus();
    this.viewport.world.add(this.pivot);
    this.actions = new EditorActions(this);
    this.tools = new ToolController(this);
    this.dock = new Dock(this);
    this.root.append(this.dock.element);
    this.root.classList.toggle("ed-advanced", this.advanced);
    this.hud = new Hud(this, view);
    // 素材栏的大类按钮浮在地图底部正中
    view.append(this.dock.tabsRow);
    this.viewport.wasd = !this.advanced;
    // 左键按在空地上拖动＝移动视角；按在东西上交给工具（拖着挪、放置、拆除）
    this.viewport.leftDrag = event => {
      if (this.mode === "source" || this.mode === "draw") return "pan";
      if (this.tool.kind !== "select" || (this.viewport.gizmo as unknown as { axis: string | null }).axis) return "none";
      return this.viewport.pick(event, [this.views.handles, this.views.pieces]) || this.tools.overStartLine(event) ? "none" : "pan";
    };
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
    if (kind === "design" && this.state.dirty) this.scheduleAutosave();
    this.queueRender();
  }

  /** 改动停下 1.5 秒后自动存到本机（空地图不存）。 */
  scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      const design = this.state.design;
      if (!this.state.dirty || (!design.roads.length && !design.pieces.length)) return;
      void this.actions.save({ quiet: true });
    }, 1500);
  }

  queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => { this.renderQueued = false; this.refresh(); });
  }

  refresh(): void {
    if (this.advanced) { renderLeftPanel(this); renderRightPanel(this); }
    this.hud.render();
    this.dock.refreshMarks();
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
    if (!this.advanced) { this.renderSimpleBar(); return; }
    const mode = (label: string, value: typeof this.gizmoMode, key: string) =>
      button(`${label} ${key}`, () => this.setGizmoMode(value), { class: this.gizmoMode === value ? "k-on" : "" });
    const tool = (label: string, kind: "select" | "bulldoze", key: string, title: string) =>
      button(`${label} ${key}`, () => this.setTool({ kind }), { class: this.tool.kind === kind && this.mode === "select" ? "k-on" : "", title });
    this.bar.append(
      h("span", { class: "ed-title" }, "地图工坊"),
      h("span", { class: "ed-mapname", title: "地图名（在右侧“地图设置”里改）" }, this.state.design.name),
      button("新建", () => this.actions.newMap(), { title: "新建向导：选主题和赛道形状" }),
      button("打开", () => this.actions.openDialog()),
      button("保存", () => void this.actions.save(), { title: "保存到本机（Ctrl+S）" }),
      h("span", { class: "ed-sep" }),
      button("撤销", () => this.state.undo(), { disabled: !this.state.canUndo, title: "Ctrl+Z" }),
      button("重做", () => this.state.redo(), { disabled: !this.state.canRedo, title: "Ctrl+Y" }),
      h("span", { class: "ed-sep" }),
      tool("选择", "select", "V", "点选摆件和道路，按住拖动挪位置"),
      tool("推土机", "bulldoze", "B", "点摆件推掉，按住拖动连片推"),
      button(this.mode === "draw" ? "结束画路" : "画路 D", () => this.mode === "draw" ? this.finishDraw() : this.startDraw(),
        { class: this.mode === "draw" ? "k-on" : "", title: "在地图上依次点击放控制点" }),
      ...(this.advanced ? [
        h("span", { class: "ed-sep" }),
        mode("移动", "translate", "W"), mode("旋转", "rotate", "E"), mode("缩放", "scale", "R"),
      ] : []),
      button(this.snap ? "吸附：开" : "吸附：关", () => this.setSnap(!this.snap),
        { class: this.snap ? "k-on" : "", title: "贴路边、顺着路摆正、落到表面，位置按 0.5 米、旋转按 15° 对齐" }),
      h("span", { class: "ed-spacer" }),
      button("试跑", () => void this.actions.testDrive(), { class: "ed-primary", title: "生成赛道，在游戏的计时赛里跑一圈" }),
      button("发布", () => void this.actions.publish(), { class: "ed-primary", title: "上传到服务器，大家都能玩" }),
      button("更多 ▾", () => this.toggleMenu()),
    );
  }

  /** 简单模式的顶栏：只放玩家常用的几样，说法像游戏。 */
  private renderSimpleBar(): void {
    const design = this.state.design;
    this.bar.append(
      h("span", { class: "ed-title" }, "地图工坊"),
      h("button", { type: "button", class: "ed-mapname ed-mapname-button", title: "改名字、圈数和难度", onclick: () => openMapSettings(this) },
        `「${design.name}」 ✎`),
      button("新地图", () => this.actions.newMap(), { title: "选主题和赛道形状，做一张新地图" }),
      button("我的地图", () => this.actions.openDialog(), { title: "打开以前做的地图" }),
      h("span", { class: "ed-sep" }),
      button("↶ 撤销", () => this.state.undo(), { disabled: !this.state.canUndo, title: "Ctrl+Z" }),
      button("↷ 重做", () => this.state.redo(), { disabled: !this.state.canRedo, title: "Ctrl+Y" }),
      h("span", { class: "ed-spacer" }),
      h("span", { class: "ed-saved" }, this.state.dirty ? "改动中…" : design.roads.length || design.pieces.length ? "✓ 已自动保存" : ""),
      button("▶ 开车试玩", () => void this.actions.testDrive(), { class: "ed-primary ed-play", title: "在游戏里开这张图跑一圈" }),
      button("★ 分享给大家", () => void this.actions.publish(), { class: "ed-primary", title: "上传到服务器，所有人都能玩" }),
      button("更多 ▾", () => this.toggleMenu()),
    );
  }

  private toggleMenu(): void {
    if (this.menu) { this.menu.remove(); this.menu = undefined; return; }
    const close = () => { this.menu?.remove(); this.menu = undefined; window.removeEventListener("pointerdown", outside, true); };
    const item = (label: string, run: () => void) => button(label, () => { close(); run(); });
    const menu = h("div", { class: "ed-menu k-dialog" }, h("div", { class: "k-caption" }, "更多"),
      item("怎么玩", () => this.actions.help()),
      item("地图设置（名字、圈数、难度）", () => openMapSettings(this)),
      item("复制一份", () => this.actions.saveAs()),
      item("导入地图文件…", () => this.actions.importFile()),
      item("导出地图文件…", () => this.actions.exportDialog()),
      item("检查地图", () => this.actions.check()),
      item(this.advanced ? "✓ 高级模式（专业编辑）" : "高级模式（专业编辑）", () => this.setAdvanced(!this.advanced)));
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) close(); };
    window.addEventListener("pointerdown", outside, true);
    const rect = this.bar.getBoundingClientRect();
    menu.style.right = "8px";
    menu.style.top = `${rect.bottom + 4}px`;
    document.body.append(menu);
    this.menu = menu;
  }

  /** 打开或关上自动吸附（记在本机）。 */
  setSnap(on: boolean): void {
    this.snap = on;
    try { localStorage.setItem("kartsim-mapeditor-snap", on ? "1" : "0"); } catch { /* 隐私模式 */ }
    this.attachGizmo();
    this.say(on ? "自动吸附打开了：靠近赛道会贴到路边、顺着路摆正" : "自动吸附关掉了：东西放在哪就是哪", 3000);
    this.queueRender();
  }

  setAdvanced(on: boolean): void {
    this.advanced = on;
    try { localStorage.setItem(ADVANCED_KEY, on ? "1" : "0"); } catch { /* 隐私模式 */ }
    this.root.classList.toggle("ed-advanced", on);
    this.viewport.wasd = !on;
    if (!on && this.mode === "source") this.closeSource();
    this.attachGizmo();
    this.say(on ? "高级模式：左侧可以浏览整条官方赛道取件，W/E/R 用手柄移动、旋转、缩放，右侧有全部数值。" : "已回到简单模式。", 6000);
    this.queueRender();
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
    if (!this.advanced) this.hud.toast(text, Math.min(ms, 4000));
    this.updateStatus();
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => { this.message = ""; this.updateStatus(); }, ms);
  }

  private updateHint(): void {
    const road = this.state.selectedRoad();
    const tool = this.tool;
    this.hint.textContent = this.mode === "draw"
      ? `画路：点击放下控制点${road && road.points.length >= 3 ? "，点回起点（绿色）闭合成环" : ""}；双击、Enter 或 Esc 结束`
      : this.mode === "source" && this.source
        ? `正在查看官方赛道「${this.source.track.title}」：点击物件选取（Shift 多选），再点左下角“放到我的地图”`
        : tool.kind === "place"
          ? `放置「${tool.piece.label}」：点击放下；滚轮或 Q/E 旋转，长按上下拖调高度，[ ] 大小，Esc 或右键结束`
          : tool.kind === "bulldoze" ? "推土机：点摆件推掉，按住拖动连片推；Esc 结束"
            : tool.kind === "items" ? "点道路放一排道具箱；Esc 结束" : "";
    clear(this.sourceBar);
    // 简单模式的提示在游戏界面里（底部动作条、提示气泡）
    if (!this.advanced) this.hint.textContent = "";
    this.helpTip.style.display = this.mode === "source" || !this.advanced ? "none" : "";
    clear(this.helpTip);
    this.helpTip.append("左键：选择 / 放置　右键拖动：转视角　滚轮：缩放　中键或空格+左键：平移", h("br"),
      this.advanced ? "W/E/R：移动/旋转/缩放手柄　D：画路　B：推土机　Ctrl+D：复制　Delete：删除　F：聚焦"
        : "Q/E：旋转　[ ]：大小　D：画路　B：推土机　Ctrl+D：复制　Delete：删除　F：聚焦　Ctrl+Z：撤销");
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
    if (mode !== "select" && this.tool.kind !== "select") this.setTool({ kind: "select" });
    this.mode = mode;
    this.attachGizmo();
    this.queueRender();
  }

  /** 换视口工具（放置、推土机…）；画路和取件时先回到普通模式。 */
  setTool(tool: Tool): void {
    if (tool.kind !== "select") {
      if (this.mode === "draw") this.finishDraw();
      if (this.mode === "source") this.closeSource();
    }
    if (tool.kind === "place" && this.tool.kind !== "place") { this.tools.yaw = 0; this.tools.scale = 1; this.tools.lift = 0; }
    this.tool = tool;
    // 放置中滚轮给物件转方向，不缩放视角（拉近拉远用右下角按钮）
    this.viewport.controls.enableZoom = tool.kind !== "place";
    this.tools.activate(tool);
    if (tool.kind !== "select") this.state.select(undefined);
    this.dock.setActive(tool.kind === "place" ? { kind: "piece", id: tool.piece.id, piece: tool.piece }
      : tool.kind === "items" ? this.dock.active : undefined);
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
    // 新路沿用已有道路（比赛路线）的路面和护栏，风格统一
    const like = this.state.design.roads.find(road => road.route) ?? this.state.design.roads[0];
    const wall = { ...DEFAULT_WALL, texture: structuredClone(this.defaultWall()) };
    const road: RoadDesign = {
      id: this.state.newId("r"), name: isFirst ? "主赛道" : `道路 ${this.state.design.roads.length + 1}`,
      closed: false, route: isFirst, points: [], width: like?.width ?? 22,
      surface: texture ? { track: texture.track, name: texture.name, road: texture.road ?? [], alpha: texture.alpha }
        : structuredClone(like?.surface ?? this.defaultSurface()),
      uvLength: 24, thickness: 1.5,
      walls: { left: structuredClone(wall), right: structuredClone(wall) },
    };
    if (this.tool.kind !== "select") this.setTool({ kind: "select" });
    this.state.design.roads.push(road);
    this.state.select({ kind: "road", id: road.id });
    this.setMode("draw");
    this.say("在地上点一下放一个点，一个一个点出赛道");
  }

  startDraw(): void {
    if (!this.state.selectedRoad()) { this.startRoad(); return; }
    if (this.mode === "source") this.closeSource();
    if (this.tool.kind !== "select") this.setTool({ kind: "select" });
    this.setMode("draw");
  }

  // ------------------------------------------------------------------ 视口交互

  private bindViewport(): void {
    const canvas = this.viewport.renderer.domElement;
    canvas.addEventListener("pointerdown", event => {
      this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
      canvas.focus();
      if (this.tools.pointerDown(event)) this.pointerDown = undefined;
    });
    canvas.addEventListener("pointermove", event => this.tools.pointerMove(event));
    // 放置中滚轮转方向（抢在视角缩放前面）
    canvas.addEventListener("wheel", event => {
      if (!this.tools.wheel(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
    canvas.addEventListener("pointerleave", () => this.tools.clearHover());
    canvas.addEventListener("pointerup", event => {
      const down = this.pointerDown;
      this.pointerDown = undefined;
      if (this.tools.pointerUp(event) || !down) return;
      const still = Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 5;
      // 右键单击（没拖动视角）：结束当前工具或画路
      if (down.button === 2 && still) {
        if (this.mode === "draw") this.finishDraw();
        else if (this.tool.kind !== "select") this.setTool({ kind: "select" });
        return;
      }
      if (down.button !== 0 || event.altKey || this.viewport.gizmo.dragging || !still) return;
      if ((this.viewport.gizmo as unknown as { axis: string | null }).axis) return;
      this.click(event);
    });
    canvas.addEventListener("dblclick", event => {
      if (this.mode === "draw") this.finishDraw();
      else if (this.mode === "select" && this.tool.kind === "select") {
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
    if (this.tool.kind !== "select") return;
    const hit = this.viewport.pick(event, this.views.pickTargets());
    if (!hit) { this.state.select(undefined); return; }
    const handle = hit.object.userData.handle as { roadId: string; index: number } | undefined;
    if (handle) { this.state.select({ kind: "road", id: handle.roadId, point: handle.index }); return; }
    const pieceId = this.views.pieceIdOf(hit.object);
    if (pieceId === START_ARCH_ID) {
      // 点起点拱门：打开素材栏的拱门那一栏换样式
      this.state.select(undefined);
      this.dock.open("arch", true);
      this.say("这是起点拱门：在下面挑一种换上，或者用“拆除”拆掉", 4000);
      return;
    }
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
    if (roadId) {
      const at = toClient(hit.point);
      this.selectionAnchor = [at[0], at[1], at[2] + 4];
      this.state.select({ kind: "road", id: roadId });
      return;
    }
    this.state.select(undefined);
  }

  /** 画路：点到的位置（道路、摆件、地面，否则所在高度的水平面）。 */
  private drawClick(event: MouseEvent): void {
    let road = this.state.selectedRoad();
    if (!road) { this.startRoad(); road = this.state.selectedRoad()!; }
    const last = road.points[road.points.length - 1];
    const hit = this.viewport.pick(event, [this.views.roads, this.views.pieces, this.views.ground]);
    // 路面至少比地面高 ROAD_CLEARANCE，贴着地面画会和草地打架、露出底图
    const floor = this.roadFloor();
    let point: Vec3 | undefined;
    if (hit) {
      const p = toClient(hit.point);
      // 点在自己这条路上时沿用上一个点的高度，免得越画越高
      point = hit.object.userData.roadId === road.id && last ? [p[0], p[1], last.z] : [p[0], p[1], Math.max(floor, p[2] + 0.05)];
    } else point = this.viewport.pickPlane(event, last?.z ?? Math.max(floor, 0));
    if (!point) return;
    const first = road.points[0];
    if (first && road.points.length >= 3 && Math.hypot(point[0] - first.x, point[1] - first.y) < Math.max(8, road.width * 0.6)) {
      this.commitRoad(road.id, r => { r.closed = true; });
      this.setMode("select");
      this.say("赛道连成一圈啦！");
      return;
    }
    if (road.points.length >= MAP_LIMITS.roadPoints) { this.say("这条路的点太多啦"); return; }
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
    } else if (road) this.commitRoad(road.id);
  }

  /** 路面最低能放多高：地面上方 ROAD_CLEARANCE（没有地面时不限）。 */
  roadFloor(): number {
    const ground = this.state.design.ground;
    return ground ? ground.z + ROAD_CLEARANCE : -Infinity;
  }

  /**
   * 改一条路，并在同一步里自动修顺（road-settle.ts：去掉太近的点、急弯修圆、
   * 贴地的点抬高、太陡的坡摊平），撤销一次就整个回去。修了什么会提示一句。
   */
  commitRoad(roadId: string, change?: (road: RoadDesign, design: MapDesign) => void): void {
    let result: SettleResult | undefined;
    this.state.commit(design => {
      const road = design.roads.find(item => item.id === roadId);
      if (!road) return;
      change?.(road, design);
      if (road.points.length < 2) return;
      result = settleRoad(road, design.ground?.z);
      road.points = result.points;
    });
    if (result && (result.rounded || result.merged || result.lifted)) {
      const parts = [result.rounded ? "急弯修圆了" : "", result.merged ? "挤在一起的点合并了" : "", result.lifted ? "太低太陡的地方垫平了" : ""].filter(Boolean);
      this.say(`赛道自动修顺：${parts.join("，")}`, 3500);
    }
  }

  // ------------------------------------------------------------------ 变换手柄

  attachGizmo(): void {
    const gizmo = this.viewport.gizmo;
    gizmo.detach();
    // 简单模式直接拖物件、拖控制点，不用手柄
    if (this.mode !== "select" || !this.advanced || this.tool.kind !== "select") return;
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
      if (done) this.commitRoad(road.id, (_road, design) => apply(design)); else this.state.preview(apply);
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
      } else {
        modal("删除道路", `删除道路「${road.name}」？可以撤销。`, [["删除", () => {
          this.state.commit(design => {
            design.roads = design.roads.filter(r => r.id !== road.id);
            design.items.rows = design.items.rows.filter(row => row.road !== road.id);
          });
          this.state.select(undefined);
        }], ["取消", () => undefined]]);
      }
    }
  }

  duplicateSelection(): void {
    const pieces = this.state.selectedPieces();
    if (!pieces.length) return;
    if (this.state.design.pieces.length + pieces.length > MAP_LIMITS.pieces) { this.say(`一张地图最多放 ${MAP_LIMITS.pieces} 样东西`); return; }
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

  // ------------------------------------------------------------------ 简单模式的一键操作

  /** 一组选中摆件绕各自位置转一转（度，正值逆时针）。 */
  rotateSelection(degrees: number): void {
    const ids = new Set(this.state.selectedPieces().map(piece => piece.id));
    if (!ids.size) return;
    this.state.commit(design => {
      for (const piece of design.pieces) {
        if (!ids.has(piece.id)) continue;
        piece.rotation[0] = Math.round((((piece.rotation[0] + degrees) % 360 + 360) % 360) * 100) / 100;
      }
    });
  }

  /** 放大缩小；factor 为 0 时恢复原始大小。 */
  scaleSelection(factor: number): void {
    const ids = new Set(this.state.selectedPieces().map(piece => piece.id));
    if (!ids.size) return;
    this.state.commit(design => {
      for (const piece of design.pieces) {
        if (!ids.has(piece.id)) continue;
        piece.scale = factor ? piece.scale.map(v => Math.min(50, Math.max(0.05, Math.round(v * factor * 1000) / 1000))) as Vec3 : [1, 1, 1];
      }
    });
  }

  raiseSelection(meters: number): void {
    const ids = new Set(this.state.selectedPieces().map(piece => piece.id));
    if (!ids.size) return;
    this.state.commit(design => {
      for (const piece of design.pieces) if (ids.has(piece.id)) piece.position[2] = Math.round((piece.position[2] + meters) * 100) / 100;
    });
  }

  /** 新护栏用的贴图：比赛路线现在的护栏，否则缺省。 */
  defaultWall(): TextureRef {
    const route = this.state.design.roads.find(road => road.route);
    const preset = this.themePreset();
    const wall = preset?.wall ? this.dock.catalog()?.textures.find(texture => texture.id === preset.wall) : undefined;
    return route?.walls.left?.texture ?? route?.walls.right?.texture ?? (wall ? textureRef(wall) : DEFAULT_WALL.texture);
  }

  /** 当前主题的主题套装（素材目录还没读到时为 undefined）。 */
  private themePreset(): ThemePreset | undefined {
    return this.dock.catalog()?.presets.find(preset => preset.theme === this.state.design.theme);
  }

  /** 还没有道路时新路用的路面：当前主题套装的路面，否则缺省。 */
  defaultSurface(): RoadDesign["surface"] {
    const preset = this.themePreset();
    const surface = preset ? this.dock.catalog()?.textures.find(texture => texture.id === preset.surface) : undefined;
    return surface ? surfaceRef(surface) : DEFAULT_ROAD_SURFACE;
  }

  /** 贴图卡片要换的那条路：选中的道路，否则比赛路线。 */
  private targetRoad(): RoadDesign | undefined {
    return this.state.selectedRoad() ?? this.state.design.roads.find(road => road.route) ?? this.state.design.roads[0];
  }

  applyTexture(texture: CatalogTexture): void {
    const label = textureLabel(texture);
    if (texture.kind === "ground") {
      this.state.commit(design => {
        design.ground ??= { ...defaultGround(), size: this.groundSizeFor(design) };
        design.ground.texture = textureRef(texture);
      });
      this.say(`地面换成「${label}」。`);
      return;
    }
    const road = this.targetRoad();
    if (!road) { this.say("先在“赛道”里铺一条路。"); this.dock.open("shape"); return; }
    if (texture.kind === "surface") {
      this.state.commit(design => { design.roads.find(r => r.id === road.id)!.surface = surfaceRef(texture); });
      this.say(`「${road.name}」的路面换成「${label}」。`);
    } else {
      this.state.commit(design => {
        const target = design.roads.find(r => r.id === road.id)!;
        if (!target.walls.left && !target.walls.right) {
          target.walls.left = { ...DEFAULT_WALL, texture: textureRef(texture) };
          target.walls.right = { ...DEFAULT_WALL, texture: textureRef(texture) };
        }
        for (const wall of [target.walls.left, target.walls.right]) if (wall) wall.texture = textureRef(texture);
      });
      this.say(`「${road.name}」的护栏换成「${label}」。`);
    }
  }

  /** 换起点拱门；null 是不要拱门。 */
  setArch(arch: CatalogArch | null): void {
    this.state.commit(design => { design.start.arch = arch ? archRef(arch) : null; });
    if (!this.state.design.roads.some(road => road.route && road.closed)) this.say("铺好一圈赛道后，拱门会立在起跑线上", 3500);
    else this.say(arch ? `起点拱门换成了「${themeTitle(arch.theme)} ${arch.label}」` : "拆掉了起点拱门", 2500);
  }

  applySky(sky: CatalogSky): void {
    this.state.commit(design => { design.sky = sky.track; });
    this.say(`天空换成「${sky.label}」。`);
  }

  /** 主题套装：天空、全部道路的路面和护栏、地面、背景音乐。 */
  applyPreset(preset: ThemePreset): void {
    const data = this.dock.catalog();
    if (!data) return;
    const find = (id: string | undefined) => id ? data.textures.find(texture => texture.id === id) : undefined;
    const surface = find(preset.surface), wall = find(preset.wall), ground = find(preset.ground);
    const sky = data.skies.find(entry => entry.id === preset.sky);
    const arch = data.arches?.find(item => item.id === preset.arch);
    this.state.commit(design => {
      design.theme = preset.theme;
      if (sky) design.sky = sky.track;
      if (arch) design.start.arch = archRef(arch);
      for (const road of design.roads) {
        if (surface) road.surface = surfaceRef(surface);
        if (wall) for (const side of [road.walls.left, road.walls.right]) if (side) side.texture = textureRef(wall);
      }
      if (ground) {
        design.ground ??= { ...defaultGround(), size: this.groundSizeFor(design) };
        design.ground.texture = textureRef(ground);
      }
    });
    this.say(`换上了${themeTitle(preset.theme)}主题。`);
    this.dock.render();
  }

  /** 地面要盖住全部道路（再多留一圈）。 */
  private groundSizeFor(design: MapDesign): number {
    let extent = 300;
    for (const road of design.roads) for (const point of road.points) extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
    return Math.min(MAP_LIMITS.extent * 2, Math.ceil((extent * 2 + 400) / 100) * 100);
  }

  /** 用模板铺比赛路线；已有路线时换掉它的形状（路面、护栏不变）。 */
  applyTemplate(template: TrackTemplate): void {
    const route = this.state.design.roads.find(road => road.route);
    const apply = () => {
      if (this.mode === "draw") this.setMode("select");
      this.state.commit(design => {
        const existing = design.roads.find(road => road.route);
        if (existing) {
          existing.points = template.points();
          existing.width = template.width;
          existing.closed = true;
        } else {
          const like = design.roads[0];
          design.roads.push(templateRoad(template, this.state.newId("r"), like?.surface ?? this.defaultSurface(), this.defaultWall()));
        }
        design.start.offset = 0;
        design.ground ??= defaultGround();
        design.ground.size = Math.max(design.ground.size, this.groundSizeFor(design));
      });
      this.state.select(undefined);
      this.frameRoute();
      this.say(`铺好了「${template.title}」。拖白色圆点可以改形状，接下来在素材栏挑建筑和树摆上去。`, 8000);
    };
    if (route && route.points.length >= 3)
      modal("换赛道形状", `把比赛路线「${route.name}」换成「${template.title}」吗？已经摆好的物件不会动，可以撤销。`, [["换", apply], ["取消", () => undefined]]);
    else apply();
  }

  /** 视角框住比赛路线。 */
  frameRoute(): void {
    const route = this.state.design.roads.find(road => road.route) ?? this.state.design.roads[0];
    if (!route?.points.length) { this.viewport.lookAt([0, 0, 0], 460); return; }
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of route.points) {
      const v = [p.x, p.y, p.z];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, v[i]!); max[i] = Math.max(max[i]!, v[i]!); }
    }
    // 留一圈边，整条路都在画面里
    const pad = Math.max(max[0] - min[0], max[1] - min[1]) * 0.1 + 20;
    this.viewport.frameBounds([min[0] - pad, min[1] - pad, min[2]], [max[0] + pad, max[1] + pad, max[2]]);
  }

  /** 沿比赛路线每隔一段放一排道具箱。 */
  autoItems(): void {
    const route = this.state.design.roads.find(road => road.route && road.closed);
    if (!route) { this.say("先铺好一条闭合的比赛路线。"); return; }
    const total = Math.max(1, Math.floor(sampleRoad(route, 2).total));
    const spacing = Math.max(150, Math.min(400, total / 4));
    const startAhead = this.state.design.start.offset + 80;
    this.state.commit(design => {
      design.items.rows = design.items.rows.filter(row => row.road !== route.id);
      for (let d = startAhead; d < startAhead + total - spacing / 2; d += spacing)
        design.items.rows.push({ id: this.state.newId("i"), road: route.id, distance: Math.round(d) % total, count: 4 });
      design.items.rows = design.items.rows.slice(0, MAP_LIMITS.itemRows);
    });
    const rows = this.state.design.items.rows.filter(row => row.road === route.id).length;
    this.say(`放了 ${rows} 排道具箱。发布后道具房也能选这张图。`);
  }

  clearItems(): void {
    if (!this.state.design.items.rows.length) return;
    this.state.commit(design => { design.items.rows = []; });
    this.say("道具箱已清除。");
  }

  /** 换一张设计（新建向导、打开）。 */
  loadNewDesign(design: MapDesign): void {
    // 以前贴着地面画的路（比地面只高一点点）会和草地打架：打开时抬到地面上方
    if (design.ground) {
      const floor = design.ground.z + ROAD_CLEARANCE;
      let lifted = 0;
      for (const road of design.roads) for (const point of road.points) if (point.z < floor) { point.z = Math.round(floor * 100) / 100; lifted++; }
      if (lifted) setTimeout(() => this.say("已经把贴着地面的路抬高了一点，不会再露出草地", 4000), 0);
    }
    // 旧地图没有记拱门：按主题补一个原版起点拱门
    const data = this.dock.catalog();
    if (design.start.arch === undefined && data) {
      const arch = defaultArch(data, design.theme);
      design.start.arch = arch ? archRef(arch) : null;
    }
    this.closeSource();
    if (this.tool.kind !== "select") this.setTool({ kind: "select" });
    this.state.load(design);
    this.frameRoute();
    this.dock.render();
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
    if (this.state.design.pieces.length + infos.length > MAP_LIMITS.pieces) { this.say(`一张地图最多放 ${MAP_LIMITS.pieces} 样东西`); return; }
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
      const placing = this.tool.kind === "place";
      const turn = event.shiftKey ? 90 : 15;
      switch (event.code) {
        case "KeyQ":
          if (placing) { this.tools.rotateGhost(turn); this.queueRender(); } else this.rotateSelection(turn);
          break;
        case "KeyE":
          if (placing) { this.tools.rotateGhost(-turn); this.queueRender(); } else if (this.advanced) this.setGizmoMode("rotate"); else this.rotateSelection(-turn);
          break;
        case "BracketRight": if (placing) { this.tools.scaleGhost(1.15); this.queueRender(); } else this.scaleSelection(1.15); break;
        case "BracketLeft": if (placing) { this.tools.scaleGhost(1 / 1.15); this.queueRender(); } else this.scaleSelection(1 / 1.15); break;
        // 简单模式 W A S D 移动视角，字母快捷键只在高级模式
        case "KeyW": if (this.advanced) this.setGizmoMode("translate"); break;
        case "KeyR": if (this.advanced) this.setGizmoMode("scale"); break;
        case "KeyV": if (this.advanced) this.setTool({ kind: "select" }); break;
        case "KeyB": if (this.advanced) this.setTool({ kind: this.tool.kind === "bulldoze" ? "select" : "bulldoze" }); break;
        case "KeyD": if (!this.advanced) break; if (this.mode === "draw") this.finishDraw(); else this.startDraw(); break;
        case "KeyF": this.focusSelection(); break;
        case "Delete": case "Backspace": event.preventDefault(); this.deleteSelection(); break;
        case "Enter": if (this.mode === "draw") this.finishDraw(); break;
        case "Escape":
          if (this.mode === "draw") this.finishDraw();
          else if (this.tool.kind !== "select") this.setTool({ kind: "select" });
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
    // 空白地图用城镇主题套装的天空和地面（素材栏里能看到“使用中”）
    const data = this.dock.catalog();
    const preset = data?.presets.find(item => item.theme === design.theme);
    if (data && preset) {
      const sky = data.skies.find(item => item.id === preset.sky);
      const ground = data.textures.find(item => item.id === preset.ground);
      if (sky) design.sky = sky.track;
      if (ground) design.ground.texture = textureRef(ground);
    }
    this.loadNewDesign(design);
  }
}
