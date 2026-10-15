import { tr } from "../i18n/locale";
import { FONT, type Rect } from "./bml-kit";

/**
 * 隊伍隨機分配 art drawn on the canvas (not in the release resources): the
 * crossing-arrows icon, the header switch of a team room, the two karts and
 * the start banner that announces the deal.
 */

export const TEAM_BLUE = "#2f7bff";
export const TEAM_RED = "#e8343c";
export const ACCENT_CYAN = "#3fd2ff";

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const easeOut = (value: number): number => 1 - (1 - clamp(value)) ** 3;

/** Two crossing arrows in a size × size box at (x, y). */
export function drawShuffleIcon(context: CanvasRenderingContext2D, x: number, y: number, size: number,
  color: string, lineWidth = size * 0.13): void {
  const at = (fx: number, fy: number): [number, number] => [x + fx * size, y + fy * size];
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const [top, bottom] of [[0.22, 0.78], [0.78, 0.22]] as const) {
    context.beginPath();
    context.moveTo(...at(0.04, top));
    context.lineTo(...at(0.34, top));
    context.lineTo(...at(0.62, bottom));
    context.lineTo(...at(0.82, bottom));
    context.stroke();
    // Arrow head at the right end.
    const [hx, hy] = at(0.98, bottom);
    const half = size * 0.17;
    context.beginPath();
    context.moveTo(hx, hy);
    context.lineTo(hx - half, hy - half);
    context.lineTo(hx - half, hy + half);
    context.closePath();
    context.fill();
  }
  context.restore();
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

export interface RandomTeamToggleState { enabled: boolean; hovered: boolean; disabled: boolean }

/** The header switch: icon, 队伍随机分配 and ON / OFF on a dark plate. */
export function paintRandomTeamToggle(context: CanvasRenderingContext2D, rect: Rect,
  state: RandomTeamToggleState): void {
  context.save();
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, 6);
  context.fillStyle = state.hovered ? "rgba(26, 44, 78, 0.92)" : "rgba(8, 18, 38, 0.78)";
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = state.hovered ? "rgba(140, 200, 255, 0.7)" : "rgba(255, 255, 255, 0.28)";
  context.stroke();
  const iconSize = rect.height * 0.56;
  const iconX = rect.x + 12;
  const iconY = rect.y + (rect.height - iconSize) / 2;
  drawShuffleIcon(context, iconX, iconY, iconSize, state.disabled ? "rgb(150, 160, 175)" : ACCENT_CYAN);
  context.font = `bold 16px ${FONT}`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  const textX = iconX + iconSize + 10;
  const middle = rect.y + rect.height / 2 + 1;
  context.fillStyle = state.disabled ? "rgb(190, 196, 206)" : "white";
  context.fillText(tr("队伍随机分配"), textX, middle);
  const labelWidth = context.measureText(tr("队伍随机分配")).width;
  context.fillStyle = state.enabled ? ACCENT_CYAN : "rgb(170, 180, 195)";
  context.fillText(state.enabled ? "ON" : "OFF", textX + labelWidth + 8, middle);
  context.restore();
}

/**
 * A side-view kart standing on (x, y): wheels, chassis, spoiler, the
 * rider's helmet. Facing right unless mirrored.
 */
