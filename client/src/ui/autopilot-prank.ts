import type { WebGLRenderer } from "three";
import { T, d5, dn, dt, p2, s2 } from "../generated/formats.js";
import { U1, fn } from "../generated/library.js";

/**
 * 创世 9 自动版 (solarAuto; its param@cn.xml is "솔라 오토 9 / 중국 / 일반 /
 * 만우절 이벤트 / 20170330 릴리즈", the 2017 April Fools' kart). The race
 * announces a fully automatic driving system and then fails: the kart stays
 * at the start for the whole race while the rider, still sitting as if at the
 * wheel, drives the course on its own.
 *
 * gui_windowTemplate holds the three prompts, which the KartSim release never
 * loads: aprilFoolDayTuto ("即将启动全自动驾驶系统。", 707×202, top),
 * aprilFoolDayWarning (a red siren over "发生系统错误!", bottom) and
 * aprilFoolPop ("没时间解释了 快按“上”键!", a ControlWindow that fades in
 * over 100 ms, shows for 1000 ms and fades out over 100 ms). When each shows
 * is not in the data: the first during the 3-2-1 count, the error from GO
 * and the pop a second later.
 */

export const AUTOPILOT_KART = "solarAuto";

export function isAutopilotKart(internalId: unknown): boolean {
  return typeof internalId === "string" && internalId.toLowerCase() === AUTOPILOT_KART.toLowerCase();
}

/** "即将启动全自动驾驶系统。" from the 3 of the countdown to GO. */
export const AUTOPILOT_ANNOUNCE_MS = 3_000;
/** "发生系统错误!" from GO. */
export const AUTOPILOT_ERROR_MS = 3_000;
/** "快按“上”键!" pops this long after the error, once the GO sign has gone. */
export const AUTOPILOT_POP_DELAY_MS = 1_000;
/** Every prompt fades in and out like aprilFoolPop's ControlWindow. */
export const AUTOPILOT_FADE_MS = 100;
/** aprilFoolPop showLength. */
export const AUTOPILOT_POP_SHOW_MS = 1_000;

export type AutopilotPromptName = "announce" | "error" | "pop";

const WINDOWS: Record<AutopilotPromptName, string> = {
  announce: "aprilFoolDayTuto", error: "aprilFoolDayWarning", pop: "aprilFoolPop",
};
const ROOT = "gui_/windowTemplate";

/** Opacity (0..1) of a window shown from `start` for `length` ms with 100 ms fades. */
function faded(time: number, start: number, length: number): number {
  const age = time - start;
  if (!(age >= 0 && age < length)) return 0;
  return Math.min(1, age / AUTOPILOT_FADE_MS, (length - age) / AUTOPILOT_FADE_MS);
}

/** How opaque each prompt is `sinceGoMs` after GO (negative during the countdown). */
export function autopilotPromptAlphas(sinceGoMs: number): Record<AutopilotPromptName, number> {
  return {
    announce: faded(sinceGoMs, -AUTOPILOT_ANNOUNCE_MS, AUTOPILOT_ANNOUNCE_MS),
    error: faded(sinceGoMs, 0, AUTOPILOT_ERROR_MS),
    pop: faded(sinceGoMs, AUTOPILOT_POP_DELAY_MS,
      AUTOPILOT_FADE_MS + AUTOPILOT_POP_SHOW_MS + AUTOPILOT_FADE_MS),
  };
}

interface Node { name: string; attributes: Array<{ name: string; value: string }>; children: Node[] }
interface ResourceFile { bytes(): Promise<Uint8Array> }
export interface AutopilotPromptLibrary { canonicalCandidates(path: string): ResourceFile[] }

/**
 * The release window tree draws Containers and Panels: an ImageBoard is a
 * Panel of its image, and the ControlWindow is a Container whose fades the
 * timeline above plays.
 */
function drawable(node: Node): Node {
  const attributes = node.attributes.filter(entry =>
    !/^(visible|fadeInLength|showLength|fadeOutLength)$/.test(entry.name));
  if (node.name === "ImageBoard") {
    return { name: "Panel", children: node.children.map(drawable),
      attributes: attributes.map(entry => entry.name === "image" ? { name: "texture", value: entry.value } : entry) };
  }
  if (node.name === "ControlWindow")
    return { name: "Container", attributes, children: node.children.map(drawable) };
  return { ...node, attributes, children: node.children.map(drawable) };
}

function textureNames(node: Node, names = new Set<string>()): Set<string> {
  const texture = T(node, "texture");
  if (texture) names.add(texture as string);
  for (const child of node.children) textureNames(child, names);
  return names;
}

