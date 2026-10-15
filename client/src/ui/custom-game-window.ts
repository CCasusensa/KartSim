import { tr } from "../i18n/locale";
import { p2 } from "../generated/formats.js";
import { customTrackId, draftTrackId } from "../mapeditor/design";
import { registerLocalDrafts, registerServerMap } from "../mapeditor/custom-map-loader";
import type { CustomMapSummary } from "../mapeditor/custom-tracks";
import { deleteDraft, listBuilds, type StoredBuild } from "../mapeditor/draft-store";
import { deleteMap, downloadMapFile, listMyMaps, listPublishedMaps, storedSessionToken } from "../mapeditor/map-service";
import { THEME_TITLES } from "../mapeditor/source-tracks";
import { ImageCache, indexRows, node, nodeName, paintText, type BmlLibrary, type Node, type NodeState, type Rect,
  type Texture, type WindowView } from "./bml-kit";
import { FRAME_TEXTURE, ROOTS, TEXT, button, drawGreyPanel, drawLabel, drawRow, loadWindow } from "./resource-window";

/**
 * 单人游戏 · 地图工坊：大家用地图工坊做的地图（server-go/MAPS.md）。
 * 左边是地图列表（全部地图 / 我的地图，我的地图含本机草稿），右边是选中
 * 地图的卡片与信息；开始计时赛、用地图工坊打开、下架，以及制作新地图。
 * 用发行版窗口渲染器画（与资源下载窗口同一套框体与行按钮）。
 */

const ROWS = 12;
// 行比列表框窄 18（与资源下载窗口相同），选中行的青色边不会伸出框外
const ROW = { width: 312, height: 26, gap: 3 };
/** 详情里的按钮：自己的地图三个（开始、修改、下架/删除），别人的两个，都居中。 */
const ACTIONS = { y: 376, height: 32, gap: 10, play: 128, edit: 150, remove: 128 };
const ROW_IMAGE = { speed: "btn_진행중_", item: "btn_완료_" };
const ACTIVE_TAB = "rgb(214,96,0)";

export type CustomGameTab = "all" | "mine";

export interface CustomGameEntry {
  trackId: string;
  summary: CustomMapSummary;
  kind: "server" | "draft";
  mine: boolean;
  build?: StoredBuild;
}

export interface CustomGameWindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
  onActivate?(): void;
  /** 开始计时赛（地图已登记进资源库）。 */
  onPlay(trackId: string): Promise<void> | void;
  onClose?(): void;
}

function stars(count: number): string {
  return "★".repeat(Math.max(0, Math.min(5, count))) + "☆".repeat(Math.max(0, 5 - count));
}

