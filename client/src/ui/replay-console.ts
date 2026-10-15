import { tr } from "../i18n/locale";
/**
 * The release replay stage over an OB 观看 race (TIMEATTACK.md 4), loaded from
 * its own layout rather than redrawn: stage_/replay mq_window@zz.bml (操作台
 * with 选择车手 1–8 and 锁定车手, the 选择视角 pad A S Q F D V and its 카메라시야
 * cone, the time bar, play / pause / 0.5× / 0.25×, 帮助 / 比赛资料 / 退出 and the
 * 帮助 board), screenui.bml in its ScreenUI slot (race time and record time at
 * the ends of the bar, the camera info, the rank list from speedIndiGame's
 * ranklist_spot_observer.bml) and tachometer.bml (speed). Keys after the
 * 帮助 board: 1–8 and -/+ riders, SPC 锁定车手, I 比赛资料, F1 帮助, A Q S D E
 * F R V G T H Y cameras, arrows adjust the camera (L and BACK are 暂时未开放).
 */
import { te } from "../generated/library.js";
import {
  adjustObserveView, OBSERVE_CAMERAS, selectObserveRank, setObserveCamera, stepObserveRank, watchedRank,
  type ObserveCameraMode, type ObserveState,
} from "../timeattack/replay-observe";
import {
  attribute, clipToStage, ImageCache, indexRows, loadBml, loadStrings, mapTree, node, nodeName, nodesUnder,
  prepare, resolveStrings, withAttributes, type BmlLibrary, type Node, type Rect, type Texture, type WindowView,
} from "./bml-kit";

export interface ReplayConsoleOptions {
  library: BmlLibrary;
  root: HTMLElement;
  observe: ObserveState;
  /** The race's natural ghost time now (for the clock's anchors). */
  naturalMs(): number;
  onExit(): void;
  onHover?(): void;
  onActivate?(): void;
}

const REPLAY = "stage_/replay";
const RANK_FOLDER = "stage_/speedIndiGame";
const ROOTS = [REPLAY, "stage_/common", "stage_/common/icon", RANK_FOLDER];
const RIDER_SLOTS = 8;
/** stage_replay tachometer.bml: dashboard 288×51, align right, anchor "0 0.72" of the 900 high stage. */
const DASHBOARD = "1312 648 288 51";
/** The race clock starts at the countdown; GO is 7 s in (replay-observe ReplayClock). */
const GO_MS = 7000;
/** speedGauge: 17 lights over the tacho bar (119 px at 7 px), the last 4 red; full at 250 km/h. */
const GAUGE_LIGHTS = 17;
const GAUGE_RED = 4;
const GAUGE_FULL_KMH = 250;

/** Areas the stage draws or takes clicks in (the rest of the race stays uncovered). */
const STATIC_AREAS: Rect[] = [
  { x: 20, y: 763, width: 426, height: 122 },
  { x: 597, y: 770, width: 406, height: 100 },
  { x: 0, y: 726, width: 1600, height: 34 },
  { x: 30, y: 18, width: 70, height: 34 },
  { x: 108, y: 18, width: 110, height: 34 },
  { x: 1500, y: 18, width: 70, height: 34 },
  { x: 20, y: 84, width: 300, height: 64 },
  { x: 1410, y: 630, width: 180, height: 95 },
];
const HELP_AREA: Rect = { x: 465, y: 206, width: 670, height: 488 };
const BAR = { x: 120, y: 741, width: 1360, height: 4, thumb: 14 };

const numbers = (value: string | undefined, fallback: number[]): number[] =>
  value ? value.trim().split(/\s+/).map(Number) : fallback;

