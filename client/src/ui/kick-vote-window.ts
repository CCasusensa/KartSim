import { tr } from "../i18n/locale";
import { te } from "../generated/library.js";
import type { KickVoteStatus } from "../multiplayer/lobby-kick-vote";
import { FONT, node, nodeName, type BmlLibrary, type Node, type Rect, type WindowView } from "./bml-kit";
import { ACCENT_CYAN, TEAM_BLUE } from "./random-team-art";

/**
 * 踢出投票 drawn by the release window renderer: a CaptionDialog with the
 * ballot box, "即将把 X 踢出等待室。是否踢出将依投票结果决定。您是否同意？",
 * the blue board with the time left, its bar and the live 同意 / 反对
 * counts, then 同意 (Enter) and 反对 (Esc). The counts come from the room
 * snapshot through `status()`, so every room update redraws them; a timer
 * keeps the bar and the seconds moving.
 */

/** The vote's length when the snapshot gave no usable deadline (the game node's 20 s). */
export const KICK_VOTE_DEFAULT_MS = 20_000;

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];
const TEXT = "rgb(42,55,80)";

export interface KickVoteWindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
  [field: string]: unknown;
}

export interface KickVoteWindow {
  busy: boolean;
  view: WindowView;
  setBusy(busy: boolean): void;
  dispose(): void;
}

function closesAt(status: KickVoteStatus): number {
  return status.deadlineAt ?? status.openedAt + KICK_VOTE_DEFAULT_MS;
}

export function kickVoteRemainingMs(status: KickVoteStatus, now: number): number {
  return Math.max(0, closesAt(status) - now);
}

/** How much of the bar is still filled: the time left over the time the window had. */
export function kickVoteBarFraction(status: KickVoteStatus, now: number): number {
  const total = Math.max(1, closesAt(status) - status.openedAt);
  return Math.min(1, kickVoteRemainingMs(status, now) / total);
}

export function kickVoteRemainingText(status: KickVoteStatus, now: number): string {
  return tr("剩余时间 {0}秒", { "0": Math.ceil(kickVoteRemainingMs(status, now) / 1000) });
}

/** The three lines of the question; the first names the target. */
export function kickVoteTextLines(targetName: string): [string, string, string] {
  return [tr("即将把 {0} 踢出等待室。", { "0": targetName }), tr("是否踢出将依投票结果决定。"), tr("您是否同意？")];
}

export function kickVoteWindowDefinition(): Node {
  const button = (name: string, left: number, text: string, colors: Record<string, string>): Node =>
    node("TextButton", { name, leftTopWH: `${left} 0 155 42`, text, textRender: "bold16", ...colors });
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "voteWnd", frame: "CaptionDialog", leftTopWH: "0 0 520 430",
      caption: tr("踢出投票"), captionColor: "black", align: "center" }, [
      node("Panel", { name: "voteIcon", leftTopWH: "0 14 64 54", align: "hcenter" }),
      node("Panel", { name: "voteText", leftTopWH: "0 78 480 78", align: "hcenter" }),
      node("Panel", { name: "voteBoard", leftTopWH: "0 164 440 150", align: "hcenter" }),
      node("Window", { frame: "HSection", leftTopWH: "0 0 440 1", align: "hcenter;bottom", adjust: "0 64" }),
      node("Container", { leftTopWH: "0 0 330 42", align: "hcenter;bottom", adjust: "0 12" }, [
        button("okButton", 0, tr("同意"), { textColor: "white", overTextColor: "white",
          clickedTextColor: "255 24 55 104", disabledTextColor: "255 220 220 220" }),
        button("cancelButton", 175, tr("反对"), { textColor: "255 64 75 95", overTextColor: "255 106 120 147",
          clickedTextColor: "255 35 41 52", disabledTextColor: "255 131 131 131" }),
        node("Panel", { name: "okKey", leftTopWH: "101 11 48 20" }),
        node("Panel", { name: "cancelKey", leftTopWH: "284 11 38 20" }),
      ]),
    ]),
  ]);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

