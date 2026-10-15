import { tr } from "../i18n/locale";
/**
 * The lottery screens' popup windows in the release look, drawn by the
 * shared window renderer (te) in a popup layer over the stage:
 *  - 兑换: the original packs, one row each (picture, name, contents, price,
 *    兑换), six a page. Laid out after dialog2_buyAll buyAll@cn (a
 *    CaptionDialog over a GrayEdit list of light item rows, the wallet
 *    under it, a centred button row) with the picture well of
 *    dialog2_buyItem mqBuyItem@cn (img_slot2), its DefaultEdit wallet panel
 *    and the release page buttons (stage_common btn_left_ / btn_right_).
 *  - 选择扭蛋: dialog2_eventMenuGachaMultiDialog (eventMenuGachaMultiDialog@zz,
 *    the release window for picking one of several gachas, with its
 *    eventMenuGachaMultiButton@zz gachaSlot_0 cards), ten cards a page.
 * They own the keyboard while up (game-popups trapPopupKeys): Escape closes
 * only the topmost popup, and no key reaches the lottery screen under it.
 */
import type { Currency } from "../account/account-session";
import { C8, te } from "../generated/library.js";
import { CURRENCY_LABELS, formatAmount } from "../shop/shop-model";
import { attribute, FONT, ImageCache, indexRows, loadBml, loadStrings, mapTree, node, nodeName, prepare, withAttributes,
  wrapText, type BmlLibrary, type Node, type NodeState, type Rect, type Texture, type WindowView } from "../ui/bml-kit";
import { popupLayer, trapPopupKeys } from "../ui/game-popups";
import type { GachaEntry, LotteryItem, LotteryPack } from "./lottery-api";
import { fillString, itemsLine } from "./lottery-model";

const TEXT = "rgb(42,55,80)";
const SUBTEXT = "rgb(88,105,129)";
/** Price colours per currency (点券 orange, 金币 blue, K币 green). */
const PRICE_COLORS: Readonly<Record<Currency, string>> = {
  coupon: "rgb(214,104,0)", lucci: "rgb(30,115,200)", koin: "rgb(42,154,60)",
};
/** The lobby top bar's currency icons (dialog2_personalShop). */
const CURRENCY_ICONS: Readonly<Record<Currency, string>> = {
  coupon: "dialog2_/personalShop/img_cash.png", lucci: "dialog2_/personalShop/img_lucci.png",
  koin: "dialog2_/personalShop/img_koin.png",
};
const CURRENCIES: readonly Currency[] = ["coupon", "lucci", "koin"];

/** An item picture for a canvas: the original icon or the garage snapshot (undefined until loaded). */
export type PictureLookup = (item: Pick<LotteryItem, "category" | "itemId" | "name">) => Texture | undefined;

// --- The window host ---------------------------------------------------------

interface WindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
  definition: Node;
  /** Folder of the dialog (its CaptionWindow close button is looked up there first). */
  folder: string;
  roots: string[];
  label: string;
  state(entry: Node): NodeState;
  /** Sees the final tree (the renderer hands state these very nodes). */
  index?(tree: Node): void;
  /** Escape, the caption's close button. */
  cancel(): void;
  /** The control focused first (not a buy button, so Enter / Space do not spend). */
  focus?: string;
}

interface OpenWindow {
  render(): void;
  dispose(): void;
}

async function decorate(library: BmlLibrary, entry: Node, folder: string): Promise<Node> {
  if (entry.name === "CaptionWindow" && attribute(entry, "setCloseButton"))
    return await C8(library, entry, folder) as Node;
  return { ...entry, children: await Promise.all(entry.children.map(child => decorate(library, child, folder))) };
}

/** Loads a window into its own modal popup layer over root and shows it. */
async function showWindow(options: WindowOptions): Promise<OpenWindow> {
  const tree = prepare(options.library, await decorate(options.library, options.definition, options.folder),
    options.roots);
  options.index?.(tree);
  const layer = popupLayer(options.root);
  let view: WindowView;
  try {
    view = await te.load({
      library: options.library, root: layer.element, definition: tree, roots: options.roots, smoothImages: true,
      modal: true, label: options.label, onCancel: options.cancel, state: options.state,
    } as never) as unknown as WindowView;
  } catch (error) {
    layer.dispose();
    throw error;
  }
  // The topmost popup owns the keys: Escape cancels it, nothing reaches the screens under it.
  const releaseKeys = trapPopupKeys(view.element, { cancel: options.cancel });
  view.show();
  view.focus(options.focus);
  return {
    render: () => view.render(),
    dispose: () => {
      releaseKeys();
      view.dispose();
      layer.dispose();
    },
  };
}