/** StateButton → the renderer's ImageButton (states _1…_4; _4 is the current choice). */
function stateButton(entry: Node, riders: number, cones: Map<string, number>): Node {
  const name = nodeName(entry);
  const icon = attribute(entry, "iconSet") ?? "";
  const zz = icon.endsWith("@zz") ? "@zz" : "";
  const base = zz ? icon.slice(0, -3) : icon;
  const [shiftX = 0, shiftY = 0] = numbers(attribute(entry, "iconPos"), [0, 0]);
  const [adjustX = 0, adjustY = 0] = numbers(attribute(entry, "adjust"), [0, 0]);
  // The icon sits iconPos into the button (the 30 px rider and camera icons 5 px down);
  // the button moves by it and its cone keeps its place.
  const changes: Record<string, string | undefined> = {
    iconSet: undefined, iconAlign: undefined, iconPos: undefined, canDisable: undefined,
    ...(shiftX || shiftY ? { adjust: `${adjustX + shiftX} ${adjustY + shiftY}` } : {}),
  };
  const children = entry.children.map(child => {
    if (child.name !== "Graduation") return child;
    const mode = /^카메라([A-Z])$/.exec(name)?.[1] ?? "";
    cones.set(mode, Number(attribute(child, "defaultVal") ?? 0));
    const [x = 0, y = 0, width = 15, height = 39] = numbers(attribute(child, "leftTopWH"), []);
    return node("Panel", { name: `camView${mode}`, leftTopWH: `${x - shiftX} ${y - shiftY} ${width} ${height}` });
  });
  const rider = /^라이더(\d)$/.exec(name);
  if (rider && Number(rider[1]) > riders)
    return { ...withAttributes(entry, { ...changes, texture: `${base}_1${zz}`, alphaBlend: "true" }), name: "Panel", children };
  // 锁定车手 has three states (선수고정_비활성/활성 _1…_3): painted.
  if (name === "선수고정") return { ...withAttributes(entry, changes), name: "ImageButton", children };
  return { ...withAttributes(entry, { ...changes, autoLoadImage: `${base}_${zz}` }), name: "ImageButton", children };
}

/** One rank row of the RankList, from ranklist_spot_observer.bml. */
function rankRow(template: Node, index: number): Node {
  const children = template.children
    .filter(child => !["ping", "logout", "exceedCon"].includes(nodeName(child)))
    .map(child => mapTree(child, entry => {
      // The spot and the watched rider's highlight are tinted with the rider's color (painted).
      if (["spot", "observerSelect"].includes(nodeName(entry)))
        return withAttributes(entry, { texture: undefined, textureOp: undefined, color: undefined });
      return undefined;
    }));
  return node("Window", { name: `rankRow${index}`, windowRect: `0 ${index * 31} 245 ${index * 31 + 31}` }, children);
}

async function definition(library: BmlLibrary, riders: number, cones: Map<string, number>): Promise<{
  tree: Node; strings: Map<string, string>;
}> {
  const [window, screen, tachometer, row, strings] = await Promise.all([
    loadBml(library, REPLAY, "mq_window@zz"), loadBml(library, REPLAY, "screenui"),
    loadBml(library, REPLAY, "tachometer"), loadBml(library, RANK_FOLDER, "ranklist_spot_observer"),
    loadStrings(library, REPLAY, "stage_stringBag"),
  ]);
  const dashboard = withAttributes(tachometer, { windowSize: undefined, anchor: undefined, align: undefined,
    leftTopWH: DASHBOARD });
  const screenUi = mapTree(screen, entry => entry.name === "RankList"
    ? node("Container", { name: "ranklist", leftTopWH: attribute(entry, "leftTopWH") ?? "4 156 229 462" },
      Array.from({ length: RIDER_SLOTS }, (_, index) => rankRow(row, index)))
    : undefined);
  let tree = mapTree(window, entry => {
    if (entry.name === "XmlFile") return node("Skip", {});
    if (entry.name === "ScrollBar")
      return node("Container", { name: nodeName(entry), windowSize: attribute(entry, "windowSize") ?? "1360 4",
        align: attribute(entry, "align") ?? "", adjust: attribute(entry, "adjust") ?? "0 0" });
    if (entry.name === "StateButton") return stateButton(entry, riders, cones);
    if (nodeName(entry) === "ScreenUI")
      return { ...withAttributes(entry, { enable: undefined }), children: [screenUi, dashboard] };
    // The filled part of the bar is painted with the bar.
    if (nodeName(entry) === "progressBar") return withAttributes(entry, { visible: "false" });
    return undefined;
  });
  // 比赛资料: the button shows displayOff while the data is on and displayOn while it is off.
  const display = tree.children.find(child => nodeName(child) === "displayOnOff");
  if (display) {
    tree = { ...tree, children: [...tree.children, withAttributes({ ...display, children: [] },
      { name: "displayOn", autoLoadImage: "displayOn_@zz" })] };
  }
  return { tree: resolveStrings(tree, strings), strings };
}

