/**
 * The shop preview backend (loaded lazily by shop-preview.ts): the garage's
 * own GarageLivePanels (ui.js E7, one WebGL renderer) loads kart, character
 * and equipment cards from the garage catalog exactly like the garage item
 * grid, and each request is drawn once into a 2D canvas snapshot. Only the
 * models the shop is waiting for, plus a few recently drawn ones (so hovering
 * a card can draw its larger tooltip picture at once), stay loaded. Items
 * with an item-panel model of their own (auras, uniforms, pets, cards …,
 * shop-item-models.ts) are drawn from it on the same renderer instead.
 *
 * The same panels draw the shop stage's rider: the garage live preview (the
 * rider in the kart with paint, dye, balloon, headband, goggles, gloves, aura,
 * skid mark, flying pet and plate, GarageX's "garage-x" camera) of the
 * player's current kart, character and equipment with the tried-on items
 * swapped in, copied into the stage canvas each animation frame.
 */
import { ha, rn } from "../generated/formats.js";
import { E7, Qs } from "../generated/ui.js";
import type { GarageCatalogEntry, EquipmentCatalogEntry } from "../resources/garage-catalog";
import { kartCatalogIdentity, type KartSelection } from "../resources/system-kart-identity";
import type { ShopPreviewRequest } from "../shop/shop-view";
import { garageEquipmentCardKey, type GarageCardItem } from "../ui/garage-live-panel-assets";
import type {
  GaragePanelCamera, GaragePanelRectangle, GaragePanelRenderer,
} from "../ui/garage-live-panel-render";
import type {
  ShopPreviewSnapshot, ShopRiderSelection, ShopSnapshotBackend, ShopStageSession,
} from "./shop-preview";
import type { GaragePreviewSelection } from "../ui/garage-live-panel-assets";
import { EQUIPMENT_CATEGORIES } from "../ui/local-profile";
import { shopModels, type ShopModelCard, type ShopModelLibrary } from "./shop-item-models";

/**
 * Sizes of the shop's ItemWindows: the card's item container (shopCard*@cn
 * 180×115), the tooltip's itemWindow (shopCardTip 125×125), the dialog's
 * itemPanel (mqBuyItem@cn 220×150) and a 累计消费活动 reward slot's
 * rewardStockItem (tcCashSlotCard 70×70).
 */
const SIZES: Record<ShopPreviewRequest["size"], { width: number; height: number }> = {
  card: { width: 180, height: 115 },
  detail: { width: 125, height: 125 },
  dialog: { width: 220, height: 150 },
  reward: { width: 70, height: 70 },
};
/**
 * Garage card cameras keep a fixed horizontal field of view, so a wider
 * picture only loses height; draw no wider than the shop card's shape.
 */
const MAX_ASPECT = 180 / 112;
/** The stage canvas is drawn at most this large (device pixels). */
const STAGE_MAX_PIXELS = 1600;
/**
 * The shop stage's view of the rider (the MqShopStage camera where
 * camIntroAni ends): the garage live preview's rider and kart seen from the
 * front left and a little above, the kart's nose turned toward the viewer's
 * right, like the original mall's lower left. The camera orbits the
 * preview's origin at `distance`, `pitch` above the horizon, looking at
 * height `targetY`; the player's drag (previewYaw) turns it further. `zoom`
 * is the camera zoom over the garage-x field of view.
 */
export const SHOP_STAGE_CAMERA = { yaw: -0.5, pitch: 0.32, distance: 12.37, targetY: 1.3, zoom: 2.15 };

/** The garage-x camera zoom the stage uses (SHOP_STAGE_CAMERA.zoom). */
export const STAGE_CAMERA_ZOOM = SHOP_STAGE_CAMERA.zoom;

interface StageCamera {
  zoom?: number;
  updateProjectionMatrix?(): void;
  position?: { set(x: number, y: number, z: number): unknown };
  lookAt?(x: number, y: number, z: number): void;
}
/** Loaded models at most: the page being drawn plus recently drawn ones. */
const MAX_MODELS = 12;
const LOAD_TIMEOUT_MS = 20_000;
const STAGE_WIDTH = 1600;
const STAGE_HEIGHT = 900;

export interface GarageShopCatalog {
  karts: GarageCatalogEntry[];
  characters: GarageCatalogEntry[];
  equipment: EquipmentCatalogEntry[];
}

