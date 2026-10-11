/**
 * Name tags and talk balloons over the karts in 卡丁城, drawn with the My
 * Room label renderer (release name tag and YellowTalkBalloon) on a canvas
 * above the race view. Heads are the karts' positions projected with the
 * race camera.
 */
import { Vector3, type PerspectiveCamera } from "three";
import { MY_ROOM_BALLOON_MS, MyRoomRiderLabels } from "../ui/my-room-labels";

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
  disposed = false;

  constructor(readonly host: CityLabelHost, fontFamily = "'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif") {
    this.labels = new MyRoomRiderLabels(host.root, host.library as any, fontFamily);
    this.labels.canvas.style.zIndex = "3";
  }

  say(id: string, text: string, now: number): void {
    this.balloons.set(id, { text, until: now + MY_ROOM_BALLOON_MS + 1000 });
  }

  draw(now: number): void {
    if (this.disposed) return;
    const width = this.host.root.clientWidth, height = this.host.root.clientHeight;
    if (!width || !height) return;
    const camera = this.host.camera;
    const heads: Array<{ id: string; x: number; y: number }> = [];
    const names = new Map<string, string>();
    for (const head of this.host.heads()) {
      this.scratch.set(head.position.x, head.position.y + 1.9, head.position.z);
      // Skip karts behind the camera.
      const direction = this.scratch.clone().sub(camera.position);
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
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
