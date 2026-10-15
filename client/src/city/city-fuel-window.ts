import { tr } from "../i18n/locale";
/**
 * The 卡丁城 加油 and 道路救援 windows, drawn by the release window renderer
 * like the 踢出投票 window: a CaptionDialog with painted boards and
 * TextButtons, Enter to confirm and Esc to cancel.
 *
 * 加油: the station's name as caption, the kart and its tank, a gauge with
 * the fuel now and what the refill adds, −5 L / +5 L / 加满, the cost and
 * the wallet, then 加油 / 取消. 道路救援: the tow truck, where it tows to,
 * the fee (free when the wallet holds less), then 呼叫救援 / 取消.
 */
import { te } from "../generated/library.js";
import { FONT, node, nodeName, type BmlLibrary, type Node, type Rect, type WindowView } from "../ui/bml-kit";
import { paintKeyBadge } from "../ui/kick-vote-window";
import { defaultRefuelMl, distanceText, liters, refuelCost, stepRefuelMl, tankClassName, tankFull } from "./city-fuel";
import type { CityFuel } from "./city-protocol";
import { gaugeColor, paintPump } from "./city-fuel-hud";

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];
const TEXT = "rgb(42,55,80)";
const BLUE = "#1a5fd0";
const RED = "#d0352b";

export interface FuelWindowOptions {
  library: BmlLibrary;
  root: HTMLElement;
}

type LoadView = (loaded: Record<string, unknown>) => Promise<unknown>;
const defaultLoadView: LoadView = loaded => te.load(loaded as never);

export interface FuelWindow {
  busy: boolean;
  setBusy(busy: boolean): void;
  dispose(): void;
}

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

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number,
  color = TEXT, align: CanvasTextAlign = "left"): void {
  context.font = `bold ${size}px ${FONT}`;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(value, x, y);
}

const amount = (value: number): string => value.toLocaleString("zh-CN");

function blueBoard(context: CanvasRenderingContext2D, rect: Rect): void {
  const fill = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
  fill.addColorStop(0, "#2a66c7");
  fill.addColorStop(1, "#1a4aa0");
  context.fillStyle = fill;
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, 4);
  context.fill();
}

/** The kart, its tank and the gauge: fuel now (green) and the refill (cyan). */
export function paintRefuelGauge(context: CanvasRenderingContext2D, rect: Rect, fuel: CityFuel, addMl: number): void {
  context.save();
  blueBoard(context, rect);
  const { x, y, width } = rect;
  paintPump(context, x + 14, y + 12, 34, "#5fe3ff");
  context.font = `bold 16px ${FONT}`;
  text(context, fuel.kartName, x + 58, y + 22, 16, "white");
  text(context, tr("{value0}油箱 · {value1} L", { value0: tankClassName(fuel.sizeClass), value1: liters(fuel.capacityMl) }), x + width - 14, y + 22, 13,
    "#bfe6ff", "right");
  const barX = x + 14, barY = y + 52, barWidth = width - 28, barHeight = 22;
  context.fillStyle = "#0b2554";
  roundedRect(context, barX, barY, barWidth, barHeight, 4);
  context.fill();
  const now = Math.min(1, fuel.fuelMl / fuel.capacityMl);
  const after = Math.min(1, (fuel.fuelMl + addMl) / fuel.capacityMl);
  context.fillStyle = gaugeColor(now);
  context.fillRect(barX + 2, barY + 2, (barWidth - 4) * now, barHeight - 4);
  context.fillStyle = "rgba(95, 227, 255, 0.85)";
  context.fillRect(barX + 2 + (barWidth - 4) * now, barY + 2, (barWidth - 4) * (after - now), barHeight - 4);
  text(context, tr("当前 {value0} L", { value0: liters(fuel.fuelMl) }), x + 14, y + 92, 14, "white");
  text(context, tr("加油后 {value0} L", { value0: liters(fuel.fuelMl + addMl) }), x + width - 14, y + 92, 14, "#5fe3ff", "right");
  context.restore();
}

