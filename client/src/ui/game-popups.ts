import { T } from "../generated/formats.js";
import { _w, h2, te } from "../generated/library.js";
import { currentResourceManager } from "../resources/resource-manager";
import { bmlColor } from "./messenger-art";
import { clipToStage, FONT, node, nodeName, paintText, prepare, wrapText, type BmlLibrary, type Node,
  type NodeState, type Rect } from "./bml-kit";

/**
 * The game's own popups for any screen (account flow, lobby, races,
 * shop, editor): the release message box (dialog2_customMessageBox
 * mq_dialog@zz) for notices and questions, the same box without buttons
 * for a blocking status line, an input box (CaptionDialog + DefaultEdit),
 * and notice plates in the release BlackEdit frame (the shop's toast): a
 * banner that stays and a toast that goes away by itself. They draw with
 * the release window renderer in their own layer over the game area, so
 * they also show over the startup loading screen (z-index 7) and
 * full-screen pages; a modal one owns the keyboard (trapPopupKeys).
 */

interface PopupView {
  readonly element: HTMLElement;
  render(): void;
  show(): void;
  focus(name?: string): void;
  dispose(): void;
  wrapLabel(text: string, width: number, size: number): { lines: string[]; lineHeight: number };
  paintLabelLines(context: CanvasRenderingContext2D, lines: string[],
    rectangle: { y: number; [field: string]: unknown }, size: number, color: string, lineHeight: number): void;
}

interface MessageTemplate {
  definition: Node;
  nodes: { dialog: Node; icon: Node; message: Node; divider: Node; buttonGroup: Node; affirmative: Node; negative: Node };
}

const ROOTS = ["stage_/common"];
const TEXT = "rgb(42,55,80)";

/** The resource library the windows read, once startup has loaded it. */
export function gameWindowLibrary(): BmlLibrary | undefined {
  const library = currentResourceManager()?.library as Partial<BmlLibrary> | undefined;
  return typeof library?.canonicalCandidates === "function" ? library as BmlLibrary : undefined;
}

/** The game area (#app): the release windows take it as their 1600×900 stage. */
export function gameRoot(document: Document = globalThis.document): HTMLElement {
  return document.querySelector<HTMLElement>("#app") ?? document.body;
}

export interface PopupLayer { element: HTMLElement; dispose(): void }

/**
 * A layer over everything whose stage covers exactly the game area. A
 * modal layer takes the whole page's pointer events (dimmed when `dim`);
 * a notice layer lets them through.
 */
export function popupLayer(root: HTMLElement, options: { dim?: boolean; modal?: boolean; zIndex?: number } = {}):
  PopupLayer {
  const doc = root.ownerDocument;
  const layer = doc.createElement("div");
  layer.dataset.uiLayer = options.modal === false ? "notice" : "popup";
  Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: String(options.zIndex ?? 10_000),
    background: options.dim ? "rgba(0,0,0,.45)" : "transparent",
    pointerEvents: options.modal === false ? "none" : "auto" });
  const element = doc.createElement("div");
  element.style.position = "absolute";
  layer.append(element);
  const place = () => {
    const rect = root === doc.body ? { left: 0, top: 0, width: doc.defaultView?.innerWidth ?? 1600,
      height: doc.defaultView?.innerHeight ?? 900 } : root.getBoundingClientRect();
    Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      height: `${rect.height}px` });
  };
  place();
  const view = doc.defaultView;
  view?.addEventListener("resize", place);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : undefined;
  observer?.observe(root);
  doc.body.append(layer);
  return { element, dispose: () => {
    view?.removeEventListener("resize", place);
    observer?.disconnect();
    layer.remove();
  } };
}

interface PopupKeys { element: HTMLElement; cancel?(): void; confirm?(): void }

/** Open modal popups, newest last: the newest one owns the keyboard. */
const keyStack: PopupKeys[] = [];

/**
 * While a popup is up no key reaches the screens under it (driving, city
 * and lobby hotkeys, the shop's and My Room's capture listeners): Escape
 * cancels the newest popup, Enter confirms it, Tab cycles its controls,
 * and other keys only do their default (typing in its field, pressing its
 * focused button). Installed when this module loads, at startup, so it runs
 * before the pages add their own window listeners.
 */