interface Library {
  timeAttackGarageCatalog(): Promise<unknown>;
}

interface Disposable { dispose(): void }

interface CharacterCard {
  scene: unknown;
  character: { update(time: number, camera: GaragePanelCamera, width: number,
    height: number, state: undefined): void };
}

/** The parts of GarageLivePanels (src/ui/garage-live-panels.ts) used here. */
export interface GarageShopPanels {
  readonly renderer: GaragePanelRenderer & {
    forceContextLoss?(): void;
    getContext?(): { isContextLost?(): boolean };
  };
  readonly stageBinding: { beginFrame(time: number): void };
  pixelRatio: number;
  directFrame?: unknown;
  readonly characters: Map<number, CharacterCard>;
  readonly karts: Map<string, unknown>;
  readonly equipment: Map<string, unknown>;
  readonly characterFailed: Set<number>;
  readonly kartFailed: Set<string>;
  readonly equipmentFailed: Set<string>;
  syncCards(items: GarageCardItem[]): void;
  renderKartCard(time: number, height: number, item: GarageCardItem,
    rectangle: GaragePanelRectangle, zoom?: number, shadow?: boolean): void;
  renderEquipmentCard(height: number, item: GarageCardItem, rectangle: GaragePanelRectangle): void;
  setViewport(height: number, rectangle: GaragePanelRectangle): void;
  submitScene(scene: unknown, camera: GaragePanelCamera): void;
  dispose(): void;
  /** The live preview the stage draws (optional so card-only fakes need not have it). */
  readonly preview?: unknown;
  previewKey?: string;
  previewGeneration?: number;
  syncPreview?(kart: GarageCardItem, rider: GarageCardItem, selection: GaragePreviewSelection): void;
  disposePreview?(): void;
  setPreviewSize?(width: number, height: number, preset?: string): void;
  renderPreview?(time: number, height: number, rectangle: GaragePanelRectangle, animate?: boolean): void;
  rotatePreview?(delta: number): void;
  readonly previewCamera?: unknown;
  /** The player's drag turn of the preview (garage-live-preview-motion). */
  previewYaw?: number;
}

interface StageEquipment {
  itemIds: Record<number, number>;
  kartSerial: number;
  systemKart?: string;
  [key: string]: unknown;
}

/** A copy of the profile equipment with every slot present (0 = nothing), as the preview loader reads them. */
function stageEquipment(value: unknown): StageEquipment {
  const equipment = value as Partial<StageEquipment> | undefined;
  const itemIds: Record<number, number> = {};
  for (const category of EQUIPMENT_CATEGORIES) itemIds[category] = 0;
  if (equipment?.itemIds && typeof equipment.itemIds === "object") {
    for (const [category, itemId] of Object.entries(equipment.itemIds))
      if (Number.isInteger(itemId)) itemIds[Number(category)] = itemId;
  }
  return { valueAt3E: 0, exceedType: 0, ...(equipment ?? {}), itemIds,
    kartSerial: Number.isInteger(equipment?.kartSerial) ? equipment!.kartSerial! : 0 };
}

const lower = (value: string | undefined) => value?.toLowerCase();

/** The Ready kart and character the rider selection names (exact path, system kart key). */
export function stageRider(catalog: GarageShopCatalog, rider: ShopRiderSelection):
  { kart: GarageCatalogEntry; character: GarageCatalogEntry } | undefined {
  const kart = catalog.karts.find(item => item.itemId === rider.vehicleItemId &&
    (!rider.vehiclePath || lower(item.path) === lower(rider.vehiclePath)) &&
    (item.itemId !== 0 || item.systemKey === rider.vehicleSystemKey));
  const character = catalog.characters.find(item => item.itemId === rider.characterItemId &&
    (!rider.characterPath || lower(item.path) === lower(rider.characterPath)));
  return kart && character ? { kart, character } : undefined;
}

/**
 * The preview the stage shows: the rider's kart, character and equipment
 * with each tried-on item in its category (a kart replaces the kart and
 * drops the equipped kart's serial and system key).
 */