/** The amount, the cost and the wallet. */
export function paintRefuelCost(context: CanvasRenderingContext2D, rect: Rect, fuel: CityFuel, addMl: number): void {
  context.save();
  const cost = refuelCost(addMl, fuel.pricePerLiter);
  const short = cost > fuel.lucci;
  const middle = rect.y + rect.height / 2;
  text(context, tr("加油量"), rect.x + 6, middle - 13, 14);
  text(context, `${liters(addMl)} L`, rect.x + 6, middle + 13, 20, BLUE);
  text(context, tr("单价 {value0} 金币/L", { value0: fuel.pricePerLiter }), rect.x + rect.width / 2, middle - 13, 13, TEXT, "center");
  text(context, tr("费用 {value0} 金币", { value0: amount(cost) }), rect.x + rect.width / 2, middle + 13, 16, short ? RED : TEXT, "center");
  text(context, tr("余额"), rect.x + rect.width - 6, middle - 13, 14, TEXT, "right");
  text(context, tr("{value0} 金币", { value0: amount(fuel.lucci) }), rect.x + rect.width - 6, middle + 13, 16, short ? RED : TEXT, "right");
  context.restore();
}

export function refuelWindowDefinition(stationName: string): Node {
  const button = (name: string, left: number, top: number, w: number, label: string, primary: boolean): Node =>
    node("TextButton", { name, leftTopWH: `${left} ${top} ${w} 42`, text: label, textRender: "bold16",
      ...(primary ? { textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104",
        disabledTextColor: "255 220 220 220" }
        : { textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52",
          disabledTextColor: "255 131 131 131" }) });
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "refuelWnd", frame: "CaptionDialog", leftTopWH: "0 0 520 420",
      caption: stationName, captionColor: "black", align: "center" }, [
      node("Panel", { name: "refuelGauge", leftTopWH: "0 14 470 110", align: "hcenter" }),
      node("Container", { leftTopWH: "0 136 470 42", align: "hcenter" }, [
        button("lessButton", 0, 0, 150, "－5 L", false),
        button("moreButton", 160, 0, 150, "＋5 L", false),
        button("fullButton", 320, 0, 150, tr("加满"), false),
      ]),
      node("Panel", { name: "refuelCost", leftTopWH: "0 190 470 66", align: "hcenter" }),
      node("Window", { frame: "HSection", leftTopWH: "0 0 470 1", align: "hcenter;bottom", adjust: "0 64" }),
      node("Container", { leftTopWH: "0 0 330 42", align: "hcenter;bottom", adjust: "0 12" }, [
        button("okButton", 0, 0, 155, tr("加油"), true),
        button("cancelButton", 175, 0, 155, tr("取消"), false),
        node("Panel", { name: "okKey", leftTopWH: "101 11 48 20" }),
        node("Panel", { name: "cancelKey", leftTopWH: "284 11 38 20" }),
      ]),
    ]),
  ]);
}

/**
 * Opens the 加油 window; buy(addMl) runs on 加油 (Enter). `fuel()` is read
 * on every redraw so a city-fuel update shows at once.
 */