function guardKeys(event: KeyboardEvent): void {
  const top = keyStack.at(-1);
  if (!top) return;
  event.stopImmediatePropagation();
  if (event.type !== "keydown" || event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    top.cancel?.();
  } else if (event.key === "Enter" && top.confirm && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    top.confirm();
  } else if (event.key === "Tab") {
    event.preventDefault();
    const controls = [...top.element.querySelectorAll<HTMLElement>("input,button")]
      .filter(control => !control.hidden && !(control as HTMLButtonElement).disabled);
    if (!controls.length) return;
    const index = controls.indexOf(top.element.ownerDocument.activeElement as HTMLElement);
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]!.focus();
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function")
  for (const type of ["keydown", "keyup", "keypress"] as const) window.addEventListener(type, guardKeys, true);

/**
 * Give a modal popup the keyboard until the returned release is called
 * (see guardKeys). `cancel` runs on Escape, `confirm` on Enter.
 */
export function trapPopupKeys(element: HTMLElement, handlers: { cancel?(): void; confirm?(): void } = {}): () => void {
  const entry: PopupKeys = { element, ...handlers };
  keyStack.push(entry);
  return () => {
    const index = keyStack.indexOf(entry);
    if (index >= 0) keyStack.splice(index, 1);
  };
}

export interface GameMessageOptions {
  /** Buttons: `yes` alone (default 确定) is a notice; with `no` it asks. */
  yes?: string;
  no?: string;
  /** Closes it (resolves false). */
  signal?: AbortSignal;
  root?: HTMLElement;
  library?: BmlLibrary;
  /** Dim the page under it (over the startup loading screen). */
  dim?: boolean;
}

/** A node's leftTopWH numbers. */
function rectOf(entry: Node): number[] {
  return ((T(entry, "leftTopWH") as string | undefined) ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
}

/**
 * The release message box with its info icon: resolves true for the first
 * button (or Enter), false for the second, Escape or an aborted signal (a
 * notice resolves true on Escape too). The text wraps like the release
 * ColorLabel ("|" and "\n" break lines) and the box grows a line at a time.
 */
export function showGameMessage(title: string, message: string, options: GameMessageOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const library = options.library ?? gameWindowLibrary();
    if (!library) {
      reject(new Error("游戏资源尚未加载，无法打开提示窗口。"));
      return;
    }
    const notice = options.no === undefined;
    let view: PopupView | undefined;
    let layer: PopupLayer | undefined;
    let releaseKeys: (() => void) | undefined;
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      releaseKeys?.();
      view?.dispose();
      layer?.dispose();
      resolve(answer);
    };
    if (options.signal?.aborted) {
      resolve(false);
      return;
    }
    options.signal?.addEventListener("abort", () => finish(false), { once: true });
    void (async () => {
      const template = await _w(library) as unknown as MessageTemplate;
      if (done) return;
      const { dialog: shell, icon, message: body, divider, buttonGroup, affirmative, negative } = template.nodes;
      const yes = h2(affirmative, { align: notice ? "center" : "left" }) as Node;
      const no = h2(negative, { align: "right" }) as Node;
      const size = Number(/\d+/.exec((T(body, "textRender") as string | undefined) ?? "")?.[0] ?? 16);
      const color = bmlColor(T(body, "textColor") as string | undefined, TEXT);
      const [, bodyY = 63, bodyWidth = 408, bodyHeight = 24] = rectOf(body);
      const [, , shellWidth = 464, shellHeight = 219] = rectOf(shell);
      layer = popupLayer(options.root ?? gameRoot(), { dim: options.dim });
      /** The box grows a line height for each line past the first, keeping the icon and the divider clear. */
      const open = (lines: number) => {
        const grow = (lines - 1) * bodyHeight;
        const text = h2(body, { leftTopWH: `0 ${bodyY} ${bodyWidth} ${bodyHeight + grow}` }) as Node;
        const visibleShell = h2(shell, { visible: "true", leftTopWH: `0 0 ${shellWidth} ${shellHeight + grow}` }, [
          icon, text, divider, { ...buttonGroup, children: notice ? [yes] : [yes, no] },
        ]) as Node;
        let opened: PopupView | undefined;
        return te.load({
          library, root: layer!.element, preserveDisplayPixels: true, smoothImages: true,
          definition: { ...template.definition, children: [visibleShell] },
          roots: ["dialog2_/customMessageBox", "stage_/common"],
          modal: true, label: title, onCancel: () => finish(notice),
          state: (entry: Node) => {
            if (entry === visibleShell) return { text: title };
            if (entry === text) return {
              visible: true, text: "",
              paint: (context: CanvasRenderingContext2D, rect: Rect) => {
                if (!opened) return;
                const { lines: wrapped, lineHeight } = opened.wrapLabel(message, rect.width, size);
                const step = Math.max(lineHeight + 4, bodyHeight);
                const top = rect.y + (rect.height - wrapped.length * step) / 2;
                opened.paintLabelLines(context, wrapped, { ...rect, y: top, height: step }, size, color, step);
              },
            };
            if (entry === yes) return { visible: true, label: options.yes ?? "确定", text: options.yes ?? "确定",
              action: () => finish(true) };
            if (entry === no) return { visible: true, label: options.no ?? "取消", text: options.no ?? "取消",
              action: () => finish(false) };
            return {};
          },
        } as never).then(loaded => opened = loaded as unknown as PopupView);
      };
      let loaded = await open(1);
      const lines = loaded.wrapLabel(message, bodyWidth, size).lines.length;
      if (lines > 1 && !done) {
        // Measured with the release font the first load brought in; the taller box replaces it unseen.
        const taller = await open(lines);
        loaded.dispose();
        loaded = taller;
      }
      view = loaded;
      if (done) {
        loaded.dispose();
        layer.dispose();
        return;
      }
      releaseKeys = trapPopupKeys(loaded.element, { cancel: () => finish(notice), confirm: () => finish(true) });
      loaded.render();
      loaded.show();
      loaded.focus();
    })().catch(error => {
      if (done) return;
      done = true;
      releaseKeys?.();
      view?.dispose();
      layer?.dispose();
      reject(error);
    });
  });
}

