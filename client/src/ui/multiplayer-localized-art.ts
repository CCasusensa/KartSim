import { gameLocale, tr } from "../i18n/locale";

interface Rectangle { x: number; y: number; width: number; height: number }

/** Only these game controls contain a baked-in caption. Avatars, track previews
 * and arbitrary uploaded artwork must keep their original pixels. */
const CAPTION_BUTTONS = new Set([
  "goBackButton", "ready", "cancel", "cancel_count", "start", "start_count",
  "changeRoomInfo", "teamChange", "createRoom", "cancelRoom", "okButton",
  "cancelButton", "change",
]);

export function multiplayerImageCaption(name: string, label: string | undefined): string | undefined {
  return gameLocale() !== "zh-CN" && CAPTION_BUTTONS.has(name) && label ? label : undefined;
}

/** A native button with a readable caption in the selected language. */
export function paintMultiplayerCaption(context: CanvasRenderingContext2D,
  rect: Rectangle, caption: string, state: number): void {
  context.save();
  context.fillStyle = state === 3 ? "#768390" : state === 2 ? "#1e69a1" : state === 1 ? "#60b7ed" : "#3997d8";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = state === 3 ? "#9ba5af" : "#c4eeff";
  context.lineWidth = 1.5;
  context.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  context.font = `bold ${Math.min(20, Math.max(12, rect.height * 0.32))}px system-ui, sans-serif`;
  context.fillStyle = "white";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(caption, rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(1, rect.width - 10));
  context.restore();
}

/** The legacy mode card keeps its character art on the left; only the known
 * title area on the right is replaced. Current lobby tabs crop this area out. */
export function paintMultiplayerModeCaption(context: CanvasRenderingContext2D,
  rect: Rectangle, label: string): void {
  if (gameLocale() === "zh-CN") return;
  context.save();
  const x = rect.x + rect.width * 0.47;
  const y = rect.y + rect.height * 0.1;
  const width = rect.width * 0.51;
  const height = rect.height * 0.34;
  context.fillStyle = "#079ee9";
  context.fillRect(x, y, width, height);
  context.font = `bold ${Math.min(21, rect.height * 0.17)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "white";
  context.fillText(tr(label), x + width / 2, y + height / 2, width - 8);
  context.restore();
}
