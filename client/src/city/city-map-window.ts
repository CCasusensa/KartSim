/**
 * 卡丁城地图 (M): the city's own minimap image (track_kartcity/xt_minimap.png,
 * the SurfaceMinimap the importer writes) in a release CaptionDialog, with
 * where the rider is, where its kart stands, the gas stations and the other
 * members. M or Esc closes it.
 */
import { te } from "../generated/library.js";
import { FONT, node, nodeName, type BmlLibrary, type Node, type Rect, type WindowView } from "../ui/bml-kit";
import { paintKeyBadge } from "../ui/kick-vote-window";
import { CITY_MAP } from "./city-track";
import { paintPump } from "./city-fuel-hud";
import { FUEL_STATIONS } from "./city-fuel";

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];
export const CITY_MINIMAP_PATH = "track_kartcity/xt_minimap.png";
/** The image is 1024² with the extent's longer side over 944 px (surface-minimap.mjs). */
const IMAGE = 1024, SPAN = 944;

export interface CityMapMarkers {
  me?: { x: number; z: number; heading: number };
  /** The own kart (parked or driven by someone). */
  kart?: { x: number; z: number; locked: boolean; driven: boolean };
  others: Array<{ x: number; z: number }>;
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

export function paintCityMap(context: CanvasRenderingContext2D, rect: Rect, image: CanvasImageSource | undefined,
  markers: CityMapMarkers): void {
  context.save();
  context.fillStyle = "#1a4aa0";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  // Only the map's extent (the image has margins around it), as large as the panel allows.
  const [[x0, z0], [x1, z1]] = CITY_MAP.meta.extent as number[][] as [[number, number], [number, number]];
  const from = minimapPixel(x0, z0), to = minimapPixel(x1, z1);
  const sourceWidth = to.x - from.x, sourceHeight = to.y - from.y;
  const fit = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const width = sourceWidth * fit, height = sourceHeight * fit;
  const left = rect.x + (rect.width - width) / 2, top = rect.y + (rect.height - height) / 2;
  if (image) context.drawImage(image, from.x, from.y, sourceWidth, sourceHeight, left, top, width, height);
  const at = (x: number, z: number) => {
    const p = minimapPixel(x, z);
    return { x: left + (p.x - from.x) * fit, y: top + (p.y - from.y) * fit };
  };
  for (const other of markers.others) {
    const p = at(other.x, other.z);
    context.fillStyle = "#ffd23f";
    context.beginPath();
    context.arc(p.x, p.y, 3, 0, Math.PI * 2);
    context.fill();
  }
  for (const station of FUEL_STATIONS) {
    const p = at(station.x, station.z);
    paintPump(context, p.x - 6, p.y - 8, 14, "#ff9a3c");
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
  if (markers.me) {
    const p = at(markers.me.x, markers.me.z);
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
  }
  context.restore();
}

export function cityMapWindowDefinition(): Node {
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "cityMapWnd", frame: "CaptionDialog", leftTopWH: "0 0 600 620",
      caption: "卡丁城地图", captionColor: "black", align: "center" }, [
      node("Panel", { name: "cityMap", leftTopWH: "0 10 540 500", align: "hcenter" }),
      node("Window", { frame: "HSection", leftTopWH: "0 0 540 1", align: "hcenter;bottom", adjust: "0 64" }),
      node("Container", { leftTopWH: "0 0 155 42", align: "hcenter;bottom", adjust: "0 12" }, [
        node("TextButton", { name: "okButton", leftTopWH: "0 0 155 42", text: "关闭", textRender: "bold16",
          textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104", disabledTextColor: "255 220 220 220" }),
        node("Panel", { name: "closeKey", leftTopWH: "103 11 44 20" }),
      ]),
    ]),
  ]);
}

export interface CityMapWindow { dispose(): void }

/** Opens the map; markers() is read on every redraw (twice a second). */
export async function showCityMapWindow(options: { library: BmlLibrary; root: HTMLElement }, image: CanvasImageSource | undefined,
  markers: () => CityMapMarkers, close: () => void,
  loadView: (loaded: Record<string, unknown>) => Promise<unknown> = loaded => te.load(loaded as never)): Promise<CityMapWindow> {
  let timer: ReturnType<typeof setInterval> | undefined;
  const view = await loadView({
    library: options.library, root: options.root, definition: cityMapWindowDefinition(), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: "卡丁城地图",
    onCancel: () => close(), onConfirm: () => close(),
    state: (entry: Node) => {
      switch (nodeName(entry)) {
        case "cityMap": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintCityMap(context, rect, image, markers()) };
        case "okButton": return { label: "关闭（M）", action: () => close() };
        case "closeKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintKeyBadge(context, rect, "M") };
      }
      return {};
    },
  }) as WindowView;
  timer = setInterval(() => view.render(), 500);
  view.show();
  view.focus("okButton");
  return { dispose() { if (timer) clearInterval(timer); timer = undefined; view.dispose(); } };
}
