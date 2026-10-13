/**
 * The replay console over an OB 观看 race (TIMEATTACK.md 4), after the release
 * stage_replay layout: the camera pad (A 追尾 / S 俯视 / Q 第一人称 / F 左侧 /
 * D 正面 / V 低角度, the release's console icons), play / pause / 0.5× / 0.25×,
 * the time bar (a range control over the canvas), the rider and the times,
 * display on/off and 退出. Keys: A S Q F D V, Space (pause), I (display), Esc.
 */
import { te } from "../generated/library.js";
import { OBSERVE_CAMERA_MODES, type ObserveState } from "../timeattack/replay-observe";

/** "01:35:00" for the console clock (0 is 00:00:00, not the windows' ??:??:??). */
function clockText(ms: number): string {
  const pad = (value: number) => Math.floor(Math.max(0, value)).toString().padStart(2, "0");
  return `${pad(ms / 60_000)}:${pad((ms / 1_000) % 60)}:${pad((ms / 10) % 100)}`;
}
import { clipToStage, node, prepare, type BmlLibrary, type Node, type Rect } from "./bml-kit";

interface WindowView { readonly element: HTMLElement; show(): void; dispose(): void; render(): void }

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

const ROOTS = ["stage_/replay", "stage_/common", "stage_/common/icon"];
const CONSOLE = { x: 20, y: 763, width: 426, height: 122 };
const CONTROL = { x: 597, y: 770, width: 406, height: 100 };
const BAR = { x: 120, y: 741, width: 1360, height: 4 };
const INFO = { x: 1120, y: 770, width: 440, height: 60 };
const EXIT = { x: 1500, y: 18, width: 70, height: 34 };
const DISPLAY = { x: 108, y: 18, width: 110, height: 34 };
const rectAttributes = (rect: Rect) => ({ leftTopWH: `${rect.x} ${rect.y} ${rect.width} ${rect.height}` });

function definition(): Node {
  const cameraButtons = [
    { mode: "A", x: 241, y: 70, w: 24, h: 14 }, { mode: "S", x: 302, y: 28, w: 14, h: 24 },
    { mode: "Q", x: 330, y: 70, w: 24, h: 14 }, { mode: "F", x: 365, y: 42, w: 26, h: 20 },
    { mode: "D", x: 390, y: 70, w: 24, h: 14 }, { mode: "V", x: 365, y: 85, w: 26, h: 20 },
  // Hit areas a little larger than the release icons (they are 14–26 px).
  ].map(button => node("ImageButton", { name: `camera${button.mode}`, autoLoadImage: `카메라${button.mode}_`,
    leftTopWH: `${button.x - (36 - button.w) / 2} ${button.y - (36 - button.h) / 2} 36 36` }));
  const playButtons = [
    { name: "play1", image: "플레이1_", x: 0 }, { name: "pause", image: "플레이멈춤_", x: 102 },
    { name: "play05", image: "플레이05_", x: 204 }, { name: "play025", image: "플레이025_", x: 306 },
  ].map(button => node("ImageButton", { name: button.name, autoLoadImage: button.image,
    leftTopWH: `${button.x} 0 100 100` }));
  return node("Container", { name: "replayConsole", windowRect: "fullscreen" }, [
    node("Container", { name: "console", ...rectAttributes(CONSOLE) }, [
      node("Panel", { name: "consoleBg", leftTopWH: "0 0 426 122", texture: "viewControl_bg", alphaBlend: "true" }),
      node("Panel", { name: "riderView", leftTopWH: "12 4 118 30", texture: "라이더뷰@zz", alphaBlend: "true" }),
      node("Panel", { name: "cameraPad", leftTopWH: "228 1 197 120", texture: "카메라시점틀@zz", alphaBlend: "true" }),
      node("Label", { name: "riderName", leftTopWH: "14 42 200 24" }),
      node("Label", { name: "cameraName", leftTopWH: "14 78 200 24" }),
      ...cameraButtons,
    ]),
    node("Container", { name: "controlPanel", ...rectAttributes(CONTROL) }, playButtons),
    node("Container", { name: "timeBar", ...rectAttributes({ x: BAR.x, y: BAR.y - 8, width: BAR.width, height: BAR.height + 16 }) }),
    node("Container", { name: "info", ...rectAttributes(INFO) }),
    node("ImageButton", { name: "exit", autoLoadImage: "나가기_@zz", ...rectAttributes(EXIT) }),
    node("ImageButton", { name: "displayOnOff", autoLoadImage: "displayOff_@zz", ...rectAttributes(DISPLAY) }),
  ]);
}

export class ReplayConsole {
  private view?: WindowView;
  private range?: HTMLInputElement;
  private disposed = false;
  private keys = (event: KeyboardEvent) => this.onKey(event);

  private constructor(private readonly options: ReplayConsoleOptions) {}

  static async open(options: ReplayConsoleOptions): Promise<ReplayConsole> {
    const console = new ReplayConsole(options);
    await console.build();
    return console;
  }

