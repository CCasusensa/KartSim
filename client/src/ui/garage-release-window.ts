import { C8, te } from "../generated/library.js";
import { attribute, prepare, wrapText, type BmlLibrary, type Node, type NodeState,
  type Rect } from "./bml-kit";
import { gameRoot, gameWindowLibrary, popupLayer, trapPopupKeys } from "./game-popups";
import { colorRuns } from "./messenger-art";

/**
 * The garage's 车辆强化 popups (性能选择, 超负荷类型变更) drawn by the
 * release window renderer. The garage page itself is DOM rasterised onto
 * its canvas (garage-control-canvas-rebuild), so these windows go into
 * their own popup layer over the game area instead of the garage surface.
 */

export interface GarageReleaseWindow {
  readonly element: HTMLElement;
  /** The node under the pointer (the renderer hands state() these very nodes). */
  readonly hovered?: unknown;
  render(): void;
  focus(name?: string): void;
  dispose(): void;
}

export interface GarageReleaseWindowOptions {
  /** The garage's resource library (the game's, when the garage passed none). */
  library: unknown;
  definition: Node;
  /** Texture folders, e.g. ["dialog2_/exceedTypeChange", "stage_/common"]. */
  roots: string[];
  /** Folder whose CaptionWindows' setCloseButton is looked up first. */
  closeButtonFolder?: string;
  label: string;
  /** Escape (the window owns the keyboard while it is the topmost popup). */
  onCancel(): void;
  state(node: Node): NodeState;
}

export type OpenGarageReleaseWindow = (options: GarageReleaseWindowOptions) => Promise<GarageReleaseWindow>;

/** The library the windows read: the garage's, else the game's. */
export function garageWindowLibrary(library: unknown): BmlLibrary {
  const candidate = library as Partial<BmlLibrary> | undefined;
  const found = typeof candidate?.canonicalCandidates === "function" ? candidate as BmlLibrary
    : gameWindowLibrary();
  if (!found) throw new Error("游戏资源尚未加载，无法打开车辆强化窗口。");
  return found;
}

/** Adds the release close button (dialogCloseButton) to every CaptionWindow with setCloseButton. */
async function addCloseButtons(library: BmlLibrary, definition: Node, folder: string): Promise<Node> {
  if (definition.name === "CaptionWindow" && attribute(definition, "setCloseButton"))
    return await C8(library, definition, folder) as Node;
  return { ...definition, children: await Promise.all(definition.children.map(child =>
    addCloseButtons(library, child, folder))) };
}

/**
 * A modal release window in a popup layer over the game area. It owns
 * the keyboard while it is the topmost popup (trapPopupKeys): Escape
 * cancels and no key reaches the garage under it.
 */
export const openGarageReleaseWindow: OpenGarageReleaseWindow = async options => {
  const library = garageWindowLibrary(options.library);
  const decorated = options.closeButtonFolder
    ? await addCloseButtons(library, options.definition, options.closeButtonFolder) : options.definition;
  const definition = prepare(library, decorated, options.roots);
  const layer = popupLayer(gameRoot());
  try {
    const view = await te.load({
      library, root: layer.element, definition, roots: options.roots, modal: true, label: options.label,
      preserveDisplayPixels: true, smoothImages: true, onCancel: options.onCancel, state: options.state,
    } as never) as unknown as GarageReleaseWindow & { show(): void };
    view.show();
    const releaseKeys = trapPopupKeys(view.element, { cancel: options.onCancel });
    return {
      element: view.element,
      get hovered() { return view.hovered; },
      render: () => view.render(),
      focus: name => view.focus(name),
      dispose: () => {
        releaseKeys();
        view.dispose();
        layer.dispose();
      },
    };
  } catch (error) {
    layer.dispose();
    throw error;
  }
};

/** The family the release window renderer loads its font under. */
export const WINDOW_FONT = "'KartSim Multiplayer Windows', 'PingFang SC', 'Microsoft YaHei', sans-serif";

export interface ColorTextOptions {
  size: number;
  /** Text outside [color] runs. */
  color: string;
  align?: "left" | "center";
  lineGap?: number;
  /** Centre the lines vertically in the rectangle. */
  middle?: boolean;
  /** The release "outline" text render: a dark edge around the glyphs. */
  outline?: string;
}

/**
 * A ColorLabel's text ([color:A R G B]…[/color] runs, "|" breaks lines)
 * painted in a rectangle; lines wider than it wrap.
 */
export function paintColorText(context: CanvasRenderingContext2D, text: string, rect: Rect,
  options: ColorTextOptions): void {
  context.save();
  context.font = `bold ${options.size}px ${WINDOW_FONT}`;
  context.textBaseline = "top";
  context.textAlign = "left";
  const lines: Array<Array<{ text: string; color: string }>> = [[]];
  for (const run of colorRuns(text)) {
    run.text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines.at(-1)!.push({ text: part, color: run.color ?? options.color });
    });
  }
  // Wrap each line to the width, keeping every piece's colours.
  const wrapped: typeof lines = [];
  for (const line of lines) {
    const plain = line.map(run => run.text).join("");
    let offset = 0;
    for (const piece of plain ? wrapText(context, plain, rect.width) : [""]) {
      const runs: Array<{ text: string; color: string }> = [];
      let start = 0;
      for (const run of line) {
        const end = start + run.text.length;
        const from = Math.max(start, offset), to = Math.min(end, offset + piece.length);
        if (from < to) runs.push({ text: run.text.slice(from - start, to - start), color: run.color });
        start = end;
      }
      wrapped.push(runs);
      offset += piece.length;
    }
  }
  const gap = options.lineGap ?? 4;
  const step = options.size + gap;
  const top = options.middle ? rect.y + (rect.height - wrapped.length * step + gap) / 2 : rect.y;
  wrapped.forEach((runs, index) => {
    const width = runs.reduce((total, run) => total + context.measureText(run.text).width, 0);
    let x = options.align === "center" ? rect.x + (rect.width - width) / 2 : rect.x;
    const y = top + index * step;
    for (const run of runs) {
      if (options.outline) {
        context.lineWidth = 3;
        context.lineJoin = "round";
        context.strokeStyle = options.outline;
        context.strokeText(run.text, x, y);
      }
      context.fillStyle = run.color;
      context.fillText(run.text, x, y);
      x += context.measureText(run.text).width;
    }
  });
  context.restore();
}
