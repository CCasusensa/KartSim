import { te } from "../generated/library.js";
import { node, nodeName, paintText, prepare, type BmlLibrary, type Node as BmlNode, type NodeState,
  type WindowView } from "../ui/bml-kit";
import { gameRoot, gameWindowLibrary, popupLayer, showGameMessage, trapPopupKeys,
  type PopupLayer } from "../ui/game-popups";
import { actionBindings, DEFAULT_KEY_MAP, keyboardActionsForCode } from "./action-bindings";
import type { KeyMap } from "./action-bindings";
import { DrivingAction } from "./driving-input";
import type { NitroSeamlessMode } from "./nitro-seamless";
import { TouchLayoutEditor } from "./touch-layout-editor";

const AUTO_FORWARD_KEY = "kartsim.auto-forward";
const NITRO_SEAMLESS_KEY = "kartsim.nitro-seamless";
const nitroModeNames: Record<NitroSeamlessMode, string> = {
  auto: "自动", manual: "手动", off: "关",
};
const nitroModes: NitroSeamlessMode[] = ["auto", "manual", "off"];

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const icons = {
  arrow: icon('<path d="M12 20V4m-7 7 7-7 7 7"/>'),
  drift: icon('<g transform="rotate(-18 12 10)"><path d="m6 10 2-6h8l2 6M5 10h14v6H5Zm2 6v2m10-2v2M8 13h1m6 0h1"/></g><path d="M6 20c-3 1 2 1 0 3m7-4c-3 1 2 2 0 3"/>'),
  booster: icon('<path d="M13 2c1 6-5 7-3 12 2-1 3-3 3-5 4 3 6 6 5 9a7 7 0 0 1-13-1c-1-5 3-7 3-10 1 1 1 2 1 3 3-2 4-5 4-8Z"/>'),
  overload: icon('<path d="m13 2-8 12h6l-1 8 9-13h-6l1-7Z"/>'),
  pause: icon('<path d="M8 5v14M16 5v14"/>'),
  reset: icon('<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>'),
};

const markup = `
      <button type="button" class="touch-sim" data-touch="menu" aria-label="打开模拟器菜单"
        aria-haspopup="dialog" aria-expanded="false">SIM</button>
      <div class="touch-menu-slot" data-touch="ghost-slot" hidden></div>
      <div class="touch-pad">
        <div class="touch-race-actions" role="group" aria-label="暂停和复位">
          <button type="button" data-drive="pause" data-action-name="暂停">${icons.pause}</button>
          <button type="button" data-drive="${DrivingAction.Reset}" data-action-name="复位">${icons.reset}</button>
        </div>
        <div class="touch-modifiers" role="group" aria-label="漂移、氮气和超负荷">
          <button type="button" data-drive="${DrivingAction.Drift}" data-action-name="漂移">${icons.drift}</button>
          <button type="button" data-drive="${DrivingAction.UseItemOrBooster}" data-action-name="氮气">${icons.booster}</button>
          <button type="button" data-drive="${DrivingAction.GaugeState}" data-action-name="释放超负荷" class="touch-overload">${icons.overload}</button>
        </div>
        <div class="touch-arrows" role="group" aria-label="方向键">
          <button type="button" data-drive="${DrivingAction.Forward}" data-action-name="前进" class="touch-up">${icons.arrow}<span class="touch-auto-forward" aria-hidden="true">AUTO</span></button>
          <button type="button" data-drive="${DrivingAction.SteerLeft}" data-action-name="左转" class="touch-left">${icons.arrow}<span class="touch-dodge-key" aria-hidden="true" hidden>Z</span></button>
          <button type="button" data-drive="${DrivingAction.Reverse}" data-action-name="后退" class="touch-down">${icons.arrow}</button>
          <button type="button" data-drive="${DrivingAction.SteerRight}" data-action-name="右转" class="touch-right">${icons.arrow}<span class="touch-dodge-key" aria-hidden="true" hidden>X</span></button>
        </div>
      </div>`;

export interface TouchDrivingControlsOptions {
  keyLabel(scanCode: number | undefined): string;
  /** The window library (defaults to the game's loaded resources). */
  library?(): BmlLibrary | undefined;
}

export function savedAutoForward(): boolean {
  try { return localStorage.getItem(AUTO_FORWARD_KEY) === "true"; }
  catch { return false; }
}