export function stagePreviewSelection(catalog: GarageShopCatalog, rider: ShopRiderSelection,
  tried: readonly ShopPreviewRequest[]):
  { kart: GarageCardItem; character: GarageCardItem; selection: GaragePreviewSelection } | undefined {
  const base = stageRider(catalog, rider);
  if (!base) return undefined;
  const equipment = stageEquipment(rider.equipment);
  let kart = base.kart as unknown as GarageCardItem;
  let character = base.character as unknown as GarageCardItem;
  for (const item of tried) {
    const card = garageCardFor(catalog, item);
    if (!card) continue;
    if (item.category === 3) {
      kart = card;
      equipment.itemIds[3] = card.itemId;
      equipment.kartSerial = 0;
      delete equipment.systemKart;
      delete equipment.systemKartVariant;
    } else if (item.category === 1) {
      character = card;
      equipment.itemIds[1] = card.itemId;
    } else {
      equipment.itemIds[item.category] = item.itemId;
    }
  }
  return { kart, character, selection: { equipment: equipment as GaragePreviewSelection["equipment"],
    garage: rider.garage, initial: rider.initial } };
}

/** Card loaders the garage has for equipment (ui.js La0). */
const EQUIPMENT_KINDS = new Set([
  "flyingPet", "balloon", "goggle", "headBand", "handGearL", "aura", "skidMark",
  "color", "dye", "plate",
]);

function isCatalog(value: unknown): value is GarageShopCatalog {
  const catalog = value as Partial<GarageShopCatalog> | undefined;
  return Array.isArray(catalog?.karts) && Array.isArray(catalog.characters) &&
    Array.isArray(catalog.equipment);
}

function pick<Entry extends { itemId: number; internalId: string }>(entries: Entry[],
  request: ShopPreviewRequest): Entry | undefined {
  const matches = entries.filter(entry => entry.itemId === request.itemId);
  const internalId = request.internalId.toLowerCase();
  return matches.find(entry => entry.internalId.toLowerCase() === internalId) ?? matches[0];
}

/**
 * The request with the garage catalog's internal id when it names none (box
 * rewards give only category and itemId), for the item-panel models that
 * are found by it.
 */
export function withInternalId(catalog: GarageShopCatalog, request: ShopPreviewRequest): ShopPreviewRequest {
  if (request.internalId) return request;
  const entry = catalog.equipment.find(candidate =>
    candidate.category === request.category && candidate.itemId === request.itemId);
  return entry ? { ...request, internalId: entry.internalId } : request;
}

/** The garage card item for a shop item, or undefined when the garage has none. */
export function garageCardFor(catalog: GarageShopCatalog, request: ShopPreviewRequest): GarageCardItem | undefined {
  if (!(request.itemId > 0)) return undefined;
  if (request.category === 3) return pick(catalog.karts, request) as GarageCardItem | undefined;
  if (request.category === 1) return pick(catalog.characters, request) as GarageCardItem | undefined;
  const equipment = pick(catalog.equipment.filter(entry =>
    entry.category === request.category && EQUIPMENT_KINDS.has(entry.kind)), request);
  return equipment as GarageCardItem | undefined;
}

function cardKey(item: GarageCardItem): string {
  if (item.kind === "kart") return `kart|${kartCatalogIdentity(item as unknown as KartSelection)}`;
  if (item.kind === "character") return `character|${item.itemId}`;
  return `equipment|${garageEquipmentCardKey(item)}`;
}

/** Puts the preview camera where the shop stage looks from (SHOP_STAGE_CAMERA), turned by the drag. */
export function poseStageCamera(camera: StageCamera | undefined, drag: number): void {
  if (!camera) return;
  const view = SHOP_STAGE_CAMERA;
  if (camera.position && typeof camera.lookAt === "function") {
    const yaw = view.yaw + (Number.isFinite(drag) ? drag : 0);
    const flat = Math.cos(view.pitch) * view.distance;
    camera.position.set(Math.sin(yaw) * flat, view.targetY + Math.sin(view.pitch) * view.distance,
      Math.cos(yaw) * flat);
    camera.lookAt(0, view.targetY, 0);
  }
  if (camera.zoom !== view.zoom && typeof camera.updateProjectionMatrix === "function") {
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
  }
}

/** Snapshot size: the art box, narrowed to the garage card shape. */
export function snapshotSize(size: ShopPreviewRequest["size"]): { width: number; height: number } {
  const box = SIZES[size] ?? SIZES.card;
  return { width: Math.min(box.width, Math.round(box.height * MAX_ASPECT)), height: box.height };
}

function pixelRatio(): number {
  const device = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const fit = typeof window === "undefined" ? 1
    : Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
  const ratio = device * (Number.isFinite(fit) && fit > 1 ? fit : 1);
  return Math.min(2, Math.max(1, ratio));
}

