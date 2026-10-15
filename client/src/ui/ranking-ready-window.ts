import { translateItemName } from "../i18n/item-names";
import { tr } from "../i18n/locale";
/**
 * The 排位计时赛 window (TIMEATTACK.md), the release stage_rankingTimeAttackReady
 * layout drawn by the shared BML renderer: the track's 赛道排名 (top ten ranked
 * records, a row with a replay opens the viewer), 目前记录, the speed / booster /
 * ghost settings, 开始 (F5) with its 金币 fee, 我的物品 and 选择赛道. The 3D
 * rider preview is the Ready screen's (ui.js ny), painted into 캐릭터창.
 */
import { C8, te } from "../generated/library.js";
import { formatRecordTime, type RankingRow, type TimeAttackRanking } from "../timeattack/timeattack-api";
import { ImageCache, loadBml, loadStrings, mapTree, node, prepare, resolveStrings, withAttributes,
  type BmlLibrary, type Node, type Rect, type Texture } from "./bml-kit";

export interface RankingSettings { speed: number; booster: number; showGhost: boolean }

export interface RankingWindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
  trackId: string;
  trackTitle: string;
  /** The track model's folder path (track_/<id>/…), for its card picture. */
  trackPath: string;
  settings: RankingSettings;
  /** Whether a local ghost record exists for the settings (我的幻影 ON needs one). */
  hasGhost(settings: RankingSettings): boolean;
  /** The rider preview painter, or none while it loads. */
  preview?: { render(context: CanvasRenderingContext2D, rect: Rect, time: number): void };
  onSettings(settings: RankingSettings): void;
  onStart(): void;
  onItems(): void;
  onTrack(): void;
  onReplay(row: RankingRow): void;
  onClose(): void;
  onHover?(): void;
  onActivate?(): void;
}

interface WindowView { readonly element: HTMLElement; show(): void; dispose(): void; render(): void }

const FOLDER = "stage_/rankingTimeAttackReady";
const ROOTS = [FOLDER, "stage_/timeAttackReady", "stage_/common"];
/** Keys the ranking stage's own string bag lacks (etc_/baseStringBag). */
const FALLBACK_STRINGS: Record<string, string> = {
  speedS7: "标准速度", speedS4: "无限", indiGame: "个人赛", teamGame: "组队赛", on: "ON", off: "OFF",
  gameSpeed: "选择速度", kartBody: "卡丁车", track: "赛道", myRecord: "目前记录", currentRecord: "目前纪录",
  option: "设置", trackSpeed: "速度", boosterMode: "加速模式", showShadow: "我的幻影", invalidShadow: "无纪录",
  trackRanking: "赛道排名", standings: "名次", recordRider: "车手", recordKart: "卡丁车", recordStat: "纪录",
  timeAttack: "排位计时赛",
};
const nodeName = (entry: Node): string => entry.attributes.find(item => item.name === "name")?.value ?? "";

export class RankingReadyWindow {
  private view?: WindowView;
  private ranking?: TimeAttackRanking;
  private loading = true;
  private error?: string;
  private disposed = false;
  private readonly images: ImageCache;
  private trackCard?: Texture;
  private animation = 0;
  private definition?: Node;

  private constructor(private readonly options: RankingWindowOptions, private readonly strings: Map<string, string>) {
    this.images = new ImageCache(options.library, () => this.view?.render());
  }

  static async open(options: RankingWindowOptions): Promise<RankingReadyWindow> {
    const strings = new Map(Object.entries(FALLBACK_STRINGS).map(([key, value]) => [key, tr(value)]));
    for (const [key, value] of await loadStrings(options.library, FOLDER, "stage_stringBag")) strings.set(key, value);
    const window = new RankingReadyWindow(options, strings);
    await window.build();
    return window;
  }

  get settings(): RankingSettings { return this.options.settings; }

  /** The table and 目前记录 from the data service; call again after a run. */
  setRanking(ranking: TimeAttackRanking | undefined, error?: string): void {
    this.ranking = ranking;
    this.error = error;
    this.loading = false;
    this.view?.render();
  }

