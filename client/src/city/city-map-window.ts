/**
 * 卡丁城地图 (M): the city's own minimap image (track_kartcity/xt_minimap.png,
 * the SurfaceMinimap the importer writes) in a release CaptionDialog, with
 * where the rider is, where its kart stands, the gas stations and the other
 * members, and the navigation: a click on the map (or a gas station, or the
 * side buttons) sets a destination and the green route to it shows here and
 * on the HUD minimap (city-navigator.ts). The wheel zooms at the cursor, a
 * drag pans, a right click clears the route. M or Esc closes it.
 */
import { te } from "../generated/library.js";
import { FONT, node, nodeName, type BmlLibrary, type Node, type Rect, type WindowView } from "../ui/bml-kit";
import { paintKeyBadge } from "../ui/kick-vote-window";
import { CITY_MAP } from "./city-track";
import { paintPump } from "./city-fuel-hud";
import { paintMark } from "./city-quest-markers";
import { FUEL_STATIONS, nearestStation } from "./city-fuel";
import type { CityNav } from "./city-nav";
import { distanceLabel, type CityNavigator } from "./city-navigator";
import { paintPin, ROUTE_CORE, ROUTE_RIM } from "./city-route-minimap";

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];
export const CITY_MINIMAP_PATH = "track_kartcity/xt_minimap.png";
/** The image is 1024² with the extent's longer side over 944 px (surface-minimap.mjs). */
const IMAGE = 1024, SPAN = 944;
/** The sea colour of the minimap image. */
const SEA = "rgb(34, 82, 108)";

/**
 * What the map shows at zoom 1: the road network's bounds (x −2625…−189,
 * z −1781…1475, tools/city/build-city-nav.mjs) with a margin.
 */
export const MAP_CONTENT = { x0: -2745, z0: -1900, x1: -70, z1: 1595 };
export const MIN_ZOOM = 1, MAX_ZOOM = 10;
/** The corner of the map (stage px from its top right) the zoom buttons cover. */
const CONTROLS = { width: 76, height: 148 };
/** One ＋/－ press. */
export const ZOOM_STEP = 1.6;
/** A press that moves less than this (stage px) is a click, not a drag. */
const CLICK_SLOP = 6;

export interface CityMapMarkers {
  me?: { x: number; z: number; heading: number; y?: number };
  /** The own kart (parked or driven by someone). */
  kart?: { x: number; z: number; locked: boolean; driven: boolean };
  others: Array<{ x: number; z: number }>;
  /** The quest under way (CITY-QUESTS.md). */
  quest?: CityMapQuest;
}

/**
 * A quest on the map: a gold "?" where it can be finished and a "★" at each
 * collection stop still to reach (like the marks in the city), and a
 * search's area as a dashed gold circle.
 */
export interface CityMapQuest {
  marks: Array<{ mark: "?" | "★"; x: number; z: number; label: string }>;
  area?: { x: number; z: number; radius: number; label: string };
}

/** Design x/z → pixel of the 1024² minimap image. */
export function minimapPixel(x: number, z: number): { x: number; y: number } {
  const [[x0, z0], [x1, z1]] = CITY_MAP.meta.extent as number[][] as [[number, number], [number, number]];
  const scale = SPAN / Math.max(x1 - x0, z1 - z0);
  return { x: IMAGE / 2 + (x - (x0 + x1) / 2) * scale, y: IMAGE / 2 + (z - (z0 + z1) / 2) * scale };
}

interface LibraryFile { virtualPath?: string; bytes(): Promise<Uint8Array> }

export async function loadCityMinimap(library: unknown): Promise<CanvasImageSource | undefined> {
  const files = (library as { files?: LibraryFile[] }).files ?? [];
  const file = files.find(entry => entry.virtualPath?.toLowerCase() === CITY_MINIMAP_PATH);
  if (!file) return undefined;
  return createImageBitmap(new Blob([await file.bytes() as BlobPart], { type: "image/png" }));
}

// ---- the view: a design centre and a zoom over MAP_CONTENT ----

export interface MapView { cx: number; cz: number; zoom: number }

export function initialView(): MapView {
  return { cx: (MAP_CONTENT.x0 + MAP_CONTENT.x1) / 2, cz: (MAP_CONTENT.z0 + MAP_CONTENT.z1) / 2, zoom: 1 };
}

