import { tr } from "../i18n/locale";
/**
 * 卡丁城收音机窗口（P）：release CaptionDialog（和操作说明、地图一样走 te.load），
 * 上面是正在播放，中间一排上一首 / 开关 / 下一首 / 随机，下面两列是光线飞车电台
 * 的 22 首歌，点一首就放。P、Esc、Enter 关闭；N / B 下一首 / 上一首。
 */
import { te } from "../generated/library.js";
import { FONT, node, nodeName, type BmlLibrary, type Node, type Rect, type WindowView } from "../ui/bml-kit";
import type { CityRadio, RadioSong } from "./city-radio";

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];

const ROWS_PER_COLUMN = 11;
const ROW_HEIGHT = 34;
const COLUMN_WIDTH = 360;
const LIST_TOP = 160;

/** What the window reads of the radio on every redraw. */
export interface RadioWindowState {
  songs: readonly RadioSong[];
  index: number;
  on: boolean;
  loading: boolean;
  shuffle: boolean;
}

export function radioState(radio: CityRadio): RadioWindowState {
  return { songs: radio.songs, index: radio.index, on: radio.on, loading: radio.loading, shuffle: radio.playlist.shuffle };
}

function fitText(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Three little bars, like a level meter. */
function paintBars(context: CanvasRenderingContext2D, x: number, bottom: number, color: string, live: boolean): void {
  const heights = live ? [8, 14, 10] : [4, 4, 4];
  context.fillStyle = color;
  heights.forEach((height, i) => context.fillRect(x + i * 5, bottom - height, 3, height));
}

/** 正在播放: the song, its singer, what the radio is doing. */
export function paintNowPlaying(context: CanvasRenderingContext2D, rect: Rect, state: RadioWindowState): void {
  const song = state.songs[state.index]!;
  context.save();
  context.beginPath();
  context.roundRect?.(rect.x, rect.y, rect.width, rect.height, 8);
  const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  gradient.addColorStop(0, state.on ? "rgb(40, 112, 230)" : "rgb(120, 130, 148)");
  gradient.addColorStop(1, state.on ? "rgb(18, 62, 160)" : "rgb(78, 86, 102)");
  context.fillStyle = gradient;
  context.fill();
  // RayCity's audio plate: a gold line over and under the song.
  context.strokeStyle = "rgba(255, 210, 90, 0.85)";
  context.lineWidth = 2;
  for (const y of [rect.y + 8, rect.y + rect.height - 8]) {
    context.beginPath();
    context.moveTo(rect.x + 14, y);
    context.lineTo(rect.x + rect.width - 14, y);
    context.stroke();
  }
  const status = !state.on ? tr("收音机已关闭 · 正在放城市音乐") : state.loading ? tr("正在调频…") : tr("正在播放");
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.font = `bold 14px ${FONT}`;
  context.fillStyle = "rgb(255, 220, 120)";
  context.fillText(tr("光线飞车电台 · {value0}", { value0: status }), rect.x + 22, rect.y + 24);
  context.font = `bold 24px ${FONT}`;
  context.fillStyle = "white";
  context.fillText(fitText(context, song.title, rect.width - 200), rect.x + 22, rect.y + 54);
  context.font = `16px ${FONT}`;
  context.fillStyle = "rgba(255, 255, 255, 0.85)";
  context.textAlign = "right";
  context.fillText(song.singer, rect.x + rect.width - 22, rect.y + 54);
  context.font = `bold 13px ${FONT}`;
  context.fillStyle = "rgba(255, 255, 255, 0.7)";
  context.fillText(`${state.index + 1} / ${state.songs.length}${state.shuffle ? tr(" · 随机") : tr(" · 顺序")}`,
    rect.x + rect.width - 22, rect.y + 24);
  context.restore();
}

/** One song row: number, title, singer; the current one in blue. */
export function paintSongRow(context: CanvasRenderingContext2D, rect: Rect, song: RadioSong, number: number,
  current: boolean, live: boolean, hovered: boolean): void {
  context.save();
  context.beginPath();
  context.roundRect?.(rect.x, rect.y + 2, rect.width, rect.height - 4, 5);
  if (current) {
    const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
    gradient.addColorStop(0, "rgb(64, 150, 255)");
    gradient.addColorStop(1, "rgb(24, 92, 210)");
    context.fillStyle = gradient;
  } else context.fillStyle = hovered ? "rgba(64, 150, 255, 0.18)" : number % 2 ? "rgba(24, 58, 128, 0.07)" : "rgba(24, 58, 128, 0.03)";
  context.fill();
  const middle = rect.y + rect.height / 2;
  context.textBaseline = "middle";
  if (current) paintBars(context, rect.x + 9, middle + 7, "rgb(255, 220, 120)", live);
  else {
    context.font = `bold 13px ${FONT}`;
    context.textAlign = "center";
    context.fillStyle = "rgb(110, 120, 140)";
    context.fillText(String(number), rect.x + 16, middle + 1);
  }
  context.font = `14px ${FONT}`;
  const singerWidth = Math.min(130, context.measureText(song.singer).width);
  context.textAlign = "right";
  context.fillStyle = current ? "rgba(255, 255, 255, 0.85)" : "rgb(110, 120, 140)";
  context.fillText(fitText(context, song.singer, 130), rect.x + rect.width - 10, middle + 1);
  context.font = `bold 15px ${FONT}`;
  context.textAlign = "left";
  context.fillStyle = current ? "white" : "rgb(42, 55, 80)";
  context.fillText(fitText(context, song.title, rect.width - 52 - singerWidth), rect.x + 34, middle + 1);
  context.restore();
}

function button(name: string, left: number, width: number, label: string, primary = false): Node {
  return node("TextButton", { name, leftTopWH: `${left} 0 ${width} 42`, text: label, textRender: "bold16",
    ...(primary ? { textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104",
      disabledTextColor: "255 220 220 220" }
      : { textColor: "255 64 75 95", overTextColor: "255 106 120 147", clickedTextColor: "255 35 41 52",
        disabledTextColor: "255 131 131 131" }) });
}

export function radioWindowDefinition(songCount: number): Node {
  const rows = Array.from({ length: songCount }, (_, i) => {
    const column = Math.floor(i / ROWS_PER_COLUMN), row = i % ROWS_PER_COLUMN;
    return node("Panel", { name: `radioSong${i}`,
      leftTopWH: `${22 + column * (COLUMN_WIDTH + 16)} ${LIST_TOP + row * ROW_HEIGHT} ${COLUMN_WIDTH} ${ROW_HEIGHT}` });
  });
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "cityRadioWnd", frame: "CaptionDialog", leftTopWH: "0 0 780 664",
      caption: tr("卡丁城收音机"), captionColor: "black", align: "center" }, [
      node("Panel", { name: "radioNow", leftTopWH: "22 10 736 88" }),
      node("Container", { leftTopWH: "22 108 736 42" }, [
        button("previousButton", 0, 176, tr("上一首（B）")),
        button("powerButton", 186, 176, tr("关闭收音机")),
        button("nextButton", 372, 176, tr("下一首（N）")),
        button("shuffleButton", 558, 178, tr("随机播放：开")),
      ]),
      ...rows,
      node("Window", { frame: "HSection", leftTopWH: "0 0 736 1", align: "hcenter;bottom", adjust: "0 64" }),
      node("Container", { leftTopWH: "0 0 155 42", align: "hcenter;bottom", adjust: "0 12" }, [
        button("okButton", 0, 155, tr("关闭（P）"), true),
      ]),
    ]),
  ]);
}

