/**
 * 底部素材栏（像模拟城市的建造菜单）：上面一排大类，下面是该类的素材卡片，
 * 每张卡片都有缩略图；右边是选中素材的大预览。点物件卡片后在地图上点击放置，
 * 点贴图、天空、主题套装、赛道形状直接换上。
 */
import {
  PIECE_CATEGORIES, catalogThemes, categoryInfo, filterPieces, pieceSize, spriteStyle, textureLabel, themeTitle,
  type CatalogData, type CatalogPiece, type CatalogSky, type CatalogTexture, type PieceCategory, type ThemePreset,
} from "../catalog";
import { sampleRoad } from "../road-geometry";
import { TRACK_TEMPLATES, templateRoad, type TrackTemplate } from "../templates";
import type { EditorApp } from "./app";
import { button, clear, h } from "./dom";
import { AssetPreview } from "./preview";

type Sub = PieceCategory | "shape" | "surface" | "wall" | "ground" | "items" | "preset" | "sky";

interface DockTab {
  id: string;
  title: string;
  subs: Array<[Sub, string]>;
}

const TABS: DockTab[] = [
  { id: "track", title: "赛道", subs: [["shape", "形状"], ["surface", "路面"], ["wall", "护栏"]] },
  { id: "building", title: "建筑", subs: [["building", "建筑"]] },
  { id: "nature", title: "自然", subs: [["tree", "树木"], ["flower", "花草"], ["rock", "山石"]] },
  { id: "roadside", title: "路边", subs: [["fence", "围栏"], ["light", "路灯"], ["sign", "路标旗帜"], ["ad", "广告牌"]] },
  { id: "special", title: "机关道具", subs: [["booster", "加速跳台"], ["items", "道具箱"]] },
  { id: "decor", title: "装饰", subs: [["vehicle", "交通工具"], ["creature", "动物人物"], ["decor", "装饰"]] },
  { id: "world", title: "环境", subs: [["preset", "主题套装"], ["sky", "天空"], ["ground", "地面"]] },
];

const PIECE_SUBS = new Set<string>(PIECE_CATEGORIES.map(category => category.id));

/** 素材栏里的一样东西。 */
export type DockItem =
  | { kind: "piece"; id: string; piece: CatalogPiece }
  | { kind: "texture"; id: string; texture: CatalogTexture }
  | { kind: "sky"; id: string; sky: CatalogSky }
  | { kind: "preset"; id: string; preset: ThemePreset }
  | { kind: "template"; id: string; template: TrackTemplate }
  | { kind: "tool"; id: string; title: string; glyph: string; description: string; run(): void };