export function savedNitroSeamlessMode(): NitroSeamlessMode {
  try {
    const value = localStorage.getItem(NITRO_SEAMLESS_KEY);
    return value === "auto" || value === "manual" || value === "off" ? value : "off";
  } catch { return "off"; }
}

type ButtonAction = number | "pause";

/** One TextButton of the SIM menu. */
export interface TouchMenuEntry {
  name: string;
  text: string;
  action(): void;
}

/**
 * A group of buttons another module adds to the SIM menu (the Ghost
 * tools): it appends an element to `ghostMenuSlot` and registers it here.
 */
export interface TouchMenuSection {
  readonly title: string;
  readonly hint?: string;
  menuEntries(): TouchMenuEntry[];
}

const menuSections = new WeakMap<object, TouchMenuSection>();

/** Shows `section` in the SIM menu while `element` is in its slot. */
export function registerTouchMenuSection(element: object, section: TouchMenuSection): void {
  menuSections.set(element, section);
}

export interface TouchMenuGroup {
  title: string;
  entries: ReadonlyArray<{ name: string }>;
  hint?: string;
}

const MENU_ROOTS = ["stage_/common"];
const MENU_TEXT = "rgb(42,55,80)";
const MENU_ERROR = "rgb(205,45,35)";
/**
 * SIM menu sizes in 1600×900 stage units: touch-sized buttons, three a
 * row (90 units stay about 40 px tall on a phone, where the stage is
 * scaled to ~0.43).
 */
export const SIM_MENU = {
  columns: 3,
  button: { width: 290, height: 90, gap: 14 },
  pad: 12,
  hint: 46,
  status: 28,
  close: { width: 260, height: 80 },
} as const;

/** A menu entry's TextButton name. */
export const menuEntryNode = (name: string): string => `menu:${name}`;

/**
 * The SIM menu tree, after the release race menu (stage_/speedIndiGame
 * retryPopup_2btn / _3btn: a fullscreen Panel color "100 0 0 0" under a
 * CaptionWindow frame="CaptionDialog"). Each group is a CaptionWindowGrey
 * (its title a label in the grey caption bar, as in the 资源下载 window)
 * with touch-sized TextButtons three a row and an optional hint line;
 * under the groups a status line, the HSection divider and 返回 in the
 * blue DefaultFocusedButton face.
 */
export function simMenuDefinition(groups: readonly TouchMenuGroup[]): BmlNode {
  const { columns, button, pad, close } = SIM_MENU;
  const grid = columns * button.width + (columns - 1) * button.gap;
  // CaptionWindowGrey: a 26 caption bar, 6 at the sides and the bottom.
  const groupWidth = grid + pad * 2 + 12;
  // CaptionDialog: 18 at the sides, a 41 caption and a 13 bottom.
  const width = groupWidth + 36 + 24;
  const children: BmlNode[] = [];
  let y = 10;
  groups.forEach((group, index) => {
    const rows = Math.max(1, Math.ceil(group.entries.length / columns));
    const buttons = rows * button.height + (rows - 1) * button.gap;
    const body = pad * 2 + buttons + (group.hint ? SIM_MENU.hint : 0);
    const height = 26 + body + 6;
    children.push(node("CaptionWindow", { name: `menuGroup${index}`, frame: "CaptionWindowGrey",
      windowSize: `${groupWidth} ${height}`, align: "hcenter", adjust: `0 ${y}` }, [
      node("Label", { name: `menuGroupTitle${index}`, windowSize: `${groupWidth - 24} 26`, adjust: "8 -26",
        textRender: "bold18", textColor: "white", textAlign: "left|vcenter", text: group.title }),
      ...group.entries.map((entry, cell) => node("TextButton", { name: menuEntryNode(entry.name),
        leftTopWH: `${pad + (cell % columns) * (button.width + button.gap)} ${
          pad + Math.floor(cell / columns) * (button.height + button.gap)} ${button.width} ${button.height}`,
        textRender: "bold26" })),
      ...group.hint ? [node("Label", { name: `menuGroupHint${index}`,
        leftTopWH: `${pad} ${pad + buttons + 4} ${grid} ${SIM_MENU.hint - 4}` })] : [],
    ]));
    y += height + 10;
  });
  children.push(node("Label", { name: "menuStatus", windowSize: `${grid} ${SIM_MENU.status}`, align: "hcenter",
    adjust: `0 ${y}` }));
  y += SIM_MENU.status;
  const strip = close.height + 28;
  children.push(
    node("Window", { leftTopWH: `0 0 ${width - 60} 1`, frame: "HSection", align: "hcenter;bottom",
      adjust: `0 ${strip}` }),
    node("TextButton", { name: "menuClose", leftTopWH: `0 0 ${close.width} ${close.height}`,
      align: "hcenter;bottom", adjust: "0 14", textRender: "bold26", frame: "DefaultFocusedButton" }),
  );
  const height = 41 + y + 6 + strip + 13;
  return node("Panel", { windowRect: "fullscreen", color: "100 0 0 0", alphaBlend: "true" }, [
    node("CaptionWindow", { name: "simMenu", frame: "CaptionDialog", caption: "模拟器菜单", captionPos: "0 1",
      windowRect: `0 0 ${width} ${height}`, align: "center", textRender: "bold" }, children),
  ]);
}