  setLoading(): void {
    this.loading = true;
    this.error = undefined;
    this.view?.render();
  }

  setPreview(preview: RankingWindowOptions["preview"]): void {
    this.options.preview = preview;
    this.view?.render();
  }

  private async build(): Promise<void> {
    const { library } = this.options;
    const raw = await loadBml(library, FOLDER, "mq_window@zz");
    let definition = mapTree(resolveStrings(raw, this.strings), entry => {
      // The release TrackCard draws the track's picture and name; the renderer has no such element.
      if (entry.name === "TrackCard") {
        return node("Container", { name: "trackCard", windowSize: "372 226" }, [
          node("Panel", { name: "trackPicture", leftTopWH: "12 12 360 214" }),
          node("Label", { name: "trackName", leftTopWH: "50 185 320 22", textRender: "outline16", textColor: "white",
            textAlign: "left|vcenter" }),
        ]);
      }
      if (entry.name === "CaptionWindow") return withAttributes(entry, { caption: this.strings.get("timeAttack") });
      return undefined;
    });
    if (definition.name === "CaptionWindow") definition = await C8(library, definition, FOLDER) as Node;
    else {
      definition = { ...definition, children: await Promise.all(definition.children.map(async child =>
        child.name === "CaptionWindow" ? await C8(library, child, FOLDER) as Node : child)) };
    }
    definition = prepare(library, definition, ROOTS);
    this.definition = definition;
    const card = this.options.trackPath.replace(/[^/\\]*$/, "") + "xt_trackCard.png";
    this.trackCard = this.images.path(card);
    if (this.disposed) return;
    this.view = await te.load({
      library, root: this.options.root, definition, roots: ROOTS, smoothImages: true, modal: true,
      label: this.strings.get("timeAttack") ?? tr("排位计时赛"),
      onCancel: () => this.options.onClose(),
      onConfirm: () => this.options.onStart(),
      state: (entry: Node) => this.state(entry),
    }) as WindowView;
    this.view.show();
    const tick = (time: number): void => {
      if (this.disposed) return;
      if (this.options.preview) this.view?.render();
      this.animation = requestAnimationFrame(tick);
      void time;
    };
    this.animation = requestAnimationFrame(tick);
  }

  /** Which named panel (gameSpeedBtnPanel …) a button belongs to. */
  private panelOf(entry: Node, names: string[]): string | undefined {
    const definition = this.definition;
    if (!definition) return undefined;
    const under = (parent: Node, panel: string): boolean =>
      nodeName(parent) === panel ? contains(parent, entry) : parent.children.some(child => under(child, panel));
    return names.find(name => under(definition, name));
  }