/** 画一条赛道模板的形状（高的地方颜色浅）。 */
export function drawTemplate(template: TrackTemplate, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = size * ratio;
  canvas.style.width = canvas.style.height = `${size}px`;
  const context = canvas.getContext("2d")!;
  const sample = sampleRoad(templateRoad(template, "preview"), 6);
  const xs = sample.points.map(p => p[0]), ys = sample.points.map(p => p[1]), zs = sample.points.map(p => p[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const scale = (size * ratio * 0.8) / Math.max(maxX - minX, maxY - minY);
  const at = (p: number[]) => [(p[0]! - (minX + maxX) / 2) * scale + size * ratio / 2, -(p[1]! - (minY + maxY) / 2) * scale + size * ratio / 2];
  // 先画低处再画高处，立交的上层压在下层上面
  const order = sample.points.map((_, i) => i).sort((a, b) => sample.points[a]![2] - sample.points[b]![2]);
  context.lineCap = "round";
  for (const pass of [0, 1]) {
    for (const i of order) {
      const p = sample.points[i]!, q = sample.points[(i + 1) % sample.points.length]!;
      const t = maxZ > minZ ? (p[2] - minZ) / (maxZ - minZ) : 0;
      context.strokeStyle = pass === 0 ? "#1b2c4a" : `rgb(${90 + 150 * t}, ${110 + 120 * t}, ${140 + 100 * t})`;
      context.lineWidth = (pass === 0 ? 9 : 6) * ratio;
      const [ax, ay] = at(p), [bx, by] = at(q);
      context.beginPath(); context.moveTo(ax!, ay!); context.lineTo(bx!, by!); context.stroke();
    }
  }
  const [sx, sy] = at(sample.points[0]!);
  context.fillStyle = "#ff8a00";
  context.beginPath(); context.arc(sx!, sy!, 5 * ratio, 0, Math.PI * 2); context.fill();
  return canvas;
}

/** 给卡片加上或去掉高亮和角标。 */
function markCard(card: HTMLElement, mark: string | undefined): void {
  // 原版的选中底（DefaultStaticButton_SelectedBlue）加青色选中圈（Selectored），角标用原版蓝色按钮框
  card.classList.toggle("k-selected", !!mark);
  card.classList.toggle("k-ring", !!mark);
  card.classList.toggle("ed-marked", !!mark);
  let tag = card.querySelector<HTMLElement>(".ed-mark");
  if (!mark) { tag?.remove(); return; }
  if (!tag) { tag = h("span", { class: "ed-mark k-tag" }); card.append(tag); }
  tag.textContent = mark;
}

export class Dock {
  readonly element: HTMLElement;
  private readonly tabsRow: HTMLElement;
  private readonly filterRow: HTMLElement;
  private readonly shelf: HTMLElement;
  private readonly previewBox: HTMLElement;
  private readonly preview: AssetPreview;
  private data?: CatalogData;
  private sheetList: string[] = [];
  tab = TABS[0]!;
  sub: Sub = "shape";
  theme = "";
  search = "";
  collapsed = false;
  /** 当前选中（工具里正在用）的素材。 */
  active?: DockItem;
  private hovered?: DockItem;
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private readonly cards = new Map<string, HTMLElement>();

  constructor(private readonly app: EditorApp) {
    this.tabsRow = h("div", { class: "ed-dock-tabs" });
    this.filterRow = h("div", { class: "ed-dock-filter" });
    this.shelf = h("div", { class: "ed-shelf" });
    this.previewBox = h("div", { class: "ed-preview" });
    this.element = h("section", { class: "ed-dock k-dialog" },
      h("div", { class: "k-caption" }, "素材栏"), this.tabsRow, this.filterRow, this.shelf, this.previewBox);
    this.preview = new AssetPreview(app.assets, app.viewport);
    this.shelf.addEventListener("mouseleave", () => this.hover(undefined));
  }

  attach(data: CatalogData, sheets: string[]): void {
    this.data = data;
    this.sheetList = sheets;
    this.render();
  }

  get ready(): boolean { return !!this.data; }

  sprite(slot: number, size: number, extra = ""): HTMLElement {
    const element = h("div", { class: `ed-sprite ${extra}` });
    if (this.data) element.setAttribute("style", spriteStyle(this.data, this.sheetList, slot, size));
    return element;
  }

  catalog(): CatalogData | undefined { return this.data; }

  sheets(): string[] { return this.sheetList; }

  /** 设计里的摆件对应的目录物件（不是从目录放的返回 undefined）。 */
  pieceFor(track: string, path: readonly number[]): CatalogPiece | undefined {
    const id = `${track}:${path.join(".")}`;
    return this.data?.pieces.find(piece => piece.id === id);
  }

  textureFor(track: string, name: string): CatalogTexture | undefined {
    return this.data?.textures.find(texture => texture.track === track && texture.name === name);
  }

  skyFor(track: string): CatalogSky | undefined {
    return this.data?.skies.find(sky => sky.track === track);
  }

  /** 打开某个大类下的某一小类；pulse 时让那一类闪几下，告诉玩家去哪里点。 */
  open(sub: Sub, pulse = false): void {
    const tab = TABS.find(item => item.subs.some(([id]) => id === sub));
    if (!tab) return;
    this.tab = tab;
    this.sub = sub;
    this.collapsed = false;
    this.render();
    if (pulse) {
      // 原版发光边框（GlowBorderPanel）闪几下
      for (const element of [this.tabsRow.querySelector(".k-tab.k-on"), this.shelf]) {
        element?.classList.remove("ed-pulse", "k-glow");
        void (element as HTMLElement | null)?.offsetWidth;
        element?.classList.add("ed-pulse", "k-glow");
        setTimeout(() => element?.classList.remove("ed-pulse", "k-glow"), 1900);
      }
    }
  }

  setActive(item: DockItem | undefined): void {
    this.active = item;
    this.refreshMarks();
    this.showPreview(this.hovered ?? item);
  }

  /**
   * 卡片上的高亮：正在放置的物件（放置中）、地图上选中的摆件对应的物件
   * （已选中）、当前用着的天空、路面、护栏、地面和主题套装（使用中）。
   */
  private marks(): Map<string, string> {
    const marks = new Map<string, string>();
    const app = this.app;
    const design = app.state.design;
    for (const piece of app.state.selectedPieces()) marks.set(`${piece.track}:${piece.path.join(".")}`, "已选中");
    marks.set(`sky:${design.sky}`, "使用中");
    const road = app.state.selectedRoad() ?? design.roads.find(item => item.route) ?? design.roads[0];
    if (road) {
      marks.set(`surface:${road.surface.track}:${road.surface.name}`, "使用中");
      const wall = road.walls.left?.texture ?? road.walls.right?.texture;
      if (wall) marks.set(`wall:${wall.track}:${wall.name}`, "使用中");
    }
    if (design.ground) marks.set(`ground:${design.ground.texture.track}:${design.ground.texture.name}`, "使用中");
    const preset = this.data?.presets.find(item => item.theme === design.theme && this.data!.skies.find(sky => sky.id === item.sky)?.track === design.sky);
    if (preset) marks.set(`preset:${preset.theme}`, "使用中");
    if (this.active) marks.set(this.active.id, this.active.kind === "piece" ? "放置中" : this.active.kind === "tool" ? "使用中" : marks.get(this.active.id) ?? "已选");
    return marks;
  }

  /** 按设计和工具的当前状态刷新卡片高亮（设计或选择变化时调用）。 */
  refreshMarks(): void {
    const marks = this.marks();
    for (const [id, card] of this.cards) markCard(card, marks.get(id));
  }

  // ------------------------------------------------------------------ 渲染

  render(): void {
    this.element.classList.toggle("ed-collapsed", this.collapsed);
    this.renderTabs();
    if (this.collapsed) return;
    this.renderFilter();
    this.renderShelf();
    this.updateCount();
    this.showPreview(this.hovered ?? this.active);
  }

  private tabIcon(tab: DockTab): HTMLElement | undefined {
    const data = this.data;
    if (!data) return undefined;
    const first = tab.subs[0]![0];
    let slot: number | undefined;
    if (PIECE_SUBS.has(first)) slot = data.pieces.find(piece => piece.category === first && piece.theme === (this.app.state.design.theme || "village"))?.slot
      ?? data.pieces.find(piece => piece.category === first)?.slot;
    else if (first === "shape" || first === "surface") slot = data.textures.find(texture => texture.kind === "surface")?.slot;
    else if (first === "preset") slot = data.skies[0]?.slot;
    return slot === undefined ? undefined : this.sprite(slot, 30, "ed-tab-icon");
  }

  private renderTabs(): void {
    clear(this.tabsRow);
    for (const tab of TABS) {
      this.tabsRow.append(h("button", {
        class: `k-tab ${tab === this.tab ? "k-on" : ""}`, type: "button",
        onclick: () => {
          if (tab === this.tab && !this.collapsed) return;
          this.tab = tab;
          this.sub = tab.subs[0]![0];
          this.collapsed = false;
          this.render();
        },
      }, this.tabIcon(tab), tab.title));
    }
    this.tabsRow.append(h("span", { class: "ed-spacer" }),
      button(this.collapsed ? "展开 ▲" : "收起 ▼", () => { this.collapsed = !this.collapsed; this.render(); }, { class: "ed-small" }));
  }

  private renderFilter(): void {
    clear(this.filterRow);
    if (this.tab.subs.length > 1) {
      for (const [id, title] of this.tab.subs) {
        this.filterRow.append(h("button", { class: `k-button ed-chip ${id === this.sub ? "k-on" : ""}`, type: "button",
          onclick: () => { this.sub = id; this.render(); } }, title));
      }
    }
    const data = this.data;
    const themed = PIECE_SUBS.has(this.sub) || ["surface", "wall", "ground", "sky"].includes(this.sub);
    if (data && themed) {
      const select = h("select", { class: "k-combo", title: "只看某个主题的素材" }, h("option", { value: "" }, "全部主题"));
      for (const theme of catalogThemes(data)) select.append(h("option", { value: theme }, themeTitle(theme)));
      select.value = this.theme;
      select.addEventListener("change", () => { this.theme = select.value; this.renderShelf(); this.updateCount(); });
      this.filterRow.append(select);
    }
    if (PIECE_SUBS.has(this.sub)) {
      const search = h("input", { class: "k-edit", type: "search", placeholder: "搜索素材" });
      search.value = this.search;
      search.addEventListener("keydown", event => event.stopPropagation());
      search.addEventListener("input", () => { this.search = search.value; this.renderShelf(); this.updateCount(); });
      this.filterRow.append(search);
    }
    this.filterRow.append(h("span", { class: "ed-count" }));
    this.updateCount();
  }

  private updateCount(): void {
    const count = this.filterRow.querySelector(".ed-count");
    if (!count) return;
    const hint: Partial<Record<Sub, string>> = {
      shape: "点一种形状铺出比赛路线，或者自己画",
      surface: "点一下换上选中道路的路面", wall: "点一下换上道路两侧的护栏",
      ground: "点一下换上地面", sky: "点一下换上天空和雾", preset: "一键换上整套主题",
      items: "道具箱让这张图也能开道具赛",
    };
    count.textContent = PIECE_SUBS.has(this.sub)
      ? `${this.shelf.querySelectorAll(".ed-card").length} 种 · 点卡片后在地图上点击放置，按住拖动连续摆放`
      : hint[this.sub] ?? "";
  }

  private items(): DockItem[] {
    const data = this.data;
    if (!data) return [];
    const theme = this.theme;
    // 当前地图主题的素材排在前面
    const mine = this.app.state.design.theme;
    const byTheme = <T extends { theme: string }>(list: T[]) => [...list].sort((a, b) => Number(b.theme === mine) - Number(a.theme === mine));
    if (PIECE_SUBS.has(this.sub)) {
      return byTheme(filterPieces(data, this.sub as PieceCategory, theme, this.search)).map(piece => ({ kind: "piece", id: piece.id, piece }));
    }
    switch (this.sub) {
      case "surface": case "wall": case "ground":
        return byTheme(data.textures.filter(texture => texture.kind === this.sub && (!theme || texture.theme === theme)))
          .map(texture => ({ kind: "texture", id: texture.id, texture }));
      case "sky":
        return byTheme(data.skies.filter(sky => !theme || sky.theme === theme)).map(sky => ({ kind: "sky", id: sky.id, sky }));
      case "preset":
        return byTheme(data.presets).map(preset => ({ kind: "preset", id: `preset:${preset.theme}`, preset }));
      case "shape":
        return [
          { kind: "tool", id: "tool:draw", title: "自己画", glyph: "✎", description: "在地上一个点一个点地点出赛道，点回绿色起点就连成一圈。", run: () => this.app.startRoad() },
          ...TRACK_TEMPLATES.map(template => ({ kind: "template" as const, id: `template:${template.id}`, template })),
        ];
      case "items":
        return [
          { kind: "tool", id: "tool:items-auto", title: "自动布置", glyph: "★", description: "沿比赛路线每隔一段放一排道具箱（每排 4 个）。", run: () => this.app.autoItems() },
          { kind: "tool", id: "tool:items-place", title: "点路放一排", glyph: "?", description: "在比赛路线上点哪里，就在哪里横着放一排道具箱。", run: () => this.app.setTool({ kind: "items" }) },
          { kind: "tool", id: "tool:items-clear", title: "全部清除", glyph: "✕", description: "清掉所有道具箱（只能竞速）。", run: () => this.app.clearItems() },
        ];
      default:
        return [];
    }
  }

  private card(item: DockItem): HTMLElement {
    let image: HTMLElement;
    let label: string;
    let badge: string | undefined;
    switch (item.kind) {
      case "piece": image = this.sprite(item.piece.slot, 76); label = item.piece.label; badge = this.theme ? undefined : themeTitle(item.piece.theme); break;
      case "texture": image = this.sprite(item.texture.slot, 76); label = textureLabel(item.texture); badge = themeTitle(item.texture.theme); break;
      case "sky": image = this.sprite(item.sky.slot, 76); label = item.sky.label; break;
      case "preset": {
        const sky = this.data!.skies.find(entry => entry.id === item.preset.sky);
        image = sky ? this.sprite(sky.slot, 76) : h("div", { class: "ed-sprite" });
        label = themeTitle(item.preset.theme);
        break;
      }
      case "template": image = drawTemplate(item.template, 76); image.classList.add("ed-sprite"); label = item.template.title; break;
      case "tool": image = h("div", { class: "ed-sprite" }, item.glyph); label = item.title; break;
    }
    const card = h("button", { class: `k-row ed-card ${item.kind === "tool" ? "ed-tool" : ""}`,
      type: "button", title: label }, image, h("span", { class: "ed-label" }, label), badge ? h("span", { class: "ed-badge" }, badge) : undefined);
    card.addEventListener("click", () => this.choose(item));
    card.addEventListener("mouseenter", () => this.hover(item));
    return card;
  }

  private renderShelf(): void {
    clear(this.shelf);
    this.cards.clear();
    if (!this.data) { this.shelf.append(h("div", { class: "ed-empty" }, "正在读取素材目录…")); return; }
    const items = this.items();
    if (!items.length) { this.shelf.append(h("div", { class: "ed-empty" }, "这个主题里没有这类素材，换个主题看看。")); return; }
    const marks = this.marks();
    for (const item of items) {
      const card = this.card(item);
      markCard(card, marks.get(item.id));
      this.cards.set(item.id, card);
      this.shelf.append(card);
    }
  }

  // ------------------------------------------------------------------ 选择与预览

  private choose(item: DockItem): void {
    switch (item.kind) {
      case "piece":
        if (this.active?.id === item.id && this.app.tool.kind === "place") { this.app.setTool({ kind: "select" }); return; }
        this.app.setTool({ kind: "place", piece: item.piece });
        break;
      case "texture": this.app.applyTexture(item.texture); break;
      case "sky": this.app.applySky(item.sky); break;
      case "preset": this.app.applyPreset(item.preset); break;
      case "template": this.app.applyTemplate(item.template); break;
      case "tool": item.run(); break;
    }
    // 贴图、天空、套装换上后由“使用中”标出来；只有放道具箱这种持续的工具保持选中
    if (item.kind !== "piece") this.setActive(item.id === "tool:items-place" ? item : undefined);
  }

  private hover(item: DockItem | undefined): void {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => {
      this.hovered = item;
      this.showPreview(item ?? this.active);
    }, item ? 120 : 300);
  }

  private showPreview(item: DockItem | undefined): void {
    const box = this.previewBox;
    clear(box);
    const stage = h("div", { class: "ed-stage" });
    box.append(stage);
    if (!item) {
      this.preview.show(undefined);
      stage.append(h("div", { class: "ed-empty", style: "display:flex;align-items:center;justify-content:center;font-size:12px" }, "把鼠标移到素材上看预览"));
      box.append(h("div", { class: "ed-meta" }, "选一样素材：物件在地图上点击放置，贴图、天空、形状点一下就换上。"));
      return;
    }
    const meta = (...lines: string[]) => h("div", { class: "ed-meta" }, ...lines.flatMap((line, i) => i ? [h("br"), line] : [line]));
    switch (item.kind) {
      case "piece": {
        const piece = item.piece;
        const fallback = this.sprite(piece.slot, 128);
        stage.append(fallback, this.preview.canvas);
        this.preview.show(piece, fallback);
        const size = pieceSize(piece);
        box.append(h("div", { class: "ed-title" }, piece.label),
          meta(`${themeTitle(piece.theme)} · ${categoryInfo(piece.category).title}`,
            `约 ${size[0].toFixed(0)}×${size[1].toFixed(0)}×${size[2].toFixed(0)} 米`,
            categoryInfo(piece.category).paint === "single" ? "点地图放置；Q/E 旋转" : "点地图放置，按住拖动连续摆放；Q/E 旋转"));
        void this.app.assets.track(piece.track).then(track => {
          const line = box.querySelector(".ed-meta");
          if (track && line && this.preview && box.contains(line)) line.append(h("br"), `来自「${track.title}」`);
        });
        return;
      }
      case "texture": {
        const texture = item.texture;
        this.preview.show(undefined);
        stage.append(this.sprite(texture.slot, 128));
        const what = texture.kind === "surface" ? "路面" : texture.kind === "wall" ? "护栏" : "地面";
        box.append(h("div", { class: "ed-title" }, `${textureLabel(texture)}${what === "路面" ? "" : ` · ${what}`}`),
          meta(`${themeTitle(texture.theme)} · ${texture.name}`, texture.kind === "surface"
            ? "点一下就换上（换的是选中的路，没选就换赛道）" : texture.kind === "wall" ? "点一下就给赛道换上这种护栏" : "点一下就换上这种地面"),
          h("div", { class: "ed-actions" }, button("换上", () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      }
      case "sky":
        this.preview.show(undefined);
        stage.append(this.sprite(item.sky.slot, 128));
        box.append(h("div", { class: "ed-title" }, item.sky.label), meta(`${themeTitle(item.sky.theme)} · 天空和雾`),
          h("div", { class: "ed-actions" }, button("换上", () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      case "preset": {
        this.preview.show(undefined);
        const sky = this.data!.skies.find(entry => entry.id === item.preset.sky);
        if (sky) stage.append(this.sprite(sky.slot, 128));
        box.append(h("div", { class: "ed-title" }, `${themeTitle(item.preset.theme)}主题`),
          meta("一键换上这个主题的天空、路面、护栏、地面和背景音乐。"),
          h("div", { class: "ed-actions" }, button("换上", () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      }
      case "template": {
        this.preview.show(undefined);
        const canvas = drawTemplate(item.template, 128);
        canvas.setAttribute("style", `${canvas.getAttribute("style") ?? ""};inset:2px auto auto 50%;transform:translateX(-50%)`);
        stage.append(canvas);
        box.append(h("div", { class: "ed-title" }, item.template.title), meta(item.template.description, "橙点是起点。铺好后可以拖白色圆点改形状。"),
          h("div", { class: "ed-actions" }, button("用这个形状", () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      }
      case "tool":
        this.preview.show(undefined);
        stage.append(h("div", { style: "display:flex;align-items:center;justify-content:center;font-size:64px;color:#2a5fb0" }, item.glyph));
        box.append(h("div", { class: "ed-title" }, item.title), meta(item.description),
          h("div", { class: "ed-actions" }, button(item.title, () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
    }
  }
}