/** Nothing was drawn (fully transparent): keep the kind icon instead. */
function blank(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  if (typeof context.getImageData !== "function" || width <= 0 || height <= 0) return false;
  try {
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

function createCanvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

/** An item drawn from its own item-panel model (shop-item-models.ts) instead of a garage card. */
export interface ShopModelRequest { readonly key: string }

/** The shop's item-panel models: which requests have one, and loading them. */
export interface ShopModelSource {
  resolve(request: ShopPreviewRequest): ShopModelRequest | undefined;
  load(model: ShopModelRequest): Promise<ShopModelCard>;
}

interface ModelCardEntry {
  readonly card: Promise<ShopModelCard>;
  /** Snapshots drawing it now; only unused models are dropped. */
  users: number;
}

/** Resolves the promise, rejecting once signal aborts or after LOAD_TIMEOUT_MS. */
function waitFor<Value>(promise: Promise<Value>, signal: AbortSignal, timeout: string): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(timeout)), LOAD_TIMEOUT_MS);
    const onAbort = () => finish(new Error("商店预览已取消。"));
    const finish = (error?: Error, value?: Value) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value!);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => finish(undefined, value), (error: unknown) =>
      finish(error instanceof Error ? error : new Error(String(error))));
  });
}

/** Snapshots over one GarageLivePanels; owns it and the given resources. */
export class GarageShopSnapshots implements ShopSnapshotBackend<ShopPreviewSnapshot> {
  private readonly wanted = new Map<string, { item: GarageCardItem; users: number }>();
  /** Drawn models kept loaded, most recent last. */
  private readonly retained = new Map<string, GarageCardItem>();
  private readonly listeners = new Set<() => void>();
  private readonly characterCameras = new Map<string, GaragePanelCamera>();
  private readonly stages = new Set<ShopStageSession>();
  private disposed = false;

  /** Item-panel models loaded or loading, least recently used first. */
  private readonly modelCards = new Map<string, ModelCardEntry>();

  constructor(private readonly catalog: GarageShopCatalog,
    private readonly panels: GarageShopPanels, private readonly owned: Disposable[],
    private readonly newCanvas: () => HTMLCanvasElement = createCanvas,
    private readonly models?: ShopModelSource) {}

  /** Model keys the panels are asked to keep (for tests and diagnostics). */
  get loadedKeys(): string[] {
    return [...new Set([...this.retained.keys(), ...this.wanted.keys()])];
  }

  /** Item-panel models kept loaded (for tests and diagnostics). */
  get modelKeys(): string[] {
    return [...this.modelCards.keys()];
  }

  /** GarageLivePanels onReady: a card finished loading or failed. */
  changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  async snapshot(request: ShopPreviewRequest, signal: AbortSignal): Promise<ShopPreviewSnapshot | undefined> {
    if (this.disposed || signal.aborted) return undefined;
    const model = request.itemId > 0 ? this.models?.resolve(withInternalId(this.catalog, request)) : undefined;
    if (model) return this.modelSnapshot(model, request.size, signal);
    const item = garageCardFor(this.catalog, request);
    if (!item) return undefined;
    const key = cardKey(item);
    try {
      this.acquire(key, item);
      await this.loaded(item, key, signal);
      if (this.disposed || signal.aborted) return undefined;
      const snapshot = this.draw(item, request.size);
      this.retained.delete(key);
      if (snapshot) this.retained.set(key, item);
      return snapshot;
    } finally {
      this.releaseItem(key);
    }
  }

