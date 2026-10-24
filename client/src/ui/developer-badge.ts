import { tr } from "../i18n/locale";
import { FONT, type Rect } from "./bml-kit";

/** Gold-edged developer ribbon, separate from the host and ready marks. */
export function paintDeveloperBadge(context: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, width, height } = rect;
  context.save();
  const fill = context.createLinearGradient(x, y, x, y + height);
  fill.addColorStop(0, "#6842ad");
  fill.addColorStop(1, "#302052");
  context.fillStyle = fill;
  context.strokeStyle = "#ffe29a";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 7, y + 1);
  context.lineTo(x + width - 7, y + 1);
  context.lineTo(x + width - 1, y + height / 2);
  context.lineTo(x + width - 7, y + height - 1);
  context.lineTo(x + 7, y + height - 1);
  context.lineTo(x + 1, y + height / 2);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = "#fff1c4";
  context.font = `bold ${height < 18 ? 10 : 14}px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(tr("开发者"), x + width / 2, y + height / 2 + 0.5, width - 18);
  context.restore();
}
