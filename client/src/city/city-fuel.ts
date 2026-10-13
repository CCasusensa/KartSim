/**
 * 卡丁城加油 (server-go/FUEL.md), the browser's side: the gas stations of
 * the map, what the HUD shows between the node's city-fuel updates, and
 * when the 加油 / 道路救援 prompts apply. The node measures the driving and
 * owns the tank; the gauge only smooths it with the local odometer.
 */
import cityMap from "./city-map.json";
import type { CityFuel } from "./city-protocol";

export interface FuelStation {
  id: string;
  name: string;
  /** Design coordinates (x east, z south). */
  x: number;
  z: number;
  y: number;
  zone: Array<[number, number]>;
  park: { x: number; z: number; y: number; heading: number };
}

interface RawStation {
  id?: unknown; name?: unknown; kind?: unknown; at?: unknown; y?: unknown;
  zone?: unknown; park?: { at?: unknown; y?: unknown; heading?: unknown };
}

const pair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(v => typeof v === "number" && Number.isFinite(v));

/** The map's "fuel" POIs (stations without a usable zone or park are skipped). */
export function parseFuelStations(pois: readonly unknown[]): FuelStation[] {
  const stations: FuelStation[] = [];
  for (const raw of pois as RawStation[]) {
    if (!raw || raw.kind !== "fuel" || typeof raw.id !== "string" || !pair(raw.at) || !Array.isArray(raw.zone) ||
        raw.zone.length < 3 || !raw.zone.every(pair) || !raw.park || !pair(raw.park.at)) continue;
    stations.push({
      id: raw.id, name: typeof raw.name === "string" ? raw.name : "加油站",
      x: raw.at[0], z: raw.at[1], y: typeof raw.y === "number" ? raw.y : 0,
      zone: raw.zone as Array<[number, number]>,
      park: { x: raw.park.at[0], z: raw.park.at[1], y: typeof raw.park.y === "number" ? raw.park.y : 0,
        heading: typeof raw.park.heading === "number" ? raw.park.heading : 0 },
    });
  }
  return stations;
}

export const FUEL_STATIONS: readonly FuelStation[] = parseFuelStations((cityMap as { pois: unknown[] }).pois);

function inside(x: number, z: number, polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!, [xj, zj] = polygon[j]!;
    if ((zi > z) !== (zj > z) && x <= (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function segmentDistance(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = dx * dx + dz * dz;
  const t = length > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / length)) : 0;
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z);
}

/**
 * The station the design point x/z is at. The node allows 1.5 m outside the
 * zone; the prompt uses 1 m so it never offers what the node refuses.
 */
export function stationAt(x: number, z: number, stations: readonly FuelStation[] = FUEL_STATIONS,
  slack = 1): FuelStation | undefined {
  return stations.find(station => inside(x, z, station.zone) ||
    station.zone.some((point, i) => segmentDistance(x, z, station.zone[(i + station.zone.length - 1) % station.zone.length]!, point) <= slack));
}

/** The nearest station on the ground plane and its distance (m). */
export function nearestStation(x: number, z: number, stations: readonly FuelStation[] = FUEL_STATIONS):
  { station: FuelStation; distance: number } | undefined {
  let best: { station: FuelStation; distance: number } | undefined;
  for (const station of stations) {
    const distance = Math.hypot(station.x - x, station.z - z);
    if (!best || distance < best.distance) best = { station, distance };
  }
  return best;
}

export const TANK_CLASS_NAMES: Record<string, string> = { small: "小型", medium: "中型", large: "大型", huge: "巨型" };

export const tankClassName = (sizeClass: string): string => TANK_CLASS_NAMES[sizeClass] ?? "中型";

/** Litres with one decimal ("23.4"). */
export function liters(ml: number): string {
  return (Math.max(0, Math.round(ml / 100)) / 10).toFixed(1);
}