interface PanelCommand { kind: string; alpha?: number }

export class AutopilotPrompts {
  private goAtMs?: number;
  private readonly overlay = new fn(new Map());

  private constructor(private readonly trees: Record<AutopilotPromptName, unknown>,
    private readonly textures: Map<string, unknown>) {}

  static async load(library: AutopilotPromptLibrary): Promise<AutopilotPrompts> {
    const windows = {} as Record<AutopilotPromptName, Node>;
    for (const name of Object.keys(WINDOWS) as AutopilotPromptName[])
      windows[name] = drawable(s2(await U1(library, [ROOT], `${WINDOWS[name]}`, ".bml").bytes()) as Node);
    const names = new Set<string>();
    for (const window of Object.values(windows)) textureNames(window, names);
    // U1 prefers the @cn image of an @zz name (the siren lamp has only @zz).
    const textures = new Map(await Promise.all([...names].sort().map(async name =>
      [name, await p2(await U1(library, [ROOT], name).bytes())] as const)));
    const trees = {} as Record<AutopilotPromptName, unknown>;
    for (const name of Object.keys(windows) as AutopilotPromptName[])
      trees[name] = d5(windows[name], textures);
    return new AutopilotPrompts(trees, textures);
  }

  /** When GO is (or was), on the clock `render` is given; undefined hides every prompt. */
  setGo(goAtMs: number | undefined): void {
    this.goAtMs = goAtMs;
  }

  reset(): void {
    this.goAtMs = undefined;
    this.overlay.update([], 0);
  }

  render(renderer: WebGLRenderer, nowMs: number, width: number, height: number): void {
    if (this.goAtMs === undefined) return;
    const alphas = autopilotPromptAlphas(nowMs - this.goAtMs);
    const commands: PanelCommand[] = [];
    for (const name of Object.keys(alphas) as AutopilotPromptName[]) {
      const alpha = alphas[name];
      if (!(alpha > 0)) continue;
      const window = dt(dn(this.trees[name], width, height, { visibility: () => true }),
        this.textures, undefined) as PanelCommand[];
      for (const command of window) {
        if (command.kind === "panel") command.alpha = Math.round(alpha * 255);
        commands.push(command);
      }
    }
    if (!commands.length) return;
    this.overlay.update(commands, Math.trunc(nowMs) >>> 0);
    this.overlay.render(renderer, width, height);
  }

  dispose(): void {
    this.reset();
    this.overlay.dispose();
  }
}

/** A kart view that can leave its model behind (world/kart-presentation-view.ts). */
export interface AutopilotParkingView {
  parkModel(mount: object): void;
  unparkModel(): void;
}

/**
 * One race's 创世 9 自动版: from GO the kart stays where it stood and the
 * rider drives on from its seat (the ReKart child 6 mount); before GO, as
 * after a restart, the rider is back in the kart.
 */
export class AutopilotPrank {
  private readonly parked = new Set<AutopilotParkingView>();

  /**
   * `prompts` are the local driver's, when they loaded; `seat` is the local
   * kart's rider mount in a solo race.
   */
  constructor(readonly prompts?: AutopilotPrompts, readonly seat?: object) {}

  park(view: AutopilotParkingView, seat: object, racing: boolean): void {
    if (racing) {
      view.parkModel(seat);
      this.parked.add(view);
    } else {
      view.unparkModel();
      this.parked.delete(view);
    }
  }

  setGo(goAtMs: number | undefined): void {
    this.prompts?.setGo(goAtMs);
  }

  render(renderer: WebGLRenderer, nowMs: number, width: number, height: number): void {
    this.prompts?.render(renderer, nowMs, width, height);
  }

  reset(): void {
    this.prompts?.reset();
  }

  dispose(): void {
    for (const view of this.parked) view.unparkModel();
    this.parked.clear();
    this.prompts?.dispose();
  }
}

export function autopilotOf(session: unknown): AutopilotPrank | undefined {
  const prank = (session as { autopilot?: unknown } | undefined)?.autopilot;
  return prank instanceof AutopilotPrank ? prank : undefined;
}

/** The local driver's prompts; a race goes on without them if they cannot load. */
export async function loadAutopilotPrompts(library: unknown,
  warn: (message: string) => void): Promise<AutopilotPrompts | undefined> {
  try {
    return await AutopilotPrompts.load(library as AutopilotPromptLibrary);
  } catch (error) {
    warn(`创世 9 自动版提示未能载入：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