/** Screen pixels per meter. */
export function viewScale(view: MapView, rect: Rect): number {
  return Math.min(rect.width / (MAP_CONTENT.x1 - MAP_CONTENT.x0), rect.height / (MAP_CONTENT.z1 - MAP_CONTENT.z0)) * view.zoom;
}

export function toScreen(view: MapView, rect: Rect, x: number, z: number): { x: number; y: number } {
  const scale = viewScale(view, rect);
  return { x: rect.x + rect.width / 2 + (x - view.cx) * scale, y: rect.y + rect.height / 2 + (z - view.cz) * scale };
}

export function toDesign(view: MapView, rect: Rect, x: number, y: number): { x: number; z: number } {
  const scale = viewScale(view, rect);
  return { x: view.cx + (x - rect.x - rect.width / 2) / scale, z: view.cz + (y - rect.y - rect.height / 2) / scale };
}

/** The view showing all of points (design x/z) with room around them, zoomed in at most to maxZoom. */
export function fitView(points: ReadonlyArray<{ x: number; z: number }>, rect: Rect, maxZoom: number): MapView {
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  // 120 m around them: the labels over the marks and the panel's edges.
  const width = x1 - x0 + 240, height = z1 - z0 + 240;
  const zoom = Math.min(rect.width / width, rect.height / height) / viewScale({ cx: 0, cz: 0, zoom: 1 }, rect);
  return clampView({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, zoom: Math.min(maxZoom, zoom) }, rect);
}

/** Keeps the content on screen: the centre stays where the view does not leave it. */
export function clampView(view: MapView, rect: Rect): MapView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const scale = viewScale({ ...view, zoom }, rect);
  const halfWidth = rect.width / 2 / scale, halfHeight = rect.height / 2 / scale;
  const clamp = (value: number, low: number, high: number) => low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));
  return { zoom, cx: clamp(view.cx, MAP_CONTENT.x0 + halfWidth, MAP_CONTENT.x1 - halfWidth),
    cz: clamp(view.cz, MAP_CONTENT.z0 + halfHeight, MAP_CONTENT.z1 - halfHeight) };
}

/** Zooms by factor keeping the design point under (x, y) where it is. */
export function zoomAt(view: MapView, rect: Rect, x: number, y: number, factor: number): MapView {
  const anchor = toDesign(view, rect, x, y);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const scale = viewScale({ ...view, zoom }, rect);
  return clampView({ zoom, cx: anchor.x - (x - rect.x - rect.width / 2) / scale, cz: anchor.z - (y - rect.y - rect.height / 2) / scale }, rect);
}

/** The gas station drawn under a screen point (within the pump icon), if any. */
export function stationUnder(view: MapView, rect: Rect, x: number, y: number) {
  for (const station of FUEL_STATIONS) {
    const p = toScreen(view, rect, station.x, station.z);
    if (Math.abs(x - p.x) <= 10 && y >= p.y - 12 && y <= p.y + 8) return station;
  }
  return undefined;
}

// ---- painting ----

