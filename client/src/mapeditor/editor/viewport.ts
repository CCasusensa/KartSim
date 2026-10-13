/**
 * 编辑器 3D 视口。场景里有一个 world 组（rotation.x = −π/2），里面一律用
 * 客户端坐标（z 向上），与游戏渲染赛道的方式相同。
 *
 * 操作：右键拖动旋转视角，中键或按住空格左键拖动平移，滚轮缩放，Alt+左键
 * 也能旋转（触控板）；方向键平移视角（Shift 加速）。左键选取。
 */
import {
  AmbientLight, Color, DirectionalLight, GridHelper, Group, MOUSE, Object3D, PerspectiveCamera, Plane,
  Raycaster, Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget, type Intersection,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { AssembledScene } from "./assets";
import type { Vec3 } from "../design";

export type ClientPoint = Vec3;

export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.5, 30000);
  readonly world = new Group();
  readonly controls: OrbitControls;
  readonly gizmo: TransformControls;
  readonly grid = new GridHelper(4000, 200, 0x4a6c9c, 0x2c3e58);
  private readonly scenes = new Set<AssembledScene>();
  private readonly raycaster = new Raycaster();
  private readonly keys = new Set<string>();
  private frameCallbacks = new Set<(time: number) => void>();
  private width = 1;
  private height = 1;
  private disposed = false;
  stageBinding?: { beginFrame(time: number): void };
  /**
   * 左键拖动做什么（在按下的那一刻问）：pan 平移视角（拖空地），none 交给工具
   * （放置、拖物件）。没有设置时左键不动视角。
   */
  leftDrag?: (event: PointerEvent) => "pan" | "none";
  /** WASD 也能移动视角（简单模式；高级模式 W/E/R 是手柄）。 */
  wasd = false;

  constructor(readonly element: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    element.append(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new Color(0x9fc6e8);
    this.world.rotation.x = -Math.PI / 2;
    this.world.name = "world";
    this.scene.add(this.world, this.grid);
    this.grid.position.y = 0.02;
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, 800, 200);
    this.scene.add(sun);
    this.camera.position.set(0, 260, 380);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: -1 as unknown as MOUSE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.zoomSpeed = 1.4;
    this.controls.target.set(0, 0, 0);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener("dragging-changed", event => { this.controls.enabled = !event.value; });
    // Alt+左键旋转、空格+左键平移（触控板没有右键拖动）
    this.renderer.domElement.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      this.controls.mouseButtons.LEFT = (event.altKey ? MOUSE.ROTATE : this.keys.has("Space") ? MOUSE.PAN
        : this.leftDrag?.(event) === "pan" ? MOUSE.PAN : -1) as MOUSE;
    }, { capture: true });
    this.renderer.domElement.addEventListener("contextmenu", event => event.preventDefault());
    window.addEventListener("keydown", event => {
      if (isTyping(event)) return;
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", event => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
    const loop = (time: number) => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      this.frame(time);
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    this.width = Math.max(1, this.element.clientWidth);
    this.height = Math.max(1, this.element.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  private lastTime = 0;

  private frame(time: number): void {
    const dt = Math.min(0.1, (time - (this.lastTime || time)) / 1000);
    this.lastTime = time;
    this.panWithKeys(dt);
    this.controls.update();
    for (const callback of this.frameCallbacks) callback(time);
    this.stageBinding?.beginFrame(time);
    for (const scene of this.scenes) {
      try { scene.update(time, this.camera, this.width, this.height); } catch (error) { console.warn(error); this.scenes.delete(scene); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private panWithKeys(dt: number): void {
    if (!this.keys.size || this.gizmo.dragging || this.keys.has("ControlLeft") || this.keys.has("MetaLeft")) return;
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    forward.normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(20, distance * 0.9) * dt * (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3 : 1);
    const move = new Vector3();
    const held = (arrow: string, letter: string) => this.keys.has(arrow) || (this.wasd && this.keys.has(letter));
    if (held("ArrowUp", "KeyW")) move.add(forward);
    if (held("ArrowDown", "KeyS")) move.sub(forward);
    if (held("ArrowRight", "KeyD")) move.add(right);
    if (held("ArrowLeft", "KeyA")) move.sub(right);
    if (this.keys.has("PageUp")) move.y += 1;
    if (this.keys.has("PageDown")) move.y -= 1;
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(speed);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  /** 这次按下是在转视角或平移（Alt、空格），不当成工具操作。 */
  navigating(event: { altKey: boolean }): boolean {
    return event.altKey || this.keys.has("Space");
  }

  addScene(scene: AssembledScene): void { this.scenes.add(scene); }
  removeScene(scene: AssembledScene): void { this.scenes.delete(scene); }
  onFrame(callback: (time: number) => void): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  /** 鼠标位置的射线命中（只看 targets）。 */
  pick(event: { clientX: number; clientY: number }, targets: Object3D[]): Intersection | undefined {
    this.setRay(event);
    return this.raycaster.intersectObjects(targets, true).find(hit => isPickable(hit.object));
  }

  /** 鼠标射线与客户端水平面 z = height 的交点（客户端坐标）。 */
  pickPlane(event: { clientX: number; clientY: number }, height = 0): ClientPoint | undefined {
    this.setRay(event);
    const plane = new Plane(new Vector3(0, 1, 0), -height);
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    return hit ? toClient(hit) : undefined;
  }

  private setRay(event: { clientX: number; clientY: number }): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
  }

  /** 从客户端点 origin 竖直向下射线，返回命中的客户端高度。 */
  castDown(origin: ClientPoint, targets: Object3D[]): number | undefined {
    this.raycaster.set(toThree(origin), new Vector3(0, -1, 0));
    const hit = this.raycaster.intersectObjects(targets, true).find(item => isPickable(item.object));
    return hit ? hit.point.y : undefined;
  }

  /** 视角中心在客户端地面上的点。 */
  focusPoint(): ClientPoint {
    return toClient(this.controls.target);
  }

  /** 绕视角中心水平转（度，正值逆时针）。 */
  orbit(degrees: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new Vector3(0, 1, 0), (degrees * Math.PI) / 180);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  /** 拉近（factor < 1）或拉远。 */
  zoom(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.min(6000, Math.max(8, offset.length() * factor)));
    this.camera.position.copy(this.controls.target).add(offset);
  }

  /** 客户端点在视口元素里的屏幕位置；在相机背后时 visible 为 false。 */
  project(point: ClientPoint): { x: number; y: number; visible: boolean } {
    const p = toThree(point).project(this.camera);
    return { x: (p.x + 1) / 2 * this.width, y: (1 - p.y) / 2 * this.height, visible: p.z > -1 && p.z < 1 };
  }

  /** 把视角移到某个客户端点附近。 */
  lookAt(point: ClientPoint, distance?: number): void {
    const target = toThree(point);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (distance !== undefined) offset.setLength(distance);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
  }

  /** 从南边斜上方框住一个客户端包围盒。 */
  frameBounds(min: ClientPoint, max: ClientPoint): void {
    const center: ClientPoint = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size = Math.max(max[0] - min[0], max[1] - min[1], 40);
    this.controls.target.copy(toThree(center));
    this.camera.position.copy(toThree([center[0], center[1] - size * 0.55, center[2] + size * 0.75]));
  }

  /** 从当前视角渲染一张指定大小的图（赛道卡片）。 */
  snapshot(width: number, height: number): HTMLCanvasElement {
    const target = new WebGLRenderTarget(width * 2, height * 2);
    const camera = this.camera.clone();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const helper = this.gizmo.getHelper();
    const visible = { grid: this.grid.visible, gizmo: helper.visible };
    this.grid.visible = false;
    helper.visible = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    const pixels = new Uint8Array(width * 2 * height * 2 * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width * 2, height * 2, pixels);
    this.renderer.setRenderTarget(null);
    this.grid.visible = visible.grid;
    helper.visible = visible.gizmo;
    target.dispose();
    const full = document.createElement("canvas");
    full.width = width * 2;
    full.height = height * 2;
    const image = new ImageData(width * 2, height * 2);
    for (let y = 0; y < height * 2; y++) // WebGL 行序自下而上
      image.data.set(pixels.subarray((height * 2 - 1 - y) * width * 8, (height * 2 - y) * width * 8), y * width * 8);
    full.getContext("2d")!.putImageData(image, 0, 0);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(full, 0, 0, width, height);
    return canvas;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}

/** three.js 世界坐标 → 客户端坐标（world 组的逆变换）。 */
export function toClient(v: Vector3): ClientPoint {
  return [v.x, -v.z, v.y];
}

export function toThree(p: ClientPoint): Vector3 {
  return new Vector3(p[0], p[2], -p[1]);
}

function isPickable(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible || current.userData.noPick) return false;
  }
  return true;
}

export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}