/** A question with two buttons; true for `yes`. */
export function confirmGame(title: string, message: string, yes = "确定", no = "取消",
  options: Omit<GameMessageOptions, "yes" | "no"> = {}): Promise<boolean> {
  return showGameMessage(title, message, { ...options, yes, no });
}

function statusDefinition(title: string): Node {
  return node("Panel", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "statusDialog", windowRect: "0 0 464 170", frame: "CaptionDialog", caption: title,
      captionPos: "0 1", align: "center", textRender: "bold" }, [
      node("Label", { name: "statusText", windowSize: "408 96", adjust: "0 16", align: "hcenter" }),
    ]),
  ]);
}

export interface GameStatus { close(): void; set(text: string): void }

/**
 * A blocking status line (正在连接…) in the message box frame without
 * buttons. Shown only when it lasts past `delayMs`, so quick steps do not
 * flash a window.
 */
export function showGameStatus(title: string, text: string, options: { root?: HTMLElement;
  library?: BmlLibrary; delayMs?: number; dim?: boolean } = {}): GameStatus {
  let message = text;
  let closed = false;
  let view: PopupView | undefined;
  let layer: PopupLayer | undefined;
  let releaseKeys: (() => void) | undefined;
  const timer = setTimeout(() => {
    const library = options.library ?? gameWindowLibrary();
    if (closed || !library) return;
    layer = popupLayer(options.root ?? gameRoot(), { dim: options.dim });
    void te.load({ library, root: layer.element, definition: prepare(library, statusDefinition(title), ROOTS),
      roots: ROOTS, smoothImages: true, modal: true, label: title,
      state: (entry: Node) => {
        switch (nodeName(entry)) {
          case "statusDialog": return { text: title };
          case "statusText": return paintText(message, { size: 16, bold: true, color: TEXT, align: "center",
            middle: true, lineGap: 6 });
        }
        return {};
      } } as never).then(loaded => {
      const opened = loaded as unknown as PopupView;
      if (closed) {
        opened.dispose();
        return;
      }
      view = opened;
      // Blocking: keys wait until it closes.
      releaseKeys = trapPopupKeys(opened.element);
      view.show();
    }).catch(error => console.warn("状态窗口打开失败", error));
  }, options.delayMs ?? 300);
  return {
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      releaseKeys?.();
      view?.dispose();
      layer?.dispose();
    },
    set: value => {
      message = value;
      view?.render();
    },
  };
}