function sizeText(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function dateText(ms: number): string {
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function customGameDefinition(): Node {
  const rows = Array.from({ length: ROWS }, (_unused, index) => node("Window", { name: `mapRow${index}`,
    leftTopWH: `0 ${index * (ROW.height + ROW.gap)} ${ROW.width} ${ROW.height}` }, [
    node("ImageButton", { name: "mapBtn", leftTopWH: `0 0 ${ROW.width} ${ROW.height}`, alphaBlend: "true" }),
  ]));
  const three = ACTIONS.play + ACTIONS.edit + ACTIONS.remove + ACTIONS.gap * 2;
  const two = ACTIONS.play + ACTIONS.edit + ACTIONS.gap;
  const action = (name: string, width: number, x: number) =>
    node("TextButton", { name, windowSize: `${width} ${ACTIONS.height}`, adjust: `${x} ${ACTIONS.y}`, textRender: "bold14" });
  const left3 = (502 - three) / 2, left2 = (502 - two) / 2;
  // 左栏：标签 → 列表（底部翻页）→ 制作新地图 / 刷新；右栏：标题 → 卡片、信息、按钮、提示。
  // 两栏顶边、底边对齐；最下面一行是状态文字和居中的“关闭”（与资源下载窗口相同）。
  return node("Panel", { windowRect: "fullscreen", color: "100 0 0 0", alphaBlend: "true" }, [
    node("CaptionWindow", { name: "customDialog", windowRect: "0 0 880 616", frame: "CaptionDialog",
      caption: tr("地图工坊"), captionPos: "0 1", align: "center", setCloseButton: "closeButton", textRender: "bold" }, [
      node("TextButton", { name: "tabAll", windowSize: "104 28", adjust: "0 6", textRender: "bold14" }),
      node("TextButton", { name: "tabMine", windowSize: "104 28", adjust: "108 6", textRender: "bold14" }),
      node("CaptionWindow", { name: "listCaption", windowSize: "330 438", adjust: "0 40", frame: "CaptionWindowGrey" }, [
        node("Label", { name: "listCaptionText", windowSize: "300 26", adjust: "8 -26", textRender: "bold15",
          textColor: "white", textAlign: "left|vcenter" }),
        node("Container", { name: "mapRows", windowSize: `${ROW.width} ${ROWS * (ROW.height + ROW.gap)}`, adjust: "6 4" }, rows),
        node("Label", { name: "listEmpty", windowSize: "300 120", adjust: "15 100" }),
        node("TextButton", { name: "listPrev", windowSize: "76 26", adjust: "40 362", textRender: "bold12" }),
        node("Label", { name: "listPage", windowSize: "90 26", adjust: "120 362" }),
        node("TextButton", { name: "listNext", windowSize: "76 26", adjust: "214 362", textRender: "bold12" }),
      ]),
      node("TextButton", { name: "newMap", windowSize: "160 32", adjust: "0 484", textRender: "bold14" }),
      node("TextButton", { name: "refresh", windowSize: "96 32", adjust: "234 484", textRender: "bold14" }),
      node("Container", { name: "detail", windowSize: "500 510", adjust: "340 6" }, [
        node("Label", { name: "detailTitle", windowSize: "500 30", adjust: "0 0", frame: "TitleCap",
          textRender: "bold", textColor: "white", textAlign: "center" }),
        node("Label", { name: "detailBack", windowSize: "502 480", adjust: "-2 30" }),
        node("Container", { windowSize: "502 480", adjust: "-2 30" }, [
          node("Label", { name: "card", windowSize: "400 234", adjust: "0 14", align: "hcenter" }),
          node("Label", { name: "info", windowSize: "452 100", adjust: "0 264", align: "hcenter" }),
          action("playButton", ACTIONS.play, left3),
          action("editButton", ACTIONS.edit, left3 + ACTIONS.play + ACTIONS.gap),
          action("removeButton", ACTIONS.remove, left3 + ACTIONS.play + ACTIONS.edit + ACTIONS.gap * 2),
          action("playButton2", ACTIONS.play, left2),
          action("editButton2", ACTIONS.edit, left2 + ACTIONS.play + ACTIONS.gap),
          node("Label", { name: "detailTip", windowSize: "452 52", adjust: "0 420", align: "hcenter" }),
        ]),
      ]),
      node("Label", { name: "summary", windowRect: "0 0 330 32", align: "left|bottom", adjust: "6 0" }),
      node("TextButton", { name: "okButton", windowRect: "0 0 94 32", align: "hcenter|bottom", textRender: "bold14" }),
    ]),
  ]);
}

/** The open 地图工坊 window (one at a time). */
let openWindow: CustomGameWindow | undefined;

export class CustomGameWindow {
  private view?: WindowView;
  private confirmView?: WindowView;
  private tab: CustomGameTab = "all";
  private page = 0;
  private selected?: string;
  private entries: Record<CustomGameTab, CustomGameEntry[] | undefined> = { all: undefined, mine: undefined };
  private status = "";
  private loading = false;
  private disposed = false;
  private readonly images: ImageCache;
  private readonly cards = new Map<string, Texture | null>();
  private readonly cardLoads = new Set<string>();

  private constructor(readonly options: CustomGameWindowOptions) {
    this.images = new ImageCache(options.library, () => this.view?.render());
  }

  static async open(options: CustomGameWindowOptions): Promise<CustomGameWindow> {
    if (openWindow) return openWindow;
    const window = new CustomGameWindow(options);
    openWindow = window;
    try {
      await window.build();
    } catch (error) {
      window.dispose();
      throw error;
    }
    return window;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (openWindow === this) openWindow = undefined;
    this.confirmView?.dispose();
    this.view?.dispose();
    this.options.onClose?.();
  }

  private async build(): Promise<void> {
    const rows = new WeakMap<Node, number>();
    const view = await loadWindow(this.options.library, this.options.root, customGameDefinition(), tr("地图工坊"),
      () => this.close(), entry => this.state(entry, rows), tree => indexRows(tree, "mapRow", rows));
    if (this.disposed) { view.dispose(); return; }
    this.view = view;
    view.show();
    void this.reload();
  }

  private close(): void {
    this.options.onActivate?.();
    this.dispose();
  }

  private render(): void { this.view?.render(); }

  /** 读取两个列表（我的地图需要登录；本机草稿一直在）。 */
  async reload(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.status = tr("正在读取地图列表…");
    this.render();
    const token = storedSessionToken();
    const [published, mine, builds] = await Promise.all([
      listPublishedMaps().catch(() => undefined),
      token ? listMyMaps(token).catch(() => undefined) : Promise.resolve(undefined),
      listBuilds().catch(() => [] as StoredBuild[]),
    ]);
    if (this.disposed) return;
    const mineIds = new Set((mine ?? []).map(map => map.id));
    const server = (map: CustomMapSummary): CustomGameEntry =>
      ({ trackId: customTrackId(map.id), summary: map, kind: "server", mine: mineIds.has(map.id) });
    this.entries.all = published?.map(server);
    const drafts: CustomGameEntry[] = builds.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt)
      .map(build => ({ trackId: draftTrackId(build.id), summary: { ...build.summary, source: "local" }, kind: "draft",
        mine: true, build }));
    this.entries.mine = [...(mine ?? []).map(server), ...drafts];
    this.status = published ? tr(token ? "社区共有 {count} 张地图。" : "社区共有 {count} 张地图；登录后可以发布自己的地图。", { count: published.length })
      : tr("连不上服务器，只显示本机草稿。");
    this.loading = false;
    const list = this.list();
    if (!this.selected || !list.some(entry => entry.trackId === this.selected)) this.selected = list[0]?.trackId;
    this.page = Math.min(this.page, this.maxPage());
    this.render();
  }

  private list(): CustomGameEntry[] {
    return this.entries[this.tab] ?? [];
  }

  private maxPage(): number {
    return Math.max(0, Math.ceil(this.list().length / ROWS) - 1);
  }

  private current(): CustomGameEntry | undefined {
    return this.list().find(entry => entry.trackId === this.selected);
  }

  private showTab(tab: CustomGameTab): void {
    this.options.onActivate?.();
    this.tab = tab;
    this.page = 0;
    this.selected = this.list()[0]?.trackId;
    this.render();
  }

  private card(entry: CustomGameEntry): Texture | undefined {
    const key = `${entry.trackId}:${entry.summary.sha256}`;
    const known = this.cards.get(key);
    if (known !== undefined) return known ?? undefined;
    if (!this.cardLoads.has(key)) {
      this.cardLoads.add(key);
      const bytes = entry.kind === "draft"
        ? entry.build?.card?.arrayBuffer().then(buffer => new Uint8Array(buffer)) ?? Promise.resolve(undefined)
        : downloadMapFile(entry.summary, "card");
      void bytes.then(async data => {
        if (!data) { this.cards.set(key, null); return; }
        const image = await p2(data) as { width: number; height: number; pixels: ArrayLike<number> };
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
        this.cards.set(key, { image: canvas, width: image.width, height: image.height });
        this.render();
      }).catch(() => { this.cards.set(key, null); this.render(); });
    }
    return undefined;
  }

  private hovered(entry: Node): boolean {
    return (this.view as unknown as { hovered?: Node } | undefined)?.hovered === entry;
  }

  private rowPaint(entry: Node, map: CustomGameEntry, selected: boolean) {
    return (context: CanvasRenderingContext2D, rect: Rect) => {
      const items = map.summary.items > 0;
      const image = this.images.named(ROOTS, `${items ? ROW_IMAGE.item : ROW_IMAGE.speed}${selected ? 5 : this.hovered(entry) ? 2 : 1}`);
      if (image) drawRow(context, image, rect);
      const middle = rect.y + rect.height / 2 + 1;
      drawLabel(context, map.kind === "draft" ? tr("草稿") : items ? tr("道具") : tr("竞速"), rect.x + 37, middle,
        { bold: true, align: "center", size: 12 });
      drawLabel(context, map.summary.name, rect.x + 78, middle, { width: rect.width - 78 - 96 });
      drawLabel(context, map.kind === "draft" ? tr("本机") : map.summary.author, rect.x + rect.width - 22, middle,
        { size: 12, align: "right", color: "rgb(70,80,100)", width: 80 });
    };
  }

  private async play(entry: CustomGameEntry): Promise<void> {
    this.options.onActivate?.();
    if (entry.kind === "draft") await registerLocalDrafts(this.options.library);
    else registerServerMap(this.options.library, entry.summary);
    this.dispose();
    await this.options.onPlay(entry.trackId);
  }

  private edit(entry: CustomGameEntry): void {
    this.options.onActivate?.();
    window.open(`/editor.html?open=${encodeURIComponent(entry.summary.id)}`, "kartsim-mapeditor");
  }

  private info(entry: CustomGameEntry): string {
    const summary = entry.summary;
    const items = summary.items > 0 ? tr("道具箱 {count} 个（竞速、道具赛都能用）", { count: summary.items }) : tr("没有道具箱（只能竞速）");
    return [
      tr("作者：{author}　　主题：{theme}", { author: entry.kind === "draft" ? tr("我（本机草稿）") : summary.author || tr("未知"), theme: tr(THEME_TITLES[summary.theme] ?? summary.theme) }),
      tr("圈数：{laps}　　难度：{difficulty}", { laps: summary.laps, difficulty: stars(summary.difficulty) }),
      items,
      tr("大小：{size}　　更新：{date}", { size: sizeText(summary.size), date: dateText(summary.updatedAt) }),
    ].join("|");
  }

  private tip(entry: CustomGameEntry | undefined): string {
    if (!entry) return this.tab === "mine" ? tr("点“制作新地图”打开地图工坊，做好后“发布”，大家就能在这里玩到。") : "";
    if (entry.kind === "draft") return tr("本机草稿只有你能玩；在地图工坊里“发布”后，所有人都能在这里和多人竞速房里玩到。");
    return tr("多人游戏里建竞速房（有道具箱的地图也可以建道具房），在“选择赛道”里搜索地图名字就能和大家一起玩。");
  }

  private state(entry: Node, rows: WeakMap<Node, number>): NodeState {
    const name = nodeName(entry);
    const row = rows.get(entry);
    const list = this.list();
    if (row !== undefined) {
      const map = list[this.page * ROWS + row];
      if (/^mapRow\d+$/.test(name)) return { visible: !!map };
      if (name === "mapBtn" && map) return { label: map.summary.name, paint: this.rowPaint(entry, map, map.trackId === this.selected),
        action: () => { this.options.onActivate?.(); this.selected = map.trackId; this.render(); } };
      return {};
    }
    const current = this.current();
    switch (name) {
      case "customDialog": return { text: tr("地图工坊") };
      case "closeButton": return { label: tr("关闭"), action: () => this.close() };
      case "okButton": return button(tr("关闭"), () => this.close());
      // 当前标签用橙色字（窗口渲染器没有“选中”状态）
      case "tabAll": return { ...button(tr("全部地图"), () => this.showTab("all")), ...(this.tab === "all" ? { textColor: ACTIVE_TAB } : {}) };
      case "tabMine": return { ...button(tr("我的地图"), () => this.showTab("mine")), ...(this.tab === "mine" ? { textColor: ACTIVE_TAB } : {}) };
      case "listCaptionText": return { text: `${this.tab === "all" ? tr("社区地图") : tr("我的地图")}（${list.length}）` };
      case "listEmpty": return list.length || this.loading ? { visible: false } : paintText(this.tab === "all"
        ? tr("还没有人发布地图。|点右下角“制作新地图”，做第一张吧！") : tr("你还没有地图。|点“制作新地图”打开地图工坊。"),
      { size: 14, color: "white", align: "center", middle: true, lineGap: 8 });
      case "listPrev": return { ...button(tr("上一页"), () => this.turn(-1), this.page <= 0), visible: list.length > ROWS };
      case "listNext": return { ...button(tr("下一页"), () => this.turn(1), this.page >= this.maxPage()), visible: list.length > ROWS };
      case "listPage": return list.length > ROWS ? paintText(`${this.page + 1} / ${this.maxPage() + 1}`, { size: 13,
        color: "black", align: "center", middle: true, bold: true }) : { visible: false };
      case "detailTitle": return { text: current?.summary.name ?? (this.loading ? tr("读取中…") : tr("地图工坊")) };
      case "detailBack": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        const frame = this.images.path(FRAME_TEXTURE);
        if (frame) drawGreyPanel(context, frame, rect);
      } };
      case "card": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        if (!current) return;
        const card = this.card(current);
        if (card) context.drawImage(card.image, rect.x, rect.y, rect.width, rect.height);
        else {
          context.fillStyle = "rgba(30,45,70,.55)";
          context.fillRect(rect.x, rect.y, rect.width, rect.height);
          drawLabel(context, tr("正在读取卡片…"), rect.x + rect.width / 2, rect.y + rect.height / 2, { align: "center", color: "white" });
        }
      } };
      case "info": return current ? paintText(this.info(current), { size: 14, color: TEXT, align: "center", lineGap: 10 })
        : { visible: false };
      // 自己的地图三个按钮（playButton…removeButton），别人的地图两个（playButton2、editButton2），都居中
      case "playButton": return current?.mine ? button(tr("开始计时赛"), () => void this.play(current)) : { visible: false };
      case "editButton": return current?.mine ? button(tr("在地图工坊修改"), () => this.edit(current)) : { visible: false };
      case "playButton2": return current && !current.mine ? button(tr("开始计时赛"), () => void this.play(current)) : { visible: false };
      case "editButton2": return current && !current.mine ? button(tr("用地图工坊打开"), () => this.edit(current)) : { visible: false };
      case "removeButton": return current?.mine ? button(current.kind === "draft" ? tr("删除草稿") : tr("下架"),
        () => void this.confirmRemove(current)) : { visible: false };
      case "detailTip": return paintText(this.tip(current), { size: 12, color: "rgb(70,80,100)", align: "center", lineGap: 6 });
      case "summary": return paintText(this.status, { size: 13, color: TEXT, bold: true, middle: true });
      case "newMap": return button(tr("制作新地图"), () => {
        this.options.onActivate?.();
        window.open("/editor.html", "kartsim-mapeditor");
      });
      case "refresh": return button(tr("刷新"), () => { this.options.onActivate?.(); void this.reload(); }, this.loading);
    }
    return {};
  }

  private turn(step: number): void {
    this.options.onActivate?.();
    this.page = Math.min(this.maxPage(), Math.max(0, this.page + step));
    this.render();
  }

  private async confirmRemove(entry: CustomGameEntry): Promise<void> {
    if (this.confirmView || this.disposed) return;
    this.options.onActivate?.();
    const draft = entry.kind === "draft";
    const title = draft ? tr("删除草稿") : tr("下架地图");
    const text = draft ? tr("删除本机草稿“{name}”？|地图工坊里的这张草稿也会删除。", { name: entry.summary.name })
      : tr("下架“{name}”？|服务器上的地图会被删除，别人再也玩不到；本机草稿不受影响。", { name: entry.summary.name });
    let view: WindowView | undefined;
    const close = () => { if (this.confirmView === view) this.confirmView = undefined; view?.dispose(); };
    const confirm = async () => {
      this.options.onActivate?.();
      close();
      try {
        if (draft) await deleteDraft(entry.summary.id);
        else {
          const token = storedSessionToken();
          if (!token) throw new Error(tr("请先登录。"));
          await deleteMap(entry.summary.id, token);
        }
        this.status = draft ? tr("草稿已删除。") : tr("地图已下架。");
      } catch (error) {
        this.status = tr("{title}失败：{error}", { title, error: (error as Error).message });
      }
      this.selected = undefined;
      await this.reload();
    };
    const definition = node("Panel", { windowRect: "fullscreen", color: "100 0 0 0", alphaBlend: "true" }, [
      node("CaptionWindow", { name: "confirmDialog", windowRect: "0 0 440 200", frame: "CaptionDialog",
        caption: title, captionPos: "0 1", align: "center", setCloseButton: "closeButton", textRender: "bold" }, [
        node("Label", { name: "confirmText", windowSize: "400 72", adjust: "0 18", align: "hcenter" }),
        node("TextButton", { name: "confirmOk", leftTopWH: "0 0 100 30", align: "hcenter;bottom", adjust: "-56 10", textRender: "bold14" }),
        node("TextButton", { name: "confirmCancel", leftTopWH: "0 0 100 30", align: "hcenter;bottom", adjust: "56 10", textRender: "bold14" }),
      ]),
    ]);
    try {
      view = await loadWindow(this.options.library, this.options.root, definition, title, close, item => {
        switch (nodeName(item)) {
          case "confirmDialog": return { text: title };
          case "confirmText": return paintText(text, { size: 14, color: TEXT, align: "center", middle: true, lineGap: 8 });
          case "confirmOk": return button(tr("确定"), () => void confirm());
          case "closeButton": return { label: tr("取消"), action: close };
          case "confirmCancel": return button(tr("取消"), close);
        }
        return {};
      });
    } catch (error) {
      console.error("确认窗口打开失败", error);
      return;
    }
    if (this.disposed) { view.dispose(); return; }
    this.confirmView = view;
    view.show();
    view.focus("confirmCancel");
  }
}
