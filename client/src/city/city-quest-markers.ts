/**
 * The floating quest marks of 卡丁城 (server-go/CITY-QUESTS.md): a gold "!"
 * over a task-point NPC with a quest to give, a gold "?" over the NPC a quest
 * under way can be finished at, a gold "★" over each collection stop still
 * to reach. The NPCs' marks bob just above their name tags
 * and are drawn on their own canvas over the race view (like the name tags),
 * sized by distance and hidden behind the camera or beyond MARK_RANGE.
 */
import { Vector3, type PerspectiveCamera } from "three";
import { CITY_VEHICLE_SCALE } from "./city-vehicle-scale";

export type QuestMark = "!" | "?" | "★";

/** Beyond this distance (m) no mark shows; the "?" of a delivery shows from further. */
const MARK_RANGE = 140;
const TARGET_RANGE = 400;
/** The name tags' anchor over a standing NPC's feet (m; city-npcs heads + city-labels HEAD_HEIGHT). */
const HEAD_HEIGHT = 1.6 * CITY_VEHICLE_SCALE;
/** A collection stop's mark floats this high (m) over the road. */
const STOP_HEIGHT = 2.2;
/** The name tag takes this much (stage px at 900 high) over the anchor; the mark floats above it. */
const TAG_TOP = 34;

export class CityQuestMarkers {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly point = new Vector3();
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();
  disposed = false;

  constructor(readonly root: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "3" });
    root.append(this.canvas);
    this.context = this.canvas.getContext("2d")!;
  }

  /** Draws `marks` (world feet positions) for `camera` at time `now` (ms). */
  draw(camera: PerspectiveCamera, marks: ReadonlyArray<{ mark: QuestMark; x: number; y: number; z: number; tagless?: boolean }>,
    now: number): void {
    if (this.disposed) return;
    const width = this.root.clientWidth, height = this.root.clientHeight;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!marks.length || !width || !height) return;
    // The race camera writes its matrices directly.
    const eye = this.eye.setFromMatrixPosition(camera.matrixWorld);
    const forward = this.forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const scale = height / 900;
    const bob = Math.sin(now / 320) * 4;
    for (const mark of marks) {
      // Over an NPC the mark floats above its name tag; a collection stop has none.
      const lift = ((mark.tagless ? 0 : TAG_TOP + 3) + bob) * scale;
      this.point.set(mark.x, mark.y + (mark.tagless ? STOP_HEIGHT : HEAD_HEIGHT), mark.z);
      const toward = this.point.clone().sub(eye);
      const distance = toward.length();
      if (toward.dot(forward) <= 0 || distance > (mark.mark === "!" ? MARK_RANGE : TARGET_RANGE)) continue;
      this.point.project(camera);
      if (this.point.z > 1) continue;
      const x = (this.point.x + 1) / 2 * width, y = (1 - this.point.y) / 2 * height - lift;
      const size = Math.max(24, Math.min(64, 900 / Math.max(distance, 1))) * Math.max(0.6, scale);
      paintMark(context, mark.mark, x, y, size);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
  }
}

/** A glossy gold glyph with a dark outline and a soft glow, its baseline at (x, y). */
export function paintMark(context: CanvasRenderingContext2D, mark: QuestMark, x: number, y: number, size: number): void {
  context.save();
  context.font = `900 ${size}px "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.shadowColor = "rgba(255, 196, 0, 0.75)";
  context.shadowBlur = size * 0.35;
  context.lineWidth = Math.max(3, size * 0.16);
  context.strokeStyle = "#5a2a00";
  context.strokeText(mark, x, y);
  context.shadowBlur = 0;
  const gradient = context.createLinearGradient(0, y - size * 0.85, 0, y);
  gradient.addColorStop(0, "#fff6a8");
  gradient.addColorStop(0.45, "#ffd21f");
  gradient.addColorStop(1, "#f08a00");
  context.fillStyle = gradient;
  context.fillText(mark, x, y);
  context.restore();
}
