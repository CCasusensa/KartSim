/**
 * The 卡丁城 fuel HUD on a canvas above the race view: the tank gauge at
 * the bottom right in the release 首领模式 HP box (litres, tank class,
 * range, the nearest gas station with an arrow), the low-fuel warnings and
 * the 加油 / 道路救援 prompt in the upper centre (dark blue boards, white
 * bold text with dark edges, cyan accents). Sizes follow the 600 px stage
 * height.
 */
import { FONT } from "../ui/bml-kit";
import { distanceText, fuelWarning, liters, tankClassName, type FuelPrompt } from "./city-fuel";

export interface FuelHudState {
  kartName: string;
  sizeClass: string;
  fuelMl: number;
  capacityMl: number;
  rangeMeters: number;
  empty: boolean;
  /** The nearest station and the angle to it relative to the kart's heading (degrees, clockwise). */
  nearest?: { name: string; distance: number; bearing: number };
  prompt: FuelPrompt;
}

const BOARD_TOP = "rgba(22, 52, 112, 0.86)";
const BOARD_BOTTOM = "rgba(10, 28, 66, 0.86)";
const BOARD_EDGE = "rgba(150, 214, 255, 0.85)";
const CYAN = "#5fe3ff";

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function board(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  scale: number, edge = BOARD_EDGE): void {
  const fill = context.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, BOARD_TOP);
  fill.addColorStop(1, BOARD_BOTTOM);
  roundedRect(context, x, y, width, height, 8 * scale);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 2 * scale;
  context.strokeStyle = edge;
  context.stroke();
}

/** Bold white text with the race HUD's dark edge. */
function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number,
  color = "white", align: CanvasTextAlign = "left"): void {
  context.font = `bold ${size}px ${FONT}`;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, size / 5);
  context.strokeStyle = "rgba(4, 14, 36, 0.9)";
  context.strokeText(text, x, y);
  context.fillStyle = color;
  context.fillText(text, x, y);
}

/** A fuel pump: body, window, hose and nozzle. */
export function paintPump(context: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;
  roundedRect(context, x, y + size * 0.08, size * 0.58, size * 0.88, size * 0.08);
  context.fill();
  context.fillStyle = "rgba(10, 28, 66, 0.9)";
  context.fillRect(x + size * 0.12, y + size * 0.2, size * 0.34, size * 0.22);
  context.lineWidth = size * 0.09;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x + size * 0.58, y + size * 0.3);
  context.lineTo(x + size * 0.82, y + size * 0.42);
  context.lineTo(x + size * 0.82, y + size * 0.78);
  context.lineTo(x + size * 0.66, y + size * 0.86);
  context.stroke();
  context.restore();
}

function arrow(context: CanvasRenderingContext2D, x: number, y: number, size: number, bearing: number): void {
  context.save();
  context.translate(x, y);
  context.rotate((bearing * Math.PI) / 180);
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.72, size * 0.7);
  context.lineTo(0, size * 0.32);
  context.lineTo(-size * 0.72, size * 0.7);
  context.closePath();
  context.fillStyle = CYAN;
  context.fill();
  context.lineWidth = Math.max(1.5, size / 5);
  context.strokeStyle = "rgba(4, 14, 36, 0.9)";
  context.stroke();
  context.restore();
}

/** The gauge colour: green from 60 %, yellow from 20 %, red below. */
export function gaugeColor(ratio: number): string {
  if (ratio < 0.2) return "#ff4d4d";
  if (ratio < 0.6) return "#ffd23f";
  return "#4cff7a";
}

/**
 * The release textures of the gauge: 首领模式's third-stage HP box
 * (stage_bossGame screenui.bml hpStage3: hpbox_0 with the octagon face slot
 * at 5,5 69×35 and the bar at 76,18 151×9) and its three bar colours —
 * green from 60 %, yellow from 20 %, red below.
 */
export const FUEL_HUD_TEXTURES = {
  box: "stage_/bossGame/hpbox_0.png",
  full: "stage_/bossGame/hp_1_1.png",
  half: "stage_/bossGame/hp_1_2.png",
  low: "stage_/bossGame/hp_1_3.png",
} as const;

