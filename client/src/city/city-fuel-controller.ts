import { tr } from "../i18n/locale";
/**
 * 卡丁城加油 in the city session (server-go/FUEL.md): keeps the tank the
 * node reports, draws the fuel HUD, stalls the kart while the tank is empty
 * (the race's motion lock: no drive force, brakes on, no boosters), and
 * opens the 加油 window at a station or the 道路救援 window with F.
 */
import { FuelHud, type FuelHudState } from "./city-fuel-hud";
import {
  FuelGauge, fuelErrorText, fuelPrompt, fuelRequestId, liters, nearestStation, stationAt,
  type FuelPrompt, type FuelStation,
} from "./city-fuel";
import { showRefuelWindow, showRescueWindow, type FuelWindow, type FuelWindowOptions } from "./city-fuel-window";
import type { CityFuel, CityPose, CityRefuelReply, CityRescueReply } from "./city-protocol";

export interface CityFuelNetwork {
  refuel(requestId: string, addMl?: number): Promise<CityRefuelReply>;
  rescue(requestId: string): Promise<CityRescueReply>;
}

export interface CityFuelPhysics {
  body: { linearVelocity: { x: number; y: number; z: number } };
  setRaceMotionLocked(locked: boolean): void;
}

export interface CityFuelHost {
  library: unknown;
  root: HTMLElement;
  network(): CityFuelNetwork | undefined;
  physics(): CityFuelPhysics | undefined;
  /** The local kart's design pose (heading 0 = north, clockwise). */
  pose(): CityPose | undefined;
  /** Puts the local kart at a design pose the node already knows. */
  teleport(pose: CityPose): void;
  notice(text: string): void;
  sound?(name: "refuel" | "rescue" | "error"): void;
  showWindow?: { refuel: typeof showRefuelWindow; rescue: typeof showRescueWindow };
}

/** How long after a window closes an Esc still belongs to it (the city's double-Esc exit ignores it). */
const ESCAPE_GRACE_MS = 400;

export class CityFuelController {
  readonly gauge = new FuelGauge();
  private hud?: FuelHud;
  private window?: FuelWindow;
  private opening = false;
  private closedAt = -Infinity;
  private locked = false;
  private prompt: FuelPrompt = { kind: "none" };
  /** False while the rider walks or rides (下车步行): no HUD, no stall, no F. */
  active = true;
  disposed = false;

  constructor(readonly host: CityFuelHost, fuel: CityFuel) {
    this.gauge.apply(fuel);
    this.hud = new FuelHud(host.root, host.library);
  }

  get fuel(): CityFuel { return this.gauge.fuel!; }

  /** Hides the gauge under a large window (the M map). */
  cover(covered: boolean): void {
    if (this.hud) this.hud.canvas.style.visibility = covered ? "hidden" : "";
  }
  get windowOpen(): boolean { return this.opening || !!this.window; }

  /** True while an Esc should go to a fuel window, not the city's exit. */
  consumesEscape(now: number): boolean { return this.windowOpen || now - this.closedAt < ESCAPE_GRACE_MS; }

  /** A tank from the node (city-fuel, a refuel or rescue reply). */
  apply(fuel: CityFuel, reason = ""): void {
    const wasEmpty = this.gauge.fuel?.empty ?? false;
    this.gauge.apply(fuel);
    if (fuel.empty && !wasEmpty && reason === "empty") this.host.notice(tr("油箱空了，车已熄火！按 F 呼叫道路救援。"));
  }

  /** A teleport (reset, tow) is not driving. */
  jump(): void { this.gauge.jump(); }

  /**
   * The tank of the kart the rider now drives (someone else's kart brings
   * its owner's), or none: walking or riding.
   */
  setTank(fuel: CityFuel | undefined): void {
    if (fuel) {
      this.gauge.apply(fuel);
      this.gauge.jump();
      this.active = true;
      return;
    }
    this.active = false;
    // The seat's owner (city-onfoot.ts) holds the kart now.
    this.locked = false;
    this.hud?.clear();
  }

  /** Says where an empty kart was put on entering the city. */
  greet(): void {
    const pose = this.host.pose();
    if (!pose) return;
    if (this.fuel.empty) {
      const station = stationAt(pose.x, pose.z);
      this.host.notice(station ? tr("油箱是空的，车停在{value0}，按 F 加油。", { value0: tr(station.name) }) : tr("油箱是空的，按 F 呼叫道路救援。"));
    } else if (this.gauge.ratio < 0.2) {
      this.host.notice(tr("油量只剩 {value0} L，记得去加油站加油。", { value0: liters(this.fuel.fuelMl) }));
    }
  }