/** "MM", "SS", "CC" of a race time. */
function clockParts(ms: number): { min: string; sec: string; mil: string } {
  const pad = (value: number) => Math.floor(Math.max(0, value)).toString().padStart(2, "0").slice(-2);
  return { min: pad(ms / 60_000), sec: pad((ms / 1_000) % 60), mil: pad((ms / 10) % 100) };
}

/** A rank color (0xRRGGBB, "#rrggbb", [r, g, b] or {r, g, b} in 0–1 or 0–255) as CSS. */
function cssColor(value: unknown): string {
  if (typeof value === "number") return `#${(value >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`;
  if (typeof value === "string") return value;
  const parts = Array.isArray(value) ? value : value && typeof value === "object"
    ? [(value as { r?: number }).r, (value as { g?: number }).g, (value as { b?: number }).b] : [];
  if (parts.length >= 3 && parts.every(part => typeof part === "number")) {
    const scale = (parts as number[]).every(part => part <= 1) ? 255 : 1;
    return `rgb(${(parts as number[]).slice(0, 3).map(part => Math.round(part * scale)).join(",")})`;
  }
  return "#ffffff";
}

export class ReplayConsole {
  private view?: WindowView;
  private bar?: HTMLDivElement;
  private dragging = false;
  private disposed = false;
  private clipKey = "";
  private lastFrame = performance.now();
  private readonly held = { up: false, down: false, left: false, right: false };
  private readonly cones = new Map<string, number>();
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  private readonly images: ImageCache;
  private strings = new Map<string, string>();
  private recordNodes = new WeakSet<Node>();
  private rows = new WeakMap<Node, number>();
  private keys = (event: KeyboardEvent) => this.onKey(event);
  private keysUp = (event: KeyboardEvent) => this.onKeyUp(event);
  private blur = () => { this.held.up = this.held.down = this.held.left = this.held.right = false; };

  private constructor(private readonly options: ReplayConsoleOptions) {
    this.images = new ImageCache(options.library, () => this.render());
  }

  static async open(options: ReplayConsoleOptions): Promise<ReplayConsole> {
    const console = new ReplayConsole(options);
    await console.build();
    return console;
  }

  private async build(): Promise<void> {
    const { tree, strings } = await definition(this.options.library, this.options.observe.riders.length, this.cones);
    this.strings = strings;
    const prepared = prepare(this.options.library, tree, ROOTS);
    this.recordNodes = nodesUnder(prepared, "recordTimeinfo");
    indexRows(prepared, "rankRow", this.rows);
    this.view = await te.load({
      library: this.options.library, root: this.options.root, definition: prepared, roots: ROOTS, smoothImages: true,
      modal: false, label: tr("回放"), onCancel: () => this.options.onExit(),
      state: (entry: Node) => this.state(entry),
    }) as WindowView;
    if (this.disposed) { this.view.dispose(); return; }
    this.view.show();
    this.bar = this.timeBarControl();
    this.view.element.append(this.bar);
    window.addEventListener("keydown", this.keys, true);
    window.addEventListener("keyup", this.keysUp, true);
    window.addEventListener("blur", this.blur);
    this.render();
  }

