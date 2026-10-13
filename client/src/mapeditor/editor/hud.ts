/**
 * 简单模式的“游戏界面”：叠在视口上的工具条、任务卡、选中物头顶的操作按钮、
 * 底部的当前动作条、视角按钮和提示气泡。说法尽量像游戏，不出现“控制点”
 * “贴图”“吸附”这类词；精确数值留给高级模式。
 */
import { MAP_LIMITS, itemBoxCount, validateDesign, type MapDesign, type RoadDesign, type Vec3 } from "../design";
import { categoryInfo } from "../catalog";
import type { EditorApp } from "./app";
import { modal } from "./actions";
import { button, clear, h } from "./dom";

// ---------------------------------------------------------------------- 进度（试玩过、分享过）

const PROGRESS_KEY = "kartsim-mapeditor-progress";

export interface MapProgress { tried?: boolean; shared?: boolean }

export function loadProgress(id: string): MapProgress {
  try { return (JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, MapProgress>)[id] ?? {}; } catch { return {}; }
}

export function saveProgress(id: string, patch: MapProgress): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, MapProgress>;
    all[id] = { ...all[id], ...patch };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch { /* 隐私模式 */ }
}

/** 设计里的问题，换成玩家看得懂的话。 */
export function friendlyIssues(design: MapDesign): string[] {
  const out: string[] = [];
  const routes = design.roads.filter(road => road.route);
  if (!routes.length) out.push("还没有赛道：点下面素材栏的“赛道”，选一种形状；或者用左边的“画赛道”自己画。");
  else if (routes.length > 1) out.push("只能有一条比赛赛道，删掉多出来的那条。");
  for (const route of routes) {
    if (!route.closed || route.points.length < 3) out.push("赛道还没连成一圈：用“画赛道”接着画，最后点回绿色的起点。");
  }
  if (!design.name.trim()) out.push("给地图起个名字：点左上角任务卡里的地图名。");
  const rest = validateDesign(design).filter(issue => !/比赛路线|地图名/.test(issue));
  return [...out, ...rest];
}

/** 热闹度：摆的东西越多越热闹（0–5 颗星）。 */
export function liveliness(design: MapDesign): { stars: number; word: string } {
  const count = design.pieces.length;
  const stars = [5, 15, 40, 80, 150].filter(threshold => count >= threshold).length;
  return { stars, word: ["空荡荡", "有点意思", "热闹起来了", "很热闹", "超级热闹", "人山人海"][stars]! };
}

/**
 * 图标按钮（原版 TextButton 框）：上面一个图标，下面两三个字。glyph 以 k- 开头时
 * 用原版小图（k-up 上箭头、k-down 下箭头、k-left / k-right 左右箭头），否则是一个字符。
 */
