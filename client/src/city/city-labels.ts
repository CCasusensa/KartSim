/**
 * Name tags and talk balloons over the karts in 卡丁城, drawn with the My
 * Room label renderer (release name tag and YellowTalkBalloon) on a canvas
 * above the race view. Heads are the karts' positions projected with the
 * race camera.
 */
import { Vector3, type PerspectiveCamera } from "three";
import { MY_ROOM_BALLOON_MS, MyRoomRiderLabels, balloonStageHeight } from "../ui/my-room-labels";
import { CITY_VEHICLE_SCALE } from "./city-vehicle-scale";

/** My Room's 1.9 m over a full-size rider, at the city's kart size. */
const HEAD_HEIGHT = 1.9 * CITY_VEHICLE_SCALE;

export interface CityLabelHost {
  root: HTMLElement;
  library: unknown;
  camera: PerspectiveCamera;
  /** World positions of the karts to label (local first). */
  heads(): Array<{ id: string; name: string; position: { x: number; y: number; z: number } }>;
}

export class CityLabels {
  private readonly labels: MyRoomRiderLabels;
  private readonly balloons = new Map<string, { text: string; until: number }>();
  private readonly scratch = new Vector3();
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();
  disposed = false;

  constructor(readonly host: CityLabelHost, fontFamily = "'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif") {
    this.labels = new MyRoomRiderLabels(host.root, host.library as any, fontFamily);
    this.labels.canvas.style.zIndex = "3";
  }

  say(id: string, text: string, now: number): void {
    this.balloons.set(id, { text, until: now + MY_ROOM_BALLOON_MS + 1000 });
  }

  /** How high (px on a 900-px-high stage) the balloon up over `id` stands above its name tag; 0 without one. */
  balloonHeight(id: string, now: number): number {
    const balloon = this.balloons.get(id);
    return balloon && balloon.until - now > 1000 ? balloonStageHeight(balloon.text) : 0;
  }

  draw(now: number): void {
    if (this.disposed) return;
    const width = this.host.root.clientWidth, height = this.host.root.clientHeight;
    if (!width || !height) return;
    const camera = this.host.camera;
    const heads: Array<{ id: string; x: number; y: number }> = [];
    const names = new Map<string, string>();
    // The race camera sets its matrices directly; its quaternion is not its view.
    const eye = this.eye.setFromMatrixPosition(camera.matrixWorld);
    const forward = this.forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    for (const head of this.host.heads()) {
      this.scratch.set(head.position.x, head.position.y + HEAD_HEIGHT, head.position.z);
      // Skip karts behind the camera.
      const direction = this.scratch.clone().sub(eye);
      if (direction.dot(forward) <= 0) continue;
      const distance = direction.length();
      if (distance > 120) continue;
      this.scratch.project(camera);
      if (this.scratch.z > 1) continue;
      heads.push({ id: head.id, x: (this.scratch.x + 1) / 2 * width, y: (1 - this.scratch.y) / 2 * height });
      names.set(head.id, head.name);
    }
    for (const [id, balloon] of this.balloons) if (balloon.until < now) this.balloons.delete(id);
    this.labels.draw(heads as any, id => {
      const name = names.get(id);
      if (name === undefined) return undefined;
      const balloon = this.balloons.get(id);
      return { name, balloon: balloon && balloon.until - now > 1000 ? balloon.text : undefined };
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.labels.dispose();
  }
}
