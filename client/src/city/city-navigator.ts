import { tr } from "../i18n/locale";
/**
 * 卡丁城导航: a destination picked on the M map, the route to it from
 * wherever the rider is (driving, walking or on a back seat), redrawn as
 * it moves, and the arrival. The road network and the distance field are
 * city-nav.ts; the green line is city-route-minimap.ts (HUD minimap) and
 * city-map-window.ts (M map).
 */
import { districtAt } from "./city-coordinates";
import { loadCityNav, NavField, pathLength, roundCorners, simplify, type CityNav, type NavPoint } from "./city-nav";

export interface NavPose { x: number; z: number; y?: number }

export interface NavDestination {
  x: number;
  z: number;
  label: string;
  /** Its network node (the route ends there). */
  node: number;
}

export type NavStatus = "idle" | "routing" | "active" | "off-road";

/** Within this distance (m, ground plane) of the destination the trip is over. */
export const ARRIVE_RADIUS = 18;
/** How far (m) a click may be from a road to set a destination there. */
export const DESTINATION_SNAP = 150;
/** How far (m) the rider may be from the network and still get a route. */
export const START_SNAP = 80;
const ROUTE_REFRESH_MS = 200;
const FIELD_BUDGET_MS = 3;
/** Grid steps and lane wobble under this (m) straighten out; corners round off by CORNER_RADIUS. */
const SIMPLIFY_TOLERANCE = 3;
const CORNER_RADIUS = 6;

export interface CityNavigatorHost {
  /** Where the rider is (design x/z, height for decks over roads). */
  pose(): NavPose | undefined;
  notice(text: string): void;
  /** The network (tests pass one in). */
  load?(): Promise<CityNav>;
  now?(): number;
}

export class CityNavigator {
  nav?: CityNav;
  destination?: NavDestination;
  /** From the rider to the destination (design x/z); empty without a route. */
  route: NavPoint[] = [];
  /** Length (m) of route. */
  remaining = 0;
  status: NavStatus = "idle";
  /** Bumps whenever route, destination or status change (redraws key on it). */
  revision = 0;
  private field?: NavField;
  private loading?: Promise<CityNav | undefined>;
  private lastRoute = -Infinity;
  disposed = false;

  constructor(private readonly host: CityNavigatorHost) {}

  /** Starts loading the network (once); undefined when it cannot load. */
  ready(): Promise<CityNav | undefined> {
    this.loading ??= (this.host.load?.() ?? loadCityNav()).then(nav => { this.nav = nav; return nav; }, error => {
      console.warn("卡丁城导航数据未能载入", error);
      this.loading = undefined;
      return undefined;
    });
    return this.loading;
  }

  /** Routes to the road nearest a design point; the refusal text when there is none. */
  async setDestination(x: number, z: number, label?: string): Promise<string | undefined> {
    const nav = await this.ready();
    if (this.disposed) return undefined;
    if (!nav) return tr("导航数据未能载入，请稍后再试。");
    const goal = nav.nearest(x, z, DESTINATION_SNAP);
    if (goal < 0) return tr("这里附近没有能开车到的路。");
    const at = nav.point(goal);
    this.destination = { x: at.x, z: at.z, node: goal,
      label: label ?? tr(districtAt(at.x, at.z)?.name ?? "目的地") };
    this.field = new NavField(nav, goal);
    this.route = [];
    this.remaining = 0;
    this.status = "routing";
    this.lastRoute = -Infinity;
    this.revision++;
    return undefined;
  }

  clear(): void {
    if (!this.destination && !this.field) return;
    this.destination = undefined;
    this.field = undefined;
    this.route = [];
    this.remaining = 0;
    this.status = "idle";
    this.revision++;
  }

  /** Once a frame: grows the field a little and refreshes the route a few times a second. */
  frame(now = this.host.now?.() ?? performance.now()): void {
    const { field, destination, nav } = this;
    if (this.disposed || !field || !destination || !nav) return;
    if (!field.done) field.grow(FIELD_BUDGET_MS, this.host.now);
    if (now - this.lastRoute < ROUTE_REFRESH_MS) return;
    this.lastRoute = now;
    const pose = this.host.pose();
    if (!pose) return;
    if (Math.hypot(pose.x - destination.x, pose.z - destination.z) <= ARRIVE_RADIUS) {
      this.host.notice(tr("已到达目的地：{value0}。", { value0: destination.label }));
      this.clear();
      return;
    }
    let start = nav.nearest(pose.x, pose.z, START_SNAP, pose.y);
    if (start >= 0 && !field.closed[start]) {
      // Not reached yet: wait for the field, or (when it is done) the rider stands on a scrap
      // of road the network does not join: the nearest node it does.
      start = field.done ? nav.nearest(pose.x, pose.z, START_SNAP, pose.y, node => field.closed[node] === 1) : -2;
    }
    if (start === -2) { this.setStatus("routing"); return; }
    const chain = start >= 0 ? field.chain(start) : undefined;
    if (!chain) {
      if (this.route.length || this.status !== "off-road") {
        this.route = [];
        this.remaining = 0;
        this.status = "off-road";
        this.revision++;
      }
      return;
    }
    this.route = roundCorners([{ x: pose.x, z: pose.z }, ...simplify(chain, SIMPLIFY_TOLERANCE)], CORNER_RADIUS);
    this.remaining = pathLength(this.route);
    this.status = "active";
    this.revision++;
  }

  private setStatus(status: NavStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.revision++;
  }

  /** One line for the map and the HUD. */
  statusText(): string {
    const destination = this.destination;
    if (!destination) return tr("点击地图选择目的地");
    switch (this.status) {
      case "routing": return tr("{value0} · 正在规划路线…", { value0: destination.label });
      case "off-road": return tr("{value0} · 离道路太远，先开回路上", { value0: destination.label });
      default: return `${destination.label} · ${distanceLabel(this.remaining)}`;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.field = undefined;
  }
}

/** 850 m, 1.2 km. */
export function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.max(0, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`;
}
