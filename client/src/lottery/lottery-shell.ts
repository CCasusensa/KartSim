/**
 * What the two lottery screens share: a full-screen original stage (the
 * 1080-high virtual screen of the shop, scaled to the viewport, covering
 * the taskbar like the release RouletteStage and GachaUseStage), item
 * pictures (the shop's garage snapshots for catalog items, original icons
 * otherwise, also for canvas windows) and the game's own popups over it:
 * notices in the release toast (BlackEdit), questions in the release
 * message box (customMessageBox) and the windows of lottery-windows (the
 * 兑换 pack window, 选择扭蛋).
 */
import type { AccountSession } from "../account/account-session";
import { fetchShopCatalog } from "../shop/shop-api";
import type { ShopArt } from "../shop/shop-assets";
import { imageVar } from "../shop/shop-assets";
import { kindIconMarkup } from "../shop/shop-icons";
import { shopScreen, type ShopScreen } from "../shop/shop-original";
import { SHOP_STYLES } from "../shop/shop-styles";
import { element, setFrame } from "../shop/shop-widgets";
import { ImageCache, type BmlLibrary, type Texture } from "../ui/bml-kit";
import { confirmGame, gameWindowLibrary, showGameToast } from "../ui/game-popups";
import { lotteryErrorMessage, type LotteryApi, type LotteryItem, type LotteryPack } from "./lottery-api";
import { isLotteryLibrary } from "./lottery-layout";
import { affordable, itemLine } from "./lottery-model";
import { openPackWindow, type PictureLookup } from "./lottery-windows";

/** Item pictures: the garage snapshot renderer the 道具图鉴 uses. */
export interface LotteryPictureSource {
  picture(category: number, itemId: number, internalId: string, signal: AbortSignal):
    Promise<HTMLCanvasElement | undefined>;
  dispose(): void;
}

export interface LotteryScreenOptions {
  root: HTMLElement;
  library: unknown;
  session: AccountSession;
  api: LotteryApi;
  /** Garage snapshots of catalog items; without it items show their icon. */
  pictures?: LotteryPictureSource;
  /** The player closed the screen (its close button, Esc) or the session ended. */
  onClose(): void;
  onHover?(): void;
  onActivate?(): void;
}

const NOTICE_MS = 3_200;

/** Rarity names of the treasure-hunt effect art (아이템출현광원_<name>). */
export const RARITY_EFFECTS: Readonly<Record<string, string>> = {
  normal: "일반", rare: "레어", epic: "에픽", unique: "유니크", legend: "레전드", special: "스페셜", ultimate: "얼티밋",
};

/** Kind of a catalog category for the fallback icons (shop-icons). */
const CATEGORY_KINDS: Readonly<Record<number, string>> = {
  1: "character", 2: "color", 3: "kart", 4: "plate", 8: "goggle", 9: "balloon", 11: "headBand", 16: "handGearL",
  18: "uniform", 20: "decal", 21: "pet", 26: "aura", 27: "skidMark", 52: "flyingPet", 70: "dye", 71: "slotBg",
};