export type FuelHudTextures = Record<keyof typeof FUEL_HUD_TEXTURES, CanvasImageSource>;

/** The box in stage pixels (800×600): its size, the face slot and the bar. */
const BOX = { width: 232, height: 45, face: { x: 5, y: 5, width: 69, height: 35 }, bar: { x: 76, y: 18, width: 151, height: 9 } };

interface ResourceFile { bytes(): Promise<Uint8Array> }
interface ResourceLibrary { canonicalCandidates(path: string): ResourceFile[] }

/** Loads the gauge textures; undefined when one is missing (the HUD then paints its own box). */
export async function loadFuelHudTextures(library: unknown,
  decode: (bytes: Uint8Array) => Promise<CanvasImageSource> = bytes =>
    createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }))): Promise<FuelHudTextures | undefined> {
  const source = library as ResourceLibrary | undefined;
  if (!source?.canonicalCandidates) return undefined;
  try {
    const entries = await Promise.all(Object.entries(FUEL_HUD_TEXTURES).map(async ([key, path]) => {
      const file = source.canonicalCandidates(path)[0];
      if (!file) throw new Error(`缺少 ${path}`);
      return [key, await decode(await file.bytes())] as const;
    }));
    return Object.fromEntries(entries) as FuelHudTextures;
  } catch (error) {
    console.warn("油量表贴图未能载入：", error);
    return undefined;
  }
}

/** The bar texture for a fill ratio. */
export function gaugeTexture(ratio: number): keyof FuelHudTextures {
  if (ratio < 0.2) return "low";
  if (ratio < 0.6) return "half";
  return "full";
}