function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  context.font = `bold ${size}px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(4, 14, 36, 0.9)";
  context.strokeText(text, x, y);
  context.fillStyle = color;
  context.fillText(text, x, y);
}

/** The road layer: network road cells at 2 m, crisp when zoomed in past the image's 5 m pixels. */
export function roadLayer(nav: CityNav): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") return undefined;
  const x0 = Math.floor((MAP_CONTENT.x0 - nav.x0) / nav.cell), z0 = Math.floor((MAP_CONTENT.z0 - nav.z0) / nav.cell);
  const width = Math.ceil((MAP_CONTENT.x1 - MAP_CONTENT.x0) / nav.cell), height = Math.ceil((MAP_CONTENT.z1 - MAP_CONTENT.z0) / nav.cell);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const image = context.createImageData(width, height);
  for (let n = 0; n < nav.count; n++) {
    if (!nav.road[n]) continue;
    const cell = nav.nodeCell[n]!, x = (cell % nav.width) - x0, z = Math.floor(cell / nav.width) - z0;
    if (x < 0 || z < 0 || x >= width || z >= height) continue;
    image.data.set([220, 220, 201, 255], (z * width + x) * 4);
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export interface MapPaintState {
  view: MapView;
  image?: CanvasImageSource;
  roads?: CanvasImageSource;
  markers: CityMapMarkers;
  navigator?: CityNavigator;
  /** Stage point under the pointer (station highlight). */
  hover?: { x: number; y: number };
}

export function paintCityMap(context: CanvasRenderingContext2D, rect: Rect, state: MapPaintState): void {
  const { view, image, roads, markers, navigator } = state;
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.fillStyle = SEA;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  const at = (x: number, z: number) => toScreen(view, rect, x, z);
  // The image, cut to what the view shows.
  const topLeft = toDesign(view, rect, rect.x, rect.y), bottomRight = toDesign(view, rect, rect.x + rect.width, rect.y + rect.height);
  if (image) {
    const from = minimapPixel(topLeft.x, topLeft.z), to = minimapPixel(bottomRight.x, bottomRight.z);
    context.imageSmoothingEnabled = true;
    context.drawImage(image, from.x, from.y, to.x - from.x, to.y - from.y, rect.x, rect.y, rect.width, rect.height);
  }
  if (roads && view.zoom >= 2.5) {
    const sx = (topLeft.x - MAP_CONTENT.x0) / 2, sy = (topLeft.z - MAP_CONTENT.z0) / 2;
    context.globalAlpha = Math.min(1, (view.zoom - 2.5) / 1.5);
    context.drawImage(roads, sx, sy, (bottomRight.x - topLeft.x) / 2, (bottomRight.z - topLeft.z) / 2, rect.x, rect.y, rect.width, rect.height);
    context.globalAlpha = 1;
  }
  // The route under every marker.
  const route = navigator?.route ?? [];
  if (route.length > 1) {
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const [color, width] of [[ROUTE_RIM, 8], [ROUTE_CORE, 4.5]] as const) {
      context.beginPath();
      route.forEach((p, i) => { const s = at(p.x, p.z); if (i) context.lineTo(s.x, s.y); else context.moveTo(s.x, s.y); });
      context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
      context.lineWidth = width;
      context.stroke();
    }
  }
  for (const other of markers.others) {
    const p = at(other.x, other.z);
    context.fillStyle = "#ffd23f";
    context.strokeStyle = "rgba(4, 14, 36, 0.9)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(p.x, p.y, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  const hovered = state.hover ? stationUnder(view, rect, state.hover.x, state.hover.y) : undefined;
  for (const station of FUEL_STATIONS) {
    const p = at(station.x, station.z), big = station === hovered;
    paintPump(context, p.x - (big ? 8 : 6), p.y - (big ? 11 : 8), big ? 18 : 14, big ? "#ffc06a" : "#ff9a3c");
    if (big || view.zoom >= 3) label(context, station.name, p.x, p.y - 18, 12, "#ffe0b0");
  }
  if (markers.kart) {
    const p = at(markers.kart.x, markers.kart.z);
    context.fillStyle = "#ff5c5c";
    context.strokeStyle = "white";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect?.(p.x - 9, p.y - 6, 18, 12, 3);
    context.fill();
    context.stroke();
    label(context, markers.kart.driven ? "我的车（有人在开）" : markers.kart.locked ? "我的车 · 已上锁" : "我的车", p.x, p.y - 16, 13, "#ffb0b0");
  }
  if (markers.quest) {
    const area = markers.quest.area;
    if (area) paintSearchArea(context, at(area.x, area.z), area.radius * viewScale(view, rect), area.label);
    for (const mark of markers.quest.marks)
      paintQuestTarget(context, rect, at(mark.x, mark.z), mark.label, mark.mark);
  }
  const destination = navigator?.destination;
  if (destination) {
    const p = at(destination.x, destination.z);
    paintPin(context, p.x, p.y - 12, 11);
    label(context, destination.label, p.x, p.y - 34, 13, "#b8ffc0");
  }
  if (markers.me) {
    const p = at(markers.me.x, markers.me.z);
    context.save();
    context.translate(p.x, p.y);
    context.rotate((markers.me.heading * Math.PI) / 180);
    context.beginPath();
    context.moveTo(0, -11);
    context.lineTo(8, 8);
    context.lineTo(0, 4);
    context.lineTo(-8, 8);
    context.closePath();
    context.fillStyle = "#5fe3ff";
    context.fill();
    context.strokeStyle = "rgba(4, 14, 36, 0.9)";
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }
  paintScaleBar(context, rect, viewScale(view, rect));
  context.restore();
}

/**
 * The delivery's "?" at p (panel px); off the view it sits on the panel's
 * edge towards the target (clear of the scale bar), with a little arrow
 * pointing out.
 */
function paintQuestTarget(context: CanvasRenderingContext2D, rect: Rect, p: { x: number; y: number }, text: string,
  mark: "?" | "★" = "?"): void {
  const left = rect.x + 26, right = rect.x + rect.width - 26, top = rect.y + 30, bottom = rect.y + rect.height - 46;
  context.save();
  context.fillStyle = "#ffd21f";
  context.strokeStyle = "#5a2a00";
  context.lineWidth = 2;
  if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom + 30) {
    context.beginPath();
    context.arc(p.x, p.y, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    paintMark(context, mark, p.x, p.y - 5, mark === "★" ? 24 : 30);
    label(context, text, p.x, p.y - (mark === "★" ? 32 : 38), 13, "#ffe9a8");
  } else {
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const k = Math.min((right - cx) / Math.max(Math.abs(dx), 1e-6), (bottom - cy) / Math.max(Math.abs(dy), 1e-6));
    const x = cx + dx * k, y = cy + dy * k;
    context.save();
    context.translate(x, y);
    context.rotate(Math.atan2(dy, dx));
    context.beginPath();
    context.moveTo(24, 0);
    context.lineTo(13, -8);
    context.lineTo(13, 8);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
    paintMark(context, mark, x, y + 10, mark === "★" ? 22 : 28);
  }
  context.restore();
}

/** A search's area: a translucent gold disc with a dashed rim and its name. */
function paintSearchArea(context: CanvasRenderingContext2D, p: { x: number; y: number }, radius: number, text: string): void {
  context.save();
  context.beginPath();
  context.arc(p.x, p.y, Math.max(radius, 8), 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 210, 31, 0.18)";
  context.fill();
  context.setLineDash([8, 6]);
  context.lineWidth = 2.5;
  context.strokeStyle = "#ffd21f";
  context.stroke();
  context.setLineDash([]);
  label(context, text, p.x, p.y - Math.max(radius, 8) - 10, 13, "#ffe9a8");
  context.restore();
}

/** A 1-2-5 scale bar about 90 px long, bottom left. */
function paintScaleBar(context: CanvasRenderingContext2D, rect: Rect, scale: number): void {
  const target = 90 / scale;
  const step = 10 ** Math.floor(Math.log10(target));
  const meters = [1, 2, 5, 10].map(f => f * step).filter(m => m <= target).at(-1) ?? step;
  const width = meters * scale, x = rect.x + 14, y = rect.y + rect.height - 16;
  context.strokeStyle = "rgba(4, 14, 36, 0.9)";
  context.lineWidth = 5;
  context.beginPath(); context.moveTo(x, y); context.lineTo(x + width, y); context.stroke();
  context.strokeStyle = "white";
  context.lineWidth = 2.5;
  context.beginPath(); context.moveTo(x, y); context.lineTo(x + width, y); context.stroke();
  label(context, distanceLabel(meters), x + width / 2, y - 11, 12, "white");
}

/** The side panel: the trip and what to do. */
function paintNavInfo(context: CanvasRenderingContext2D, rect: Rect, navigator: CityNavigator | undefined): void {
  context.save();
  context.fillStyle = "rgb(24, 58, 128)";
  context.beginPath();
  context.roundRect?.(rect.x, rect.y, rect.width, rect.height, 6);
  context.fill();
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = "white";
  context.font = `bold 17px ${FONT}`;
  context.fillText("导航", rect.x + 14, rect.y + 12);
  const destination = navigator?.destination;
  context.font = `bold 15px ${FONT}`;
  if (!destination) {
    context.fillStyle = "rgb(200, 220, 255)";
    context.fillText("点击地图上的一点，", rect.x + 14, rect.y + 48);
    context.fillText("小地图会显示绿色路线。", rect.x + 14, rect.y + 72);
  } else {
    paintPin(context, rect.x + 22, rect.y + 58, 9);
    context.fillStyle = "#b8ffc0";
    context.fillText(destination.label, rect.x + 38, rect.y + 47);
    context.fillStyle = "white";
    context.font = `bold 22px ${FONT}`;
    const text = navigator!.status === "routing" ? "规划中…" : navigator!.status === "off-road" ? "离道路太远" : distanceLabel(navigator!.remaining);
    context.fillText(text, rect.x + 14, rect.y + 80);
    context.font = `13px ${FONT}`;
    context.fillStyle = "rgb(200, 220, 255)";
    context.fillText(navigator!.status === "off-road" ? "开回路上就会显示路线" : "按小地图上的绿线开", rect.x + 14, rect.y + 114);
  }
  context.restore();
}

function paintHelp(context: CanvasRenderingContext2D, rect: Rect): void {
  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = `14px ${FONT}`;
  let y = rect.y + 12;
  const row = (draw: (x: number, y: number) => void, text: string) => {
    draw(rect.x + 16, y);
    context.fillStyle = "rgb(64, 75, 95)";
    context.font = `14px ${FONT}`;
    context.fillText(text, rect.x + 36, y);
    y += 26;
  };
  row((x, cy) => {
    context.beginPath(); context.moveTo(x, cy - 8); context.lineTo(x + 6, cy + 6); context.lineTo(x, cy + 3); context.lineTo(x - 6, cy + 6); context.closePath();
    context.fillStyle = "#5fe3ff"; context.fill(); context.strokeStyle = "rgba(4,14,36,.9)"; context.lineWidth = 1.5; context.stroke();
  }, "我");
  row((x, cy) => { context.fillStyle = "#ff5c5c"; context.beginPath(); context.roundRect?.(x - 8, cy - 5, 16, 10, 3); context.fill(); }, "我的车");
  row((x, cy) => paintPump(context, x - 6, cy - 8, 14, "#ff9a3c"), "加油站（可点击）");
  row((x, cy) => { context.fillStyle = "#ffd23f"; context.beginPath(); context.arc(x, cy, 4, 0, Math.PI * 2); context.fill(); }, "其他玩家");
  row((x, cy) => paintPin(context, x, cy - 3, 8), "目的地");
  row((x, cy) => paintMark(context, "?", x, cy + 8, 22), "任务目标");
  row((x, cy) => paintMark(context, "★", x, cy + 7, 18), "收集点");
  row((x, cy) => {
    context.beginPath(); context.arc(x, cy, 7, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 210, 31, 0.25)"; context.fill();
    context.setLineDash([3, 3]); context.strokeStyle = "#d9a400"; context.lineWidth = 2; context.stroke(); context.setLineDash([]);
  }, "寻物范围");
  row((x, cy) => {
    context.lineCap = "round";
    context.strokeStyle = `#${ROUTE_RIM.toString(16).padStart(6, "0")}`; context.lineWidth = 7;
    context.beginPath(); context.moveTo(x - 8, cy); context.lineTo(x + 8, cy); context.stroke();
    context.strokeStyle = `#${ROUTE_CORE.toString(16).padStart(6, "0")}`; context.lineWidth = 4;
    context.beginPath(); context.moveTo(x - 8, cy); context.lineTo(x + 8, cy); context.stroke();
  }, "行驶路线");
  y += 8;
  context.fillStyle = "rgb(110, 120, 140)";
  context.font = `13px ${FONT}`;
  for (const line of ["＋ － 或滚轮缩放，拖动平移", "点击地图自动导航到那里", "右键清除导航"]) { context.fillText(line, rect.x + 16, y); y += 22; }
  context.restore();
}