  /** Draws the stage rider into canvas every animation frame until the session is disposed. */
  attachStage(canvas: HTMLCanvasElement, rider: ShopRiderSelection,
    onFirstFrame?: () => void): ShopStageSession | undefined {
    const panels = this.panels;
    if (this.disposed || !panels.syncPreview || !panels.renderPreview || !stageRider(this.catalog, rider))
      return undefined;
    let tried: readonly ShopPreviewRequest[] = [];
    let frame = 0;
    let stopped = false;
    const sync = () => {
      const preview = stagePreviewSelection(this.catalog, rider, tried);
      if (preview) panels.syncPreview!(preview.kart, preview.character, preview.selection);
    };
    const draw = (time: number) => {
      frame = 0;
      if (stopped || this.disposed) return;
      if (!(typeof document !== "undefined" && document.hidden)) {
        try {
          if (this.drawStage(canvas, time) && onFirstFrame) {
            const first = onFirstFrame;
            onFirstFrame = undefined;
            first();
          }
        } catch { /* The next frame tries again. */ }
      }
      frame = requestAnimationFrame(draw);
    };
    sync();
    frame = requestAnimationFrame(draw);
    const session: ShopStageSession = {
      setTryOns: items => {
        tried = [...items];
        if (!stopped) sync();
      },
      rotate: pixels => { if (!stopped) panels.rotatePreview?.(pixels); },
      dispose: () => {
        if (stopped) return;
        stopped = true;
        this.stages.delete(session);
        if (frame) cancelAnimationFrame(frame);
        if (!this.disposed) {
          panels.previewKey = undefined;
          if (panels.previewGeneration !== undefined) panels.previewGeneration++;
          try { panels.disposePreview?.(); } catch { /* Best effort. */ }
        }
      },
    };
    this.stages.add(session);
    return session;
  }

  /** One stage frame: the live preview at the canvas's on-screen size, copied into it; true when drawn. */
  private drawStage(canvas: HTMLCanvasElement, time: number): boolean {
    const panels = this.panels;
    const context = canvas.getContext("2d");
    if (!context) return false;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const scale = Math.min(1, STAGE_MAX_PIXELS / Math.max(1, bounds.width * ratio));
    const width = Math.max(1, Math.round(bounds.width * ratio * scale));
    const height = Math.max(1, Math.round(bounds.height * ratio * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (!panels.preview || !bounds.width || !bounds.height) {
      context.clearRect(0, 0, width, height);
      return false;
    }
    const renderer = panels.renderer;
    if (renderer.getContext?.().isContextLost?.()) return false;
    panels.directFrame = undefined;
    panels.pixelRatio = 1;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    panels.stageBinding.beginFrame(time);
    panels.setPreviewSize?.(width, height, "garage-x");
    poseStageCamera(panels.previewCamera as StageCamera | undefined, panels.previewYaw ?? 0);
    renderer.setScissorTest(true);
    try {
      panels.renderPreview!(time, height, { x: 0, y: 0, width, height }, true);
    } finally {
      renderer.setScissorTest(false);
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(renderer.domElement, 0, 0, width, height, 0, 0, width, height);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const stage of [...this.stages]) stage.dispose();
    this.disposed = true;
    this.changed();
    this.listeners.clear();
    this.wanted.clear();
    this.retained.clear();
    for (const entry of this.modelCards.values())
      void entry.card.then(card => card.dispose(), () => undefined);
    this.modelCards.clear();
    const renderer = this.panels.renderer;
    try { this.panels.dispose(); } catch { /* Best effort. */ }
    try { renderer.forceContextLoss?.(); } catch { /* Best effort. */ }
    for (const owned of this.owned) {
      try { owned.dispose(); } catch { /* Best effort. */ }
    }
  }

  private acquire(key: string, item: GarageCardItem): void {
    const entry = this.wanted.get(key);
    if (entry) entry.users++;
    else this.wanted.set(key, { item, users: 1 });
    this.sync();
  }

  private releaseItem(key: string): void {
    const entry = this.wanted.get(key);
    if (entry && --entry.users <= 0) this.wanted.delete(key);
    if (this.disposed) return;
    try { this.sync(); } catch { /* The next request syncs again. */ }
  }

  /** Keep the wanted models plus the most recent drawn ones within MAX_MODELS. */
  private sync(): void {
    const room = Math.max(0, MAX_MODELS - this.wanted.size);
    for (const key of [...this.retained.keys()]) {
      if (this.retained.size <= room) break;
      this.retained.delete(key);
    }
    const items = new Map<string, GarageCardItem>();
    for (const [key, item] of this.retained) items.set(key, item);
    for (const [key, entry] of this.wanted) items.set(key, entry.item);
    this.panels.syncCards([...items.values()]);
  }

  private state(item: GarageCardItem): "ready" | "failed" | "loading" {
    const panels = this.panels;
    if (item.kind === "kart") {
      const key = kartCatalogIdentity(item as unknown as KartSelection);
      return panels.karts.has(key) ? "ready" : panels.kartFailed.has(key) ? "failed" : "loading";
    }
    if (item.kind === "character") {
      return panels.characters.has(item.itemId) ? "ready"
        : panels.characterFailed.has(item.itemId) ? "failed" : "loading";
    }
    const key = garageEquipmentCardKey(item);
    return panels.equipment.has(key) ? "ready" : panels.equipmentFailed.has(key) ? "failed" : "loading";
  }

  private loaded(item: GarageCardItem, key: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.listeners.delete(check);
        signal.removeEventListener("abort", check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (this.disposed || signal.aborted) return finish(new Error("商店预览已取消。"));
        const state = this.state(item);
        if (state === "ready") finish();
        else if (state === "failed") finish(new Error(`车库卡片加载失败：${key}`));
      };
      const timer = setTimeout(() => finish(new Error(`车库卡片加载超时：${key}`)), LOAD_TIMEOUT_MS);
      this.listeners.add(check);
      signal.addEventListener("abort", check, { once: true });
      check();
    });
  }