/** Runs a window until done(value) or cancel; an aborted signal cancels it. */
function runWindow<T>(fallback: T, signal: AbortSignal | undefined,
  open: (done: (value: T) => void) => Promise<OpenWindow>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let window: OpenWindow | undefined;
    let finished = false;
    const done = (value: T) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      window?.dispose();
      resolve(value);
    };
    const abort = () => done(fallback);
    if (signal?.aborted) {
      resolve(fallback);
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    open(done).then(opened => {
      if (finished) opened.dispose();
      else window = opened;
    }, error => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

// --- Painting -------------------------------------------------------------------

/** Draws an image contained and centred in rect. */
export function paintPicture(context: CanvasRenderingContext2D, picture: Texture | undefined, rect: Rect,
  maxScale = 2): void {
  if (!picture?.width || !picture.height) return;
  const scale = Math.min(rect.width / picture.width, rect.height / picture.height, maxScale);
  const width = picture.width * scale;
  const height = picture.height * scale;
  context.drawImage(picture.image, rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2,
    width, height);
}

/** Text cut to width with "…". */
export function fitText(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let shown = [...text];
  while (shown.length > 1 && context.measureText(`${shown.join("")}…`).width > width) shown = shown.slice(0, -1);
  return `${shown.join("")}…`;
}

/** Wrapped lines, at most `max`; the last one ends in "…" when text is cut. */
export function clampLines(context: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines = wrapText(context, text, width);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fitText(context, `${kept[max - 1]}${lines.slice(max).join("")}`, width);
  return kept;
}

interface LineStyle { size: number; color: string; align?: CanvasTextAlign; lineHeight?: number }

/** A state painting bold text wrapped (and cut to maxLines) into its rectangle. */
function textState(text: string, style: LineStyle, maxLines: number, middle = false): NodeState {
  return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
    context.save();
    context.font = `bold ${style.size}px ${FONT}`;
    const lines = clampLines(context, text, rect.width, maxLines);
    context.fillStyle = style.color;
    context.textBaseline = "middle";
    const align = style.align ?? "left";
    context.textAlign = align;
    const step = style.lineHeight ?? style.size + 5;
    const top = middle ? rect.y + (rect.height - lines.length * step) / 2 : rect.y;
    const x = align === "center" ? rect.x + rect.width / 2 : align === "right" ? rect.x + rect.width : rect.x;
    lines.forEach((line, index) => context.fillText(line, x, top + index * step + step / 2));
    context.restore();
  } };
}

// --- 兑换 ----------------------------------------------------------------------

export const PACK_ROWS = 6;
const PACK = { width: 760, list: 736, row: 716, rowHeight: 76, gap: 6, pad: 10 };
const PACK_FOLDER = "dialog2_/buyAll";
const PACK_ROOTS = [PACK_FOLDER, "dialog2_/buyItem", "stage_/common"];

/** Height of the GrayEdit list for rows. */
function packListHeight(rows: number): number {
  return rows * PACK.rowHeight + (rows - 1) * PACK.gap + PACK.pad * 2;
}

/**
 * The 兑换 window: the CaptionDialog with `rows` pack rows, the page
 * buttons when paged, the wallet and 关闭 (the caption's close button too).
 */
