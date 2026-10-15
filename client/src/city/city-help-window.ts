import { tr } from "../i18n/locale";
/**
 * 卡丁城操作说明（H 或 F1；第一次进城时自动打开一次）：release CaptionDialog
 * （bml-kit，和 M 地图一样）里分“驾驶”“城市”“任务”三页，左边是按键，右边是
 * 说明。驾驶键读玩家在设置里改过的键位（原版 22 个绑定），其余是卡丁城自己的键。
 * 确定、Esc、Enter、H、F1 关闭；←/→ 或 1/2/3 换页。
 */
import { te } from "../generated/library.js";
import { SP as keyboardLabel } from "../generated/world.js";
import { DEFAULT_KEY_MAP } from "../input/action-bindings";
import { FONT, node, nodeName, wrapText, type BmlLibrary, type Node, type Rect, type WindowView } from "../ui/bml-kit";

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];

export interface HelpRow {
  /** Key caps; "/" between them means "or". */
  keys: string[];
  text: string;
  /** keys is a topic (送货, 载客 …), drawn as a gold tag instead of key caps. */
  topic?: boolean;
}

export interface HelpPage { title: string; rows: HelpRow[]; note?: string }

/** Short names for the original scan codes' labels. */
const SHORT: Record<string, string> = {
  "Up Arrow": "↑", "Down Arrow": "↓", "Left Arrow": "←", "Right Arrow": "→",
  "Shift (Left)": "Shift", "Shift (Right)": "右 Shift", "Ctrl (Left)": "Ctrl", "Ctrl (Right)": "右 Ctrl",
  "Alt (Left)": "Alt", "Alt (Right)": "右 Alt", Space: "空格",
};

/** The key bound to a binding slot (action-bindings.ts index), as a key cap. */
export function boundKey(keyMap: Record<number, number> | undefined, index: number): string {
  const code = keyMap?.[index] ?? DEFAULT_KEY_MAP[index];
  const label = code === undefined ? "" : keyboardLabel(code) as string;
  return tr(SHORT[label] ?? label);
}

/** The three pages; the driving keys follow keyMap (the player's settings). */
export function cityHelpPages(keyMap?: Record<number, number>): HelpPage[] {
  const key = (index: number) => boundKey(keyMap, index);
  return [
    {
      title: tr("驾驶"),
      rows: [
        { keys: [key(2), key(3)], text: tr("前进 / 刹车、倒车") },
        { keys: [key(0), key(1)], text: tr("左右转向") },
        { keys: [key(4)], text: tr("漂移：转弯时按住，攒氮气") },
        { keys: [key(5)], text: tr("使用氮气加速（氮气条攒满后）") },
        { keys: [key(8), key(20)], text: tr("EX 瞬间加速") },
        { keys: [key(9)], text: tr("复位：回到最近的路上（卡住、掉进水里时用）") },
        { keys: ["Enter"], text: tr("打开聊天框，和同一线路的玩家说话") },
        { keys: ["Esc ×2"], text: tr("连按两次 Esc，离开卡丁城回到大厅") },
      ],
      note: tr("驾驶键位按“设置 → 按键”里的设置显示，可以随时修改。卡丁城没有终点，随便开；城里的 NPC 都遵守交通规则。"),
    },
    {
      title: tr("城市"),
      rows: [
        { keys: ["E"], text: tr("下车步行（车速低于 12 km/h）；走到车旁按 E 上车，别人的车有空位也能坐后座") },
        { keys: ["W", "A", "S", "D"], text: tr("步行时走路（也可以用方向键），按住 Shift 跑步，R 回到路上") },
        { keys: ["L"], text: tr("给自己的车上锁 / 解锁，上锁后别人不能上车") },
        { keys: ["M"], text: tr("卡丁城地图：滚轮或 ＋/－ 缩放、拖动平移，点击地图自动导航，小地图显示绿色路线") },
        { keys: ["G"], text: tr("打开车库换车、换装（要坐在自己车的驾驶座上）") },
        { keys: ["F"], text: tr("在加油站停车后加油；油箱空了在原地叫道路救援") },
        { keys: ["P"], text: tr("收音机：光线飞车电台的 22 首韩国歌曲，点歌、开关、随机播放（音量跟设置里的背景音乐）") },
        { keys: ["N", "B"], text: tr("开车时直接换收音机的下一首 / 上一首") },
        { keys: ["H", "F1"], text: tr("打开这页操作说明") },
      ],
      note: tr("开车会耗油，右下角显示油量和还能开多远；城里有 7 个加油站，地图上的油泵图标就是。"),
    },
    {
      title: tr("任务"),
      rows: [
        { keys: ["T"], text: tr("走近任务点人物（头顶金色“!”）按 T 对话，听完委托后在任务卡上按“开始”接任务") },
        { topic: true, keys: [tr("送货")], text: tr("把东西送到收件人那里，收件人头顶有金色“?”，到旁边自动交货") },
        { topic: true, keys: [tr("载客")], text: tr("乘客坐进你的后座：别撞车、别开太快，满意度越高小费越多；中途下车或乘客不满就失败") },
        { topic: true, keys: [tr("收集")], text: tr("开到 M 地图上标“★”的地方自动收集，收齐后交给收件人") },
        { topic: true, keys: [tr("寻物")], text: tr("在 M 地图的圆圈范围里找，信号格越多离东西越近，开到旁边就找到，再交给收件人") },
        { topic: true, keys: [tr("限制")], text: tr("限速、小心驾驶（碰撞次数）、限时：限制越难，报酬倍率越高；违反限制屏幕中间会弹出“失败”") },
        { keys: ["T"], text: tr("任务中再找委托人按 T 可以放弃任务") },
      ],
      note: tr("报酬按路程算，完成后结算金币和经验，每天前 50 个任务有报酬。传送、拖车或离开卡丁城会让任务作废。"),
    },
  ];
}