  private characterCamera(width: number, height: number): GaragePanelCamera {
    const key = `${width}x${height}`;
    let camera = this.characterCameras.get(key);
    if (!camera) {
      camera = Qs("character", width, height) as unknown as GaragePanelCamera;
      this.characterCameras.set(key, camera);
    }
    return camera;
  }

  /** An item-panel model, loaded once and shared, drawn like an equipment card. */
  private async modelSnapshot(model: ShopModelRequest, size: ShopPreviewRequest["size"],
    signal: AbortSignal): Promise<ShopPreviewSnapshot | undefined> {
    let entry = this.modelCards.get(model.key);
    if (entry) this.modelCards.delete(model.key);
    else {
      entry = { card: this.models!.load(model), users: 0 };
      // A failed model is not kept, so a later page may try it again.
      entry.card.catch(() => {
        if (this.modelCards.get(model.key) === entry) this.modelCards.delete(model.key);
      });
    }
    this.modelCards.set(model.key, entry);
    entry.users++;
    try {
      this.trimModels();
      const card = await waitFor(entry.card, signal, `商店物品模型加载超时：${model.key}`);
      if (this.disposed || signal.aborted) return undefined;
      const snapshot = this.capture(size, (_time, height, rectangle, frame) => {
        this.panels.setViewport(height, rectangle);
        card.update(rectangle.width, rectangle.height, frame);
        this.panels.submitScene(card.scene, card.camera);
      }, card.frames);
      if (!snapshot && this.modelCards.get(model.key) === entry && entry.users === 1) {
        // A model that draws nothing is not kept.
        this.modelCards.delete(model.key);
        card.dispose();
      }
      return snapshot;
    } finally {
      entry.users--;
      if (!this.disposed) this.trimModels();
    }
  }

  /** Keep at most MAX_MODELS item-panel models, dropping unused ones oldest first. */
  private trimModels(): void {
    for (const [key, entry] of this.modelCards) {
      if (this.modelCards.size <= MAX_MODELS) break;
      if (entry.users > 0) continue;
      this.modelCards.delete(key);
      void entry.card.then(card => card.dispose(), () => undefined);
    }
  }

  /** Draw one loaded card alone on the shared renderer and copy it out. */
  private draw(item: GarageCardItem, size: ShopPreviewRequest["size"]): ShopPreviewSnapshot | undefined {
    if (this.state(item) !== "ready") throw new Error("车库卡片已释放。");
    const panels = this.panels;
    return this.capture(size, (time, height, rectangle) => {
      const { width } = rectangle;
      if (item.kind === "kart") {
        panels.renderKartCard(time, height, item, rectangle, undefined, true);
      } else if (item.kind === "character") {
        const card = panels.characters.get(item.itemId)!;
        // renderGarageCharacterCard with a camera of this picture's shape.
        const camera = this.characterCamera(width, height);
        panels.setViewport(height, rectangle);
        card.character.update(time, camera, width, height, undefined);
        panels.submitScene(card.scene, camera);
      } else {
        panels.renderEquipmentCard(height, item, rectangle);
      }
    });
  }