export function packWindowDefinition(rows: number, paged: boolean): Node {
  const listHeight = packListHeight(rows);
  let y = 10 + listHeight + 8;
  const middle = PACK.width / 2 - 12;
  const pager = paged ? [
    node("ImageButton", { name: "prevPage", leftTopWH: `${middle - 40 - 160} ${y} 160 24`,
      autoLoadImage: "btn_left_", alphaBlend: "true" }),
    node("Label", { name: "pageText", leftTopWH: `${middle - 40} ${y} 80 24`, textRender: "bold16",
      textColor: "255 42 55 80", textAlign: "center" }),
    node("ImageButton", { name: "nextPage", leftTopWH: `${middle + 40} ${y} 160 24`,
      autoLoadImage: "btn_right_", alphaBlend: "true" }),
  ] : [];
  if (paged) y += 24 + 8;
  const walletY = y;
  y += 34;
  const rowNodes = Array.from({ length: rows }, (_unused, index) => node("Window", { name: `packRow${index}`,
    leftTopWH: `${PACK.pad} ${PACK.pad + index * (PACK.rowHeight + PACK.gap)} ${PACK.row} ${PACK.rowHeight}`,
    frame: "DisabledEditLabel" }, [
    // mqBuyItem@cn's picture well (img_slot2, 220×150) at a row's height.
    node("Panel", { name: "packWell", leftTopWH: "8 6 94 64", texture: "img_slot2", alphaBlend: "true" }),
    node("Label", { name: "packPicture", leftTopWH: "12 9 86 58" }),
    node("Label", { name: "packName", leftTopWH: "116 7 440 24" }),
    node("Label", { name: "packItems", leftTopWH: "116 32 450 40" }),
    node("Label", { name: "packPrice", leftTopWH: "560 8 146 24" }),
    node("TextButton", { name: "packBuy", leftTopWH: "590 38 116 32", frame: "DefaultFocusedButton",
      textRender: "bold16" }),
  ]));
  return node("Panel", { windowRect: "fullscreen", color: "160 0 0 0", alphaBlend: "true" }, [
    // Under the wallet: a gap, then the HSection and 关闭 that sit 63 and 6 above the client bottom.
    node("CaptionWindow", { name: "packDialog", windowRect: `0 0 ${PACK.width} ${y + 134}`, frame: "CaptionDialog",
      caption: tr("兑换"), captionPos: "0 1", align: "center", textRender: "bold", setCloseButton: "closeButton" }, [
      node("Window", { name: "packList", leftTopWH: `0 10 ${PACK.list} ${listHeight}`, align: "hcenter",
        frame: "GrayEdit" }, [
        ...rowNodes,
        node("Label", { name: "packEmpty", leftTopWH: `0 0 ${PACK.list} ${listHeight}` }),
      ]),
      ...pager,
      // mqBuyItem@cn's wallet panel frame (DefaultEdit).
      node("Window", { name: "walletPanel", leftTopWH: `0 ${walletY} ${PACK.list} 34`, align: "hcenter",
        frame: "DefaultEdit" }, [
        node("Label", { name: "walletText", leftTopWH: `14 0 ${PACK.list - 28} 34` }),
      ]),
      node("Window", { leftTopWH: `0 0 ${PACK.list} 1`, frame: "HSection", align: "hcenter;bottom", adjust: "0 63" }),
      node("TextButton", { name: "cancelButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "0 6",
        textRender: "bold16" }),
    ]),
  ]);
}

export interface PackWindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
  packs: readonly LotteryPack[];
  /** The account's wallet now (re-read on every paint). */
  wallet(): Readonly<Record<Currency, number>> | undefined;
  picture: PictureLookup;
  /** Buys a pack (affordability, request, notices); true when bought. */
  buy(pack: LotteryPack): Promise<boolean>;
  /** Pictures arriving call the render this hands over. */
  subscribe(render: () => void): void;
  onActivate?(): void;
  signal?: AbortSignal;
}