export function cityMapWindowDefinition(): Node {
  const button = (name: string, top: number, text: string, primary = false): Node =>
    node("TextButton", { name, leftTopWH: `636 ${top} 236 42`, text, textRender: "bold16",
      ...(primary ? { textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104", disabledTextColor: "255 220 220 220" }
        : { textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52", disabledTextColor: "255 131 131 131" }) });
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "cityMapWnd", frame: "CaptionDialog", leftTopWH: "0 0 900 852",
      caption: "卡丁城地图", captionColor: "black", align: "center" }, [
      node("Panel", { name: "cityMap", leftTopWH: "22 10 600 760" }),
      // Zoom buttons over the map's top right corner (the wheel zooms too).
      node("TextButton", { name: "zoomInButton", leftTopWH: "572 22 40 40", text: "＋", textRender: "bold16",
        textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52", disabledTextColor: "255 170 170 170" }),
      node("TextButton", { name: "zoomOutButton", leftTopWH: "572 68 40 40", text: "－", textRender: "bold16",
        textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52", disabledTextColor: "255 170 170 170" }),
      node("TextButton", { name: "locateButton", leftTopWH: "552 114 60 36", text: "定位", textRender: "bold16",
        textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52", disabledTextColor: "255 170 170 170" }),
      node("Panel", { name: "navInfo", leftTopWH: "636 10 236 140" }),
      button("kartButton", 162, "去我的车"),
      button("stationButton", 214, "去最近的加油站"),
      button("clearButton", 266, "清除导航"),
      node("Panel", { name: "mapHelp", leftTopWH: "636 326 236 350" }),
      button("okButton", 728, "关闭", true),
      node("Panel", { name: "closeKey", leftTopWH: "800 739 44 20" }),
    ]),
  ]);
}

export interface CityMapWindow { dispose(): void }

export interface CityMapWindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
  image?: CanvasImageSource;
  markers(): CityMapMarkers;
  navigator?: CityNavigator;
  close(): void;
  notice(text: string): void;
  loadView?: (loaded: Record<string, unknown>) => Promise<unknown>;
}

/** Stage coordinates (1600×900) of a pointer event over the window element. */
function stagePoint(element: HTMLElement, event: { clientX: number; clientY: number }): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: ((event.clientX - box.left) / Math.max(1, box.width)) * 1600, y: ((event.clientY - box.top) / Math.max(1, box.height)) * 900 };
}

/** Opens the map; markers() is read on every redraw. */
export async function showCityMapWindow(options: CityMapWindowOptions): Promise<CityMapWindow> {
  const { navigator } = options;
  const loadView = options.loadView ?? (loaded => te.load(loaded as never));
  let view = initialView();
  let mapRect: Rect | undefined;
  let hover: { x: number; y: number } | undefined;
  let roads: HTMLCanvasElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let windowView: WindowView | undefined;
  let disposed = false;
  const render = () => { if (!disposed) windowView?.render(); };
  void navigator?.ready().then(nav => { if (nav && !disposed) { roads = roadLayer(nav); render(); } });
  // Centre on the rider, a little zoomed in, the first time the map's size is
  // known; with a delivery under way, show the rider and where it goes.
  let centred = false;
  const centre = (rect: Rect) => {
    if (centred) return;
    centred = true;
    const { me, quest } = options.markers();
    const points: Array<{ x: number; z: number }> = [...(me ? [me] : []), ...(quest?.marks ?? [])];
    if (quest?.area) points.push({ x: quest.area.x - quest.area.radius, z: quest.area.z - quest.area.radius },
      { x: quest.area.x + quest.area.radius, z: quest.area.z + quest.area.radius });
    if (points.length > 1) view = fitView(points, rect, 2);
    else if (points[0]) view = clampView({ cx: points[0].x, cz: points[0].z, zoom: 2 }, rect);
  };
  /** The ＋/－ buttons zoom about the map's centre. */
  const zoomBy = (factor: number) => {
    if (!mapRect) return;
    view = zoomAt(view, mapRect, mapRect.x + mapRect.width / 2, mapRect.y + mapRect.height / 2, factor);
    render();
  };
  const go = async (x: number, z: number, label?: string) => {
    if (!navigator) return;
    const refusal = await navigator.setDestination(x, z, label);
    if (refusal) options.notice(refusal);
    render();
  };

  windowView = await loadView({
    library: options.library, root: options.root, definition: cityMapWindowDefinition(), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: "卡丁城地图",
    onCancel: () => options.close(), onConfirm: () => options.close(),
    state: (entry: Node) => {
      switch (nodeName(entry)) {
        case "cityMap": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
          mapRect = rect;
          centre(rect);
          view = clampView(view, rect);
          paintCityMap(context, rect, { view, image: options.image, roads, markers: options.markers(), navigator, hover });
        } };
        case "navInfo": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintNavInfo(context, rect, navigator) };
        case "mapHelp": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintHelp(context, rect) };
        case "kartButton": {
          const kart = options.markers().kart;
          return { disabled: !navigator || !kart, label: "导航到我的车",
            action: () => { if (kart) void go(kart.x, kart.z, "我的车"); } };
        }
        case "stationButton": return { disabled: !navigator, label: "导航到最近的加油站", action: () => {
          const me = options.markers().me;
          const nearest = me ? nearestStation(me.x, me.z) : undefined;
          if (nearest) void go(nearest.station.park.x, nearest.station.park.z, nearest.station.name);
        } };
        case "zoomInButton": return { disabled: view.zoom >= MAX_ZOOM, label: "放大地图", action: () => zoomBy(ZOOM_STEP) };
        case "zoomOutButton": return { disabled: view.zoom <= MIN_ZOOM, label: "缩小地图", action: () => zoomBy(1 / ZOOM_STEP) };
        case "locateButton": return { disabled: !options.markers().me, label: "回到我的位置", action: () => {
          const me = options.markers().me;
          if (me && mapRect) { view = clampView({ cx: me.x, cz: me.z, zoom: Math.max(view.zoom, 2) }, mapRect); render(); }
        } };
        case "clearButton": return { disabled: !navigator?.destination, label: "清除导航",
          action: () => { navigator?.clear(); render(); } };
        case "okButton": return { label: "关闭（M）", action: () => options.close() };
        case "closeKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintKeyBadge(context, rect, "M") };
      }
      return {};
    },
  }) as WindowView;

  // Pointer input over the map panel: wheel zoom, drag pan, click a destination, right click clears.
  const element = windowView.element;
  // The ＋/－/定位 buttons sit in the map's top right corner: presses there are theirs.
  const overControls = (p: { x: number; y: number }) => !!mapRect &&
    p.x >= mapRect.x + mapRect.width - CONTROLS.width && p.y <= mapRect.y + CONTROLS.height;
  const inside = (p: { x: number; y: number }) => !!mapRect && p.x >= mapRect.x && p.y >= mapRect.y &&
    p.x <= mapRect.x + mapRect.width && p.y <= mapRect.y + mapRect.height && !overControls(p);
  let press: { id: number; x: number; y: number; view: MapView; moved: boolean } | undefined;
  const onWheel = (event: WheelEvent) => {
    const p = stagePoint(element, event);
    if (!mapRect || !inside(p)) return;
    event.preventDefault();
    view = zoomAt(view, mapRect, p.x, p.y, Math.exp(-event.deltaY * 0.0015));
    render();
  };
  const onDown = (event: PointerEvent) => {
    const p = stagePoint(element, event);
    if (!mapRect || !inside(p)) return;
    event.preventDefault();
    if (event.button === 2) { navigator?.clear(); render(); return; }
    if (event.button !== 0) return;
    press = { id: event.pointerId, x: p.x, y: p.y, view, moved: false };
    element.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    const p = stagePoint(element, event);
    if (press && press.id === event.pointerId && mapRect) {
      const dx = p.x - press.x, dy = p.y - press.y;
      if (!press.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      press.moved = true;
      const scale = viewScale(press.view, mapRect);
      view = clampView({ ...press.view, cx: press.view.cx - dx / scale, cz: press.view.cz - dy / scale }, mapRect);
      render();
      return;
    }
    const next = inside(p) ? p : undefined;
    if (!!next !== !!hover || (next && mapRect && stationUnder(view, mapRect, next.x, next.y) !== (hover && stationUnder(view, mapRect, hover.x, hover.y)))) {
      hover = next;
      render();
    } else hover = next;
    element.style.cursor = next ? (mapRect && stationUnder(view, mapRect, next.x, next.y) ? "pointer" : "crosshair") : "";
  };
  const onUp = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    const moved = press.moved;
    press = undefined;
    element.releasePointerCapture?.(event.pointerId);
    if (moved || !mapRect) return;
    const p = stagePoint(element, event);
    const station = stationUnder(view, mapRect, p.x, p.y);
    if (station) { void go(station.park.x, station.park.z, station.name); return; }
    const at = toDesign(view, mapRect, p.x, p.y);
    void go(at.x, at.z);
  };
  const onMenu = (event: Event) => { if (mapRect && inside(stagePoint(element, event as MouseEvent))) event.preventDefault(); };
  // A modal window keeps every key it has the focus for: M closes the map from inside it too.
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== "KeyM" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    options.close();
  };
  element.addEventListener("keydown", onKey, true);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onUp);
  element.addEventListener("contextmenu", onMenu);

  // Markers move and the route follows the rider: redraw a few times a second.
  timer = setInterval(render, 250);
  windowView.show();
  windowView.focus("okButton");
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      element.removeEventListener("contextmenu", onMenu);
      element.removeEventListener("keydown", onKey, true);
      windowView?.dispose();
    },
  };
}