/** Touch gamepad, menu, accessibility labels, and auto forward arbitration. */
export class TouchDrivingControls {
  readonly element = document.createElement("section");
  readonly buttons = new Map<ButtonAction, HTMLButtonElement>();
  readonly pointers = new Map<number, ButtonAction>();
  readonly touchPointers = new Set<number>();
  readonly listeners = new AbortController();
  readonly coarsePointer = window.matchMedia("(pointer: coarse)");
  readonly menuButton: HTMLButtonElement;
  readonly pad: HTMLElement;
  readonly layout: TouchLayoutEditor;
  /** Hidden holder for the menu sections' elements (the Ghost tools and their file input). */
  readonly ghostMenuSlot: HTMLElement;
  touchCapable = navigator.maxTouchPoints > 0;
  usingTouch = this.touchCapable && this.coarsePointer.matches;
  usingGamepad = false;
  manualVisible: boolean | undefined;
  available = false;
  paused = false;
  lteDodge = false;
  autoForward = savedAutoForward();
  nitroSeamless = savedNitroSeamlessMode();
  autoForwardAllowed = false;
  autoForwardSuspended = document.hidden;
  keyMap: KeyMap = DEFAULT_KEY_MAP;
  /** The SIM menu is up (also while its 调整按键 editor is). */
  menuOpen = false;
  autoForwardMessage = "";
  nitroSeamlessMessage = "";
  /** The 全屏 help ("添加到主屏幕"), shown in a release message box over the menu. */
  screenHelpMessage = "";
  screenHelpOpen = false;
  screenHelpClose: AbortController | undefined;
  menuView: WindowView | undefined;
  menuLayer: PopupLayer | undefined;
  menuKey = "";
  menuGeneration = 0;
  menuGroups: TouchMenuGroup[] = [];
  menuItems = new Map<string, TouchMenuEntry>();
  releaseMenuKeys: (() => void) | undefined;

  constructor(
    readonly root: HTMLElement,
    readonly onAction: (action: number, down: boolean) => void,
    readonly onPause: () => void,
    readonly onAutoForwardChange: (allowed: boolean) => void = () => {},
    readonly onNitroSeamlessChange: (mode: NitroSeamlessMode) => void = () => {},
    readonly options: TouchDrivingControlsOptions = { keyLabel: () => "" },
  ) {
    this.element.className = "touch-controls";
    this.element.dataset.uiLayer = "controls";
    this.element.setAttribute("aria-label", "触屏驾驶");
    this.element.innerHTML = markup;
    this.menuButton = this.element.querySelector("[data-touch='menu']")!;
    this.pad = this.element.querySelector(".touch-pad")!;
    this.ghostMenuSlot = this.element.querySelector("[data-touch='ghost-slot']")!;
    this.element.querySelectorAll<HTMLButtonElement>("[data-drive]")
      .forEach(button => this.bindButton(button));
    this.setKeyMap(this.keyMap);
    this.menuButton.dataset.actionName = "SIM 菜单";
    const layoutButtons = new Map<ButtonAction | "menu", HTMLButtonElement>(this.buttons);
    layoutButtons.set("menu", this.menuButton);
    this.layout = new TouchLayoutEditor(this.element, this.pad, layoutButtons,
      () => this.refresh(), { library: () => this.windowLibrary(), stage: () => this.stage() });
    const events = { signal: this.listeners.signal };
    this.menuButton.addEventListener("click", () => {
      if (!this.layout.isEditing) this.openMenu();
    }, events);
    this.element.addEventListener("contextmenu", event => event.preventDefault(), events);
    this.element.addEventListener("selectstart", event => event.preventDefault(), events);
    this.pad.addEventListener("touchstart", event => event.preventDefault(),
      { ...events, passive: false });
    document.addEventListener("touchend", this.onTouchEnd, events);
    document.addEventListener("touchcancel", this.onTouchEnd, events);
    root.addEventListener("pointerdown", this.onTouch, events);
    window.addEventListener("keydown", this.onKeyDown, events);
    window.addEventListener("blur", this.releaseAll, events);
    document.addEventListener("visibilitychange", this.onVisibilityChange, events);
    document.addEventListener("fullscreenchange", this.onFullscreenChange, events);
    this.coarsePointer.addEventListener("change", this.onPointerChange, events);
    root.ownerDocument.body.append(this.element);
    this.refresh();
  }

