import { tr } from "../../i18n/locale";
/**
 * 底部素材栏（像模拟城市的建造菜单）：上面一排大类，下面是该类的素材卡片，
 * 每张卡片都有缩略图；右边是选中素材的大预览。点物件卡片后在地图上点击放置，
 * 点贴图、天空、主题套装、赛道形状直接换上。
 */
import {
  PIECE_CATEGORIES, catalogThemes, categoryInfo, filterPieces, pieceSize, spriteStyle, textureLabel, themeTitle,
  archIdOf, type CatalogArch, type CatalogData, type CatalogPiece, type CatalogSky, type CatalogTexture, type PieceCategory, type ThemePreset,
} from "../catalog";
import { sampleRoad } from "../road-geometry";
import { TRACK_TEMPLATES, templateRoad, type TrackTemplate } from "../templates";
import type { EditorApp } from "./app";
import { button, clear, h } from "./dom";
import { AssetPreview } from "./preview";

type Sub = PieceCategory | "shape" | "surface" | "wall" | "arch" | "ground" | "items" | "preset" | "sky";

interface DockTab {
  id: string;
  title: string;
  subs: Array<[Sub, string]>;
}

const TABS: DockTab[] = [
  { id: "track", title: tr("赛道"), subs: [["shape", tr("形状")], ["surface", tr("路面")], ["wall", tr("护栏")], ["arch", tr("起点拱门")]] },
  { id: "building", title: tr("建筑"), subs: [["building", tr("建筑")]] },
  { id: "nature", title: tr("自然"), subs: [["tree", tr("树木")], ["flower", tr("花草")], ["rock", tr("山石")]] },
  { id: "roadside", title: tr("路边"), subs: [["fence", tr("围栏")], ["light", tr("路灯")], ["sign", tr("路标旗帜")], ["ad", tr("广告牌")]] },
  { id: "special", title: tr("机关道具"), subs: [["booster", tr("加速跳台")], ["items", tr("道具箱")]] },
  { id: "decor", title: tr("装饰"), subs: [["vehicle", tr("交通工具")], ["creature", tr("动物人物")], ["decor", tr("装饰")]] },
  { id: "world", title: tr("环境"), subs: [["preset", tr("主题套装")], ["sky", tr("天空")], ["ground", tr("地面")]] },
];

const PIECE_SUBS = new Set<string>(PIECE_CATEGORIES.map(category => category.id));