export async function showRefuelWindow(options: FuelWindowOptions, stationName: string, fuel: () => CityFuel,
  buy: (addMl: number) => void, cancel: () => void, loadView: LoadView = defaultLoadView): Promise<FuelWindow> {
  let addMl = defaultRefuelMl(fuel());
  let view: WindowView;
  const window: FuelWindow = {
    busy: false,
    setBusy(busy) {
      window.busy = busy;
      // Back from a reply (a stale one re-read the tank): the amount fits the tank again.
      if (!busy) addMl = Math.min(addMl, defaultRefuelMl(fuel()));
      view.render();
      // Disabling the buttons dropped the focus; once enabled again, Enter confirms.
      if (!busy) view.focus("okButton");
    },
    dispose() { view.dispose(); },
  };
  const change = (next: number) => { if (!window.busy) { addMl = next; view.render(); } };
  const confirm = () => {
    if (window.busy) return;
    if (addMl > 0 && refuelCost(addMl, fuel().pricePerLiter) <= fuel().lucci) buy(addMl);
  };
  view = await loadView({
    library: options.library, root: options.root, definition: refuelWindowDefinition(stationName), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: stationName,
    onCancel: () => { if (!window.busy) cancel(); }, onConfirm: confirm,
    state: (entry: Node) => {
      const current = fuel();
      const room = Math.max(0, current.capacityMl - current.fuelMl);
      addMl = Math.min(addMl, room);
      switch (nodeName(entry)) {
        case "refuelGauge": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintRefuelGauge(context, rect, current, addMl) };
        case "refuelCost": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
          paintRefuelCost(context, rect, current, addMl) };
        case "lessButton": return { disabled: window.busy || addMl <= 0, label: tr("少加 5 升"),
          action: () => change(stepRefuelMl(current, addMl, -5)) };
        case "moreButton": return { disabled: window.busy || addMl >= defaultRefuelMl(current), label: tr("多加 5 升"),
          action: () => change(stepRefuelMl(current, addMl, 5)) };
        case "fullButton": return { disabled: window.busy || addMl >= defaultRefuelMl(current), label: tr("加满"),
          action: () => change(defaultRefuelMl(current)) };
        case "okButton": return { disabled: window.busy || addMl <= 0 || tankFull(current) ||
          refuelCost(addMl, current.pricePerLiter) > current.lucci, label: tr("加油（Enter）"), action: confirm };
        case "cancelButton": return { disabled: window.busy, label: tr("取消（Esc）"), action: () => cancel() };
        case "okKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintKeyBadge(context, rect, "ENTER") };
        case "cancelKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintKeyBadge(context, rect, "ESC") };
      }
      return {};
    },
  }) as WindowView;
  view.show();
  view.focus("okButton");
  return window;
}

/** A tow truck with the hook down. */
export function paintTowTruck(context: CanvasRenderingContext2D, rect: Rect): void {
  const size = Math.min(rect.width / 1.6, rect.height);
  const x = rect.x + (rect.width - size * 1.6) / 2, y = rect.y + (rect.height - size) / 2;
  context.save();
  context.fillStyle = "#f2a23a";
  roundedRect(context, x, y + size * 0.36, size * 1.1, size * 0.4, 5);
  context.fill();
  context.fillStyle = "#e0822a";
  roundedRect(context, x + size * 1.02, y + size * 0.16, size * 0.5, size * 0.6, 6);
  context.fill();
  context.fillStyle = "#cfe9ff";
  roundedRect(context, x + size * 1.12, y + size * 0.24, size * 0.3, size * 0.2, 3);
  context.fill();
  context.strokeStyle = "#5a6478";
  context.lineWidth = size * 0.06;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x + size * 0.7, y + size * 0.36);
  context.lineTo(x + size * 0.1, y + size * 0.04);
  context.lineTo(x - size * 0.02, y + size * 0.3);
  context.stroke();
  context.fillStyle = "#2c3446";
  for (const wheel of [0.28, 1.2]) {
    context.beginPath();
    context.arc(x + size * wheel, y + size * 0.8, size * 0.16, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#ffd23f";
  context.fillRect(x + size * 1.3, y + size * 0.08, size * 0.12, size * 0.08);
  context.restore();
}

export function rescueWindowDefinition(): Node {
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "rescueWnd", frame: "CaptionDialog", leftTopWH: "0 0 520 370",
      caption: tr("道路救援"), captionColor: "black", align: "center" }, [
      node("Panel", { name: "rescueIcon", leftTopWH: "0 12 150 62", align: "hcenter" }),
      node("Panel", { name: "rescueText", leftTopWH: "0 84 470 76", align: "hcenter" }),
      node("Panel", { name: "rescueFee", leftTopWH: "0 168 440 58", align: "hcenter" }),
      node("Window", { frame: "HSection", leftTopWH: "0 0 470 1", align: "hcenter;bottom", adjust: "0 64" }),
      // 呼叫救援 is twice as long as 加油: a wider button keeps it clear of the ENTER badge.
      node("Container", { leftTopWH: "0 0 365 42", align: "hcenter;bottom", adjust: "0 12" }, [
        node("TextButton", { name: "okButton", leftTopWH: "0 0 190 42", text: tr("呼叫救援"), textRender: "bold16",
          textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104",
          disabledTextColor: "255 220 220 220" }),
        node("TextButton", { name: "cancelButton", leftTopWH: "210 0 155 42", text: tr("取消"), textRender: "bold16",
          textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52",
          disabledTextColor: "255 131 131 131" }),
        node("Panel", { name: "okKey", leftTopWH: "136 11 48 20" }),
        node("Panel", { name: "cancelKey", leftTopWH: "319 11 38 20" }),
      ]),
    ]),
  ]);
}