export interface CityRadioWindow {
  /** The radio changed: redraw. */
  refresh(): void;
  dispose(): void;
}

export async function showCityRadioWindow(options: { library: BmlLibrary; root: HTMLElement; radio: CityRadio;
  close(): void; loadView?: (loaded: Record<string, unknown>) => Promise<unknown> }): Promise<CityRadioWindow> {
  const { radio } = options;
  const loadView = options.loadView ?? (loaded => te.load(loaded as never));
  let disposed = false;
  let view: WindowView | undefined;
  const songs = radio.songs;
  view = await loadView({
    library: options.library, root: options.root, definition: radioWindowDefinition(songs.length), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: tr("卡丁城收音机"),
    onCancel: () => options.close(), onConfirm: () => options.close(),
    state: (entry: Node) => {
      const state = radioState(radio);
      const name = nodeName(entry);
      const row = /^radioSong(\d+)$/.exec(name);
      if (row) {
        const index = Number(row[1]);
        const song = songs[index]!;
        const current = index === state.index && state.on;
        return { label: tr("播放 {value0}（{value1}）", { value0: song.title, value1: song.singer }), action: () => radio.select(index),
          paint: (context: CanvasRenderingContext2D, rect: Rect) => paintSongRow(context, rect, song, index + 1,
            current, current && !state.loading, view?.hoveredRegionId === name) };
      }
      switch (name) {
        case "radioNow": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintNowPlaying(context, rect, state) };
        case "previousButton": return { label: tr("上一首"), action: () => radio.previous() };
        case "nextButton": return { label: tr("下一首"), action: () => radio.next() };
        case "powerButton": return { text: state.on ? tr("关闭收音机") : tr("打开收音机"),
          label: state.on ? tr("关闭收音机，换回城市音乐") : tr("打开收音机"), action: () => radio.toggle() };
        case "shuffleButton": return { text: state.shuffle ? tr("随机播放：开") : tr("随机播放：关"),
          label: state.shuffle ? tr("改为顺序播放") : tr("改为随机播放"), action: () => radio.setShuffle(!state.shuffle) };
        case "okButton": return { label: tr("关闭"), action: () => options.close() };
      }
      return {};
    },
  }) as WindowView;
  const element = view.element;
  // A modal window keeps every key it has the focus for: P closes it, N / B change the song.
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyP") options.close();
    else if (event.code === "KeyN") radio.next();
    else if (event.code === "KeyB") radio.previous();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener("keydown", onKey, true);
  view.show();
  view.focus("okButton");
  return {
    refresh() { if (!disposed) view?.render(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      element.removeEventListener("keydown", onKey, true);
      view?.dispose();
    },
  };
}
