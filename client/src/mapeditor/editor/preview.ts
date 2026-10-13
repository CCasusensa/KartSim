/**
 * 素材栏右侧的大预览：把选中（或鼠标停留）的官方物件用游戏装配画出来，
 * 慢慢转圈。载入前先显示雪碧图里的缩略图放大版，模型到了就把缩略图藏起来，
 * 免得静止的原角度缩略图和转动的模型叠在一起。
 */
import { AmbientLight, DirectionalLight, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { CatalogPiece } from "../catalog";
import type { AssembledScene, EditorAssets } from "./assets";
import type { Viewport } from "./viewport";

export class AssetPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.1, 5000);
  private readonly turntable = new Group();
  private current?: { id: string; scene?: AssembledScene; offset: Group; fallback?: HTMLElement };
  private width = 1;
  private height = 1;
  private spin = 0;

  constructor(private readonly assets: EditorAssets, viewport: Viewport) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add("ed-preview-3d");
    const world = new Group();
    world.rotation.x = -Math.PI / 2;
    world.add(this.turntable);
    this.scene.add(world, new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, 800, 200);
    this.scene.add(sun);
    viewport.onFrame(time => this.frame(time));
  }

  /**
   * 显示一个物件；同一个物件不重复载入。fallback 是载入前顶替的缩略图，
   * 模型画出来后隐藏。
   */
  show(piece: Pick<CatalogPiece, "id" | "track" | "path" | "min" | "max"> | undefined, fallback?: HTMLElement): void {
    if (piece && this.current?.id === piece.id) {
      this.current.fallback = fallback;
      if (fallback && this.current.scene) fallback.style.visibility = "hidden";
      return;
    }
    this.clear();
    if (!piece) return;
    const offset = new Group();
    const center: [number, number, number] = [(piece.min[0] + piece.max[0]) / 2, (piece.min[1] + piece.max[1]) / 2, (piece.min[2] + piece.max[2]) / 2];
    offset.position.set(-center[0], -center[1], -center[2]);
    this.turntable.add(offset);
    const entry: NonNullable<AssetPreview["current"]> = { id: piece.id, offset, fallback };
    this.current = entry;
    this.canvas.style.visibility = "hidden";
    // 相机：从斜上方看包围球
    const size = new Vector3(piece.max[0] - piece.min[0], piece.max[1] - piece.min[1], piece.max[2] - piece.min[2]);
    const radius = Math.max(0.5, size.length() / 2);
    const distance = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.92;
    this.camera.near = Math.max(0.05, distance / 200);
    this.camera.far = distance * 20;
    this.camera.position.set(0, distance * 0.5, distance * 0.87);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.spin = 0;
    void this.assets.assemblePiece(piece.track, piece.path).then(scene => {
      if (this.current !== entry) { scene.dispose(); return; }
      entry.scene = scene;
      offset.add(scene.object);
      this.canvas.style.visibility = "";
      if (entry.fallback) entry.fallback.style.visibility = "hidden";
    }).catch(error => console.warn("预览载入失败", piece.track, piece.path, error));
  }

  clear(): void {
    const current = this.current;
    this.current = undefined;
    if (!current) return;
    current.offset.removeFromParent();
    current.scene?.dispose();
    this.canvas.style.visibility = "hidden";
  }

  private frame(time: number): void {
    const current = this.current;
    if (!current?.scene || !this.canvas.isConnected) return;
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.spin += 0.008;
    this.turntable.rotation.z = this.spin - 0.6;
    try { current.scene.update(time, this.camera, width, height); } catch { /* 预览画不出来就算了 */ }
    this.renderer.render(this.scene, this.camera);
  }
}