/** The 兑换 window; resolves when closed (true when something was bought). */
export function openPackWindow(options: PackWindowOptions): Promise<boolean> {
  const { packs } = options;
  const rows = Math.max(1, Math.min(PACK_ROWS, packs.length));
  const pages = Math.max(1, Math.ceil(packs.length / PACK_ROWS));
  let page = 0;
  let bought = false;
  const busy = new Set<number>();
  return runWindow<boolean>(false, options.signal, async done => {
    let window: OpenWindow | undefined;
    const render = () => window?.render();
    const icons = new ImageCache(options.library, render);
    options.subscribe(render);
    const close = () => {
      options.onActivate?.();
      done(bought);
    };
    const turn = (delta: number) => {
      const next = Math.max(0, Math.min(pages - 1, page + delta));
      if (next === page) return;
      options.onActivate?.();
      page = next;
      render();
    };
    const buy = (pack: LotteryPack) => {
      if (busy.has(pack.stockId)) return;
      options.onActivate?.();
      busy.add(pack.stockId);
      render();
      void options.buy(pack).then(ok => { if (ok) bought = true; }).finally(() => {
        busy.delete(pack.stockId);
        render();
      });
    };
    const rowOf = new WeakMap<Node, number>();
    const state = (entry: Node): NodeState => {
      const row = rowOf.get(entry);
      const name = nodeName(entry);
      if (row !== undefined) {
        const pack = packs[page * PACK_ROWS + row];
        if (!pack) return { visible: false };
        return packRowState(name, pack, busy.has(pack.stockId), () => buy(pack), options.picture, icons);
      }
      switch (name) {
        case "packDialog": return { text: tr("兑换") };
        case "packEmpty": return packs.length ? { visible: false }
          : textState(tr("暂时没有可兑换的礼包。"), { size: 16, color: SUBTEXT, align: "center" }, 1, true);
        case "prevPage": return { label: tr("上一页"), disabled: page === 0, ...(page > 0 ? { action: () => turn(-1) } : {}) };
        case "nextPage": return { label: tr("下一页"), disabled: page >= pages - 1,
          ...(page < pages - 1 ? { action: () => turn(1) } : {}) };
        case "pageText": return { text: `${page + 1}/${pages}` };
        case "walletText": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintWallet(context, rect, options.wallet(), icons) };
        case "closeButton": return { label: tr("关闭"), action: close };
        case "cancelButton": return { text: tr("关闭"), label: tr("关闭"), action: close };
      }
      return {};
    };
    window = await showWindow({
      library: options.library, root: options.root, definition: packWindowDefinition(rows, pages > 1),
      folder: PACK_FOLDER, roots: PACK_ROOTS, label: tr("兑换"), state, cancel: close, focus: "cancelButton",
      index: tree => indexRows(tree, "packRow", rowOf),
    });
    return window;
  });
}

function packRowState(name: string, pack: LotteryPack, busy: boolean, buy: () => void, picture: PictureLookup,
  icons: ImageCache): NodeState {
  switch (name) {
    case "packPicture": {
      const item = pack.items[0];
      return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        if (item) paintPicture(context, picture(item), rect);
      } };
    }
    case "packName": return textState(pack.name, { size: 16, color: TEXT }, 1);
    case "packItems": return textState(itemsLine(pack.items), { size: 13, color: SUBTEXT, lineHeight: 19 }, 2);
    case "packPrice": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
      paintAmount(context, rect, pack.price, pack.currency, icons, "right", PRICE_COLORS[pack.currency]);
    } };
    case "packBuy": return { text: tr("兑换"), label: tr("兑换 {0}", { "0": pack.name }), disabled: busy, ...(busy ? {} : { action: buy }) };
  }
  return {};
}

/** "[icon] 2,190 点券", aligned in rect. */
function paintAmount(context: CanvasRenderingContext2D, rect: Rect, amount: number, currency: Currency,
  icons: ImageCache, align: "left" | "right", color: string, size = 16): void {
  context.save();
  context.font = `bold ${size}px ${FONT}`;
  const text = `${formatAmount(amount)} ${CURRENCY_LABELS[currency]}`;
  const icon = icons.path(CURRENCY_ICONS[currency]);
  const iconSize = 20;
  const width = context.measureText(text).width + (icon ? iconSize + 4 : 0);
  const x = align === "right" ? rect.x + rect.width - width : rect.x;
  const middle = rect.y + rect.height / 2;
  if (icon) paintPicture(context, icon, { x, y: middle - iconSize / 2, width: iconSize, height: iconSize }, 1);
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText(text, x + (icon ? iconSize + 4 : 0), middle + 1);
  context.restore();
}

/** 持有：[icon] 20,000 点券 [icon] 20,000 金币 [icon] 20,000 K币 */
function paintWallet(context: CanvasRenderingContext2D, rect: Rect,
  wallet: Readonly<Record<Currency, number>> | undefined, icons: ImageCache): void {
  if (!wallet) return;
  context.save();
  context.font = `bold 14px ${FONT}`;
  context.fillStyle = SUBTEXT;
  context.textBaseline = "middle";
  context.fillText(tr("持有："), rect.x, rect.y + rect.height / 2 + 1);
  const start = rect.x + context.measureText(tr("持有：")).width + 10;
  context.restore();
  const slot = (rect.x + rect.width - start) / CURRENCIES.length;
  CURRENCIES.forEach((currency, index) => paintAmount(context, { ...rect, x: start + index * slot, width: slot },
    wallet[currency], currency, icons, "left", TEXT, 14));
}

