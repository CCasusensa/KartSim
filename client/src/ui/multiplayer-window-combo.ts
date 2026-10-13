import type { WindowNode } from "./multiplayer-window-assets";
import type { WindowRect } from "./multiplayer-window-draw";
import { scrollbarGeometry } from "./scrollbar";

/** gui_/monocoque config.bml `<ScrollBar defaultSize="12"/>`. */
const SCROLLBAR_WIDTH = 12;

export interface ComboFrame {
  texture?: string;
  left: { width: number };
  right: { width: number };
  caption: { height: number };
  bottom: { height: number };
}
export interface MultiplayerComboHost {
  options: {
    state(node: WindowNode): {
      select?: { values: string[]; value: string };
      disabled?: boolean;
    };
    onHover?(): void;
  };
  openCombo?: WindowNode;
  comboIndex: number;
  /**
   * First option shown when the list is longer than its comboListLength;
   * undefined until the open list is first drawn (it then centers the
   * selected option).
   */
  comboOffset?: number;
  /** Options that fit in a scrolling list (0 when the whole list shows). */
  comboVisible?: number;
  comboRects: Map<WindowNode, WindowRect>;
  buttons: Array<{
    key: WindowNode | string | number;
    rect: WindowRect;
    label?: string;
    tabIndex?: number;
    hover?(): void;
    activate(): void;
  }>;
  frames: Map<string, ComboFrame[]>;
  styles: Map<WindowNode, { states: Array<{ frame: ComboFrame }> }>;
  images: Map<string, { image: CanvasImageSource }>;
  context: CanvasRenderingContext2D;
  render(): void;
  closeCombo(): void;
  chooseCombo(index: number): void;
  drawComboText(node: WindowNode, rect: WindowRect): void;
  text(value: string): string;
}
export interface MultiplayerComboDependencies {
  entries(node: WindowNode, values: string[]): WindowNode[];
  attribute(node: WindowNode, name: string): string | undefined;
  rectangle(node: WindowNode, parent: WindowRect, frame: ComboFrame): WindowRect;
  paintFrame(context: CanvasRenderingContext2D, frame: ComboFrame,
    image: CanvasImageSource, rectangle: WindowRect): void;
}

/** Draws an open BML combo list and its accessible hit regions. */
export function drawMultiplayerComboPopup(host: MultiplayerComboHost,
  dependencies: MultiplayerComboDependencies): void {
  const combo = host.openCombo;
  const state = combo ? host.options.state(combo) : undefined;
  const anchor = combo ? host.comboRects.get(combo) : undefined;
  if (!combo || !state?.select || state.disabled || !anchor) {
    host.openCombo = undefined;
    return;
  }
  host.buttons.push({
    key: "comboBackdrop",
    rect: { x: 0, y: 0, width: 1600, height: 900 },
    activate: () => host.closeCombo(),
  });
  const entries = dependencies.entries(combo, state.select.values);
  const listFrame = host.frames.get(dependencies.attribute(combo, "listFrame") ??
    "DefaultEdit")![0]!;
  const totalHeight = entries.reduce((height, entry) => height +
    dependencies.rectangle(entry, anchor, host.styles.get(entry)!.states[0]!.frame).height, 0);
  const listLength = Number(dependencies.attribute(combo, "comboListLength"));
  if (listLength > 0 && totalHeight > listLength) {
    drawScrollingComboList(host, dependencies, combo, entries, anchor, listFrame,
      totalHeight, listLength);
    return;
  }
  host.comboVisible = 0;
  const listRect = {
    x: anchor.x - listFrame.left.width,
    y: anchor.y - listFrame.caption.height,
    width: anchor.width + listFrame.left.width + listFrame.right.width,
    height: totalHeight + listFrame.caption.height + listFrame.bottom.height,
  };
  if (listFrame.texture)
    dependencies.paintFrame(host.context, listFrame,
      host.images.get(listFrame.texture)!.image, listRect);
  let y = anchor.y;
  entries.forEach((entry, index) => {
    const style = host.styles.get(entry)!.states[index === host.comboIndex ? 1 : 0]!;
    const rect = dependencies.rectangle(entry,
      { ...anchor, y, height: totalHeight }, style.frame);
    y += rect.height;
    if (style.frame.texture)
      dependencies.paintFrame(host.context, style.frame,
        host.images.get(style.frame.texture)!.image, rect);
    host.drawComboText(entry, rect);
    host.buttons.push({
      key: index, rect,
      label: host.text(dependencies.attribute(entry, "text") ?? ""),
      tabIndex: -1,
      hover: () => host.options.onHover?.(),
      activate: () => host.chooseCombo(index),
    });
  });
}

