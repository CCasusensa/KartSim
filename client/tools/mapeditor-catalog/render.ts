/**
 * 地图工坊素材目录 · 第二步：在浏览器里用游戏自己的装配（c5）把挑出的物件、
 * 贴图和天空各画成一张 96×96 的缩略图，拼成雪碧图。由 build.mjs 通过 CDP
 * 调用 window.__catalog.render(jobs)。
 */
import {
  AlwaysDepth, AmbientLight, DirectionalLight, DoubleSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, RepeatWrapping, Scene, Vector3, WebGLRenderer, type Texture,
} from "three";
import { loadLegacyResourceBundle } from "../../src/resources/legacy-adapter";
import { Sw } from "../../src/generated/library.js";
import { EditorAssets, type AssembledScene, type EditorLibrary } from "../../src/mapeditor/editor/assets";

export interface RenderJob {
  kind: "piece" | "surface" | "wall" | "ground" | "sky";
  track: string;
  path?: number[];
  name?: string;
  min?: number[];
  max?: number[];
}

export interface RenderOutput {
  /** 每个任务一项：slot 是它在雪碧图里的格子号，画不出来（空白、出错）时为 -1。 */
  cells: Array<{ slot: number; coverage: number; error?: string }>;
  /** image/webp data URL，每张 COLUMNS × ROWS 格。 */
  sheets: string[];
}

const CELL = 96;
const SUPER = 2;
const COLUMNS = 16;
const ROWS = 16;

const status = document.getElementById("status")!;

const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CELL * SUPER, CELL * SUPER, false);
renderer.setClearColor(0x000000, 0);
document.body.append(renderer.domElement);

const scene = new Scene();
const world = new Group();
world.rotation.x = -Math.PI / 2;
scene.add(world, new AmbientLight(0xffffff, 1.6));
const sun = new DirectionalLight(0xffffff, 1.4);
sun.position.set(300, 800, 200);
scene.add(sun);

const toThree = (p: ArrayLike<number>) => new Vector3(p[0]!, p[2]!, -p[1]!);

let assets: EditorAssets;

async function boot(): Promise<void> {
  const bundle = await loadLegacyResourceBundle("p3553", () => undefined);
  const library = await (Sw as unknown as { load(sources: unknown, progress: unknown, indexes: unknown): Promise<EditorLibrary> })
    .load(bundle.sources, () => undefined, bundle.archiveIndexes);
  assets = new EditorAssets(library);
  await assets.tracks();
  status.textContent = "就绪";
}

/** 把渲染结果缩到一格，返回不透明像素占比。 */
function grab(target: HTMLCanvasElement): number {
  const context = target.getContext("2d", { willReadFrequently: true })!;
  context.clearRect(0, 0, CELL, CELL);
  context.imageSmoothingQuality = "high";
  context.drawImage(renderer.domElement, 0, 0, CELL, CELL);
  const pixels = context.getImageData(0, 0, CELL, CELL).data;
  let solid = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 24) solid++;
  return solid / (CELL * CELL);
}

/** 从西南斜上方看包围盒，并按投影范围收紧到画面九成。 */
function frame(camera: PerspectiveCamera, min: number[], max: number[]): void {
  const center = toThree(min.map((v, i) => (v + max[i]!) / 2));
  const corners: Vector3[] = [];
  for (let i = 0; i < 8; i++) corners.push(toThree([i & 1 ? max[0]! : min[0]!, i & 2 ? max[1]! : min[1]!, i & 4 ? max[2]! : min[2]!]));
  const radius = Math.max(0.5, corners[0]!.distanceTo(corners[7]!) / 2);
  const direction = toThree([-0.55, -0.8, 0.55]).normalize();
  let distance = radius / Math.sin((camera.fov * Math.PI) / 360);
  let target = center.clone();
  for (let pass = 0; pass < 3; pass++) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.near = Math.max(0.05, distance / 200);
    camera.far = distance * 20;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const corner of corners) {
      const p = corner.clone().project(camera);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const extent = Math.max(x1 - x0, y1 - y0) / 2;
    // 画面中心挪到投影框中心
    const shift = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0.5).unproject(camera).sub(new Vector3(0, 0, 0.5).unproject(camera));
    target = target.add(shift);
    distance *= extent / 0.9;
  }
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

async function renderPiece(job: RenderJob, cell: HTMLCanvasElement): Promise<number> {
  const assembled: AssembledScene = await assets.assemblePiece(job.track, job.path!);
  try {
    world.add(assembled.object);
    const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
    frame(camera, job.min!, job.max!);
    (assets.stageBinding as unknown as { beginFrame(time: number): void }).beginFrame(0);
    assembled.update(0, camera, CELL * SUPER, CELL * SUPER);
    renderer.render(scene, camera);
    return grab(cell);
  } finally {
    assembled.object.removeFromParent();
    assembled.dispose();
  }
}