  private speedKmh(): number {
    const velocity = this.host.physics()?.body.linearVelocity;
    return velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) * 3.6 : 0;
  }

  frame(now: number): void {
    if (this.disposed || !this.active) return;
    const pose = this.host.pose();
    if (pose) this.gauge.advance(pose);
    const physics = this.host.physics();
    // Empty: the engine is off. An open window holds the kart at the pumps.
    const lock = this.fuel.empty || this.windowOpen;
    if (physics && (lock || this.locked)) {
      physics.setRaceMotionLocked(lock);
      this.locked = lock;
    }
    const display = this.gauge.displayMl;
    const shown: CityFuel = { ...this.fuel, fuelMl: display };
    this.prompt = pose && !this.windowOpen ? fuelPrompt(shown, pose.x, pose.z, this.speedKmh()) : { kind: "none" };
    const nearest = pose ? nearestStation(pose.x, pose.z) : undefined;
    let bearing = 0;
    if (pose && nearest) {
      const absolute = (Math.atan2(nearest.station.x - pose.x, -(nearest.station.z - pose.z)) * 180) / Math.PI;
      bearing = absolute - pose.heading;
    }
    const state: FuelHudState = {
      kartName: this.fuel.kartName, sizeClass: this.fuel.sizeClass, fuelMl: display, capacityMl: this.fuel.capacityMl,
      rangeMeters: this.gauge.rangeMeters, empty: this.fuel.empty, prompt: this.prompt,
      ...(nearest && nearest.distance > 15 ? { nearest: { name: tr(nearest.station.name), distance: nearest.distance, bearing } } : {}),
    };
    this.hud?.draw(state, now);
  }

  /** F at a station opens 加油, with an empty tank elsewhere 道路救援. */
  keydown(event: KeyboardEvent): void {
    if (this.disposed || !this.active || event.code !== "KeyF" || event.repeat || this.windowOpen) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const prompt = this.prompt;
    if (prompt.kind === "refuel") void this.openRefuel(prompt.station);
    else if (prompt.kind === "rescue") void this.openRescue();
    else if (prompt.kind === "slow-down") this.host.notice(tr("请先停车再加油。"));
    else if (prompt.kind === "full") this.host.notice(tr("油箱已经加满了。"));
    else return;
    event.preventDefault();
  }

  private closeWindow(): void {
    this.window?.dispose();
    this.window = undefined;
    this.closedAt = performance.now();
  }

  private options(): FuelWindowOptions {
    return { library: this.host.library as FuelWindowOptions["library"], root: this.host.root };
  }

  async openRefuel(station: FuelStation): Promise<void> {
    if (this.windowOpen) return;
    this.opening = true;
    const show = this.host.showWindow?.refuel ?? showRefuelWindow;
    try {
      const window = await show(this.options(), tr(station.name), () => this.fuel, addMl => { void this.buy(addMl); },
        () => this.closeWindow());
      if (this.disposed) { window.dispose(); return; }
      this.window = window;
    } catch (error) {
      console.warn("加油窗口未能打开", error);
      this.host.notice(tr("加油窗口未能打开。"));
    } finally {
      this.opening = false;
    }
  }

  private async buy(addMl: number): Promise<void> {
    const window = this.window, network = this.host.network();
    if (!window || !network || window.busy) return;
    window.setBusy(true);
    try {
      const reply = await network.refuel(fuelRequestId("fuel"), addMl);
      if (this.disposed) return;
      this.gauge.apply(reply.fuel);
      if (reply.stale) {
        this.host.notice(tr("油量已同步，请再确认一次加油量。"));
        window.setBusy(false);
        return;
      }
      this.closeWindow();
      this.host.sound?.("refuel");
      this.host.notice(tr("加油成功：+{value0} L，花费 {value1} 金币，余额 {value2} 金币。", { value0: liters(reply.addedMl), value1: reply.cost, value2: reply.fuel.lucci }));
    } catch (error) {
      if (this.disposed) return;
      this.host.sound?.("error");
      this.host.notice(fuelErrorText(error));
      if (this.window === window) window.setBusy(false);
    }
  }

  async openRescue(): Promise<void> {
    if (this.windowOpen) return;
    this.opening = true;
    const show = this.host.showWindow?.rescue ?? showRescueWindow;
    const destination = () => {
      const pose = this.host.pose();
      const nearest = pose ? nearestStation(pose.x, pose.z) : undefined;
      return nearest ? { name: tr(nearest.station.name), distance: nearest.distance } : undefined;
    };
    try {
      const window = await show(this.options(), () => this.fuel, destination, () => { void this.callRescue(); },
        () => this.closeWindow());
      if (this.disposed) { window.dispose(); return; }
      this.window = window;
    } catch (error) {
      console.warn("救援窗口未能打开", error);
      this.host.notice(tr("救援窗口未能打开。"));
    } finally {
      this.opening = false;
    }
  }

  private async callRescue(): Promise<void> {
    const window = this.window, network = this.host.network();
    if (!window || !network || window.busy) return;
    window.setBusy(true);
    try {
      const reply = await network.rescue(fuelRequestId("tow"));
      if (this.disposed) return;
      this.gauge.apply(reply.fuel);
      this.closeWindow();
      if (reply.stale || !reply.pose) {
        this.host.notice(reply.fuel.empty ? tr("救援没有完成，请再试一次。") : tr("油箱还有油，不需要救援。"));
        return;
      }
      this.host.teleport(reply.pose);
      this.gauge.jump();
      this.host.sound?.("rescue");
      const paid = reply.free ? tr("金币不足，本次免费救援") : reply.cost > 0 ? tr("花费 {value0} 金币", { value0: reply.cost }) : tr("本次免费");
      this.host.notice(tr("救援车已把你拖到{value0}（{value1}），按 F 加油。", { value0: tr(reply.stationName ?? "加油站"), value1: paid }));
    } catch (error) {
      if (this.disposed) return;
      this.host.sound?.("error");
      this.host.notice(fuelErrorText(error));
      if (this.window === window) window.setBusy(false);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.window?.dispose();
    this.window = undefined;
    if (this.locked) this.host.physics()?.setRaceMotionLocked(false);
    this.hud?.dispose();
    this.hud = undefined;
  }
}