/** The ballot box: a blue box with a slot and a white ballot going in. */
export function paintBallotBox(context: CanvasRenderingContext2D, rect: Rect): void {
  const size = Math.min(rect.width, rect.height * 1.2);
  const x = rect.x + (rect.width - size) / 2;
  const y = rect.y + rect.height - size * 0.86;
  const boxTop = y + size * 0.28;
  context.save();
  // Box, its lid with the slot, a highlight.
  context.fillStyle = "#2a6ad8";
  roundedRect(context, x, boxTop, size, size * 0.58, 5);
  context.fill();
  context.fillStyle = "#1b4ca8";
  roundedRect(context, x - size * 0.04, boxTop - size * 0.02, size * 1.08, size * 0.16, 4);
  context.fill();
  context.fillStyle = "#0e2d6b";
  context.fillRect(x + size * 0.22, boxTop + size * 0.04, size * 0.56, size * 0.05);
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.fillRect(x + size * 0.08, boxTop + size * 0.2, size * 0.84, size * 0.05);
  // The ballot, half way into the slot, its tick showing.
  context.fillStyle = "white";
  context.strokeStyle = "#8ea8cc";
  context.lineWidth = 1.5;
  roundedRect(context, x + size * 0.3, rect.y, size * 0.4, boxTop + size * 0.06 - rect.y, 3);
  context.fill();
  context.stroke();
  context.strokeStyle = TEAM_BLUE;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x + size * 0.4, rect.y + size * 0.16);
  context.lineTo(x + size * 0.48, rect.y + size * 0.25);
  context.lineTo(x + size * 0.62, rect.y + size * 0.07);
  context.stroke();
  context.restore();
}

/** The question, centred, the target's name in blue. */
export function paintVoteText(context: CanvasRenderingContext2D, rect: Rect, targetName: string): void {
  const lines = kickVoteTextLines(targetName);
  context.save();
  context.font = `bold 16px ${FONT}`;
  context.textBaseline = "middle";
  const step = 25;
  const top = rect.y + (rect.height - lines.length * step) / 2 + step / 2;
  const middle = rect.x + rect.width / 2;
  const [lead = "", tail = ""] = tr("即将把 {0} 踢出等待室。").split("{0}");
  const widths = [lead, targetName, tail].map(part => context.measureText(part).width);
  let x = middle - (widths[0]! + widths[1]! + widths[2]!) / 2;
  context.textAlign = "left";
  for (const [index, part] of [lead, targetName, tail].entries()) {
    context.fillStyle = index === 1 ? TEAM_BLUE : TEXT;
    context.fillText(part, x, top);
    x += widths[index]!;
  }
  context.textAlign = "center";
  context.fillStyle = TEXT;
  context.fillText(lines[1], middle, top + step);
  context.fillText(lines[2], middle, top + step * 2);
  context.restore();
}

function drawThumb(context: CanvasRenderingContext2D, x: number, y: number, size: number, up: boolean,
  color: string): void {
  context.save();
  context.translate(x, y);
  if (!up) context.scale(1, -1);
  context.fillStyle = color;
  // Cuff, fingers and the thumb.
  roundedRect(context, -size * 0.5, -size * 0.1, size * 0.22, size * 0.5, 3);
  context.fill();
  roundedRect(context, -size * 0.26, -size * 0.1, size * 0.66, size * 0.5, size * 0.1);
  context.fill();
  context.beginPath();
  context.moveTo(-size * 0.2, -size * 0.1);
  context.lineTo(-size * 0.02, -size * 0.1);
  context.lineTo(size * 0.2, -size * 0.5);
  context.lineTo(size * 0.26, -size * 0.3);
  context.lineTo(size * 0.12, -size * 0.1);
  context.closePath();
  context.fill();
  context.restore();
}

function drawClock(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.save();
  context.strokeStyle = "white";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(x, y - radius * 0.6);
  context.lineTo(x, y);
  context.lineTo(x + radius * 0.5, y);
  context.stroke();
  context.restore();
}