// --- 选择扭蛋 ------------------------------------------------------------------

const GACHA_FOLDER = "dialog2_/eventMenuGachaMultiDialog";
const GACHA_ROOTS = [GACHA_FOLDER, "stage_/common"];
export const GACHA_GRID = { columns: 5, rows: 2 };
/** eventMenuGachaMultiButton@zz: a 254×308 cell around its 250×288 gachaSlot_0 card. */
const CELL = { width: 254, height: 308 };

/**
 * eventMenuGachaMultiDialog@zz with columns × rows cards: the card template
 * (the ImageButton of eventMenuGachaMultiButton@zz) copied into each cell of
 * a grid that replaces its GridSelectorDivLoad, the dialog and its
 * InputBoxBg2 sized to the grid, page buttons under it and a Selectored
 * frame that marks the gacha on show.
 */
export function gachaPickerDefinition(dialog: Node, card: Node, columns: number, rows: number): Node {
  const gridWidth = columns * CELL.width;
  const gridHeight = rows * CELL.height;
  const bgWidth = gridWidth + 20;
  // The release dialog is 40 wider than its InputBoxBg2 and 68 taller (caption, margins); 38 more for the pages.
  const width = bgWidth + 40;
  const height = gridHeight + 68 + 38;
  const pagerY = 10 + gridHeight + 8;
  const button = card.children.find(child => child.name === "ImageButton");
  const content = (button?.children ?? []).map(child => mapTree(child, entry =>
    entry.name === "ItemWindow" || entry.name === "ColorLabel" ? { ...entry, name: "Label" } : undefined));
  const cell = (index: number): Node => node("Window", { name: `gachaCell${index}`,
    leftTopWH: `${(index % columns) * CELL.width} ${Math.floor(index / columns) * CELL.height} ${CELL.width} ${
      CELL.height}` }, [
    ...button ? [{ ...button, children: content.map(child => mapTree(child, entry => ({ ...entry }))) }] : [],
    node("Window", { name: "gachaMark", leftTopWH: "0 8 254 292", frame: "Selectored" }),
  ]);
  const children = dialog.children.map(entry => {
    if (entry.name !== "CaptionWindow") return entry;
    const inner = entry.children.map(child => {
      if (nodeName(child) === "bg") return withAttributes(child, { leftTopWH: `0 10 ${bgWidth} ${gridHeight}` });
      if (nodeName(child) === "itemSelector") return node("Container", { name: "itemSelector",
        windowSize: `${gridWidth} ${gridHeight}`, adjust: "0 10", align: "hcenter" },
      Array.from({ length: columns * rows }, (_unused, index) => cell(index)));
      return child;
    });
    return { ...withAttributes(entry, { leftTopWH: `0 0 ${width} ${height}`, caption: tr("选择扭蛋"), captionPos: "0 1",
      textRender: "bold" }), children: [...inner,
      node("ImageButton", { name: "prevPage", windowSize: "160 24", adjust: `-130 ${pagerY}`, align: "hcenter",
        autoLoadImage: "btn_left_", alphaBlend: "true" }),
      node("Label", { name: "pageText", windowSize: "80 24", adjust: `0 ${pagerY}`, align: "hcenter",
        textRender: "bold16", textColor: "255 42 55 80", textAlign: "center" }),
      node("ImageButton", { name: "nextPage", windowSize: "160 24", adjust: `130 ${pagerY}`, align: "hcenter",
        autoLoadImage: "btn_right_", alphaBlend: "true" }),
    ] };
  });
  return { ...dialog, children };
}

/** A card's status on its dark tab: 未开放 / 可使用 / 可兑换. */
export function gachaStatus(entry: Pick<GachaEntry, "open" | "owned">): string {
  if (!entry.open) return tr("未开放");
  return entry.owned > 0 ? tr("可使用") : tr("可兑换");
}

export interface GachaPickerOptions {
  library: BmlLibrary;
  root: HTMLElement;
  entries: readonly GachaEntry[];
  current?: number;
  picture: PictureLookup;
  subscribe(render: () => void): void;
  onActivate?(): void;
  signal?: AbortSignal;
}