/** Distance as the HUD writes it: metres below 1 km, else km with one decimal. */
export function distanceText(meters: number): string {
  return meters < 1000 ? `${Math.max(0, Math.round(meters))} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** What adding ml costs (the data service's rule: whole 金币, rounded up). */
export function refuelCost(ml: number, pricePerLiter: number): number {
  return ml > 0 && pricePerLiter > 0 ? Math.ceil((ml * pricePerLiter) / 1000) : 0;
}

/** The most ml lucci 金币 buy at pricePerLiter. */
export function affordableMl(lucci: number, pricePerLiter: number): number {
  return pricePerLiter > 0 ? Math.floor((lucci * 1000) / pricePerLiter) : Number.POSITIVE_INFINITY;
}

/**
 * A tank this close to its capacity counts as full (the node refuses a
 * smaller refill too): less than the 0.1 L the window shows.
 */
export const FULL_SLACK_ML = 100;

export function tankFull(fuel: CityFuel): boolean {
  return fuel.capacityMl - fuel.fuelMl < FULL_SLACK_ML;
}

/** How much the refuel window offers by default: a full tank, or what the wallet buys. */
export function defaultRefuelMl(fuel: CityFuel): number {
  const room = Math.max(0, fuel.capacityMl - fuel.fuelMl);
  return Math.min(room, affordableMl(fuel.lucci, fuel.pricePerLiter));
}

/** The refuel amount after a ±step (litres) press, kept within room and wallet. */
export function stepRefuelMl(fuel: CityFuel, current: number, stepLiters: number): number {
  const room = Math.max(0, fuel.capacityMl - fuel.fuelMl);
  const limit = Math.min(room, affordableMl(fuel.lucci, fuel.pricePerLiter));
  const step = Math.abs(stepLiters) * 1000;
  // Steps land on whole multiples of the step, the last one on the limit.
  const next = stepLiters > 0 ? (Math.floor(current / step) + 1) * step : (Math.ceil(current / step) - 1) * step;
  return Math.max(0, Math.min(limit, next));
}

/**
 * The gauge between the node's updates: the last level it sent, minus what
 * the local odometer says was burnt since, never below zero nor above it.
 */
export class FuelGauge {
  fuel?: CityFuel;
  private burntMl = 0;
  private last?: { x: number; y: number; z: number };

  apply(fuel: CityFuel): void {
    this.fuel = fuel;
    this.burntMl = 0;
  }

  /** Feeds the kart's design position; a jump (reset or tow) is not driving. */
  advance(position: { x: number; y: number; z: number }): void {
    const last = this.last;
    this.last = { ...position };
    if (!last || !this.fuel || this.fuel.empty) return;
    const metres = Math.hypot(position.x - last.x, position.y - last.y, position.z - last.z);
    if (metres > 30) return;
    this.burntMl += (metres * this.fuel.useMlPerKm) / 1000;
  }

  /** Forget the last position (after a teleport). */
  jump(): void { this.last = undefined; }

  get displayMl(): number {
    if (!this.fuel) return 0;
    return Math.max(0, this.fuel.fuelMl - this.burntMl);
  }

  get ratio(): number {
    return this.fuel ? Math.min(1, this.displayMl / this.fuel.capacityMl) : 0;
  }

  /** Range left at the current consumption (m). */
  get rangeMeters(): number {
    return this.fuel && this.fuel.useMlPerKm > 0 ? (this.displayMl / this.fuel.useMlPerKm) * 1000 : 0;
  }
}

/** The fuel warnings: below 20 % low, below 10 % critical. */
export function fuelWarning(ratio: number, empty: boolean): "empty" | "critical" | "low" | undefined {
  if (empty) return "empty";
  if (ratio < 0.1) return "critical";
  if (ratio < 0.2) return "low";
  return undefined;
}

export type FuelPrompt =
  | { kind: "refuel"; station: FuelStation; text: string }
  | { kind: "full"; station: FuelStation; text: string }
  | { kind: "slow-down"; station: FuelStation; text: string }
  | { kind: "rescue"; text: string }
  | { kind: "none" };

/** Below this speed (km/h) the kart counts as stopped for the prompt. */
export const REFUEL_PROMPT_KMH = 6;

/** What the HUD offers at the kart's design pose (F opens the window). */
export function fuelPrompt(fuel: CityFuel | undefined, x: number, z: number, speedKmh: number,
  stations: readonly FuelStation[] = FUEL_STATIONS): FuelPrompt {
  if (!fuel) return { kind: "none" };
  const station = stationAt(x, z, stations);
  if (station) {
    if (tankFull(fuel)) return { kind: "full", station, text: `${station.name} · 油箱已满` };
    if (speedKmh > REFUEL_PROMPT_KMH) return { kind: "slow-down", station, text: `${station.name} · 停车后按 F 加油` };
    return { kind: "refuel", station, text: `${station.name} · 按 F 加油` };
  }
  if (fuel.empty) {
    const fee = fuel.rescueFee > 0 ? `${fuel.rescueFee} 金币` : "免费";
    return { kind: "rescue", text: `油箱空了，车已熄火 · 按 F 呼叫道路救援（${fee}）` };
  }
  return { kind: "none" };
}

/** A fresh request id for city-refuel / city-rescue. */
export function fuelRequestId(prefix: string): string {
  const random = globalThis.crypto?.getRandomValues?.(new Uint32Array(2));
  const tail = random ? `${random[0]!.toString(36)}${random[1]!.toString(36)}` : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${tail}`.slice(0, 64);
}

/** Chinese text for the node's and data service's fuel refusals. */
export const FUEL_ERROR_TEXT: Record<string, string> = {
  NOT_AT_STATION: "请把车开进加油站再加油。",
  KART_MOVING: "请先停车再加油。",
  TANK_FULL: "油箱已经加满了。",
  INSUFFICIENT_FUNDS: "金币不足。",
  CITY_FUEL_OFF: "加油功能暂未开放。",
  TANK_NOT_EMPTY: "油箱还有油，不需要救援。",
  NO_STATION: "附近没有加油站。",
  FUEL_BUSY: "正在处理上一笔加油，请稍候。",
  FUEL_EMPTY: "油箱空了，车已熄火，请呼叫道路救援。",
  RATE_LIMITED: "操作太频繁，请稍后再试。",
  DATA_SERVICE_UNAVAILABLE: "数据服务暂时不可用，请稍后再试。",
};

export function fuelErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return FUEL_ERROR_TEXT[code] ?? `操作失败：${code}`;
}