export interface GamePromptOptions {
  value?: string;
  maxLength?: number;
  /** One or two lines over the field. */
  info?: string;
  ok?: string;
  cancel?: string;
  password?: boolean;
  root?: HTMLElement;
  library?: BmlLibrary;
  signal?: AbortSignal;
}

function promptDefinition(title: string, info: boolean): Node {
  const top = info ? 64 : 22;
  return node("Panel", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "promptDialog", windowRect: `0 0 464 ${top + 136}`, frame: "CaptionDialog",
      caption: title, captionPos: "0 1", align: "center", textRender: "bold" }, [
      ...info ? [node("Label", { name: "promptInfo", leftTopWH: "28 14 408 44" })] : [],
      node("Edit", { name: "promptEdit", leftTopWH: `52 ${top} 360 30`, frame: "DefaultEdit", textRender: "bold16" }),
      node("Window", { leftTopWH: "0 0 408 1", frame: "HSection", align: "hcenter;bottom", adjust: "0 63" }),
      node("TextButton", { name: "okButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "-70 6",
        textRender: "bold16" }),
      node("TextButton", { name: "cancelButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "70 6",
        textRender: "bold16" }),
    ]),
  ]);
}

/**
 * A line of text asked in the game's look (CaptionDialog, DefaultEdit,
 * 确定/取消); resolves the text, or undefined when cancelled.
 */
export function promptGame(title: string, options: GamePromptOptions = {}): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve, reject) => {
    const library = options.library ?? gameWindowLibrary();
    if (!library) {
      reject(new Error("游戏资源尚未加载，无法打开输入窗口。"));
      return;
    }
    let value = options.value ?? "";
    let view: PopupView | undefined;
    let layer: PopupLayer | undefined;
    let releaseKeys: (() => void) | undefined;
    let done = false;
    const finish = (answer: string | undefined) => {
      if (done) return;
      done = true;
      releaseKeys?.();
      view?.dispose();
      layer?.dispose();
      resolve(answer);
    };
    if (options.signal?.aborted) {
      resolve(undefined);
      return;
    }
    options.signal?.addEventListener("abort", () => finish(undefined), { once: true });
    const submit = () => finish(value);
    void (async () => {
      layer = popupLayer(options.root ?? gameRoot());
      const loaded = await te.load({
        library, root: layer.element, definition: prepare(library, promptDefinition(title, !!options.info), ROOTS),
        roots: ROOTS, smoothImages: true, modal: true, label: title, onCancel: () => finish(undefined),
        onConfirm: submit,
        state: (entry: Node): NodeState => {
          switch (nodeName(entry)) {
            case "promptDialog": return { text: title };
            case "promptInfo": return paintText(options.info ?? "", { size: 14, bold: true, color: TEXT,
              align: "center", middle: true, lineGap: 4 });
            case "promptEdit": return { label: title, input: { value, maxLength: options.maxLength ?? 64,
              password: options.password, submit, change: (next: string) => {
                value = next;
              } } };
            case "okButton": return { text: options.ok ?? "确定", label: options.ok ?? "确定", action: submit };
            case "cancelButton": return { text: options.cancel ?? "取消", label: options.cancel ?? "取消",
              action: () => finish(undefined) };
          }
          return {};
        },
      } as never) as unknown as PopupView;
      view = loaded;
      if (done) {
        loaded.dispose();
        layer.dispose();
        return;
      }
      releaseKeys = trapPopupKeys(loaded.element, { cancel: () => finish(undefined), confirm: submit });
      loaded.show();
      loaded.focus("promptEdit");
    })().catch(error => {
      if (done) return;
      done = true;
      releaseKeys?.();
      view?.dispose();
      layer?.dispose();
      reject(error);
    });
  });
}

const BANNER = { width: 640, top: 120, padX: 34, line: 26, padY: 18, size: 18 };