/** Paints the HUD into a canvas of width × height device pixels. */
export function paintFuelHud(context: CanvasRenderingContext2D, width: number, height: number,
  state: FuelHudState, now: number, textures?: FuelHudTextures): void {
  context.clearRect(0, 0, width, height);
  const scale = Math.max(0.6, height / 600);
  const ratio = state.capacityMl > 0 ? Math.min(1, state.fuelMl / state.capacityMl) : 0;
  const warning = fuelWarning(ratio, state.empty);
  const blink = warning === "critical" || warning === "empty" ? Math.floor(now / 400) % 2 === 0 : false;

  // The gauge, bottom right (the chat sits bottom left, the tachometer bottom centre).
  const boxWidth = BOX.width * scale, boxHeight = BOX.height * scale;
  const x = width - boxWidth - 16 * scale, y = height - boxHeight - 16 * scale;
  const bar = { x: x + BOX.bar.x * scale, y: y + BOX.bar.y * scale, width: BOX.bar.width * scale, height: BOX.bar.height * scale };
  const face = { x: x + BOX.face.x * scale, y: y + BOX.face.y * scale, width: BOX.face.width * scale, height: BOX.face.height * scale };
  if (textures) {
    context.drawImage(textures.box, x, y, boxWidth, boxHeight);
    if (ratio > 0 && !(warning === "critical" && !blink)) {
      const texture = textures[gaugeTexture(ratio)];
      context.drawImage(texture, 0, 0, BOX.bar.width * ratio, BOX.bar.height, bar.x, bar.y, bar.width * ratio, bar.height);
    }
  } else {
    board(context, x, y, boxWidth, boxHeight, scale);
    context.fillStyle = "rgba(0, 10, 30, 0.85)";
    context.fillRect(bar.x, bar.y, bar.width, bar.height);
    if (ratio > 0) {
      context.fillStyle = gaugeColor(ratio);
      context.fillRect(bar.x, bar.y, bar.width * ratio, bar.height);
    }
  }
  // The face slot: a fuel pump, red while the tank is (nearly) dry.
  const pumpSize = face.height * 0.86;
  paintPump(context, face.x + (face.width - pumpSize * 0.86) / 2, face.y + (face.height - pumpSize) / 2, pumpSize,
    warning === "empty" || warning === "critical" ? (blink ? "#ff5c5c" : "#ffd23f") : warning === "low" ? "#ffd23f" : "white");
  // Litres over the bar, the tank class at its end, the range and the nearest station above the box.
  label(context, `${liters(state.fuelMl)} / ${liters(state.capacityMl)} L`, bar.x, y + 8 * scale, 12 * scale,
    warning ? gaugeColor(ratio) : "white");
  label(context, `${tankClassName(state.sizeClass)}油箱`, bar.x + bar.width, y + 8 * scale, 11 * scale, CYAN, "right");
  const rangeText = state.empty ? "油箱空了 · 已熄火" : `可行驶 ${distanceText(state.rangeMeters)}`;
  label(context, rangeText, x + boxWidth, y - 10 * scale, 12 * scale,
    state.empty ? "#ff8080" : warning ? gaugeColor(ratio) : "white", "right");
  if (state.nearest) {
    const text = `${state.nearest.name} ${distanceText(state.nearest.distance)}`;
    context.font = `bold ${12 * scale}px ${FONT}`;
    const textWidth = context.measureText(text).width;
    label(context, text, x + boxWidth, y - 28 * scale, 12 * scale, "white", "right");
    arrow(context, x + boxWidth - textWidth - 12 * scale, y - 28 * scale, 7 * scale, state.nearest.bearing);
  }

  // Warnings and the prompt, upper centre: clear of the kart and the tachometer.
  let banner: { text: string; color: string; key: boolean } | undefined;
  switch (state.prompt.kind) {
    case "refuel": banner = { text: state.prompt.text, color: CYAN, key: true }; break;
    case "rescue": banner = { text: state.prompt.text, color: "#ff8080", key: true }; break;
    case "slow-down": case "full": banner = { text: state.prompt.text, color: "white", key: false }; break;
    default:
      if (warning === "critical") banner = { text: "油量严重不足，请尽快到加油站加油！", color: "#ff8080", key: false };
      else if (warning === "low") banner = { text: "油量不足，请留意附近的加油站", color: "#ffd23f", key: false };
  }
  if (banner) {
    context.font = `bold ${15 * scale}px ${FONT}`;
    const keyWidth = banner.key ? 30 * scale : 0;
    const textWidth = context.measureText(banner.text).width;
    const bannerWidth = textWidth + keyWidth + 36 * scale, bannerHeight = 36 * scale;
    const bx = (width - bannerWidth) / 2, by = height * 0.2;
    board(context, bx, by, bannerWidth, bannerHeight, scale, banner.color === CYAN ? BOARD_EDGE : banner.color);
    let tx = bx + 18 * scale;
    if (banner.key) {
      roundedRect(context, tx, by + 7 * scale, 22 * scale, 22 * scale, 4 * scale);
      context.fillStyle = "#15213a";
      context.fill();
      context.lineWidth = 1.5 * scale;
      context.strokeStyle = "rgba(255, 255, 255, 0.85)";
      context.stroke();
      label(context, "F", tx + 11 * scale, by + 18.5 * scale, 13 * scale, "white", "center");
      tx += keyWidth;
    }
    label(context, banner.text, tx, by + bannerHeight / 2 + 1, 15 * scale, banner.color);
  }
  if (state.empty && blink) label(context, "油箱空了！", width / 2, height * 0.32, 34 * scale, "#ff5c5c", "center");
}

/** The HUD canvas: sized to the race view, redrawn every frame. */
export class FuelHud {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private textures?: FuelHudTextures;
  disposed = false;

  constructor(readonly root: HTMLElement, library?: unknown) {
    if (library) void loadFuelHudTextures(library).then(textures => { this.textures = textures; });
    this.canvas = document.createElement("canvas");
    this.canvas.className = "kartcity-fuel-hud";
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "4",
    });
    root.append(this.canvas);
    this.context = this.canvas.getContext("2d")!;
  }

  draw(state: FuelHudState, now: number): void {
    if (this.disposed) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.round(this.root.clientWidth * ratio), height = Math.round(this.root.clientHeight * ratio);
    if (!width || !height) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    paintFuelHud(this.context, width, height, state, now, this.textures);
  }

  /** Nothing drawn (the rider is not driving). */
  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
  }
}