/** The blue board: time left with its bar, then the 同意 and 反对 counts. */
export function paintVoteBoard(context: CanvasRenderingContext2D, rect: Rect,
  status: KickVoteStatus | undefined, now: number): void {
  const { x, y, width, height } = rect;
  context.save();
  const fill = context.createLinearGradient(x, y, x + width, y + height);
  fill.addColorStop(0, "#2a66c7");
  fill.addColorStop(1, "#1a4aa0");
  context.fillStyle = fill;
  roundedRect(context, x, y, width, height, 4);
  context.fill();
  // Header: clock, time left, the bar.
  const headerHeight = 30;
  context.fillStyle = "#123a7d";
  context.fillRect(x, y, width, headerHeight);
  context.font = `bold 14px ${FONT}`;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillStyle = "white";
  const timeText = status ? kickVoteRemainingText(status, now) : tr("投票已结束");
  const textWidth = context.measureText(timeText).width;
  drawClock(context, x + width / 2 - textWidth / 2 - 14, y + headerHeight / 2, 7);
  context.fillText(timeText, x + width / 2 + 10, y + headerHeight / 2 + 1);
  const barY = y + headerHeight;
  context.fillStyle = "#0b2554";
  context.fillRect(x, barY, width, 6);
  context.fillStyle = ACCENT_CYAN;
  context.fillRect(x, barY, width * (status ? kickVoteBarFraction(status, now) : 0), 6);
  // Two halves.
  const bodyTop = barY + 6;
  const bodyHeight = height - headerHeight - 6;
  context.strokeStyle = "rgba(255, 255, 255, 0.35)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + width / 2, bodyTop + 14);
  context.lineTo(x + width / 2, y + height - 14);
  context.stroke();
  const half = width / 2;
  const columns = [
    { label: tr("同意"), count: status?.yes ?? 0, color: ACCENT_CYAN, up: true },
    { label: tr("反对"), count: status?.no ?? 0, color: "white", up: false },
  ];
  columns.forEach((column, index) => {
    const centre = x + half * index + half / 2;
    context.font = `bold 16px ${FONT}`;
    context.fillStyle = "white";
    context.textAlign = "center";
    context.fillText(column.label, centre, bodyTop + 22);
    const rowY = bodyTop + bodyHeight * 0.64;
    drawThumb(context, centre - 42, rowY, 34, column.up, column.color);
    context.font = `bold 44px ${FONT}`;
    context.fillStyle = column.color;
    context.textAlign = "left";
    context.fillText(String(column.count), centre - 8, rowY + 2);
  });
  context.restore();
}

/** A small key badge (ENTER / ESC) beside a button's text. */
export function paintKeyBadge(context: CanvasRenderingContext2D, rect: Rect, text: string): void {
  context.save();
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, 4);
  context.fillStyle = "#15213a";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.5)";
  context.lineWidth = 1;
  context.stroke();
  context.font = `bold 11px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "white";
  context.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
  context.restore();
}

/** Open the vote window; `status()` is read on every redraw. */
export async function showKickVoteWindow(options: KickVoteWindowOptions,
  status: () => KickVoteStatus | undefined, vote: (approve: boolean) => void,
  nowMs: () => number = () => performance.now(),
  loadView: (loaded: Record<string, unknown>) => Promise<unknown> = loaded => te.load(loaded as never),
  setInterval: (callback: () => void, ms: number) => unknown = (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (timer: unknown) => void = timer => globalThis.clearInterval(timer as number)):
  Promise<KickVoteWindow> {
  const window: KickVoteWindow = {
    busy: false,
    view: undefined as unknown as WindowView,
    setBusy(busy) {
      window.busy = busy;
      window.view.render();
    },
    dispose() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      window.view.dispose();
    },
  };
  let timer: unknown;
  const answer = (approve: boolean) => { if (!window.busy) vote(approve); };
  window.view = await loadView({
    library: options.library, root: options.root, definition: kickVoteWindowDefinition(), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: tr("踢出投票"),
    onCancel: () => answer(false), onConfirm: () => answer(true),
    state: (entry: Node) => {
      switch (nodeName(entry)) {
        case "voteIcon": return { paint: paintBallotBox };
        case "voteText": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintVoteText(context, rect, status()?.targetName ?? "") };
        case "voteBoard": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintVoteBoard(context, rect, status(), nowMs()) };
        case "okButton": return { disabled: window.busy, label: tr("同意（Enter）"), action: () => answer(true) };
        case "cancelButton": return { disabled: window.busy, label: tr("反对（Esc）"), action: () => answer(false) };
        case "okKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintKeyBadge(context, rect, "ENTER") };
        case "cancelKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintKeyBadge(context, rect, "ESC") };
      }
      return {};
    },
  }) as WindowView;
  timer = setInterval(() => window.view.render(), 200);
  window.view.show();
  window.view.focus("okButton");
  return window;
}