/**
 * A list longer than its comboListLength (pixels of options) shows that many
 * rows and scrolls by wheel, keys or the scrollbar track; scrollBarVisible
 * draws the default vertical monocoque scrollbar beside the rows.
 */
function drawScrollingComboList(host: MultiplayerComboHost,
  dependencies: MultiplayerComboDependencies, combo: WindowNode, entries: WindowNode[],
  anchor: WindowRect, listFrame: ComboFrame, totalHeight: number, listLength: number): void {
  const rowHeight = totalHeight / entries.length;
  const visible = Math.max(1, Math.floor(listLength / rowHeight));
  const maxOffset = entries.length - visible;
  const offset = Math.max(0, Math.min(maxOffset,
    host.comboOffset ?? host.comboIndex - Math.floor(visible / 2)));
  host.comboOffset = offset;
  host.comboVisible = visible;
  const scrollbar = dependencies.attribute(combo, "scrollBarVisible") === "true";
  const rows = { ...anchor, width: anchor.width - (scrollbar ? SCROLLBAR_WIDTH : 0) };
  const shown = entries.slice(offset, offset + visible);
  const height = shown.reduce((sum, entry) => sum +
    dependencies.rectangle(entry, rows, host.styles.get(entry)!.states[0]!.frame).height, 0);
  const listRect = {
    x: anchor.x - listFrame.left.width,
    y: anchor.y - listFrame.caption.height,
    width: anchor.width + listFrame.left.width + listFrame.right.width,
    height: height + listFrame.caption.height + listFrame.bottom.height,
  };
  if (listFrame.texture)
    dependencies.paintFrame(host.context, listFrame,
      host.images.get(listFrame.texture)!.image, listRect);
  let y = anchor.y;
  shown.forEach((entry, row) => {
    const index = offset + row;
    const style = host.styles.get(entry)!.states[index === host.comboIndex ? 1 : 0]!;
    const rect = dependencies.rectangle(entry, { ...rows, y, height }, style.frame);
    y += rect.height;
    if (style.frame.texture)
      dependencies.paintFrame(host.context, style.frame,
        host.images.get(style.frame.texture)!.image, rect);
    host.drawComboText(entry, rect);
    host.buttons.push({
      key: index, rect,
      label: host.text(dependencies.attribute(entry, "text") ?? ""),
      tabIndex: -1,
      hover: () => host.options.onHover?.(),
      activate: () => host.chooseCombo(index),
    });
  });
  if (!scrollbar) return;
  const area = host.frames.get("DefaultVerticalScrollArea")?.[0];
  const button = host.frames.get("DefaultVerticalScrollButton")?.[0];
  if (!area || !button) return;
  const track = { x: anchor.x + anchor.width - SCROLLBAR_WIDTH, y: anchor.y,
    width: SCROLLBAR_WIDTH, height };
  const geometry = scrollbarGeometry(
    { minButtonHeight: button.caption.height + button.bottom.height }, track,
    entries.length / visible, offset / visible, offset * rowHeight, totalHeight);
  for (const [frame, rect] of [[area, geometry.area], [button, geometry.button]] as const) {
    const image = frame.texture ? host.images.get(frame.texture)?.image : undefined;
    if (image) dependencies.paintFrame(host.context, frame, image, rect);
  }
  // A track click pages the list, as in the release list boxes.
  const page = (direction: number) => () => {
    host.comboOffset = Math.max(0, Math.min(maxOffset, offset + direction * visible));
    host.render();
  };
  const thumb = geometry.button;
  host.buttons.push(
    { key: "comboPageUp", rect: { ...track, height: thumb.y - track.y },
      activate: page(-1) },
    { key: "comboPageDown", rect: { ...track, y: thumb.y + thumb.height,
      height: track.y + track.height - thumb.y - thumb.height }, activate: page(1) },
    { key: "comboThumb", rect: thumb, activate: () => undefined },
  );
}