function iconButton(glyph: string, label: string, run: () => void, options: { title?: string; class?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const element = h("button", { type: "button", class: `k-button ed-icon ${options.class ?? ""}`, title: options.title ?? label,
    disabled: options.disabled, onclick: () => run() });
  element.append(glyph.startsWith("k-") ? h("i", { class: `ed-pic ${glyph}` }) : h("b", {}, glyph), h("span", {}, label));
  return element;
}

/** 原版 TextButton 框的小文字按钮。 */
function popButton(label: string, run: () => void, options: { title?: string; class?: string } = {}): HTMLButtonElement {
  return button(label, run, { class: `ed-small ${options.class ?? ""}`, title: options.title });
}

// ---------------------------------------------------------------------- 地图设置

export function openMapSettings(app: EditorApp): void {
  const design = app.state.design;
  let laps = design.laps, difficulty = design.difficulty;
  const name = h("input", { class: "k-edit", type: "text", maxLength: MAP_LIMITS.nameLength });
  name.value = design.name;
  name.addEventListener("keydown", event => event.stopPropagation());
  const lapsText = h("b", { class: "ed-big" }, String(laps));
  const stars = h("span", { class: "ed-stars" });
  const drawStars = () => {
    clear(stars);
    for (let i = 1; i <= 5; i++) stars.append(h("button", { type: "button", class: `ed-star ${i <= difficulty ? "ed-on" : ""}`,
      title: `${i} 星`, onclick: () => { difficulty = i; drawStars(); } }, "★"));
  };
  drawStars();
  const content = h("div", { class: "ed-settings" },
    h("label", { class: "ed-field ed-wide" }, h("span", {}, "地图名"), name),
    h("div", { class: "ed-field" }, h("span", {}, "跑几圈"),
      button("－", () => { laps = Math.max(1, laps - 1); lapsText.textContent = String(laps); }, { class: "ed-small" }),
      lapsText,
      button("＋", () => { laps = Math.min(9, laps + 1); lapsText.textContent = String(laps); }, { class: "ed-small" })),
    h("div", { class: "ed-field" }, h("span", {}, "难度"), stars),
    h("div", { class: "ed-note" }, "想换天空、地面和音乐？在下面素材栏的“环境 → 主题套装”里点一个。"));
  const dialog = modal("地图设置", content, [["好了", () => {
    const value = name.value.trim();
    app.state.commit(d => { if (value) d.name = value; d.laps = laps; d.difficulty = difficulty; });
  }], ["取消", () => undefined]]);
  dialog.body.style.whiteSpace = "normal";
  setTimeout(() => name.focus(), 0);
}

// ---------------------------------------------------------------------- 界面

export class Hud {
  readonly element: HTMLElement;
  private readonly toolStrip: HTMLElement;
  private readonly mission: HTMLElement;
  private readonly actionBar: HTMLElement;
  private readonly modeBar: HTMLElement;
  private readonly cameraBox: HTMLElement;
  private readonly toastBox: HTMLElement;
  private readonly tip: HTMLElement;
  private missionOpen = true;
  private anchor?: () => Vec3 | undefined;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly app: EditorApp, view: HTMLElement) {
    this.toolStrip = h("div", { class: "ed-toolstrip" });
    this.mission = h("div", { class: "ed-mission k-dialog" });
    this.actionBar = h("div", { class: "ed-actbar k-balloon" });
    this.modeBar = h("div", { class: "ed-modebar k-bar" });
    this.cameraBox = h("div", { class: "ed-camera" },
      iconButton("k-left", "左转", () => app.viewport.orbit(45), { title: "视角向左转" }),
      iconButton("k-right", "右转", () => app.viewport.orbit(-45), { title: "视角向右转" }),
      iconButton("＋", "拉近", () => app.viewport.zoom(0.7)),
      iconButton("－", "拉远", () => app.viewport.zoom(1.4)),
      iconButton("⌂", "全景", () => app.frameRoute(), { title: "看整条赛道" }));
    this.toastBox = h("div", { class: "ed-toast k-toast" });
    this.tip = h("div", { class: "ed-tip k-tip" });
    this.element = h("div", { class: "ed-hud" }, this.toolStrip, this.mission, this.actionBar, this.modeBar, this.cameraBox, this.toastBox, this.tip);
    view.append(this.element);
    this.renderTip();
    app.viewport.onFrame(() => this.placeActionBar());
  }

  /** 提示气泡（放好、拆掉、换上…）。 */
  toast(text: string, ms = 2600): void {
    this.toastBox.textContent = text;
    this.toastBox.classList.remove("ed-show");
    void this.toastBox.offsetWidth;
    this.toastBox.classList.add("ed-show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastBox.classList.remove("ed-show"), ms);
  }

  render(): void {
    this.element.style.display = this.app.advanced ? "none" : "";
    if (this.app.advanced) return;
    this.renderTools();
    this.renderMission();
    this.renderModeBar();
    this.renderActionBar();
  }

  private renderTip(): void {
    let closed = false;
    try { closed = localStorage.getItem("kartsim-mapeditor-tip") === "closed"; } catch { /* 隐私模式 */ }
    clear(this.tip);
    if (closed) { this.tip.style.display = "none"; return; }
    this.tip.append(h("span", {}, "拖动空地：移动　右键拖动：转方向　滚轮：拉近拉远　W A S D：移动"),
      popButton("知道了", () => {
        try { localStorage.setItem("kartsim-mapeditor-tip", "closed"); } catch { /* 隐私模式 */ }
        this.tip.style.display = "none";
      }));
  }

  private renderTools(): void {
    const app = this.app;
    clear(this.toolStrip);
    const on = (active: boolean) => active ? "k-on" : "";
    this.toolStrip.append(
      iconButton("✋", "选择", () => { if (app.mode === "draw") app.finishDraw(); app.setTool({ kind: "select" }); },
        { class: on(app.mode === "select" && app.tool.kind === "select"), title: "点东西选中，按住拖动挪位置" }),
      iconButton("✎", "画赛道", () => app.mode === "draw" ? app.finishDraw() : app.startDraw(),
        { class: on(app.mode === "draw"), title: "在地上一个点一个点地画出赛道" }),
      iconButton("✖", "拆除", () => app.setTool({ kind: app.tool.kind === "bulldoze" ? "select" : "bulldoze" }),
        { class: on(app.tool.kind === "bulldoze"), title: "点一下拆掉东西，按住拖可以拆一片" }));
  }

  private renderMission(): void {
    const app = this.app;
    const design = app.state.design;
    const progress = loadProgress(design.id);
    const route = design.roads.find(road => road.route);
    const routeOk = !!route && route.closed && route.points.length >= 3;
    const boxes = itemBoxCount(design);
    const steps: Array<{ done: boolean; text: string; go?: [string, () => void] }> = [
      { done: routeOk, text: routeOk ? "铺好赛道了" : "铺一条赛道", go: ["去铺", () => app.dock.open("shape", true)] },
      { done: design.pieces.length >= 10, text: `摆 10 样东西（${Math.min(design.pieces.length, 10)}/10）`, go: ["去摆", () => app.dock.open("building", true)] },
      { done: boxes > 0, text: boxes ? `放了 ${boxes} 个道具箱` : "放道具箱", go: ["去放", () => app.dock.open("items", true)] },
      { done: !!progress.tried, text: "开车试玩一圈", go: ["开车", () => void app.actions.testDrive()] },
      { done: !!progress.shared, text: "分享给大家", go: ["分享", () => void app.actions.publish()] },
    ];
    const current = steps.findIndex(step => !step.done);
    const lively = liveliness(design);
    clear(this.mission);
    this.mission.append(h("div", { class: "k-caption" }, "任务"));
    const head = h("div", { class: "ed-mission-head" },
      h("button", { type: "button", class: "ed-mapname-button", title: "改名字、圈数和难度", onclick: () => openMapSettings(app) },
        `「${design.name}」`, h("small", {}, " ✎")),
      popButton(this.missionOpen ? "收起" : "展开", () => { this.missionOpen = !this.missionOpen; this.renderMission(); }));
    this.mission.append(head);
    if (!this.missionOpen) return;
    steps.forEach((step, index) => {
      const now = index === current;
      // 原版勾选框：做完的打勾；正在做的这一步套上原版的青色选中圈
      this.mission.append(h("div", { class: `ed-step ${step.done ? "ed-done" : ""} ${now ? "ed-now k-ring" : ""}` },
        h("i", { class: `ed-pic k-check ${step.done ? "k-done" : ""}` }), h("span", {}, `${index + 1}. ${step.text}`),
        now && step.go ? popButton(step.go[0], step.go[1], { class: "ed-go" }) : undefined));
    });
    if (current < 0) this.mission.append(h("div", { class: "ed-cheer" }, "全部完成！大家都能玩到你的赛道了"));
    this.mission.append(h("div", { class: "ed-lively", title: `摆了 ${design.pieces.length} 样东西` },
      h("span", {}, "热闹度"), h("span", { class: "ed-stars" }, ...[1, 2, 3, 4, 5].map(i => h("i", { class: i <= lively.stars ? "ed-on" : "" }, "★"))),
      h("small", {}, lively.word)));
  }

  /** 正在做的动作（画赛道、放东西、拆除、放道具箱）：屏幕底部中间一条。 */
  private renderModeBar(): void {
    const app = this.app;
    clear(this.modeBar);
    const tool = app.tool;
    const bar = (...children: Array<Node | string | undefined>) => this.modeBar.append(...children.filter((child): child is Node | string => !!child));
    if (app.mode === "draw") {
      const road = app.state.selectedRoad();
      const count = road?.points.length ?? 0;
      bar(h("span", { class: "ed-say" }, count >= 3 ? "接着点地面加点，点回绿色起点就连成一圈" : "在地上点一下放一个点，一个一个点出赛道的形状"),
        iconButton("↶", "撤一个点", () => app.state.undo(), { disabled: !count }),
        iconButton("✓", "画完了", () => app.finishDraw(), { class: "ed-primary" }));
    } else if (tool.kind === "place") {
      const paint = categoryInfo(tool.piece.category).paint !== "single";
      const lift = app.tools.lift;
      const say = app.tools.lifting ? `上下拖动调高度：离地 ${lift.toFixed(1)} 米，松开就放下`
        : `正在放「${tool.piece.label}」：点地面放下${paint ? "，按住拖动连着放" : ""}；滚轮转方向，长按后上下拖调高度`;
      bar(app.dock.sprite(tool.piece.slot, 40, "ed-modebar-sprite"),
        h("span", { class: "ed-say" }, say),
        Math.abs(lift) >= 0.05 && !app.tools.lifting ? h("span", { class: "ed-say ed-height" }, `离地 ${lift.toFixed(1)} 米`) : undefined,
        Math.abs(lift) >= 0.05 ? iconButton("k-down", "贴地", () => app.tools.resetLift(), { title: "高度清零，贴着地面放" }) : undefined,
        iconButton("k-left", "左转", () => { app.tools.rotateGhost(15); }, { title: "Q 或滚轮" }),
        iconButton("k-right", "右转", () => { app.tools.rotateGhost(-15); }, { title: "E 或滚轮" }),
        iconButton("＋", "变大", () => { app.tools.scaleGhost(1.15); }, { title: "]" }),
        iconButton("－", "变小", () => { app.tools.scaleGhost(1 / 1.15); }, { title: "[" }),
        iconButton("✓", "放完了", () => app.setTool({ kind: "select" }), { class: "ed-primary", title: "Esc 或右键" }));
    } else if (tool.kind === "bulldoze") {
      bar(h("span", { class: "ed-say" }, "拆除：点一下拆掉，按住拖可以拆一片（拆错了点“撤销”）"),
        iconButton("✓", "拆完了", () => app.setTool({ kind: "select" }), { class: "ed-primary" }));
    } else if (tool.kind === "items") {
      bar(h("span", { class: "ed-say" }, "在赛道上点一下，就横着放一排道具箱"),
        iconButton("✓", "好了", () => app.setTool({ kind: "select" }), { class: "ed-primary" }));
    }
    this.modeBar.style.display = this.modeBar.firstChild ? "" : "none";
  }

  /** 选中的东西头顶上的一排按钮。 */
  private renderActionBar(): void {
    const app = this.app;
    clear(this.actionBar);
    this.anchor = undefined;
    const selection = app.state.selection;
    if (app.mode !== "select" || app.tool.kind !== "select" || !selection) { this.actionBar.style.display = "none"; return; }
    const title = (text: string) => h("div", { class: "ed-actbar-title" }, text);
    const row = h("div", { class: "ed-actbar-row" });
    if (selection.kind === "pieces") {
      const pieces = app.state.selectedPieces();
      if (!pieces.length) { this.actionBar.style.display = "none"; return; }
      this.actionBar.append(title(pieces.length === 1 ? pieces[0]!.label : `${pieces.length} 样东西`), row);
      row.append(
        iconButton("k-left", "左转", () => app.rotateSelection(15), { title: "Q" }),
        iconButton("k-right", "右转", () => app.rotateSelection(-15), { title: "E" }),
        iconButton("＋", "变大", () => app.scaleSelection(1.15), { title: "]" }),
        iconButton("－", "变小", () => app.scaleSelection(1 / 1.15), { title: "[" }),
        iconButton("k-up", "抬高", () => app.raiseSelection(1)),
        iconButton("k-down", "降低", () => app.raiseSelection(-1)),
        iconButton("⧉", "复制", () => app.duplicateSelection(), { title: "Ctrl+D" }),
        iconButton("✖", "删除", () => app.deleteSelection(), { class: "ed-danger", title: "Delete" }));
      this.anchor = () => this.piecesTop();
    } else {
      const road = app.state.road(selection.id);
      if (!road) { this.actionBar.style.display = "none"; return; }
      // 改路都走 commitRoad：同一步里自动修顺（急弯修圆、贴地抬高、太陡摊平）
      const commit = (change: (road: RoadDesign) => void) => app.commitRoad(road.id, change);
      if (selection.point !== undefined && road.points[selection.point]) {
        const index = selection.point;
        const point = road.points[index]!;
        this.actionBar.append(title(`路上的第 ${index + 1} 个点${point.z ? `（高 ${point.z.toFixed(0)} 米）` : ""}`), row);
        row.append(
          iconButton("k-up", "抬高", () => commit(r => { r.points[index]!.z = Math.round((r.points[index]!.z + 2) * 10) / 10; })),
          iconButton("k-down", "降低", () => commit(r => { r.points[index]!.z = Math.round((r.points[index]!.z - 2) * 10) / 10; })),
          iconButton("↶", "左歪", () => commit(r => { r.points[index]!.bank = Math.min(40, (r.points[index]!.bank ?? 0) + 8); }), { title: "路面往右边倾斜（左高右低）" }),
          iconButton("↷", "右歪", () => commit(r => { r.points[index]!.bank = Math.max(-40, (r.points[index]!.bank ?? 0) - 8); })),
          iconButton("＋", "加个点", () => {
            // 不走自动修顺：新点可能离两边很近，修顺会把它当成多余的点合并掉
            app.state.commit(design => {
              const r = design.roads.find(item => item.id === road.id)!;
              const a = r.points[index]!, b = r.points[(index + 1) % r.points.length] ?? a;
              r.points.splice(index + 1, 0, { x: (a.x + b.x) / 2 + (b === a ? 10 : 0), y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
            });
            app.state.select({ kind: "road", id: road.id, point: index + 1 });
          }, { title: "在这个点和下一个点中间加一个" }),
          iconButton("✖", "删掉", () => app.deleteSelection(), { class: "ed-danger", disabled: road.points.length <= (road.closed ? 3 : 2) }));
        this.anchor = () => {
          const p = app.state.road(road.id)?.points[index];
          return p ? [p.x, p.y, p.z + 4] : undefined;
        };
      } else {
        const sides = !!road.walls.left || !!road.walls.right;
        this.actionBar.append(title(road.route ? `赛道 · ${road.width} 米宽` : `${road.name} · ${road.width} 米宽`), row);
        const buttons: Array<HTMLElement | undefined> = [
          iconButton("⇔", "变宽", () => commit(r => { r.width = Math.min(MAP_LIMITS.width[1], r.width + 4); })),
          iconButton("⇒⇐", "变窄", () => commit(r => { r.width = Math.max(8, r.width - 4); })),
          iconButton("▥", sides ? "拆护栏" : "装护栏", () => commit(r => {
            if (sides) { r.walls.left = null; r.walls.right = null; }
            else {
              const wall = { texture: structuredClone(app.defaultWall()), height: 1.2, visible: true };
              r.walls.left = structuredClone(wall); r.walls.right = structuredClone(wall);
            }
          })),
          iconButton("▦", "换路面", () => app.dock.open("surface", true)),
          iconButton("⇄", "掉头", () => commit(r => { r.points.reverse(); }), { title: "比赛方向反过来" }),
          !road.closed ? iconButton("✎", "接着画", () => app.startDraw()) : undefined,
          road.route ? iconButton("?", "道具箱", () => app.autoItems(), { title: "沿赛道自动放道具箱" }) : undefined,
          iconButton("✖", "删除", () => app.deleteSelection(), { class: "ed-danger" })];
        row.append(...buttons.filter((item): item is HTMLElement => !!item));
        const at = app.selectionAnchor;
        this.anchor = () => at ?? (road.points[0] ? [road.points[0].x, road.points[0].y, road.points[0].z + 4] : undefined);
      }
    }
    this.actionBar.style.display = "";
    this.placeActionBar();
  }

  /** 选中摆件的顶部中心（客户端坐标）。 */
  private piecesTop(): Vec3 | undefined {
    const pieces = this.app.state.selectedPieces();
    if (!pieces.length) return undefined;
    let x = 0, y = 0, top = -Infinity;
    for (const piece of pieces) {
      const info = this.app.views.pieceInfo(piece.id);
      const height = info ? (info.max[2] - piece.origin[2]) * piece.scale[2] : 8;
      x += piece.position[0]; y += piece.position[1];
      top = Math.max(top, piece.position[2] + height);
    }
    return [x / pieces.length, y / pieces.length, top + 1];
  }

  private placeActionBar(): void {
    if (this.actionBar.style.display === "none" || !this.anchor) return;
    const point = this.anchor();
    const view = this.element.getBoundingClientRect();
    if (!point) { this.actionBar.style.visibility = "hidden"; return; }
    const screen = this.app.viewport.project(point);
    const width = this.actionBar.offsetWidth, height = this.actionBar.offsetHeight;
    // 原版气泡的尖角在右下角（离右边约 18 像素），让尖角对准选中的东西
    const x = Math.min(view.width - width - 8, Math.max(8, screen.x - width + 18));
    const y = Math.min(view.height - height - 70, Math.max(8, screen.y - height - 4));
    this.actionBar.style.visibility = screen.visible ? "" : "hidden";
    this.actionBar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