/** The fee board: what the tow costs, or that it is free this time. */
export function paintRescueFee(context: CanvasRenderingContext2D, rect: Rect, fuel: CityFuel): void {
  context.save();
  blueBoard(context, rect);
  const middle = rect.y + rect.height / 2;
  if (fuel.rescueFee <= 0) {
    text(context, tr("本次救援免费"), rect.x + rect.width / 2, middle, 18, "white", "center");
  } else if (fuel.lucci < fuel.rescueFee) {
    text(context, tr("救援费用 {value0} 金币", { value0: amount(fuel.rescueFee) }), rect.x + rect.width / 2, middle - 12, 16, "white", "center");
    text(context, tr("金币不足，本次免费救援"), rect.x + rect.width / 2, middle + 12, 14, "#ffd23f", "center");
  } else {
    text(context, tr("救援费用 {value0} 金币", { value0: amount(fuel.rescueFee) }), rect.x + 18, middle, 18, "white");
    text(context, tr("余额 {value0} 金币", { value0: amount(fuel.lucci) }), rect.x + rect.width - 18, middle, 14, "#bfe6ff", "right");
  }
  context.restore();
}

/** Opens the 道路救援 window; call() runs on 呼叫救援 (Enter). */
export async function showRescueWindow(options: FuelWindowOptions, fuel: () => CityFuel,
  destination: () => { name: string; distance: number } | undefined, call: () => void, cancel: () => void,
  loadView: LoadView = defaultLoadView): Promise<FuelWindow> {
  let view: WindowView;
  const window: FuelWindow = {
    busy: false,
    setBusy(busy) { window.busy = busy; view.render(); if (!busy) view.focus("okButton"); },
    dispose() { view.dispose(); },
  };
  const confirm = () => { if (!window.busy) call(); };
  view = await loadView({
    library: options.library, root: options.root, definition: rescueWindowDefinition(), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: tr("道路救援"),
    onCancel: () => { if (!window.busy) cancel(); }, onConfirm: confirm,
    state: (entry: Node) => {
      switch (nodeName(entry)) {
        case "rescueIcon": return { paint: paintTowTruck };
        case "rescueText": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
          const target = destination();
          const middle = rect.x + rect.width / 2;
          text(context, tr("油箱空了，车已熄火。"), middle, rect.y + 14, 16, TEXT, "center");
          text(context, tr("救援车会把你的车拖到最近的加油站："), middle, rect.y + 40, 15, TEXT, "center");
          text(context, target ? tr("{value0}（约 {value1}）", { value0: target.name, value1: distanceText(target.distance) }) : tr("最近的加油站"), middle,
            rect.y + 64, 16, BLUE, "center");
        } };
        case "rescueFee": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintRescueFee(context, rect, fuel()) };
        case "okButton": return { disabled: window.busy, label: tr("呼叫救援（Enter）"), action: confirm };
        case "cancelButton": return { disabled: window.busy, label: tr("取消（Esc）"), action: () => cancel() };
        case "okKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintKeyBadge(context, rect, "ENTER") };
        case "cancelKey": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintKeyBadge(context, rect, "ESC") };
      }
      return {};
    },
  }) as WindowView;
  view.show();
  view.focus("okButton");
  return window;
}