  private state(entry: Node): Record<string, unknown> {
    const name = nodeName(entry);
    const { settings } = this.options;
    const row = /^(순위|이름|카트|기록)_(\d+)$/.exec(name);
    if (row) return this.rowState(row[1]!, Number(row[2]));
    const line = /^line(\d+)$/.exec(name);
    if (line) {
      const index = Number(line[1]) - 1;
      const entryRow = this.ranking?.rows[index];
      return entryRow?.hasReplay ? { action: () => this.options.onReplay(entryRow), label: tr("观看 {name} 的录像", { name: entryRow.nickname }),
        hoverRegion: `row-${index}` } : {};
    }
    switch (name) {
      case "onBtn":
      case "offBtn": {
        const panel = this.panelOf(entry, ["gameSpeedBtnPanel", "teamBoosterBtnPanel", "shadowBtnPanel"]);
        if (panel === "gameSpeedBtnPanel") {
          const speed = name === "onBtn" ? 7 : 4;
          return { checked: settings.speed === speed, label: speed === 7 ? tr("标准速度") : tr("无限"),
            action: settings.speed === speed ? undefined : () => this.change({ speed }) };
        }
        if (panel === "teamBoosterBtnPanel") {
          const booster = name === "onBtn" ? 1 : 0;
          return { checked: settings.booster === booster, label: booster ? tr("组队赛") : tr("个人赛"),
            action: settings.booster === booster ? undefined : () => this.change({ booster }) };
        }
        if (panel === "shadowBtnPanel") {
          const show = name === "onBtn";
          const hasGhost = this.options.hasGhost(settings);
          return { visible: hasGhost, checked: settings.showGhost === show, label: show ? tr("我的幻影 ON") : tr("我的幻影 OFF"),
            action: settings.showGhost === show ? undefined : () => this.change({ showGhost: show }) };
        }
        return {};
      }
      case "shadowdesc": return { visible: !this.options.hasGhost(settings) };
      case "시작": return { label: tr("开始 (F5)"), action: () => this.options.onStart() };
      case "소모루찌": return { text: tr("{fee} 金币", { fee: this.ranking?.fee ?? 500 }) };
      case "내아이템": return { label: tr("我的物品"), action: () => this.options.onItems() };
      case "트랙": return { label: tr("选择赛道"), action: () => this.options.onTrack() };
      case "exit": return { label: tr("关闭"), action: () => this.options.onClose() };
      case "currentRecord": return { text: formatRecordTime(this.ranking?.ranked?.bestMs) };
      case "replayGameSpeed":
        return { text: `${settings.speed === 7 ? tr("标准速度") : tr("无限")} / ${settings.booster ? tr("组队赛") : tr("个人赛")}` };
      case "replayKart": return { text: this.ranking?.ranked?.kart.name ?? "" };
      case "replayTrack": return { text: this.options.trackTitle };
      case "게임스피드": return { paint: this.icon(`timeAttack_main_iconMode${settings.speed === 7 ? 7 : 4}`) };
      case "부스터모드": return { paint: this.icon(`timeAttack_main_iconBooster${settings.booster}`) };
      case "고스트사용": return { paint: this.icon(`timeAttack_main_iconGhost${settings.showGhost ? 1 : 2}`) };
      case "lucciRect": return { visible: false };
      case "trackName": return { text: this.options.trackTitle };
      case "trackPicture": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        const card = this.trackCard ?? this.images.path(this.options.trackPath.replace(/[^/\\]*$/, "") + "xt_trackCard.png");
        if (card) context.drawImage(card.image, rect.x, rect.y, rect.width, rect.height);
      } };
      case "캐릭터창": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        this.options.preview?.render(context, rect, performance.now());
      } };
      case "holder": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        if (this.loading || this.error || (this.ranking && this.ranking.rows.length === 0)) {
          context.save();
          context.font = "bold 16px 'KartSim Main Menu', sans-serif";
          context.fillStyle = "rgba(220,231,242,1)";
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillText(this.loading ? tr("正在读取赛道排名…") : this.error ?? tr("该赛道还没有排位纪录。"),
            rect.x + rect.width / 2, rect.y + 24);
          context.restore();
        }
      } };
    }
    return {};
  }

  private rowState(column: string, index: number): Record<string, unknown> {
    const entryRow = this.ranking?.rows[index - 1];
    if (!entryRow) return { text: "" };
    const text = column === "순위" ? String(entryRow.rank) : column === "이름" ? entryRow.nickname
      : column === "카트" ? translateItemName(entryRow.kartName) : formatRecordTime(entryRow.bestMs);
    return { text, ...(entryRow.self ? { textColor: "255 255 226 72" } : {}) };
  }

  private icon(name: string) {
    return (context: CanvasRenderingContext2D, rect: Rect) => {
      const texture = this.images.named(ROOTS, name);
      if (texture) context.drawImage(texture.image, rect.x, rect.y, rect.width, rect.height);
    };
  }

  private change(changes: Partial<RankingSettings>): void {
    this.options.onActivate?.();
    this.options.settings = { ...this.options.settings, ...changes };
    if (changes.speed !== undefined || changes.booster !== undefined) this.setLoading();
    this.options.onSettings(this.options.settings);
    this.view?.render();
  }

  render(): void { this.view?.render(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.view?.dispose();
    this.view = undefined;
  }
}

function contains(parent: Node, target: Node): boolean {
  return parent === target || parent.children.some(child => contains(child, target));
}