/** 素材栏里的一样东西。 */
export type DockItem =
  | { kind: "piece"; id: string; piece: CatalogPiece }
  | { kind: "texture"; id: string; texture: CatalogTexture }
  | { kind: "sky"; id: string; sky: CatalogSky }
  | { kind: "preset"; id: string; preset: ThemePreset }
  | { kind: "template"; id: string; template: TrackTemplate }
  | { kind: "arch"; id: string; arch: CatalogArch }
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
  /** 大类按钮：浮在地图底部正中（app 把它挂到视口上），不占素材栏的高度。 */
  readonly tabsRow: HTMLElement;
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
    this.tabsRow = h("div", { class: "ed-catbar k-bar" });
    this.filterRow = h("div", { class: "ed-dock-filter" });
    this.shelf = h("div", { class: "ed-shelf" });
    this.previewBox = h("div", { class: "ed-preview" });
    this.element = h("section", { class: "ed-dock k-dialog" },
      h("div", { class: "k-caption" }, tr("素材栏")), this.filterRow, this.shelf, this.previewBox);
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
    for (const piece of app.state.selectedPieces()) marks.set(`${piece.track}:${piece.path.join(".")}`, tr("已选中"));
    marks.set(`sky:${design.sky}`, tr("使用中"));
    const road = app.state.selectedRoad() ?? design.roads.find(item => item.route) ?? design.roads[0];
    if (road) {
      marks.set(`surface:${road.surface.track}:${road.surface.name}`, tr("使用中"));
      const wall = road.walls.left?.texture ?? road.walls.right?.texture;
      if (wall) marks.set(`wall:${wall.track}:${wall.name}`, tr("使用中"));
    }
    if (design.ground) marks.set(`ground:${design.ground.texture.track}:${design.ground.texture.name}`, tr("使用中"));
    if (design.start.arch) marks.set(archIdOf(design.start.arch), tr("使用中"));
    else if (design.start.arch === null) marks.set("tool:arch-none", tr("使用中"));
    const preset = this.data?.presets.find(item => item.theme === design.theme && this.data!.skies.find(sky => sky.id === item.sky)?.track === design.sky);
    if (preset) marks.set(`preset:${preset.theme}`, tr("使用中"));
    if (this.active) marks.set(this.active.id, this.active.kind === "piece" ? tr("放置中") : this.active.kind === "tool" ? tr("使用中") : marks.get(this.active.id) ?? tr("已选"));
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
    return slot === undefined ? undefined : this.sprite(slot, 34, "ed-tab-icon");
  }

  private renderTabs(): void {
    clear(this.tabsRow);
    for (const tab of TABS) {
      this.tabsRow.append(h("button", {
        class: `k-tab ${tab === this.tab ? "k-on" : ""}`, type: "button",
        onclick: () => {
          // 再点一下当前大类：收起或展开素材栏
          if (tab === this.tab) { this.collapsed = !this.collapsed; this.render(); return; }
          this.tab = tab;
          this.sub = tab.subs[0]![0];
          this.collapsed = false;
          this.render();
        },
      }, this.tabIcon(tab), tab.title));
    }
    this.tabsRow.append(button(this.collapsed ? tr("展开 ▲") : tr("收起 ▼"), () => { this.collapsed = !this.collapsed; this.render(); },
      { class: "ed-catbar-fold", title: tr("收起素材栏，地图看得更大") }));
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
    const themed = PIECE_SUBS.has(this.sub) || ["surface", "wall", "arch", "ground", "sky"].includes(this.sub);
    if (data && themed) {
      const select = h("select", { class: "k-combo", title: tr("只看某个主题的素材") }, h("option", { value: "" }, tr("全部主题")));
      for (const theme of catalogThemes(data)) select.append(h("option", { value: theme }, tr(themeTitle(theme))));
      select.value = this.theme;
      select.addEventListener("change", () => { this.theme = select.value; this.renderShelf(); this.updateCount(); });
      this.filterRow.append(select);
    }
    if (PIECE_SUBS.has(this.sub)) {
      const search = h("input", { class: "k-edit", type: "search", placeholder: tr("搜索素材") });
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
      shape: tr("点一种形状铺出比赛路线，或者自己画"),
      surface: tr("点一下换上选中道路的路面"), wall: tr("点一下换上道路两侧的护栏"),
      ground: tr("点一下换上地面"), sky: tr("点一下换上天空和雾"), preset: tr("一键换上整套主题"),
      items: tr("道具箱让这张图也能开道具赛"),
      arch: tr("点一种拱门立在起跑线上方，或者不要拱门"),
    };
    count.textContent = PIECE_SUBS.has(this.sub)
      ? tr("{value} 种 · 点卡片后在地图上点击放置", { value: String(this.shelf.querySelectorAll(".ed-card").length) })
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
      case "arch":
        return [
          { kind: "tool", id: "tool:arch-none", title: tr("不要拱门"), glyph: "✕", description: tr("起跑线上方不放拱门。"), run: () => this.app.setArch(null) },
          ...byTheme((data.arches ?? []).filter(arch => !theme || arch.theme === theme)).map(arch => ({ kind: "arch" as const, id: arch.id, arch })),
        ];
      case "shape":
        return [
          { kind: "tool", id: "tool:draw", title: tr("自己画"), glyph: "✎", description: tr("在地上一个点一个点地点出赛道，点回绿色起点就连成一圈。"), run: () => this.app.startRoad() },
          ...TRACK_TEMPLATES.map(template => ({ kind: "template" as const, id: `template:${template.id}`, template })),
        ];
      case "items":
        return [
          { kind: "tool", id: "tool:items-auto", title: tr("自动布置"), glyph: "★", description: tr("沿比赛路线每隔一段放一排道具箱（每排 4 个）。"), run: () => this.app.autoItems() },
          { kind: "tool", id: "tool:items-place", title: tr("点路放一排"), glyph: "?", description: tr("在比赛路线上点哪里，就在哪里横着放一排道具箱。"), run: () => this.app.setTool({ kind: "items" }) },
          { kind: "tool", id: "tool:items-clear", title: tr("全部清除"), glyph: "✕", description: tr("清掉所有道具箱（只能竞速）。"), run: () => this.app.clearItems() },
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
      case "piece": image = this.sprite(item.piece.slot, 96); label = item.piece.label; badge = this.theme ? undefined : tr(themeTitle(item.piece.theme)); break;
      case "texture": image = this.sprite(item.texture.slot, 96); label = tr(textureLabel(item.texture)); badge = tr(themeTitle(item.texture.theme)); break;
      case "sky": image = this.sprite(item.sky.slot, 96); label = item.sky.label; break;
      case "preset": {
        const sky = this.data!.skies.find(entry => entry.id === item.preset.sky);
        image = sky ? this.sprite(sky.slot, 96) : h("div", { class: "ed-sprite" });
        label = tr(themeTitle(item.preset.theme));
        break;
      }
      case "template": image = drawTemplate(item.template, 96); image.classList.add("ed-sprite"); label = item.template.title; break;
      case "arch": image = this.sprite(item.arch.slot, 96); label = item.arch.label; badge = tr(themeTitle(item.arch.theme)); break;
      case "tool": image = h("div", { class: "ed-sprite" }, item.glyph); label = item.title; break;
    }
    const card = h("button", { class: `k-row ed-card ${item.kind === "tool" ? "ed-tool" : ""}`,
      type: "button", title: tr(label) }, image, h("span", { class: "ed-label" }, tr(label)), badge ? h("span", { class: "ed-badge" }, badge) : undefined);
    card.addEventListener("click", () => this.choose(item));
    card.addEventListener("mouseenter", () => this.hover(item));
    return card;
  }

  private renderShelf(): void {
    clear(this.shelf);
    this.cards.clear();
    if (!this.data) { this.shelf.append(h("div", { class: "ed-empty" }, tr("正在读取素材目录…"))); return; }
    const items = this.items();
    if (!items.length) { this.shelf.append(h("div", { class: "ed-empty" }, tr("这个主题里没有这类素材，换个主题看看。"))); return; }
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
      case "arch": this.app.setArch(item.arch); break;
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
      stage.append(h("div", { class: "ed-empty", style: "display:flex;align-items:center;justify-content:center;font-size:12px" }, tr("把鼠标移到素材上看预览")));
      box.append(h("div", { class: "ed-meta" }, tr("选一样素材：物件在地图上点击放置，贴图、天空、形状点一下就换上。")));
      return;
    }
    const meta = (...lines: string[]) => h("div", { class: "ed-meta" }, ...lines.flatMap((line, i) => i ? [h("br"), line] : [line]));
    switch (item.kind) {
      case "piece": {
        const piece = item.piece;
        const fallback = this.sprite(piece.slot, 160);
        stage.append(fallback, this.preview.canvas);
        this.preview.show(piece, fallback);
        const size = pieceSize(piece);
        box.append(h("div", { class: "ed-title" }, piece.label),
          meta(`${tr(themeTitle(piece.theme))} · ${tr(categoryInfo(piece.category).title)}`,
            tr("约 {value}×{value2}×{value3} 米", { value: String(size[0].toFixed(0)), value2: String(size[1].toFixed(0)), value3: String(size[2].toFixed(0)) }),
            tr("点地图放置；滚轮转方向，长按上下拖调高度")));
        void this.app.assets.track(piece.track).then(track => {
          const line = box.querySelector(".ed-meta");
          if (track && line && this.preview && box.contains(line)) line.append(h("br"), tr("来自「{value}」", { value: String(track.title) }));
        });
        return;
      }
      case "texture": {
        const texture = item.texture;
        this.preview.show(undefined);
        stage.append(this.sprite(texture.slot, 160));
        const what = texture.kind === "surface" ? tr("路面") : texture.kind === "wall" ? tr("护栏") : tr("地面");
        box.append(h("div", { class: "ed-title" }, `${tr(textureLabel(texture))}${what === tr("路面") ? "" : ` · ${what}`}`),
          meta(`${tr(themeTitle(texture.theme))} · ${texture.name}`, texture.kind === "surface"
            ? tr("点一下就换上（换的是选中的路，没选就换赛道）") : texture.kind === "wall" ? tr("点一下就给赛道换上这种护栏") : tr("点一下就换上这种地面")),
          h("div", { class: "ed-actions" }, button(tr("换上"), () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      }
      case "sky":
        this.preview.show(undefined);
        stage.append(this.sprite(item.sky.slot, 160));
        box.append(h("div", { class: "ed-title" }, item.sky.label), meta(tr("{value} · 天空和雾", { value: String(tr(themeTitle(item.sky.theme))) })),
          h("div", { class: "ed-actions" }, button(tr("换上"), () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      case "preset": {
        this.preview.show(undefined);
        const sky = this.data!.skies.find(entry => entry.id === item.preset.sky);
        if (sky) stage.append(this.sprite(sky.slot, 160));
        box.append(h("div", { class: "ed-title" }, tr("{value}主题", { value: String(tr(themeTitle(item.preset.theme))) })),
          meta(tr("一键换上这个主题的天空、路面、护栏、地面和背景音乐。")),
          h("div", { class: "ed-actions" }, button(tr("换上"), () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      }
      case "arch": {
        const arch = item.arch;
        const fallback = this.sprite(arch.slot, 160);
        stage.append(fallback, this.preview.canvas);
        this.preview.show(arch, fallback);
        const size = pieceSize(arch);
        box.append(h("div", { class: "ed-title" }, `${tr(themeTitle(arch.theme))} ${arch.label}`),
          meta(tr("约 {value}×{value2}×{value3} 米，会按路宽自动缩放", { value: String(size[0].toFixed(0)), value2: String(size[1].toFixed(0)), value3: String(size[2].toFixed(0)) }), tr("立在起跑线正上方，拖动起跑线时跟着走")),
          h("div", { class: "ed-actions" }, button(tr("换上"), () => this.choose(item), { class: "ed-small ed-primary" })));
        return;
      }
      case "template": {
        this.preview.show(undefined);
        const canvas = drawTemplate(item.template, 160);
        canvas.setAttribute("style", `${canvas.getAttribute("style") ?? ""};inset:2px auto auto 50%;transform:translateX(-50%)`);
        stage.append(canvas);
        box.append(h("div", { class: "ed-title" }, tr(item.template.title)), meta(tr(item.template.description), tr("橙点是起点。铺好后可以拖白色圆点改形状。")),
          h("div", { class: "ed-actions" }, button(tr("用这个形状"), () => this.choose(item), { class: "ed-small ed-primary" })));
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