const ROW_GAP = 8;
const KEYS_WIDTH = 180;

function paintKeyCap(context: CanvasRenderingContext2D, x: number, y: number, text: string, topic = false): number {
  context.font = `bold 13px ${FONT}`;
  const width = Math.max(30, context.measureText(text).width + (topic ? 24 : 16));
  context.beginPath();
  context.roundRect?.(x, y, width, 26, topic ? 13 : 5);
  if (topic) {
    const gradient = context.createLinearGradient(0, y, 0, y + 26);
    gradient.addColorStop(0, "#ffd84a");
    gradient.addColorStop(1, "#f09a00");
    context.fillStyle = gradient;
    context.fill();
    context.fillStyle = "#4a2400";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, x + width / 2, y + 14);
    return width;
  }
  context.fillStyle = "#15213a";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.55)";
  context.lineWidth = 1;
  context.stroke();
  // A lighter top edge, like a key cap.
  context.beginPath();
  context.moveTo(x + 4, y + 1.5);
  context.lineTo(x + width - 4, y + 1.5);
  context.strokeStyle = "rgba(255, 255, 255, 0.25)";
  context.stroke();
  context.fillStyle = "white";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, y + 14);
  return width;
}

/** One page: key caps on the left, the wrapped description on the right, the note under them. */
export function paintHelpPage(context: CanvasRenderingContext2D, rect: Rect, page: HelpPage): void {
  context.save();
  context.fillStyle = "rgba(24, 58, 128, 0.06)";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  let y = rect.y + 10;
  const textX = rect.x + KEYS_WIDTH + 12, textWidth = rect.width - KEYS_WIDTH - 24;
  // English lines are longer; choose a readable size that keeps all rows
  // and the footer inside the same help panel.
  let fontSize = 15;
  const neededHeight = (size: number): number => {
    context.font = `${size}px ${FONT}`;
    const rows = page.rows.reduce((height, row) => height +
      Math.max(30, wrapText(context, row.text, textWidth).length * (size + 6) + 6) + ROW_GAP, 10);
    context.font = `14px ${FONT}`;
    return rows + (page.note ? 14 + wrapText(context, page.note, rect.width - 24).length * 20 : 0);
  };
  while (fontSize > 11 && neededHeight(fontSize) > rect.height) fontSize--;
  const lineHeight = fontSize + 6;
  for (const [index, row] of page.rows.entries()) {
    context.font = `${fontSize}px ${FONT}`;
    const lines = wrapText(context, row.text, textWidth);
    const height = Math.max(30, lines.length * lineHeight + 6);
    if (index > 0) {
      context.strokeStyle = "rgba(24, 58, 128, 0.12)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(rect.x + 10, y - ROW_GAP / 2);
      context.lineTo(rect.x + rect.width - 10, y - ROW_GAP / 2);
      context.stroke();
    }
    let x = rect.x + 12;
    const capY = y + (height - 26) / 2;
    row.keys.forEach((key, i) => {
      if (i > 0) {
        context.font = `bold 13px ${FONT}`;
        context.fillStyle = "rgb(90, 102, 125)";
        context.textAlign = "center";
        context.textBaseline = "middle";
        const join = row.keys.length === 4 ? "" : "/";
        if (join) { context.fillText(join, x + 6, capY + 13); x += 12; } else x += 3;
      }
      x += paintKeyCap(context, x, capY, key, row.topic);
    });
    context.font = `${fontSize}px ${FONT}`;
    context.fillStyle = "rgb(42, 55, 80)";
    context.textAlign = "left";
    context.textBaseline = "middle";
    lines.forEach((line, i) => context.fillText(line, textX, y + (height - lines.length * lineHeight) / 2 + lineHeight * i + lineHeight / 2));
    y += height + ROW_GAP;
  }
  if (page.note) {
    context.font = `14px ${FONT}`;
    context.fillStyle = "rgb(110, 120, 140)";
    context.textAlign = "left";
    context.textBaseline = "middle";
    y += 4;
    for (const line of wrapText(context, page.note, rect.width - 24)) {
      context.fillText(line, rect.x + 12, y + 10);
      y += 20;
    }
  }
  context.restore();
}