/** 选择扭蛋: resolves the chosen lottery's itemId, or undefined when closed. */
export function openGachaPicker(options: GachaPickerOptions): Promise<number | undefined> {
  const { entries } = options;
  const perPage = GACHA_GRID.columns * GACHA_GRID.rows;
  const pages = Math.max(1, Math.ceil(entries.length / perPage));
  const currentIndex = entries.findIndex(entry => entry.itemId === options.current);
  let page = currentIndex >= 0 ? Math.floor(currentIndex / perPage) : 0;
  return runWindow<number | undefined>(undefined, options.signal, async done => {
    const [dialog, card, strings] = await Promise.all([
      loadBml(options.library, GACHA_FOLDER, "eventMenuGachaMultiDialog@zz"),
      loadBml(options.library, GACHA_FOLDER, "eventMenuGachaMultiButton@zz"),
      loadStrings(options.library, GACHA_FOLDER, "eventMenuGachaMultiDialog_stringBag"),
    ]);
    const countFormat = strings.get("itemCount") ?? tr("%d 个");
    let window: OpenWindow | undefined;
    const render = () => window?.render();
    options.subscribe(render);
    const close = () => {
      options.onActivate?.();
      done(undefined);
    };
    const turn = (delta: number) => {
      const next = Math.max(0, Math.min(pages - 1, page + delta));
      if (next === page) return;
      options.onActivate?.();
      page = next;
      render();
    };
    const cellOf = new WeakMap<Node, number>();
    const state = (entry: Node): NodeState => {
      const cell = cellOf.get(entry);
      const name = nodeName(entry);
      if (cell !== undefined) {
        const gacha = entries[page * perPage + cell];
        if (!gacha) return { visible: false };
        switch (name) {
          case "gachaButton": return { label: gacha.name, action: () => {
            options.onActivate?.();
            done(gacha.itemId);
          } };
          case "gachaMark": return { visible: gacha.itemId === options.current };
          case "itemName": return textState(gacha.name, { size: 16, color: TEXT, align: "center" }, 1, true);
          case "itemPeriod": return { text: gachaStatus(gacha) };
          case "itemCount": {
            // The release label keeps off the card's right edge (marginRect).
            const count = textState(tr("持有 {0}", { "0": fillString(countFormat, gacha.owned) }),
              { size: 14, color: SUBTEXT, align: "right" }, 1);
            return { ...count, paint: (context: CanvasRenderingContext2D, rect: Rect) =>
              (count.paint as (context: CanvasRenderingContext2D, rect: Rect) => void)(context,
                { ...rect, width: rect.width - 16 }) };
          }
          case "itemPanel": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
            // The card body between the count (top right) and the info lines (bottom).
            const size = 128;
            paintPicture(context, options.picture({ category: 24, itemId: gacha.itemId, name: gacha.name }),
              { x: rect.x + (rect.width - size) / 2, y: rect.y + 52, width: size, height: size });
          } };
          case "itemInfo": return textState(gacha.key ? tr("需同时使用 {0}（持有 {1} 个）", { "0": gacha.key.name, "1": gacha.key.owned }) : "",
            { size: 14, color: "rgb(64,75,95)", align: "center", lineHeight: 18 }, 2, true);
        }
        return {};
      }
      switch (name) {
        case "eventMenuGachaMultiDialog": return { text: tr("选择扭蛋") };
        case "prevPage": return { visible: pages > 1, label: tr("上一页"), disabled: page === 0,
          ...(page > 0 ? { action: () => turn(-1) } : {}) };
        case "nextPage": return { visible: pages > 1, label: tr("下一页"), disabled: page >= pages - 1,
          ...(page < pages - 1 ? { action: () => turn(1) } : {}) };
        case "pageText": return { visible: pages > 1, text: `${page + 1}/${pages}` };
        case "closeButton": return { label: tr("关闭"), action: close };
      }
      return {};
    };
    window = await showWindow({
      library: options.library, root: options.root,
      definition: gachaPickerDefinition(dialog, card, GACHA_GRID.columns, GACHA_GRID.rows),
      folder: GACHA_FOLDER, roots: GACHA_ROOTS, label: tr("选择扭蛋"), state, cancel: close, focus: "closeButton",
      index: tree => indexRows(tree, "gachaCell", cellOf),
    });
    return window;
  });
}