  /**
   * Renders one picture of the size with render() on the shared renderer and
   * copies it out. With frames (an item-panel model), the brightest of those
   * animation moments is drawn over black and over white to find its
   * coverage (unmatte).
   */
  private capture(size: ShopPreviewRequest["size"],
    render: (time: number, height: number, rectangle: GaragePanelRectangle, frame: number) => void,
    frames?: readonly number[]): ShopPreviewSnapshot | undefined {
    const { width, height } = snapshotSize(size);
    const panels = this.panels;
    const renderer = panels.renderer;
    // A lost context (the browser reclaimed it) would only draw blank pictures.
    if (renderer.getContext?.().isContextLost?.()) throw new Error("商店预览的 WebGL 上下文已丢失。");
    const ratio = pixelRatio();
    const time = performance.now();
    const rectangle = { x: 0, y: 0, width, height };
    panels.directFrame = undefined;
    panels.pixelRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    const pass = (frame: number) => {
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      panels.stageBinding.beginFrame(time);
      renderer.setScissorTest(true);
      try {
        render(time, height, rectangle, frame);
      } finally {
        renderer.setScissorTest(false);
      }
      const source = renderer.domElement;
      const canvas = this.newCanvas();
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("商店预览缺少 2D 画布。");
      context.drawImage(source, 0, 0);
      return { canvas, context };
    };
    const pixels = (picture: ReturnType<typeof pass>) =>
      picture.context.getImageData(0, 0, picture.canvas.width, picture.canvas.height);
    const release = (picture: ReturnType<typeof pass>) => {
      picture.canvas.width = 0;
      picture.canvas.height = 0;
    };
    let picture: ReturnType<typeof pass>;
    if (!frames) picture = pass(0);
    else {
      try {
        renderer.setClearColor(0x000000, 1);
        let best = frames[0] ?? 0;
        if (frames.length > 1) {
          let bestScore = -1;
          for (const frame of frames) {
            const candidate = pass(frame);
            const score = brightness(pixels(candidate).data);
            release(candidate);
            if (score > bestScore) [best, bestScore] = [frame, score];
          }
        }
        picture = pass(best);
        renderer.setClearColor(0xffffff, 1);
        const white = pass(best);
        const image = pixels(picture);
        unmatte(image.data, pixels(white).data);
        picture.context.putImageData(image, 0, 0);
        release(white);
      } finally {
        renderer.setClearColor(0, 0);
      }
    }
    const { canvas, context } = picture;
    if (blank(context, canvas.width, canvas.height)) {
      release(picture);
      return undefined;
    }
    return { canvas, width, height };
  }
}

/** How much a picture drawn over black shows: the sum of each pixel's brightest channel. */
export function brightness(pixels: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < pixels.length; index += 4)
    sum += Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
  return sum;
}

/**
 * Recovers a picture's coverage from renders over black (into which the
 * result is written) and over white: a pixel covered with alpha a shows a·c
 * over black and a·c + (1 − a) over white. Additive light (aura glow
 * textures, whose black would otherwise show as a dark box on the card)
 * comes out as white light of its brightness, brightening the card behind
 * it like the original panel drawn onto the window.
 */
export function unmatte(black: Uint8ClampedArray, white: ArrayLike<number>): void {
  for (let index = 0; index < black.length; index += 4) {
    const difference = (white[index]! - black[index]! + white[index + 1]! - black[index + 1]! +
      white[index + 2]! - black[index + 2]!) / 3;
    const alpha = Math.min(255, Math.max(0, Math.round(255 - difference)));
    for (let channel = 0; channel < 3; channel++)
      black[index + channel] = alpha === 0 ? 0 : Math.min(255, Math.round(black[index + channel]! * 255 / alpha));
    black[index + 3] = alpha;
  }
}

/** One shared garage renderer for the open shop; dispose() releases it and its WebGL context. */
export async function loadGarageShopPreview(library: unknown): Promise<ShopSnapshotBackend<ShopPreviewSnapshot>> {
  const source = library as Library | undefined;
  if (typeof source?.timeAttackGarageCatalog !== "function")
    throw new Error("商店预览缺少车库目录。");
  const catalog = await source.timeAttackGarageCatalog();
  if (!isCatalog(catalog)) throw new Error("商店预览的车库目录无效。");
  const environment = await rn.load(source as never) as Disposable;
  const binding = new ha();
  let backend: GarageShopSnapshots | undefined;
  try {
    const card = SIZES.card;
    const panels = await E7.load(source, environment, binding, () => backend?.changed(),
      card, card, undefined, "preview") as unknown as GarageShopPanels;
    backend = new GarageShopSnapshots(catalog, panels, [binding, environment], undefined,
      shopModels(source as unknown as ShopModelLibrary, environment, binding));
    return backend;
  } catch (error) {
    binding.dispose();
    environment.dispose();
    throw error;
  }
}