function paintTab(context: CanvasRenderingContext2D, rect: Rect, title: string, selected: boolean): void {
  context.save();
  context.beginPath();
  context.roundRect?.(rect.x, rect.y, rect.width, rect.height, [8, 8, 0, 0]);
  const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  if (selected) {
    gradient.addColorStop(0, "rgb(64, 150, 255)");
    gradient.addColorStop(1, "rgb(24, 92, 210)");
  } else {
    gradient.addColorStop(0, "rgb(226, 231, 240)");
    gradient.addColorStop(1, "rgb(200, 208, 222)");
  }
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = selected ? "rgb(18, 70, 170)" : "rgb(170, 180, 198)";
  context.lineWidth = 1;
  context.stroke();
  context.font = `bold 16px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = selected ? "white" : "rgb(64, 75, 95)";
  context.fillText(title, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
  context.restore();
}

export function cityHelpDefinition(pages: readonly HelpPage[]): Node {
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "cityHelpWnd", frame: "CaptionDialog", leftTopWH: "0 0 780 640",
      caption: tr("卡丁城操作说明"), captionColor: "black", align: "center" }, [
      ...pages.map((_, i) => node("Panel", { name: `helpTab${i}`, leftTopWH: `${22 + i * 150} 10 144 38` })),
      node("Panel", { name: "helpPage", leftTopWH: "22 48 736 480" }),
      node("Window", { frame: "HSection", leftTopWH: "0 0 736 1", align: "hcenter;bottom", adjust: "0 64" }),
      node("Container", { leftTopWH: "0 0 155 42", align: "hcenter;bottom", adjust: "0 12" }, [
        node("TextButton", { name: "okButton", leftTopWH: "0 0 155 42", text: tr("知道了"), textRender: "bold16",
          textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104", disabledTextColor: "255 220 220 220" }),
      ]),
    ]),
  ]);
}

export interface CityHelpWindow { dispose(): void }

export async function showCityHelpWindow(options: { library: BmlLibrary; root: HTMLElement; keyMap?: Record<number, number>;
  close(): void; loadView?: (loaded: Record<string, unknown>) => Promise<unknown> }): Promise<CityHelpWindow> {
  const pages = cityHelpPages(options.keyMap);
  const loadView = options.loadView ?? (loaded => te.load(loaded as never));
  let current = 0;
  let disposed = false;
  let view: WindowView | undefined;
  const show = (index: number) => {
    current = (index + pages.length) % pages.length;
    view?.render();
  };
  view = await loadView({
    library: options.library, root: options.root, definition: cityHelpDefinition(pages), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: tr("卡丁城操作说明"),
    onCancel: () => options.close(), onConfirm: () => options.close(),
    state: (entry: Node) => {
      const name = nodeName(entry);
      const tab = /^helpTab(\d)$/.exec(name);
      if (tab) {
        const index = Number(tab[1]);
        return { label: tr("{value0}说明", { value0: pages[index]!.title }), action: () => show(index),
          paint: (context: CanvasRenderingContext2D, rect: Rect) =>
            paintTab(context, rect, pages[index]!.title, index === current) };
      }
      switch (name) {
        case "helpPage": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintHelpPage(context, rect, pages[current]!) };
        case "okButton": return { label: tr("知道了"), action: () => options.close() };
      }
      return {};
    },
  }) as WindowView;
  const element = view.element;
  // A modal window keeps every key it has the focus for: H / F1 close it, ←/→ and 1–3 turn the page.
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyH" || event.code === "F1") options.close();
    else if (event.code === "ArrowLeft") show(current - 1);
    else if (event.code === "ArrowRight") show(current + 1);
    else if (/^Digit[1-9]$/.test(event.code) && Number(event.code.slice(5)) <= pages.length) show(Number(event.code.slice(5)) - 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener("keydown", onKey, true);
  view.show();
  view.focus("okButton");
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      element.removeEventListener("keydown", onKey, true);
      view?.dispose();
    },
  };
}