  private async build(): Promise<void> {
    const prepared = prepare(this.options.library, definition(), ROOTS);
    this.view = await te.load({
      library: this.options.library, root: this.options.root, definition: prepared, roots: ROOTS, smoothImages: true,
      modal: false, label: "回放操作台", onCancel: () => this.options.onExit(),
      state: (entry: Node) => this.state(entry),
    }) as WindowView;
    if (this.disposed) { this.view.dispose(); return; }
    clipToStage(this.view.element, [CONSOLE, CONTROL, { ...BAR, y: BAR.y - 8, height: BAR.height + 16 }, INFO, EXIT, DISPLAY]);
    this.view.show();
    // The time bar is a real range control laid over the canvas (seeking needs the pointer's x).
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = String(this.options.observe.clock.durationMs);
    range.step = "100";
    range.setAttribute("aria-label", "回放进度");
    Object.assign(range.style, { position: "absolute", left: `${(BAR.x / 16).toFixed(3)}%`, top: `${(BAR.y / 9).toFixed(3)}%`,
      width: `${(BAR.width / 16).toFixed(3)}%`, height: "16px", margin: "0", transform: "translateY(-6px)",
      accentColor: "#ffe248", cursor: "pointer", pointerEvents: "auto" });
    range.addEventListener("input", () => {
      this.options.observe.clock.seek(this.options.naturalMs(), Number(range.value));
      this.options.observe.previous = undefined;
      this.render();
    });
    this.view.element.append(range);
    this.range = range;
    window.addEventListener("keydown", this.keys);
  }

  private onKey(event: KeyboardEvent): void {
    if (event.repeat || this.disposed) return;
    const { observe } = this.options;
    const natural = this.options.naturalMs();
    const camera = OBSERVE_CAMERA_MODES.find(entry => entry.key === event.code);
    if (camera) { observe.camera = camera.mode; observe.previous = undefined; }
    else if (event.code === "Space") { observe.clock.paused ? observe.clock.play(natural, observe.clock.rate) : observe.clock.pause(natural); }
    else if (event.code === "KeyI") observe.hudVisible = !observe.hudVisible;
    else if (event.code === "ArrowLeft") observe.clock.seek(natural, observe.clock.current - 5000);
    else if (event.code === "ArrowRight") observe.clock.seek(natural, observe.clock.current + 5000);
    else return;
    event.preventDefault();
    event.stopPropagation();
    this.render();
  }

  private state(entry: Node): Record<string, unknown> {
    const name = entry.attributes.find(item => item.name === "name")?.value ?? "";
    const { observe } = this.options;
    const clock = observe.clock;
    const natural = () => this.options.naturalMs();
    const camera = /^camera([ASQFDV])$/.exec(name);
    if (camera) {
      const mode = camera[1] as ObserveState["camera"];
      const entryMode = OBSERVE_CAMERA_MODES.find(item => item.mode === mode)!;
      return { label: `镜头 ${entryMode.label}`, checked: observe.camera === mode,
        action: () => { this.options.onActivate?.(); observe.camera = mode; observe.previous = undefined; this.render(); } };
    }
    const act = (label: string, run: () => void) => ({ label, action: () => { this.options.onActivate?.(); run(); this.render(); } });
    switch (name) {
      case "play1": return { ...act("播放", () => clock.play(natural(), 1)), checked: !clock.paused && clock.rate === 1 };
      case "pause": return { ...act("暂停", () => clock.pause(natural())), checked: clock.paused };
      case "play05": return { ...act("0.5 倍速", () => clock.play(natural(), 0.5)), checked: !clock.paused && clock.rate === 0.5 };
      case "play025": return { ...act("0.25 倍速", () => clock.play(natural(), 0.25)), checked: !clock.paused && clock.rate === 0.25 };
      case "exit": return act("退出回放", () => this.options.onExit());
      case "displayOnOff": return act(observe.hudVisible ? "隐藏界面" : "显示界面", () => { observe.hudVisible = !observe.hudVisible; });
      case "riderName": return { text: observe.riderName, textColor: "white", textRender: "outline16" };
      case "cameraName":
        return { text: `镜头：${OBSERVE_CAMERA_MODES.find(item => item.mode === observe.camera)?.label ?? ""}${
          clock.paused ? "　暂停" : clock.rate !== 1 ? `　${clock.rate}×` : ""}`, textColor: "white" };
      case "info": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => this.paintInfo(context, rect) };
      case "timeBar": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        context.save();
        context.fillStyle = "rgba(0,0,0,0.55)";
        context.fillRect(rect.x, rect.y + 6, rect.width, 4);
        const fraction = clock.durationMs > 0 ? clock.current / clock.durationMs : 0;
        context.fillStyle = "#ffe248";
        context.fillRect(rect.x, rect.y + 6, rect.width * fraction, 4);
        context.restore();
      } };
    }
    return {};
  }

  private paintInfo(context: CanvasRenderingContext2D, rect: Rect): void {
    const { observe } = this.options;
    context.save();
    context.font = "bold 18px 'KartSim Main Menu', sans-serif";
    context.textBaseline = "top";
    context.textAlign = "right";
    context.lineWidth = 3;
    context.strokeStyle = "rgba(0,0,0,0.8)";
    context.fillStyle = "white";
    const lines = [`${observe.riderName}　${observe.kartName}`,
      `${clockText(observe.clock.current)} / ${clockText(observe.recordMs || observe.clock.durationMs)}${
        observe.clock.ended ? "　回放结束" : ""}`];
    lines.forEach((line, index) => {
      context.strokeText(line, rect.x + rect.width, rect.y + index * 26);
      context.fillText(line, rect.x + rect.width, rect.y + index * 26);
    });
    context.restore();
  }

  /** Once a frame: the time bar and the clock text. */
  update(): void {
    if (this.range && document.activeElement !== this.range)
      this.range.value = String(Math.round(this.options.observe.clock.current));
    this.view?.render();
  }

  render(): void { this.view?.render(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.keys);
    this.range?.remove();
    this.view?.dispose();
    this.view = undefined;
  }
}