async function renderTexture(job: RenderJob, cell: HTMLCanvasElement): Promise<number> {
  const texture = await assets.texture(job.track, job.name!);
  if (!texture) throw new Error("贴图读不到");
  const map: Texture = texture.clone();
  map.wrapS = map.wrapT = RepeatWrapping;
  // 地面看得出铺开的样子，护栏横向重复
  if (job.kind === "ground") map.repeat.set(2, 2);
  if (job.kind === "wall") map.repeat.set(2, 1);
  map.needsUpdate = true;
  const material = new MeshBasicMaterial({ map, transparent: true, alphaTest: job.kind === "wall" ? 0.4 : 0, side: DoubleSide });
  const flat = new Scene();
  flat.add(new Mesh(new PlaneGeometry(2, job.kind === "wall" ? 1 : 2), material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  renderer.render(flat, camera);
  material.dispose();
  map.dispose();
  return grab(cell);
}

async function renderSky(job: RenderJob, cell: HTMLCanvasElement): Promise<number> {
  const sky = await assets.assembleSky(job.track);
  if (!sky) throw new Error("没有天空");
  try {
    sky.object.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.depthFunc = AlwaysDepth;
        material.depthWrite = false;
      }
    });
    const skyScene = new Scene();
    skyScene.add(sky.object);
    const camera = new PerspectiveCamera(80, 1, 0.5, 30000);
    camera.position.set(0, 2, 0);
    camera.lookAt(new Vector3(0, 2 + Math.tan((12 * Math.PI) / 180) * 10, -10));
    camera.updateMatrixWorld();
    (assets.stageBinding as unknown as { beginFrame(time: number): void }).beginFrame(0);
    sky.update(0, camera, CELL * SUPER, CELL * SUPER);
    renderer.setClearColor(0x9fc6e8, 1);
    renderer.render(skyScene, camera);
    renderer.setClearColor(0x000000, 0);
    return grab(cell);
  } finally {
    sky.dispose();
  }
}

/** 画完一条赛道的任务后释放它的贴图，免得显存越积越多。 */
function releaseTextures(): void {
  for (const texture of assets.textureCache.values()) (texture as { dispose?(): void }).dispose?.();
  assets.textureCache.clear();
}

async function render(jobs: RenderJob[]): Promise<RenderOutput> {
  const cells: RenderOutput["cells"] = [];
  const images: HTMLCanvasElement[] = [];
  let lastTrack = "";
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]!;
    if (job.track !== lastTrack) { releaseTextures(); lastTrack = job.track; }
    status.textContent = `${index + 1}/${jobs.length} ${job.kind} ${job.track} ${job.name ?? job.path?.join(".") ?? ""}`;
    const cell = document.createElement("canvas");
    cell.width = cell.height = CELL;
    let coverage = 0;
    let error: string | undefined;
    try {
      coverage = job.kind === "piece" ? await renderPiece(job, cell)
        : job.kind === "sky" ? await renderSky(job, cell) : await renderTexture(job, cell);
    } catch (caught) {
      error = (caught as Error).message;
    }
    const usable = !error && coverage > (job.kind === "piece" ? 0.04 : job.kind === "wall" ? 0.05 : 0.5);
    cells.push({ slot: usable ? images.length : -1, coverage: Math.round(coverage * 1000) / 1000, error });
    if (usable) images.push(cell);
    if (index % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  releaseTextures();
  const sheets: string[] = [];
  const perSheet = COLUMNS * ROWS;
  for (let start = 0; start < images.length; start += perSheet) {
    const part = images.slice(start, start + perSheet);
    const sheet = document.createElement("canvas");
    sheet.width = COLUMNS * CELL;
    sheet.height = Math.ceil(part.length / COLUMNS) * CELL;
    const context = sheet.getContext("2d")!;
    part.forEach((image, i) => context.drawImage(image, (i % COLUMNS) * CELL, Math.floor(i / COLUMNS) * CELL));
    sheets.push(sheet.toDataURL("image/webp", 0.86));
  }
  status.textContent = `完成：${images.length}/${jobs.length}，${sheets.length} 张雪碧图`;
  return { cells, sheets };
}

const ready = boot().catch(error => { status.textContent = `启动失败：${(error as Error).message}`; throw error; });
(window as unknown as { __catalog: unknown }).__catalog = {
  ready,
  cell: CELL, columns: COLUMNS, rows: ROWS,
  render: async (jobs: RenderJob[]) => { await ready; return render(jobs); },
  status: () => status.textContent,
};