  /** The time bar takes the pointer (seeking needs its x); the bar itself is painted on the canvas. */
  private timeBarControl(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.setAttribute("role", "slider");
    bar.setAttribute("aria-label", tr("回放进度"));
    Object.assign(bar.style, { position: "absolute", left: `${BAR.x / 16}%`, top: `${(BAR.y - 10) / 9}%`,
      width: `${BAR.width / 16}%`, height: `${24 / 9}%`, cursor: "pointer", pointerEvents: "auto", touchAction: "none",
      outline: "none" });
    const seek = (event: PointerEvent) => {
      const box = bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width)));
      const { observe } = this.options;
      observe.clock.seek(this.options.naturalMs(), fraction * observe.clock.durationMs);
      observe.fixed = undefined;
      observe.previous = undefined;
      this.render();
    };
    bar.addEventListener("pointerdown", event => {
      this.dragging = true;
      bar.setPointerCapture(event.pointerId);
      this.options.onActivate?.();
      seek(event);
    });
    bar.addEventListener("pointermove", event => { if (this.dragging) seek(event); });
    const stop = () => { this.dragging = false; this.render(); };
    bar.addEventListener("pointerup", stop);
    bar.addEventListener("pointercancel", stop);
    return bar;
  }

  private onKey(event: KeyboardEvent): void {
    if (this.disposed) return;
    const { observe } = this.options;
    const arrow = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[
      event.code as "ArrowUp"];
    const camera = OBSERVE_CAMERAS.find(entry => entry.key === event.code);
    const digit = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
    if (arrow) this.held[arrow] = true;
    else if (event.repeat) { /* the rest act once per press */ }
    else if (camera) setObserveCamera(observe, camera.mode);
    else if (digit) selectObserveRank(observe, Number(digit[1]));
    else if (event.code === "Minus" || event.code === "NumpadSubtract") stepObserveRank(observe, -1);
    else if (event.code === "Equal" || event.code === "NumpadAdd") stepObserveRank(observe, 1);
    else if (event.code === "Space") this.toggleLock();
    else if (event.code === "KeyI") observe.hudVisible = !observe.hudVisible;
    else if (event.code === "F1") observe.helpVisible = !observe.helpVisible;
    else if (event.code === "Escape") {
      if (observe.helpVisible) observe.helpVisible = false;
      else this.options.onExit();
    } else if (event.code !== "KeyL" && event.code !== "Backspace") return; // L, BACK: 暂时未开放
    event.preventDefault();
    event.stopImmediatePropagation();
    this.render();
  }

  private onKeyUp(event: KeyboardEvent): void {
    const arrow = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[
      event.code as "ArrowUp"];
    if (!arrow) return;
    this.held[arrow] = false;
    event.stopImmediatePropagation();
  }

  private toggleLock(): void {
    const { observe } = this.options;
    observe.rankLock = !observe.rankLock;
    if (!observe.rankLock) observe.followRank = watchedRank(observe);
  }

  private cameraName(mode: ObserveCameraMode): string {
    const camera = OBSERVE_CAMERAS.find(entry => entry.mode === mode)!;
    return tr(this.strings.get(camera.sb) ?? camera.name);
  }

  private riderAt(row: number): number | undefined {
    return this.options.observe.ranking[row];
  }

  private state(entry: Node): Record<string, unknown> {
    const name = nodeName(entry);
    const { observe } = this.options;
    const clock = observe.clock;
    const natural = () => this.options.naturalMs();
    const act = (label: string, run: () => void, disabled = false) => ({ label: tr(label), disabled,
      action: () => { this.options.onActivate?.(); run(); this.render(); } });
    const row = this.rows.get(entry);
    if (row !== undefined) return this.rowState(entry, name, row);
    const camera = /^카메라([ASQFDV])$/.exec(name);
    if (camera) {
      const mode = camera[1] as ObserveCameraMode;
      return act(this.cameraName(mode), () => setObserveCamera(observe, mode), observe.camera === mode);
    }
    const cone = /^camView([ASQFDV])$/.exec(name);
    if (cone) return { visible: observe.camera === cone[1], paint: (context: CanvasRenderingContext2D, rect: Rect) =>
      this.paintCone(context, rect, this.cones.get(cone[1]!) ?? 0) };
    const rider = /^라이더(\d)$/.exec(name);
    if (rider && entry.name === "ImageButton") {
      const rank = Number(rider[1]);
      const name = observe.riders[observe.ranking[rank - 1] ?? -1]?.name ?? "";
      return act(tr("第 {rank} 名 {name}", { rank, name }), () => selectObserveRank(observe, rank), watchedRank(observe) === rank);
    }
    const mode = clock.paused ? "pause" : clock.rate === 0.5 ? "play05" : clock.rate === 0.25 ? "play025" : "play1";
    switch (name) {
      case "선수고정": return { ...act(observe.rankLock ? "取消锁定车手" : "锁定车手", () => this.toggleLock()),
        hoverRegion: "riderLock", paint: (context: CanvasRenderingContext2D, rect: Rect) => this.paintLock(context, rect) };
      case "play1": return act("播放", () => clock.play(natural(), 1), mode === "play1");
      case "pause": return act("暂停", () => clock.pause(natural()), mode === "pause");
      case "play05": return act("0.5 倍速", () => clock.play(natural(), 0.5), mode === "play05");
      case "play025": return act("0.25 倍速", () => clock.play(natural(), 0.25), mode === "play025");
      case "나가기": return act("退出", () => this.options.onExit());
      case "help": return act(this.strings.get("help") ?? "帮助", () => { observe.helpVisible = !observe.helpVisible; });
      case "helpClose": return act("关闭帮助", () => { observe.helpVisible = false; });
      case "helpMessage": return { visible: observe.helpVisible };
      case "displayOnOff": return { visible: observe.hudVisible, ...act("比赛资料 关闭", () => { observe.hudVisible = false; }) };
      case "displayOn": return { visible: !observe.hudVisible, ...act("比赛资料 开启", () => { observe.hudVisible = true; }) };
      case "ScreenUI": return { visible: observe.hudVisible };
      case "useItemDesc": case "bgpOn": return { visible: false };
      case "currentRider": return { text: observe.riders[observe.watched]?.name ?? "" };
      case "currentCam": return { text: this.cameraName(observe.camera) };
      case "min": case "sec": case "mil": {
        const record = this.recordNodes.has(entry);
        const race = Math.max(0, clock.current - GO_MS);
        return { text: clockParts(record ? observe.recordMs : Math.min(race, observe.recordMs || race))[name] };
      }
      case "kmh": return { text: Math.round(Math.max(0, observe.speedKmh)).toString().padStart(3, " ") };
      case "speedGauge": {
        const lit = Math.round(Math.min(1, Math.max(0, observe.speedKmh) / GAUGE_FULL_KMH) * GAUGE_LIGHTS);
        return { text: Array.from({ length: GAUGE_LIGHTS }, (_, index) =>
          index >= lit ? "0" : index >= GAUGE_LIGHTS - GAUGE_RED ? "2" : "1").join("") };
      }
      case "timeBar": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => this.paintBar(context, rect) };
    }
    return {};
  }

  private rowState(entry: Node, name: string, row: number): Record<string, unknown> {
    const { observe } = this.options;
    const rider = this.riderAt(row);
    if (/^rankRow\d$/.test(name)) return { visible: rider !== undefined };
    if (rider === undefined) return {};
    const watched = rider === observe.watched;
    switch (name) {
      case "spot": return { paint: (context: CanvasRenderingContext2D, rect: Rect) =>
        this.paintTinted(context, rect, "rank_slot_observer2", observe.colors[rider]) };
      case "observerSelect": return { visible: watched, paint: (context: CanvasRenderingContext2D, rect: Rect) =>
        this.paintTinted(context, rect, "내순위표시_2", observe.colors[rider]) };
      case "observerSelect_line": return { visible: watched };
      case "rankStr": return { text: String(row + 1) };
      case "rid": return { text: observe.riders[rider]?.name ?? "" };
    }
    void entry;
    return {};
  }

  private texture(name: string, roots = ROOTS): Texture | undefined {
    return this.images.named(roots, name);
  }

  /** The release tints these with the rider's color: color in, the texture's alpha kept. */
  private paintTinted(context: CanvasRenderingContext2D, rect: Rect, name: string, color: unknown): void {
    const texture = this.texture(name, [RANK_FOLDER]);
    if (!texture) return;
    const css = cssColor(color);
    const key = `${name}:${css}`;
    let tinted = this.tinted.get(key);
    if (!tinted) {
      tinted = document.createElement("canvas");
      tinted.width = texture.width;
      tinted.height = texture.height;
      const paint = tinted.getContext("2d")!;
      paint.drawImage(texture.image, 0, 0);
      paint.globalCompositeOperation = "source-in";
      paint.fillStyle = css;
      paint.fillRect(0, 0, texture.width, texture.height);
      this.tinted.set(key, tinted);
    }
    context.drawImage(tinted, rect.x, rect.y, rect.width, rect.height);
  }

  /** 카메라시야: the cone turned about its axis (0, 20) to the camera's defaultVal. */
  private paintCone(context: CanvasRenderingContext2D, rect: Rect, degrees: number): void {
    const texture = this.texture("카메라시야");
    if (!texture) return;
    context.save();
    context.translate(rect.x, rect.y + 20);
    context.rotate(degrees * Math.PI / 180);
    context.drawImage(texture.image, 0, -20, rect.width, rect.height);
    context.restore();
  }

  private paintLock(context: CanvasRenderingContext2D, rect: Rect): void {
    const hover = this.view?.hoveredRegionId === "riderLock" ? 2 : 1;
    const texture = this.texture(`선수고정_${this.options.observe.rankLock ? "활성" : "비활성"}_${hover}@zz`);
    if (texture) context.drawImage(texture.image, rect.x + (rect.width - texture.width) / 2,
      rect.y + (rect.height - texture.height) / 2);
  }

  /** ReplayHorizonScrollArea (progressBar_bg), the played part (progressBar) and the 14 px scroll button. */
  private paintBar(context: CanvasRenderingContext2D, rect: Rect): void {
    const clock = this.options.observe.clock;
    const fraction = clock.durationMs > 0 ? Math.min(1, clock.current / clock.durationMs) : 0;
    const area = this.texture("progressBar_bg", ["gui_/monocoque"]);
    const played = this.texture("progressBar");
    const button = this.texture(this.dragging ? "progressBar_handle_press" : "progressBar_handle_normal",
      ["gui_/monocoque"]);
    if (area) context.drawImage(area.image, rect.x, rect.y, rect.width, rect.height);
    const thumbX = rect.x + fraction * (rect.width - BAR.thumb);
    const filled = thumbX + BAR.thumb / 2 - rect.x;
    if (played && filled > 0)
      context.drawImage(played.image, 0, 0, Math.min(played.width, filled), played.height, rect.x, rect.y, filled, rect.height);
    if (button) context.drawImage(button.image, 1, 1, 14, 14, thumbX, rect.y + rect.height / 2 - BAR.thumb / 2,
      BAR.thumb, BAR.thumb);
  }

  private clip(): void {
    if (!this.view) return;
    const { observe } = this.options;
    const areas = [...STATIC_AREAS, { x: 4, y: 156, width: 245, height: 31 * Math.max(1, observe.riders.length) },
      ...(observe.helpVisible ? [HELP_AREA] : [])];
    const key = `${observe.helpVisible}:${observe.riders.length}`;
    if (key === this.clipKey) return;
    this.clipKey = key;
    clipToStage(this.view.element, areas);
  }

  /** Once a frame: the held arrows, E's turn, the bar and the times. */
  update(): void {
    const now = performance.now();
    adjustObserveView(this.options.observe, this.held, Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000)));
    this.lastFrame = now;
    if (this.bar) {
      const clock = this.options.observe.clock;
      this.bar.setAttribute("aria-valuemin", "0");
      this.bar.setAttribute("aria-valuemax", String(Math.round(clock.durationMs)));
      this.bar.setAttribute("aria-valuenow", String(Math.round(clock.current)));
    }
    this.render();
  }

  render(): void {
    this.clip();
    this.view?.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.keys, true);
    window.removeEventListener("keyup", this.keysUp, true);
    window.removeEventListener("blur", this.blur);
    this.bar?.remove();
    this.view?.dispose();
    this.view = undefined;
  }
}
