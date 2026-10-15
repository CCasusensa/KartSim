import { te } from "../generated/library.js";
import { tr } from "../i18n/locale";
import { clipToStage, node, nodeName, paintText, prepare, type BmlLibrary, type Node as BmlNode,
  type NodeState, type WindowView } from "../ui/bml-kit";
import { gameRoot, gameWindowLibrary, popupLayer, type PopupLayer } from "../ui/game-popups";

export const TOUCH_LAYOUT_STORAGE_KEY = "kartsim.touch-layout";

export interface TouchButtonPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TouchButtonId = string | number;
export type TouchLayout = Record<string, TouchButtonPlacement>;

const arrowStep: Record<string, readonly [number, number]> = {
  ArrowLeft: [-4, 0],
  ArrowRight: [4, 0],
  ArrowUp: [0, -4],
  ArrowDown: [0, 4],
};

/** The drag handle that resizes the selected key (it follows the key's bottom-right corner). */
const resizeHandleMarkup = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 9V4h5M15 20h5v-5M4 4l6 6M20 20l-6-6"/>
      </svg>`;

const ROOTS = ["stage_/common"];
const TEXT = "rgb(42,55,80)";
const ERROR_TEXT = "rgb(205,45,35)";
/**
 * The 调整按键 panel in 1600×900 stage units, at the top centre (the keys
 * sit at the bottom corners and the SIM key at the top left).
 */
export const LAYOUT_PANEL = { x: 450, y: 90, width: 700, height: 262 } as const;
/** Touch-sized: 80 units stay about 35 px tall on a phone (stage scaled to ~0.43). */
const PANEL_BUTTON = { width: 200, height: 80, gap: 18 } as const;
export const LAYOUT_PANEL_HINT = "拖动按键调整位置，拖动按键右下角的方块调整大小。";

/**
 * The panel tree: a release CaptionDialog (gui_/monocoque frame.bml) with
 * a hint line, a status line, the HSection divider and touch-sized
 * TextButtons 保存 (the blue DefaultFocusedButton face) / 取消 / 恢复默认,
 * laid out like the release dialogs' button strip
 * (dialog2_customMessageBox).
 */
export function layoutPanelDefinition(): BmlNode {
  const { width, height, gap } = PANEL_BUTTON;
  const strip = width * 3 + gap * 2;
  const button = (name: string, index: number, frame?: string) => node("TextButton", {
    name, leftTopWH: `0 0 ${width} ${height}`, align: "hcenter;bottom",
    adjust: `${-strip / 2 + width / 2 + index * (width + gap)} 12`, textRender: "bold26",
    ...frame ? { frame } : {},
  });
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "layoutPanel", frame: "CaptionDialog", caption: tr("调整按键"), captionPos: "0 1",
      textRender: "bold",
      leftTopWH: `${LAYOUT_PANEL.x} ${LAYOUT_PANEL.y} ${LAYOUT_PANEL.width} ${LAYOUT_PANEL.height}` }, [
      node("Label", { name: "layoutHint", leftTopWH: `20 12 ${LAYOUT_PANEL.width - 76} 32` }),
      node("Label", { name: "layoutStatus", leftTopWH: `20 46 ${LAYOUT_PANEL.width - 76} 28` }),
      node("Window", { leftTopWH: `0 0 ${LAYOUT_PANEL.width - 60} 1`, frame: "HSection", align: "hcenter;bottom",
        adjust: `0 ${height + 24}` }),
      button("layoutSave", 0, "DefaultFocusedButton"),
      button("layoutCancel", 1),
      button("layoutReset", 2),
    ]),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= min && value <= max;
}

/** Accepts current width/height and the older single-size saved format. */
export function normalizeTouchPlacement(value: unknown): TouchButtonPlacement | undefined {
  if (!isRecord(value)) return;
  const placement = {
    x: value.x,
    y: value.y,
    width: value.width === undefined ? value.size : value.width,
    height: value.height === undefined ? value.size : value.height,
  };
  if (finiteWithin(placement.x, 0, 1) && finiteWithin(placement.y, 0, 1) &&
      finiteWithin(placement.width, 44, 144) &&
      finiteWithin(placement.height, 44, 144)) {
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    };
  }
}

/** Ignores unknown keys and malformed placements without discarding valid buttons. */
export function parseTouchLayout(raw: string, buttonIds: Iterable<TouchButtonId>): TouchLayout {
  try {
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored)) return {};
    const layout: TouchLayout = {};
    for (const id of buttonIds) {
      const placement = normalizeTouchPlacement(stored[id]);
      if (placement) layout[id] = placement;
    }
    return layout;
  } catch {
    return {};
  }
}

export function resizeTouchButton(
  width: number, height: number, deltaX: number, deltaY: number,
): { width: number; height: number } {
  return {
    width: Math.min(144, Math.max(44, width + deltaX)),
    height: Math.min(144, Math.max(44, height + deltaY)),
  };
}

export function touchButtonPosition(fraction: number, size: number): string {
  return `clamp(0px, calc(${fraction * 100}% - ${fraction * size}px), max(0px, calc(100% - ${size}px)))`;
}

export function applyTouchPlacement(
  button: HTMLButtonElement, placement: TouchButtonPlacement | undefined,
): void {
  button.classList.toggle("touch-positioned", !!placement);
  if (!placement) {
    for (const property of ["position", "left", "top", "transform",
      "--touch-key-width", "--touch-key-height"]) {
      button.style.removeProperty(property);
    }
    return;
  }
  button.style.position = "fixed";
  button.style.left = touchButtonPosition(placement.x, placement.width);
  button.style.top = touchButtonPosition(placement.y, placement.height);
  button.style.transform = "none";
  button.style.setProperty("--touch-key-width", `${placement.width}px`);
  button.style.setProperty("--touch-key-height", `${placement.height}px`);
}

interface DragState {
  pointer: number;
  action: TouchButtonId;
  offsetX: number;
  offsetY: number;
}

interface ResizeState {
  pointer: number;
  action: TouchButtonId;
  left: number;
  top: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
}

export interface TouchLayoutEditorOptions {
  /** The window library (defaults to the game's loaded resources). */
  library?(): BmlLibrary | undefined;
  /** The game area the panel's 1600×900 stage covers (defaults to #app). */
  stage?(): HTMLElement;
}

/**
 * Lets players move and resize each touch control; saves only after
 * confirmation. While editing, a dimmed layer holds the keys and the
 * resize handle, and the 调整按键 panel is a release window: non-modal and
 * clipped to its frame, so the keys around it stay draggable.
 */
export class TouchLayoutEditor {
  readonly editor = document.createElement("div");
  readonly listeners = new AbortController();
  readonly resizeHandle: HTMLButtonElement;
  /** The panel's status line (save failure, 已恢复默认). */
  message = "";
  messageIsError = false;
  readonly parent: HTMLElement;
  readonly nextSibling: Node | null;
  readonly externalButtons: Array<{
    button: HTMLButtonElement;
    parent: HTMLElement;
    nextSibling: Node | null;
  }>;
  saved: TouchLayout;
  draft: TouchLayout = {};
  selected: TouchButtonId;
  editing = false;
  previousFocus: HTMLElement | null = null;
  drag: DragState | undefined;
  resize: ResizeState | undefined;
  panelView: WindowView | undefined;
  panelLayer: PopupLayer | undefined;
  panelGeneration = 0;

  constructor(
    readonly host: HTMLElement,
    readonly pad: HTMLElement,
    readonly buttons: Map<TouchButtonId, HTMLButtonElement>,
    readonly onEditingChange: () => void,
    readonly options: TouchLayoutEditorOptions = {},
  ) {
    this.parent = pad.parentElement!;
    this.nextSibling = pad.nextSibling;
    this.externalButtons = [...buttons.values()]
      .filter(button => !pad.contains(button))
      .map(button => ({
        button,
        parent: button.parentElement!,
        nextSibling: button.nextSibling,
      }));
    this.selected = buttons.keys().next().value!;
    this.editor.className = "touch-layout-editor";
    this.editor.hidden = true;
    // Over the whole page, dimmed like the release dialogs' Panel (color 100 0 0 0).
    Object.assign(this.editor.style, { position: "fixed", inset: "0", background: "rgba(0, 0, 0, 0.39)",
      pointerEvents: "auto", touchAction: "none" });
    this.resizeHandle = document.createElement("button");
    this.resizeHandle.type = "button";
    this.resizeHandle.className = "touch-layout-resize-handle";
    this.resizeHandle.setAttribute("aria-label", tr("调整按键大小"));
    this.resizeHandle.innerHTML = resizeHandleMarkup;
    // A small square grip in the release blue on the selected key's corner.
    Object.assign(this.resizeHandle.style, { position: "fixed", zIndex: "4", width: "30px", height: "30px",
      border: "2px solid white", borderRadius: "0", background: "rgb(24, 112, 220)", color: "white",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.6)", transform: "translate(calc(-50% + 3px), calc(-50% + 3px))",
      cursor: "nwse-resize", touchAction: "none" });
    this.editor.append(this.resizeHandle);
    host.append(this.editor);
    for (const [id, button] of buttons) {
      button.addEventListener("pointerdown", event => this.startDrag(event, id),
        { signal: this.listeners.signal });
      button.addEventListener("focus", () => {
        if (this.editing) this.selectButton(id);
      }, { signal: this.listeners.signal });
    }
    this.bindEditor();
    this.saved = this.readSaved();
    this.apply(this.saved);
  }

  get isEditing(): boolean { return this.editing; }

  start(): void {
    if (this.editing) return;
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.draft = { ...this.saved };
    this.editing = true;
    this.setMessage("");
    this.editor.hidden = false;
    this.editor.append(this.pad);
    this.externalButtons.forEach(({ button }) => this.editor.append(button));
    this.pad.hidden = false;
    for (const button of this.buttons.values()) button.style.cursor = "move";
    this.onEditingChange();
    this.selectButton(this.selected);
    this.buttons.get(this.selected)!.focus({ preventScroll: true });
    this.openPanel();
  }

  cancel(): void {
    if (this.editing) {
      this.apply(this.saved);
      this.finish();
    }
  }

  dispose(): void {
    this.cancel();
    this.closePanel();
    this.listeners.abort();
    this.editor.remove();
  }

  setMessage(message: string, error = false): void {
    this.message = message;
    this.messageIsError = error;
    this.panelView?.render();
  }

  /** The panel window's node states. */
  panelState(entry: BmlNode): NodeState {
    const button = (text: string, action: () => void): NodeState => ({ text, label: text, action });
    switch (nodeName(entry)) {
      case "layoutPanel": return { text: tr("调整按键") };
      case "layoutHint": return paintText(tr(LAYOUT_PANEL_HINT), { size: 20, bold: true, color: TEXT, align: "center",
        middle: true });
      case "layoutStatus": return paintText(this.message, { size: 18, bold: this.messageIsError,
        color: this.messageIsError ? ERROR_TEXT : TEXT, align: "center", middle: true });
      case "layoutSave": return button(tr("保存"), () => this.save());
      case "layoutCancel": return button(tr("取消"), () => this.cancel());
      case "layoutReset": return button(tr("恢复默认"), () => this.reset());
    }
    return {};
  }

  private openPanel(): void {
    const library = (this.options.library ?? gameWindowLibrary)();
    if (!library) return;
    const generation = ++this.panelGeneration;
    // Non-modal: the layer lets the pointer through except over the panel itself.
    const layer = popupLayer((this.options.stage ?? gameRoot)(), { modal: false, zIndex: 10_002 });
    this.panelLayer = layer;
    void (te.load({
      library, root: layer.element, definition: prepare(library, layoutPanelDefinition(), ROOTS), roots: ROOTS,
      smoothImages: true, modal: false, label: tr("调整按键"),
      onCancel: () => this.cancel(),
      state: (entry: BmlNode) => this.panelState(entry),
    } as never) as Promise<WindowView>).then(view => {
      if (generation !== this.panelGeneration || !this.editing) {
        view.dispose();
        return;
      }
      this.panelView = view;
      view.element.style.pointerEvents = "auto";
      clipToStage(view.element, [LAYOUT_PANEL]);
      // Keys pressed on the panel stay in the editor, as on its keys.
      view.element.addEventListener("keydown", event => event.stopPropagation());
      view.show();
    }).catch(error => {
      if (generation === this.panelGeneration) this.closePanel();
      console.warn("调整按键窗口打开失败", error);
    });
  }

  private closePanel(): void {
    this.panelGeneration++;
    this.panelView?.dispose();
    this.panelView = undefined;
    this.panelLayer?.dispose();
    this.panelLayer = undefined;
  }

  private bindEditor(): void {
    const options = { signal: this.listeners.signal };
    this.resizeHandle.addEventListener("pointerdown", event => this.startResize(event), options);
    this.editor.addEventListener("pointermove", event => {
      this.moveDrag(event);
      this.moveResize(event);
    }, options);
    const stop = (event: PointerEvent): void => {
      if (event.pointerId === this.drag?.pointer) this.stopDrag();
      if (event.pointerId === this.resize?.pointer) this.stopResize();
    };
    this.editor.addEventListener("pointerup", stop, options);
    this.editor.addEventListener("pointercancel", stop, options);
    this.editor.addEventListener("lostpointercapture", stop, options);
    this.editor.addEventListener("keydown", event => {
      this.moveWithKeyboard(event);
      this.resizeWithKeyboard(event);
      if (event.key === "Escape" && this.editing) {
        event.preventDefault();
        this.cancel();
      }
      // The page under the editor does not act on its keys (the release dialog stopped them too).
      event.stopPropagation();
    }, options);
  }

  readSaved(): TouchLayout {
    try {
      return parseTouchLayout(localStorage.getItem(TOUCH_LAYOUT_STORAGE_KEY) ?? "{}",
        this.buttons.keys());
    } catch {
      return {};
    }
  }

  save(): void {
    this.stopInteraction();
    try {
      localStorage.setItem(TOUCH_LAYOUT_STORAGE_KEY, JSON.stringify(this.draft));
    } catch {
      this.setMessage(tr("无法保存按键布局，请检查浏览器的本地存储设置后重试。"), true);
      return;
    }
    this.saved = { ...this.draft };
    this.finish();
  }

  reset(): void {
    this.stopInteraction();
    this.draft = {};
    this.apply(this.draft);
    this.selectButton(this.selected);
    this.setMessage(tr("已恢复默认，保存后生效。"));
  }

  finish(): void {
    this.stopInteraction();
    this.editing = false;
    for (const button of this.buttons.values())
      button.classList.remove("is-layout-selected");
    this.parent.insertBefore(this.pad, this.nextSibling);
    this.externalButtons.forEach(({ button, parent, nextSibling }) =>
      parent.insertBefore(button, nextSibling));
    for (const button of this.buttons.values()) button.style.removeProperty("cursor");
    this.editor.hidden = true;
    this.closePanel();
    this.onEditingChange();
    this.previousFocus?.focus();
  }

  selectButton(id: TouchButtonId): void {
    this.selected = id;
    for (const [candidate, button] of this.buttons)
      button.classList.toggle("is-layout-selected", candidate === id);
    const button = this.buttons.get(id)!;
    this.resizeHandle.setAttribute("aria-label",
      tr("调整{action}大小", { action: button.dataset.actionName ?? tr("按键") }));
    this.positionResizeHandle();
  }

  startDrag(event: PointerEvent, id: TouchButtonId): void {
    if (!this.editing || this.drag || this.resize || event.button !== 0) return;
    event.preventDefault();
    this.selectButton(id);
    const button = this.buttons.get(id)!;
    button.focus({ preventScroll: true });
    const rect = button.getBoundingClientRect();
    this.drag = {
      pointer: event.pointerId,
      action: id,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    button.setPointerCapture(event.pointerId);
  }

  moveDrag(event: PointerEvent): void {
    if (this.drag?.pointer !== event.pointerId) return;
    event.preventDefault();
    const { action, offsetX, offsetY } = this.drag;
    const { width, height } = this.buttons.get(action)!.getBoundingClientRect();
    this.place(action, event.clientX - offsetX, event.clientY - offsetY, width, height);
  }

  stopDrag(): void {
    if (!this.drag) return;
    const { pointer, action } = this.drag;
    this.drag = undefined;
    const button = this.buttons.get(action)!;
    if (button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
  }

  startResize(event: PointerEvent): void {
    if (!this.editing || this.drag || this.resize || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const { left, top, width, height } =
      this.buttons.get(this.selected)!.getBoundingClientRect();
    this.resize = {
      pointer: event.pointerId,
      action: this.selected,
      left, top, width, height,
      startX: event.clientX,
      startY: event.clientY,
    };
    this.resizeHandle.setPointerCapture(event.pointerId);
  }

  moveResize(event: PointerEvent): void {
    if (this.resize?.pointer !== event.pointerId) return;
    event.preventDefault();
    const { action, left, top, width, height, startX, startY } = this.resize;
    const size = resizeTouchButton(width, height,
      event.clientX - startX, event.clientY - startY);
    this.place(action, left, top, size.width, size.height);
  }

  stopResize(): void {
    if (!this.resize) return;
    const { pointer } = this.resize;
    this.resize = undefined;
    if (this.resizeHandle.hasPointerCapture(pointer))
      this.resizeHandle.releasePointerCapture(pointer);
  }

  stopInteraction(): void {
    this.stopDrag();
    this.stopResize();
  }

  moveWithKeyboard(event: KeyboardEvent): void {
    const step = arrowStep[event.key];
    const button = this.buttons.get(this.selected)!;
    if (!this.editing || !step || event.target !== button) return;
    event.preventDefault();
    const rect = button.getBoundingClientRect();
    this.place(this.selected, rect.left + step[0], rect.top + step[1],
      rect.width, rect.height);
  }

  resizeWithKeyboard(event: KeyboardEvent): void {
    const step = arrowStep[event.key];
    if (!this.editing || !step || event.target !== this.resizeHandle) return;
    event.preventDefault();
    const rect = this.buttons.get(this.selected)!.getBoundingClientRect();
    const size = resizeTouchButton(rect.width, rect.height, step[0], step[1]);
    this.place(this.selected, rect.left, rect.top, size.width, size.height);
  }

  place(id: TouchButtonId, left: number, top: number,
    width: number, height: number): void {
    const placement = {
      x: Math.min(1, Math.max(0, left / Math.max(1, window.innerWidth - width))),
      y: Math.min(1, Math.max(0, top / Math.max(1, window.innerHeight - height))),
      width,
      height,
    };
    this.draft[id] = placement;
    applyTouchPlacement(this.buttons.get(id)!, placement);
    if (this.editing && id === this.selected) this.positionResizeHandle();
  }

  positionResizeHandle(): void {
    const rect = this.buttons.get(this.selected)!.getBoundingClientRect();
    this.resizeHandle.style.left = `${rect.right}px`;
    this.resizeHandle.style.top = `${rect.bottom}px`;
  }

  apply(layout: TouchLayout): void {
    for (const [id, button] of this.buttons)
      applyTouchPlacement(button, layout[id]);
  }
}
