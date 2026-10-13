/**
 * 送货结算窗口 (server-go/CITY-QUESTS.md): after the mission result plays,
 * a release CaptionDialog (built with bml-kit like the M map) lists the
 * delivery's verdict line by line: 任务成功 with the 金币, 经验 and level-ups
 * it earned, or 任务失败 with why. 确定, Enter or Esc closes it.
 */
import { te } from "../generated/library.js";
import { FONT, node, nodeName, wrapText, type BmlLibrary, type Node, type Rect, type WindowView } from "../ui/bml-kit";

const ROOTS = ["dialog2_/customMessageBox", "stage_/common"];

export interface QuestResultRow {
  label: string;
  value: string;
  /** The value's colour (default: dark text). */
  color?: string;
}

export interface QuestResult {
  success: boolean;
  /** The delivery's title, over the rows. */
  heading: string;
  rows: QuestResultRow[];
  /** A wrapped line under the rows (why it failed, a daily cap). */
  note?: string;
}

const WIDTH = 440;
const ROW = 34;
const HEADING = 46;
const NOTE_LINE = 20;

/** Lines of the note at the panel's width. */
function noteLines(note: string | undefined, width: number): string[] {
  if (!note) return [];
  const context = globalThis.document?.createElement("canvas").getContext("2d");
  // Without a canvas: a 14 px character is about 14 px wide.
  if (!context) return Array.from({ length: Math.ceil(note.length * 14 / width) }, (_, i) =>
    note.slice(Math.floor(i * width / 14), Math.floor((i + 1) * width / 14)));
  context.font = `14px ${FONT}`;
  return wrapText(context, note, width);
}

export function questResultDefinition(result: QuestResult): Node {
  const panelWidth = WIDTH - 60;
  // Measured narrower than painted: the game font may not have loaded yet.
  const notes = noteLines(result.note, panelWidth - 40);
  const panelHeight = HEADING + result.rows.length * ROW + (notes.length ? 12 + notes.length * NOTE_LINE : 0) + 8;
  const height = panelHeight + 120;
  return node("Container", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "questResultWnd", frame: "CaptionDialog", leftTopWH: `0 0 ${WIDTH} ${height}`,
      caption: result.success ? "任务成功" : "任务失败", captionColor: "black", align: "center" }, [
      node("Panel", { name: "questResult", leftTopWH: `0 12 ${panelWidth} ${panelHeight}`, align: "hcenter" }),
      node("Window", { frame: "HSection", leftTopWH: `0 0 ${panelWidth} 1`, align: "hcenter;bottom", adjust: "0 64" }),
      node("TextButton", { name: "okButton", leftTopWH: "0 0 155 42", align: "hcenter;bottom", adjust: "0 12",
        text: "确定", textRender: "bold16", textColor: "white", overTextColor: "white",
        clickedTextColor: "255 24 55 104", disabledTextColor: "255 220 220 220" }),
    ]),
  ]);
}

export function paintQuestResult(context: CanvasRenderingContext2D, rect: Rect, result: QuestResult): void {
  context.save();
  context.textBaseline = "middle";
  // The title, gold on success and red on failure.
  context.textAlign = "center";
  context.font = `bold 20px ${FONT}`;
  context.lineJoin = "round";
  context.lineWidth = 4;
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.strokeText(result.heading, rect.x + rect.width / 2, rect.y + HEADING / 2 - 4);
  context.fillStyle = result.success ? "rgb(214, 120, 0)" : "rgb(206, 40, 40)";
  context.fillText(result.heading, rect.x + rect.width / 2, rect.y + HEADING / 2 - 4);
  let y = rect.y + HEADING;
  for (const [index, row] of result.rows.entries()) {
    if (index % 2 === 0) {
      context.fillStyle = "rgba(24, 58, 128, 0.07)";
      context.fillRect(rect.x, y, rect.width, ROW);
    }
    context.font = `15px ${FONT}`;
    context.textAlign = "left";
    context.fillStyle = "rgb(90, 102, 125)";
    context.fillText(row.label, rect.x + 14, y + ROW / 2);
    context.font = `bold 17px ${FONT}`;
    context.textAlign = "right";
    context.fillStyle = row.color ?? "rgb(42, 55, 80)";
    context.fillText(row.value, rect.x + rect.width - 14, y + ROW / 2);
    y += ROW;
  }
  const notes = noteLines(result.note, rect.width);
  if (notes.length) {
    y += 12;
    context.font = `14px ${FONT}`;
    context.textAlign = "left";
    context.fillStyle = "rgb(110, 120, 140)";
    for (const line of notes) {
      context.fillText(line, rect.x, y + NOTE_LINE / 2);
      y += NOTE_LINE;
    }
  }
  context.restore();
}

export async function showQuestResultWindow(options: { library: BmlLibrary; root: HTMLElement },
  result: QuestResult, close: () => void,
  loadView: (loaded: Record<string, unknown>) => Promise<unknown> = loaded => te.load(loaded as never)):
  Promise<WindowView & { readonly disposed: boolean }> {
  const view = await loadView({
    library: options.library, root: options.root, definition: questResultDefinition(result), roots: ROOTS,
    preserveDisplayPixels: true, smoothImages: true, modal: true, label: result.success ? "任务成功" : "任务失败",
    onCancel: () => close(), onConfirm: () => close(),
    state: (entry: Node) => {
      switch (nodeName(entry)) {
        case "questResult": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => paintQuestResult(context, rect, result) };
        case "okButton": return { label: "确定", action: () => close() };
      }
      return {};
    },
  }) as WindowView & { readonly disposed: boolean };
  view.show();
  view.focus("okButton");
  return view;
}