  windowLibrary(): BmlLibrary | undefined {
    return this.options.library ? this.options.library() : gameWindowLibrary();
  }

  /** The game area the windows' 1600×900 stage covers. */
  stage(): HTMLElement {
    return gameRoot(this.root.ownerDocument);
  }

  /** Opens the SIM menu (the SIM key). */
  openMenu(): void {
    if (this.menuOpen || this.layout.isEditing) return;
    this.menuOpen = true;
    this.refresh();
  }

  /** Closes the SIM menu, its 全屏 help and an unsaved key layout. */
  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.layout.cancel();
    this.closeScreenHelp();
    this.closeMenuWindow();
    this.refresh();
  }

  /** The menu's buttons in the release dialog's order; hidden ones are left out. */
  menuEntries(): TouchMenuEntry[] {
    const visible = this.manualVisible ?? this.usingTouch;
    const entries: TouchMenuEntry[] = [];
    if (this.available)
      entries.push({ name: "toggle", text: visible ? "隐藏按键" : "显示按键", action: this.onToggle });
    entries.push(
      { name: "auto-forward", text: `自动前进：${this.autoForward ? "开" : "关"}`,
        action: this.onAutoForwardToggle },
      { name: "nitro-seamless", text: `氮气无缝：${nitroModeNames[this.nitroSeamless]}`,
        action: this.onNitroSeamlessToggle },
    );
    if (this.available)
      entries.push({ name: "pause", text: this.paused ? "继续" : "暂停", action: this.onPauseClick });
    if (this.screenEntryVisible())
      entries.push({ name: "screen", text: document.fullscreenElement ? "退出全屏" : "全屏",
        action: () => void this.onScreen() });
    entries.push({ name: "layout", text: "调整按键", action: () => this.layout.start() });
    return entries;
  }

  /** The registered sections whose elements are in the slot (the Ghost tools). */
  menuSections(): TouchMenuSection[] {
    return [...this.ghostMenuSlot.children ?? []].flatMap(child => {
      const section = menuSections.get(child);
      return section ? [section] : [];
    });
  }

  /** The menu's groups: 驾驶设置, then each registered section. */
  currentMenuGroups(): TouchMenuGroup[] {
    const groups: TouchMenuGroup[] = [{ title: "驾驶设置", entries: this.menuEntries() }];
    for (const section of this.menuSections())
      groups.push({ title: section.title, entries: section.menuEntries(), hint: section.hint });
    return groups;
  }

  /** A menu node's state for the window renderer. */
  menuNodeState(entry: BmlNode): NodeState {
    const name = nodeName(entry);
    if (name === "simMenu") return { text: "模拟器菜单" };
    if (name === "menuClose") return { text: "返回", label: "返回", action: () => this.closeMenu() };
    if (name === "menuStatus") {
      const status = [this.autoForwardMessage, this.nitroSeamlessMessage].filter(Boolean).join("　");
      return paintText(status, { size: 18, bold: true, color: MENU_ERROR, align: "center", middle: true });
    }
    const hint = /^menuGroupHint(\d+)$/.exec(name);
    if (hint) return paintText(this.menuGroups[Number(hint[1])]?.hint ?? "", { size: 18, color: MENU_TEXT,
      align: "center", middle: true, lineGap: 6 });
    if (name.startsWith("menu:")) {
      const item = this.menuItems.get(name.slice(5));
      if (!item) return { visible: false };
      return { text: item.text, label: item.text, action: () => {
        item.action();
        this.refresh();
      } };
    }
    return {};
  }

  /**
   * Keeps the window in step with the menu: built for its buttons (rebuilt
   * when they change), hidden while the 调整按键 editor is up.
   */
  syncMenuWindow(): void {
    if (!this.menuOpen) {
      this.closeMenuWindow();
      return;
    }
    const groups = this.currentMenuGroups();
    this.menuGroups = groups;
    this.menuItems = new Map(groups.flatMap(group => group.entries)
      .map(entry => [entry.name, entry as TouchMenuEntry]));
    const editing = this.layout.isEditing;
    if (this.menuLayer) this.menuLayer.element.parentElement!.hidden = editing;
    // The editor is not modal: while it is up the menu gives the keyboard back.
    if (editing) this.releaseMenuTrap();
    else this.trapMenuKeys();
    const key = groups.map(group => `${group.title}:${group.entries.map(entry => entry.name).join(",")}:${
      group.hint ?? ""}`).join("|");
    if (key === this.menuKey) {
      this.menuView?.render();
      return;
    }
    this.menuKey = key;
    const library = this.windowLibrary();
    if (!library) return;
    const generation = ++this.menuGeneration;
    this.menuLayer ??= popupLayer(this.stage());
    const layer = this.menuLayer;
    void (te.load({
      library, root: layer.element, definition: prepare(library, simMenuDefinition(groups), MENU_ROOTS),
      roots: MENU_ROOTS, smoothImages: true, modal: true, label: "模拟器菜单",
      onCancel: () => this.closeMenu(),
      state: (entry: BmlNode) => this.menuNodeState(entry),
    } as never) as Promise<WindowView>).then(view => {
      if (generation !== this.menuGeneration || !this.menuOpen) {
        view.dispose();
        return;
      }
      const previous = this.menuView;
      this.releaseMenuTrap();
      this.menuView = view;
      view.show();
      previous?.dispose();
      if (this.layout.isEditing) return;
      this.trapMenuKeys();
      // Keyboard focus starts on 返回, the dialog's default button.
      view.focus("menuClose");
    }).catch(error => {
      if (generation === this.menuGeneration) this.menuKey = "";
      console.warn("模拟器菜单打开失败", error);
    });
  }

  closeMenuWindow(): void {
    this.menuGeneration++;
    this.menuKey = "";
    this.releaseMenuTrap();
    this.menuView?.dispose();
    this.menuView = undefined;
    this.menuLayer?.dispose();
    this.menuLayer = undefined;
  }

  /** While the menu is up it owns the keyboard (Escape closes it). */
  trapMenuKeys(): void {
    if (this.releaseMenuKeys || !this.menuView) return;
    this.releaseMenuKeys = trapPopupKeys(this.menuView.element, { cancel: () => this.closeMenu() });
  }

  releaseMenuTrap(): void {
    this.releaseMenuKeys?.();
    this.releaseMenuKeys = undefined;
  }

  setRaceState(available: boolean, paused: boolean, lteDodge = false): void {
    if (this.available === available && this.paused === paused &&
        this.lteDodge === lteDodge) return;
    if (this.lteDodge !== lteDodge) {
      for (const [pointer, action] of [...this.pointers]) {
        if (action === DrivingAction.SteerLeft || action === DrivingAction.SteerRight)
          this.releasePointer(pointer);
      }
      this.lteDodge = lteDodge;
      this.setKeyMap(this.keyMap);
    }
    this.available = available;
    this.paused = paused;
    this.refresh();
  }

  setKeyMap(keyMap: KeyMap): void {
    this.keyMap = keyMap;
    for (const [action, button] of this.buttons) {
      const labels = actionBindings
        .filter(binding => binding.action === action)
        .filter(({ index }) => !this.lteDodge ||
          (keyMap[index] !== 44 && keyMap[index] !== 45))
        .map(({ index }) => this.options.keyLabel(keyMap[index]))
        .filter(Boolean);
      const steering = action === DrivingAction.SteerLeft ||
        action === DrivingAction.SteerRight;
      if (steering) {
        button.dataset.actionName = this.lteDodge
          ? action === DrivingAction.SteerLeft ? "左躲闪" : "右躲闪"
          : action === DrivingAction.SteerLeft ? "左转" : "右转";
        button.querySelector<HTMLElement>(".touch-dodge-key")!.hidden = !this.lteDodge;
      }
      const label = this.lteDodge && steering
        ? action === DrivingAction.SteerLeft ? "Z" : "X"
        : action === "pause" ? "Esc" : [...new Set(labels)].join(" / ");
      const name = button.dataset.actionName;
      button.title = label ? `${name}（${label}）` : name ?? "";
      button.setAttribute("aria-label", button.title);
    }
  }

  getNitroSeamlessMode(): NitroSeamlessMode { return this.nitroSeamless; }

  setAutoForwardActive(active: boolean): void {
    const forward = this.buttons.get(DrivingAction.Forward)!;
    if (forward.classList.contains("is-auto-forward") === active) return;
    forward.classList.toggle("is-auto-forward", active);
    if (active) forward.setAttribute("aria-description", "自动前进中");
    else forward.removeAttribute("aria-description");
  }

  resumeAutoForwardForGamepad(): void {
    if (!this.autoForward || !this.available || this.paused || this.menuOpen ||
        this.layout.isEditing) return;
    this.usingGamepad = true;
    this.autoForwardSuspended = false;
    this.refreshAutoForward(this.manualVisible ?? this.usingTouch);
  }

  releaseAll = (): void => {
    this.suspendAutoForward();
    for (const pointer of [...this.pointers.keys()]) this.releasePointer(pointer);
  };

  dispose(): void {
    this.releaseAll();
    this.listeners.abort();
    this.layout.dispose();
    this.closeMenu();
    this.closeMenuWindow();
    this.element.remove();
  }

  bindButton(button: HTMLButtonElement): void {
    const action: ButtonAction = button.dataset.drive === "pause"
      ? "pause" : Number(button.dataset.drive);
    this.buttons.set(action, button);
    button.setAttribute("aria-pressed", "false");
    const events = { signal: this.listeners.signal };
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.pad.hidden || this.layout.isEditing) return;
      event.preventDefault();
      this.useVirtualInput();
      button.setPointerCapture(event.pointerId);
      const alreadyPressed = [...this.pointers.values()].includes(action);
      this.pointers.set(event.pointerId, action);
      if (event.pointerType === "touch") this.touchPointers.add(event.pointerId);
      if (!alreadyPressed) {
        button.setAttribute("aria-pressed", "true");
        this.dispatchAction(action, true);
      }
    }, events);
    const release = (event: PointerEvent): void => this.releasePointer(event.pointerId);
    button.addEventListener("pointerup", release, events);
    button.addEventListener("pointercancel", release, events);
    button.addEventListener("lostpointercapture", release, events);
  }

  releasePointer(pointer: number): void {
    const action = this.pointers.get(pointer);
    if (action === undefined) return;
    this.pointers.delete(pointer);
    this.touchPointers.delete(pointer);
    const button = this.buttons.get(action)!;
    if (button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
    if (![...this.pointers.values()].includes(action)) {
      button.setAttribute("aria-pressed", "false");
      this.dispatchAction(action, false);
    }
  }

  dispatchAction(action: ButtonAction, down: boolean): void {
    if (action === "pause") {
      if (down) this.onPause();
      return;
    }
    const dispatched = this.lteDodge
      ? action === DrivingAction.SteerLeft ? DrivingAction.ModeImpulsePositive
      : action === DrivingAction.SteerRight ? DrivingAction.ModeImpulseNegative
      : action
      : action;
    this.onAction(dispatched, down);
  }

  onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length === 0)
      for (const pointer of this.touchPointers) this.releasePointer(pointer);
  };

  refresh(): void {
    this.element.hidden = !this.touchCapable;
    const visible = this.manualVisible ?? this.usingTouch;
    this.refreshPad(visible);
    this.refreshAutoForward(visible);
    this.menuButton.setAttribute("aria-expanded", String(this.menuOpen));
    this.syncMenuWindow();
  }

  refreshPad(visible: boolean): void {
    this.pad.hidden = !(this.layout.isEditing || this.drivingPadVisible(visible));
    if (this.pad.hidden) this.releaseAll();
  }

  drivingPadVisible(visible: boolean): boolean {
    return this.touchCapable && this.available && !this.paused &&
      visible && !this.menuOpen;
  }

  refreshAutoForward(visible: boolean): void {
    const touchDriving = this.usingTouch && this.drivingPadVisible(visible);
    const gamepadDriving = this.usingGamepad && this.available &&
      !this.paused && !this.menuOpen;
    this.setAutoForwardAllowed(this.autoForward &&
      !this.autoForwardSuspended && !this.layout.isEditing &&
      (touchDriving || gamepadDriving));
  }

  setAutoForwardAllowed(allowed: boolean): void {
    if (this.autoForwardAllowed === allowed) return;
    this.autoForwardAllowed = allowed;
    if (!allowed) this.setAutoForwardActive(false);
    this.onAutoForwardChange(allowed);
  }

  suspendAutoForward(): void {
    this.autoForwardSuspended = true;
    this.setAutoForwardAllowed(false);
  }

  useVirtualInput(): void {
    this.usingGamepad = false;
    this.usingTouch = true;
    this.autoForwardSuspended = false;
    this.refresh();
  }

  onAutoForwardToggle = (): void => {
    this.autoForward = !this.autoForward;
    this.autoForwardMessage = "";
    try { localStorage.setItem(AUTO_FORWARD_KEY, String(this.autoForward)); }
    catch { this.autoForwardMessage = "自动前进设置未保存，仅本次有效。"; }
    this.refresh();
  };

  onNitroSeamlessToggle = (): void => {
    const index = nitroModes.indexOf(this.nitroSeamless);
    this.nitroSeamless = nitroModes[(index + 1) % nitroModes.length]!;
    this.nitroSeamlessMessage = "";
    try { localStorage.setItem(NITRO_SEAMLESS_KEY, this.nitroSeamless); }
    catch { this.nitroSeamlessMessage = "氮气无缝设置未保存，仅本次有效。"; }
    this.onNitroSeamlessChange(this.nitroSeamless);
    this.refresh();
  };

  /** 暂停 / 继续 closes the menu first, as the release dialog did. */
  onPauseClick = (): void => {
    this.closeMenu();
    this.onPause();
  };

  onScreen = async (): Promise<void> => {
    this.closeScreenHelp();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled)
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      else this.showScreenHelp("当前浏览器不支持页面全屏。");
    } catch {
      this.showScreenHelp("浏览器未允许切换全屏。");
    }
  };

  /**
   * The 全屏 help ("添加到主屏幕") in the release message box
   * (dialog2_customMessageBox) over the menu; 关闭说明 closes it and leaves
   * the menu up.
   */
  showScreenHelp(message: string): void {
    this.screenHelpMessage =
      `${message}可通过浏览器的分享或菜单选择“添加到主屏幕”或“安装应用”，再从图标打开。若有“作为网页 App 打开”选项，请开启。`;
    this.closeScreenHelp();
    const library = this.windowLibrary();
    if (!library) return;
    const close = new AbortController();
    this.screenHelpClose = close;
    this.screenHelpOpen = true;
    void showGameMessage("全屏", this.screenHelpMessage, { yes: "关闭说明", signal: close.signal, library,
      root: this.stage() }).catch(error => console.warn("全屏说明打开失败", error)).finally(() => {
      if (this.screenHelpClose !== close) return;
      this.screenHelpClose = undefined;
      this.screenHelpOpen = false;
      if (this.menuOpen && !this.layout.isEditing) this.menuView?.focus("menuClose");
    });
  }

  closeScreenHelp(): void {
    const close = this.screenHelpClose;
    this.screenHelpClose = undefined;
    this.screenHelpOpen = false;
    close?.abort();
  }

  /** 全屏 is left out of the menu in an installed app (unless it is full screen). */
  screenEntryVisible(): boolean {
    const fullscreen = !!document.fullscreenElement;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    return fullscreen || !(standalone ||
      window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches);
  }

  onFullscreenChange = (): void => {
    this.syncMenuWindow();
  };

  onToggle = (): void => {
    this.manualVisible = !(this.manualVisible ?? this.usingTouch);
    this.closeMenu();
    this.refresh();
  };

  onTouch = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.element.contains(event.target as Node)) return;
    this.touchCapable = true;
    this.useVirtualInput();
  };

  onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || keyboardActionsForCode(event.code, this.keyMap).length === 0 ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input, textarea, select, [contenteditable]"))) return;
    this.usingGamepad = false;
    this.usingTouch = false;
    this.suspendAutoForward();
    this.refresh();
  };

  onPointerChange = (): void => {
    this.usingTouch = this.touchCapable && this.coarsePointer.matches;
    this.refresh();
  };

  onVisibilityChange = (): void => {
    if (document.hidden) this.releaseAll();
  };
}