export function drawKart(context: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string,
  facingRight = true): void {
  context.save();
  context.translate(x, y);
  context.scale(facingRight ? scale : -scale, scale);
  const wheel = (wx: number): void => {
    context.beginPath();
    context.arc(wx, -15, 15, 0, Math.PI * 2);
    context.fillStyle = "#1f2227";
    context.fill();
    context.beginPath();
    context.arc(wx, -15, 7, 0, Math.PI * 2);
    context.fillStyle = "#9aa3ad";
    context.fill();
  };
  // Spoiler and its strut behind the rider.
  context.fillStyle = color;
  context.fillRect(-64, -66, 30, 8);
  context.fillRect(-50, -58, 5, 16);
  // Chassis.
  context.beginPath();
  context.moveTo(-58, -18);
  context.lineTo(60, -18);
  context.lineTo(66, -30);
  context.lineTo(34, -34);
  context.lineTo(12, -50);
  context.lineTo(-26, -50);
  context.lineTo(-42, -34);
  context.lineTo(-62, -30);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "rgba(0, 0, 0, 0.35)";
  context.lineWidth = 2;
  context.stroke();
  // A white racing stripe and the windshield.
  context.fillStyle = "rgba(255, 255, 255, 0.75)";
  context.fillRect(-30, -45, 36, 5);
  context.beginPath();
  context.moveTo(12, -50);
  context.lineTo(30, -50);
  context.lineTo(34, -34);
  context.closePath();
  context.fillStyle = "rgba(220, 240, 255, 0.85)";
  context.fill();
  // Rider: helmet with a dark visor.
  context.beginPath();
  context.arc(-8, -64, 17, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "rgba(0, 0, 0, 0.3)";
  context.stroke();
  context.beginPath();
  context.arc(-8, -64, 17, -0.35, 0.9);
  context.lineTo(-8, -64);
  context.closePath();
  context.fillStyle = "#1d2330";
  context.fill();
  wheel(-38);
  wheel(38);
  context.restore();
}

function drawDust(context: CanvasRenderingContext2D, x: number, y: number, direction: number, strength: number): void {
  if (strength <= 0) return;
  context.save();
  context.fillStyle = `rgba(255, 255, 255, ${0.55 * strength})`;
  for (const [dx, dy, r] of [[18, -8, 14], [40, -14, 18], [66, -6, 11]] as const) {
    context.beginPath();
    context.arc(x + direction * dx, y + dy, r * (0.6 + 0.4 * strength), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/**
 * The start banner at `progress` (0…1 over its life): the blue and red
 * band with chequered edges fades in, the two karts rush in from the
 * sides, the icon and 队伍随机分配! pop in the middle, then it all fades.
 */
export function paintRandomTeamBanner(context: CanvasRenderingContext2D, rect: Rect, progress: number): void {
  const p = clamp(progress);
  const alpha = Math.min(easeOut(p / 0.1), 1 - clamp((p - 0.85) / 0.15));
  if (alpha <= 0) return;
  const { x, y, width, height } = rect;
  const cx = x + width / 2;
  context.save();
  context.globalAlpha = alpha;
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  // Blue left, red right, split on a slant with a white seam.
  const blue = context.createLinearGradient(x, y, x, y + height);
  blue.addColorStop(0, "#3d8dff");
  blue.addColorStop(1, "#1c4fc9");
  const red = context.createLinearGradient(x, y, x, y + height);
  red.addColorStop(0, "#ff5c5c");
  red.addColorStop(1, "#c81e28");
  context.fillStyle = blue;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(cx + 40, y);
  context.lineTo(cx - 40, y + height);
  context.lineTo(x, y + height);
  context.closePath();
  context.fill();
  context.fillStyle = red;
  context.beginPath();
  context.moveTo(cx + 40, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width, y + height);
  context.lineTo(cx - 40, y + height);
  context.closePath();
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.beginPath();
  context.moveTo(cx + 36, y);
  context.lineTo(cx + 46, y);
  context.lineTo(cx - 34, y + height);
  context.lineTo(cx - 44, y + height);
  context.closePath();
  context.fill();
  // Chequered strips along both edges.
  const square = 14;
  context.fillStyle = "rgba(255, 255, 255, 0.55)";
  for (let column = 0; column * square < width; column++) {
    for (const row of [0, 1]) {
      if ((column + row) % 2 === 0) context.fillRect(x + column * square, y + row * square, square, square);
      if ((column + row) % 2 === 1) {
        context.fillRect(x + column * square, y + height - (2 - row) * square, square, square);
      }
    }
  }
  context.fillStyle = "rgba(0, 0, 0, 0.18)";
  context.fillRect(x, y + height - 3, width, 3);
  context.fillRect(x, y, width, 3);
  // Karts rush in from the sides.
  const rush = easeOut((p - 0.06) / 0.28);
  const ground = y + height * 0.86;
  const blueX = x - 160 + (cx - 300 - (x - 160)) * rush;
  const redX = x + width + 160 - (x + width + 160 - (cx + 300)) * rush;
  const dust = clamp((p - 0.2) / 0.2) * (1 - clamp((p - 0.55) / 0.3));
  drawDust(context, blueX - 60, ground - 12, -1, dust);
  drawDust(context, redX + 60, ground - 12, 1, dust);
  drawKart(context, blueX, ground, 1.05, TEAM_BLUE, true);
  drawKart(context, redX, ground, 1.05, TEAM_RED, false);
  // Icon and title pop in the middle.
  const pop = 1 + 0.4 * (1 - easeOut((p - 0.12) / 0.18));
  const show = clamp((p - 0.1) / 0.1);
  context.globalAlpha = alpha * show;
  context.translate(cx, y + height / 2);
  context.scale(pop, pop);
  drawShuffleIcon(context, -32, -height * 0.4, 64, "white", 8);
  context.font = `bold italic 40px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 7;
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, 0.72)";
  context.strokeText(tr("队伍随机分配!"), 0, height * 0.2);
  context.fillStyle = "white";
  context.fillText(tr("队伍随机分配!"), 0, height * 0.2);
  context.restore();
}