/** Lines the banner text takes at its width (measured with the window font when a canvas is at hand). */
function bannerLines(message: string): number {
  const width = BANNER.width - BANNER.padX * 2;
  const context = typeof document === "undefined" ? undefined : document.createElement("canvas").getContext("2d");
  if (!context) return Math.max(1, message.split(/\n|\|/).length);
  context.font = `bold ${BANNER.size}px ${FONT}`;
  return Math.max(1, wrapText(context, message, width).length);
}

export interface GameBanner {
  /** Change the text (the plate grows or shrinks with it). */
  set(message: string): void;
  close(): void;
}

/**
 * A notice plate in the release BlackEdit frame (the shop's toast), centred
 * near the top of the game area, that stays until closed; it never takes
 * the pointer. Without loaded resources it only logs the text.
 */
export function showGameBanner(message: string, options: { root?: HTMLElement; library?: BmlLibrary;
  top?: number } = {}): GameBanner {
  const library = options.library ?? gameWindowLibrary();
  let text = message;
  if (!library) {
    console.info(message);
    return { set: value => { if (value !== text) console.info(text = value); }, close: () => {} };
  }
  const layer = popupLayer(options.root ?? gameRoot(), { modal: false, zIndex: 10_001 });
  let view: PopupView | undefined;
  let lines = 0;
  let closed = false;
  let building = Promise.resolve();
  const build = () => building = building.then(async () => {
    if (closed) return;
    lines = bannerLines(text);
    const height = BANNER.padY * 2 + lines * BANNER.line;
    const rect = { x: (1600 - BANNER.width) / 2, y: options.top ?? BANNER.top, width: BANNER.width, height };
    const definition = node("Panel", { windowRect: "fullscreen" }, [
      node("Window", { name: "banner", leftTopWH: `${rect.x} ${rect.y} ${rect.width} ${rect.height}`,
        frame: "BlackEdit" }, [
        node("Label", { name: "bannerText", leftTopWH: `${BANNER.padX} ${BANNER.padY - 4} ${
          BANNER.width - BANNER.padX * 2} ${height - BANNER.padY * 2 + 8}` }),
      ]),
    ]);
    const opened = await te.load({ library, root: layer.element, definition: prepare(library, definition, ROOTS),
      roots: ROOTS, smoothImages: true, label: text,
      state: (entry: Node) => nodeName(entry) === "bannerText"
        ? paintText(text, { size: BANNER.size, bold: true, color: "white", outline: true, align: "center",
          middle: true, lineGap: BANNER.line - BANNER.size })
        : {} } as never) as unknown as PopupView;
    if (closed) {
      opened.dispose();
      return;
    }
    opened.element.setAttribute("role", "status");
    opened.element.style.pointerEvents = "none";
    clipToStage(opened.element, [rect]);
    opened.show();
    view?.dispose();
    view = opened;
  }).catch(error => console.warn("提示窗口打开失败", error));
  void build();
  return {
    set: value => {
      if (closed || value === text) return;
      text = value;
      view?.element.setAttribute("aria-label", value);
      if (bannerLines(value) !== lines) void build();
      else view?.render();
    },
    close: () => {
      if (closed) return;
      closed = true;
      view?.dispose();
      layer.dispose();
    },
  };
}

/** One notice at a time: a newer one replaces it. */
let activeToast: GameBanner | undefined;

/**
 * A short notice (升级啦！, 已返回大厅, …): the banner that goes away by
 * itself after `durationMs`.
 */
export function showGameToast(message: string, durationMs = 3_000, options: { root?: HTMLElement;
  library?: BmlLibrary } = {}): void {
  activeToast?.close();
  const banner = showGameBanner(message, options);
  activeToast = banner;
  const timer = setTimeout(() => {
    banner.close();
    if (activeToast === banner) activeToast = undefined;
  }, durationMs);
  (timer as { unref?(): void }).unref?.();
}

/**
 * A message the player should see (请先登录, a window that failed to open,
 * a change not saved): a game notice, also kept in the HUD's debug log.
 */
export function tellPlayer(hud: { showDebugText(message: string, kind: string): void } | undefined, message: string,
  kind: "error" | "info" = "error"): void {
  hud?.showDebugText(message, kind);
  showGameToast(message, kind === "error" ? 5_000 : 3_000);
}