export const LOTTERY_STYLES = `
.ks-lottery{pointer-events:auto;z-index:5;background:#000}
.ks-lottery .ks-lottery-stage{position:absolute;left:0;top:0;width:var(--ks-shop-w,1920px);height:1080px;
  transform-origin:0 0;transform:scale(var(--ks-shop-scale,1));overflow:hidden}
.ks-lottery button.ks-bml:not(:disabled){cursor:pointer}
.ks-lottery button.ks-bml[aria-disabled=true]{filter:grayscale(.6) brightness(.8);cursor:default}
.ks-lottery-pic{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.ks-lottery-pic>canvas,.ks-lottery-pic>img{position:absolute;max-width:100%;max-height:100%;object-fit:contain}
.ks-lottery-pic>canvas{width:100%;height:100%}
.ks-lottery-pic>svg{width:46%;height:46%;opacity:.85;color:#fff;filter:drop-shadow(0 2px 2px #0008)}
.ks-lottery-pic[data-preview=ready]>svg{display:none}
.ks-lottery-pic>.ks-lottery-icon{position:absolute;inset:18%;background:center/contain no-repeat}
.ks-lottery-pic>.ks-lottery-cube{position:absolute;left:14%;top:14%;width:72%;height:72%;
  background:var(${imageVar("확정가챠꽝아이템")}) no-repeat;background-size:290.9% 145.5%;background-position:28% 4%;border-radius:8%}
.ks-lottery-name{position:absolute;left:-30px;right:-30px;text-align:center;color:#fff;font-size:15px;line-height:1.2;
  text-shadow:0 0 2px #000,1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;pointer-events:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

/** The pictures of item keys shown by catalog internal id (karts, characters, equipment). */
export class LotteryPictures {
  private catalog?: Promise<Map<string, { internalId: string; kind: string }>>;

  constructor(private readonly options: Pick<LotteryScreenOptions, "session" | "pictures"> &
    Partial<Pick<LotteryScreenOptions, "library">>) {}

  private catalogItems(): Promise<Map<string, { internalId: string; kind: string }>> {
    this.catalog ??= fetchShopCatalog(this.options.session).then(catalog => new Map(catalog.items.map(item =>
      [`${item.category}:${item.itemId}`, { internalId: item.internalId, kind: item.kind }])))
      .catch(() => new Map());
    return this.catalog;
  }

  /** The garage snapshot of a catalog item (undefined without one). */
  private async snapshot(item: Pick<LotteryItem, "category" | "itemId">, signal: AbortSignal):
    Promise<HTMLCanvasElement | undefined> {
    const source = this.options.pictures;
    if (!source || !CATEGORY_KINDS[item.category]) return undefined;
    const known = (await this.catalogItems()).get(`${item.category}:${item.itemId}`);
    if (!known || signal.aborted) return undefined;
    return await source.picture(item.category, item.itemId, known.internalId, signal);
  }

  /**
   * Draws an item into host (positioned, sized by the caller): the
   * category icon at once, then the garage snapshot of a catalog item, or
   * the original icon of a lottery material. Returns the cleanup.
   */
  draw(host: HTMLElement, item: Pick<LotteryItem, "category" | "itemId" | "name">): () => void {
    host.classList.add("ks-lottery-pic");
    host.replaceChildren();
    host.removeAttribute("data-preview");
    const icon = materialIcon(item);
    if (icon) {
      const image = element("div", "ks-lottery-icon");
      image.style.backgroundImage = `var(${imageVar(icon)})`;
      host.append(image);
      host.dataset.preview = "ready";
      return () => {};
    }
    host.insertAdjacentHTML("beforeend", kindIconMarkup(CATEGORY_KINDS[item.category] ?? "etc"));
    const abort = new AbortController();
    void this.snapshot(item, abort.signal).then(canvas => {
      if (!canvas || abort.signal.aborted) return;
      host.append(canvas);
      host.dataset.preview = "ready";
    }).catch(() => { /* The icon stays. */ });
    return () => abort.abort();
  }

  /**
   * Pictures for a window drawn on a canvas: picture(item) is the original
   * icon of a material, or the garage snapshot of a catalog item with the
   * category icon until it is ready; changed() runs as pictures arrive.
   */
  canvas(changed: () => void): { picture: PictureLookup; dispose(): void } {
    const library = this.options.library;
    const icons = isLotteryLibrary(library) ? new ImageCache(library as unknown as BmlLibrary, changed) : undefined;
    const snapshots = new Map<string, Texture | null>();
    const abort = new AbortController();
    const picture: PictureLookup = item => {
      const icon = materialIcon(item);
      if (icon) return icons?.named([...LOTTERY_ICON_ROOTS], icon);
      const key = `${item.category}:${item.itemId}`;
      const ready = snapshots.get(key);
      if (ready) return ready;
      if (ready === undefined) {
        snapshots.set(key, null);
        void this.snapshot(item, abort.signal).then(canvas => {
          if (!canvas || abort.signal.aborted) return;
          snapshots.set(key, { image: canvas, width: canvas.width, height: canvas.height });
          changed();
        }).catch(() => { /* The icon stays. */ });
      }
      return kindIcon(CATEGORY_KINDS[item.category] ?? "etc", changed);
    };
    return { picture, dispose: () => abort.abort() };
  }
}

/** The category line icons (shop-icons) as images for canvases, decoded once. */
const KIND_ICONS = new Map<string, { image: HTMLImageElement; ready: boolean; waiting: Set<() => void> }>();
const KIND_ICON_COLOR = "rgb(64,75,95)";

function kindIcon(kind: string, changed: () => void): Texture | undefined {
  if (typeof Image === "undefined") return undefined;
  let entry = KIND_ICONS.get(kind);
  if (!entry) {
    const image = new Image();
    const created = { image, ready: false, waiting: new Set<() => void>() };
    KIND_ICONS.set(kind, created);
    image.onload = () => {
      created.ready = true;
      for (const wake of created.waiting) wake();
      created.waiting.clear();
    };
    const markup = kindIconMarkup(kind).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" ')
      .replaceAll("currentColor", KIND_ICON_COLOR);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    entry = created;
  }
  if (entry.ready) return { image: entry.image, width: 64, height: 48 };
  entry.waiting.add(changed);
  return undefined;
}

/** Original icons of items without a 3D picture. */
function materialIcon(item: Pick<LotteryItem, "category" | "itemId">): string | undefined {
  if (item.category === 34 && (item.itemId === 883 || item.itemId === 884)) return "newgacha_goodsicon_1";
  if (item.category === 34 && item.itemId === 834) return "newgacha_goodsicon_2";
  if (item.category === 56 && item.itemId === 1) return "common_icon_koin";
  if (item.category === 62 && item.itemId === 1) return "common_icon_cash";
  if (item.category === 24) return "limitedGacha_01";
  return undefined;
}

/** Icons materialIcon names, to load with a screen's art. */
export const LOTTERY_ICON_IMAGES = ["newgacha_goodsicon_1", "newgacha_goodsicon_2", "common_icon_koin",
  "common_icon_cash", "limitedGacha_01", "확정가챠꽝아이템"] as const;
/** Where those icons are. */
export const LOTTERY_ICON_ROOTS = ["stage_/treasureHunt", "stage_/mqShop", "stage_/mainMenu", "stage_/common"] as const;

/** What lottery-windows needs to open a window over the screen. */
export interface LotteryPopupContext {
  library: BmlLibrary;
  root: HTMLElement;
  signal: AbortSignal;
  onActivate?(): void;
}

/** The full-screen stage both screens are built on. */
export class LotteryShell {
  readonly element = element("div", "ks-shop ks-lottery");
  readonly stage = element("div", "ks-lottery-stage");
  private resizeObserver?: ResizeObserver;
  private readonly previousFocus: Element | null;
  /** Closes the popups (message boxes, windows) when the screen goes. */
  private readonly popupAbort = new AbortController();
  private openPopups = 0;
  screen: ShopScreen;
  disposed = false;

  constructor(readonly options: LotteryScreenOptions, label: string,
    private readonly onResize: (screen: ShopScreen) => void, private readonly onEscape: () => void) {
    this.previousFocus = document.activeElement;
    this.screen = this.measure();
    const root = this.element;
    root.dataset.uiLayer = "dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", label);
    root.tabIndex = -1;
    const style = element("style");
    style.textContent = SHOP_STYLES + LOTTERY_STYLES;
    root.append(style, this.stage);
    root.addEventListener("keydown", this.onKeyDown);
    root.addEventListener("pointerover", event => {
      if (event.target instanceof Element && event.target.closest("button:not(:disabled)")) options.onHover?.();
    });
    root.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("button:not(:disabled)")) options.onActivate?.();
    }, true);
  }

  private measure(): ShopScreen {
    const { root } = this.options;
    return shopScreen(root.clientWidth || window.innerWidth, root.clientHeight || window.innerHeight);
  }

  /** Mounts the screen and starts following the viewport. */
  mount(): void {
    this.options.root.append(this.element);
    this.fit();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.options.root);
    } else {
      window.addEventListener("resize", this.fit);
    }
    this.element.focus({ preventScroll: true });
  }

  private fit = (): void => {
    const screen = this.measure();
    this.element.style.setProperty("--ks-shop-scale", String(screen.scale));
    this.element.style.setProperty("--ks-shop-w", `${screen.width}px`);
    const moved = screen.width !== this.screen.width;
    this.screen = screen;
    if (moved) this.onResize(screen);
  };

  /** Installs loaded art (CSS custom properties) on the screen. */
  applyArt(art: ShopArt): void {
    for (const [name, value] of art.properties) this.element.style.setProperty(name, value);
    this.element.dataset.art = String(art.properties.size);
  }

  /**
   * Escape closes the screen. A popup over it owns the keys once it shows
   * (trapPopupKeys: Escape closes only that popup); while one is still
   * loading Escape does nothing here.
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (!this.dialogOpen) this.onEscape();
  };

  /** The resource library for the game's windows. */
  library(): BmlLibrary | undefined {
    const library = this.options.library;
    return isLotteryLibrary(library) ? library as unknown as BmlLibrary : gameWindowLibrary();
  }

  /** A short notice in the release toast (BlackEdit) over the stage; it goes away by itself. */
  showNotice(message: string, ms = NOTICE_MS): void {
    if (this.disposed) return;
    showGameToast(message, ms, { root: this.options.root, library: this.library() });
  }

  /** A message box or a window is open (or opening) over the screen. */
  get dialogOpen(): boolean { return this.openPopups > 0; }

  /**
   * Runs a popup over the screen: the screen's Escape waits for it, the
   * screen closing closes it, and the focus comes back afterwards.
   */
  async popup<T>(open: (context: LotteryPopupContext) => Promise<T>, fallback: T): Promise<T> {
    const library = this.library();
    if (this.disposed || !library) return fallback;
    this.openPopups++;
    try {
      return await open({ library, root: this.options.root, signal: this.popupAbort.signal,
        ...(this.options.onActivate ? { onActivate: this.options.onActivate } : {}) });
    } catch (error) {
      console.warn("抽奖窗口打开失败", error);
      return fallback;
    } finally {
      this.openPopups--;
      if (!this.disposed && this.openPopups === 0) this.element.focus({ preventScroll: true });
    }
  }

  /** A question in the release message box (customMessageBox): ok / 取消. */
  confirm(title: string, message: string, ok = "确定"): Promise<boolean> {
    return this.popup(context => confirmGame(title, message, ok, "取消",
      { root: context.root, library: context.library, signal: context.signal }), false);
  }

  /**
   * The 兑换 window (lottery-windows): the original packs with their price;
   * 兑换 buys one at once and reports the items. Resolves true when
   * something was bought.
   */
  packs(packs: readonly LotteryPack[], pictures: LotteryPictures, onBought: () => void): Promise<boolean> {
    let repaint = () => {};
    const canvas = pictures.canvas(() => repaint());
    return this.popup(context => openPackWindow({
      ...context, packs, picture: canvas.picture, subscribe: render => { repaint = render; },
      wallet: () => this.options.session.summary()?.wallet,
      buy: async pack => {
        const bought = await this.buy(pack);
        if (bought) onBought();
        return bought;
      },
    }), false).finally(() => canvas.dispose());
  }

  private async buy(pack: LotteryPack): Promise<boolean> {
    const wallet = this.options.session.summary()?.wallet;
    if (!affordable(pack, wallet)) {
      this.showNotice(lotteryErrorMessage("INSUFFICIENT_FUNDS"));
      return false;
    }
    try {
      const result = await this.options.api.buyPack(pack);
      await this.options.session.refresh().catch(() => undefined);
      const got = result.items.filter(item => !item.owned).map(itemLine).join("、");
      this.showNotice(`兑换成功！获得 ${got || pack.name}`);
      return true;
    } catch (error) {
      this.showNotice(lotteryErrorMessage(error));
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.popupAbort.abort();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.fit);
    this.element.remove();
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected)
      this.previousFocus.focus({ preventScroll: true });
  }
}

/** A name label under a picture. */
export function nameLabel(text: string, top: number): HTMLElement {
  const label = element("div", "ks-lottery-name", text);
  label.style.top = `${top}px`;
  return label;
}

/** Frames a plain element with a monocoque frame, like the shop's toast. */
export { setFrame };
