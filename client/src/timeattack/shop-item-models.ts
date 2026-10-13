/**
 * Item-panel models for the shop kinds the garage has no card for.
 *
 * The original data ships a model of its own for every such item, drawn by
 * the ItemPanel with the kind's camera record in
 * gui_/windowTemplate/itemPanels2.bml: auras a `<id>상점.1s` ("shop") build
 * next to the worn _1/_2/_3 slots (every CN aura has one; the worn intro
 * slot starts empty, so the garage card drew nothing in a still picture),
 * uniforms `stuff/uniform/<id>.1s` (textured with `_상점` images), slot
 * backgrounds `stuff2_/slotBG/<id>상점.1s`, and the decal, headphone,
 * rider-colour pen, card and item-skin-card models under stuff. Each loads
 * like the garage's decoration cards (ui.js La0 over vehicle.js hr): one
 * .1s scene over the shop's environment, textures from the model's folder.
 * Pets (pet_/<id>) share the flying pets' layout (param.bml, model.1s,
 * unequipped/fNN.1s motions) and load like the garage's flying pet card.
 */
import {
  AddEquation, CustomBlending, DataTexture, Group, Mesh, OneFactor, PerspectiveCamera, Scene, SrcAlphaFactor,
  type Material, type Object3D,
} from "three";

import { s2, T, W1, we, y9 } from "../generated/formats.js";
import { S4 } from "../generated/world.js";
import type { ShopPreviewRequest } from "../shop/shop-view";

export interface ShopModelEntry {
  readonly canonicalPath?: string;
  readonly virtualPath: string;
  bytes(): Promise<Uint8Array>;
}

export interface ShopModelLibrary {
  exactCanonicalCandidates(path: string): readonly ShopModelEntry[];
}

interface ShopModelKind {
  /** Folder under stuff2_/stuff. */
  readonly folder: string;
  /** Model names tried in order. */
  names(internalId: string): string[];
  /** The itemPanels2.bml camera record, or the camera itself for a kind the file has none for. */
  readonly panel: string | PanelRecord;
  /** Opaque textures blend additively, like the worn aura (vehicle.js le0). */
  readonly additive?: boolean;
}

/** Shop item category → its item-panel model. */
export const SHOP_ITEM_MODEL_KINDS: ReadonlyMap<number, ShopModelKind> = new Map([
  [26, { folder: "aura", names: (id: string) => [`${id}상점`, `${id}_상점`, `${id}_2`], panel: "Aura",
    additive: true }],
  [18, { folder: "uniform", names: (id: string) => [id], panel: "Uniform" }],
  [20, { folder: "decal", names: (id: string) => [id], panel: "Decal" }],
  [12, { folder: "headPhone", names: (id: string) => [id], panel: "HeadPhone" }],
  [31, { folder: "ridColor", names: (id: string) => [id], panel: "RidColor" }],
  [32, { folder: "card", names: (id: string) => [id], panel: "Card" }],
  [61, { folder: "card", names: (id: string) => [id], panel: "Card" }],
  [7, { folder: "card", names: (id: string) => [id], panel: "SlotChanger" }],
  [58, { folder: "goItemSkinCard", names: (id: string) => [id], panel: "Card" }],
  // itemPanels2 has no slot background record; the panel (about 1 × 1.1
  // around the origin, facing −y) is seen straight on, like Plate and Card.
  [71, { folder: "slotBG", names: (id: string) => [`${id}상점`, id],
    panel: { defaultCameraPos: "0 -2.5 0", defaultSpotPos: "0 0 0", zoom: "1.5", viewSize: "140 95" } }],
]);

/** Decoration roots, searched like vehicle.js ug: the model must exist under exactly one. */
const ROOTS = ["stuff2_", "stuff"] as const;
const TEXTURE_EXTENSIONS = ["png", "tga", "kng"] as const;
const PANEL_LAYOUT = "gui_/windowTemplate/itemPanels2.bml";

export interface ShopItemModel {
  /** Canonical model path, lower case: the cache key. */
  readonly key: string;
  readonly entry: ShopModelEntry;
  /** Canonical folder the model's textures are read from. */
  readonly folder: string;
  readonly panel: string | PanelRecord;
  readonly additive: boolean;
}

/** A pet, drawn from pet_/<pet> like a flying pet. */
export interface ShopPetModel {
  readonly key: string;
  readonly pet: string;
}

const PET_CATEGORY = 21;

/**
 * The pet of a shop item, or undefined when it is no pet or has no
 * param.bml. Its model and motions may come from the folders the param's
 * addModelFolder names (圣诞小哈士奇 dog2 moves like dog1), as the flying pet
 * loader reads them.
 */
export function shopPetModel(library: ShopModelLibrary,
  request: Pick<ShopPreviewRequest, "category" | "internalId">): ShopPetModel | undefined {
  // The flying pet loader's folder rule (library.js x4.load).
  if (request.category !== PET_CATEGORY || !/^[\w-]+$/.test(request.internalId)) return undefined;
  const param = `pet_/${request.internalId}/param.bml`;
  if (library.exactCanonicalCandidates(param).length !== 1) return undefined;
  return { key: param.toLowerCase(), pet: request.internalId };
}

function safeName(name: string): boolean {
  return name.length > 0 && !/[\\/]/.test(name) && name !== "." && name !== "..";
}

/** The item-panel model of a shop item, or undefined when its kind has none or the file is missing. */
export function shopItemModel(library: ShopModelLibrary,
  request: Pick<ShopPreviewRequest, "category" | "internalId">): ShopItemModel | undefined {
  const kind = SHOP_ITEM_MODEL_KINDS.get(request.category);
  if (!kind || !safeName(request.internalId)) return undefined;
  for (const name of kind.names(request.internalId)) {
    const found = ROOTS.flatMap(root => library.exactCanonicalCandidates(`${root}/${kind.folder}/${name}.1s`));
    if (found.length > 1) return undefined;
    const entry = found[0];
    if (!entry) continue;
    const path = (entry.canonicalPath ?? entry.virtualPath).replaceAll("\\", "/");
    return { key: path.toLowerCase(), entry, folder: path.slice(0, path.lastIndexOf("/")),
      panel: kind.panel, additive: kind.additive === true };
  }
  return undefined;
}

interface TextureSlot { kind?: string; name?: string }
type TextureResolution =
  | { status: "found"; entry: ShopModelEntry }
  | { status: "missing" }
  | { status: "unresolved"; reason: string };

/**
 * Textures from the model's folder (vehicle.js de0), a `@zz` name trying its
 * `@cn` variant first like the release resource lookup (library.js U1).
 */
export function shopModelTextures(library: ShopModelLibrary, folder: string):
  (slot: TextureSlot) => TextureResolution {
  return slot => {
    if (slot.kind !== "texture" || !slot.name) return { status: "missing" };
    const names = slot.name.includes("@zz") ? [slot.name.replace("@zz", "@cn"), slot.name] : [slot.name];
    for (const name of names) {
      for (const extension of TEXTURE_EXTENSIONS) {
        const found = library.exactCanonicalCandidates(`${folder}/${name}.${extension}`);
        if (found.length === 1) return { status: "found", entry: found[0]! };
        if (found.length > 1)
          return { status: "unresolved", reason: `${folder}/${name}.${extension} 有多个候选。` };
      }
    }
    return { status: "missing" };
  };
}

export interface ShopPanelCamera {
  readonly camera: PerspectiveCamera;
  readonly zoom: number;
}

interface PanelNode { name: string; children: PanelNode[] }

/** An itemPanels2.bml camera record's attributes. */
export interface PanelRecord {
  readonly defaultCameraPos: string;
  readonly defaultSpotPos: string;
  readonly zoom: string;
  readonly viewSize: string;
}

const panelLayouts = new WeakMap<object, Promise<PanelNode>>();

function panelLayout(library: ShopModelLibrary): Promise<PanelNode> {
  let pending = panelLayouts.get(library);
  if (!pending) {
    pending = (async () => {
      const found = library.exactCanonicalCandidates(PANEL_LAYOUT);
      if (found.length !== 1) throw new Error(`${PANEL_LAYOUT} source 数量必须为 1，实际 ${found.length}。`);
      return s2(await found[0]!.bytes()) as PanelNode;
    })();
    panelLayouts.set(library, pending);
    pending.catch(() => panelLayouts.delete(library));
  }
  return pending;
}

/**
 * The record's camera, placed like ui.js tf: KartRider's z-up coordinates
 * (x, y, z) become (x, z, −y); the field of view is 75° over the zoom.
 */
export function panelCamera(layout: PanelNode, record: string | PanelRecord): ShopPanelCamera {
  const node = typeof record === "string"
    ? layout.children.find(child => child.name === record && T(child, "name") === "default") : undefined;
  const attribute = (name: keyof PanelRecord): string | undefined =>
    typeof record === "string" ? node && T(node, name) : record[name];
  const read = (name: keyof PanelRecord, fallback: string) =>
    String(attribute(name) ?? fallback).split(/\s+/).map(value => Math.fround(Number(value)));
  const [cameraX, cameraY, cameraZ] = read("defaultCameraPos", "0 -2.5 0.65") as [number, number, number];
  const [spotX, spotY, spotZ] = read("defaultSpotPos", "0 0 0.65") as [number, number, number];
  const [zoom] = read("zoom", "2.5") as [number];
  const [width, height] = read("viewSize", "97 96") as [number, number];
  const aspect = width / height;
  const camera = new PerspectiveCamera(we(75 / zoom, aspect), aspect, 1, 100);
  camera.position.set(cameraX, cameraZ, -cameraY);
  camera.lookAt(spotX, spotZ, -spotY);
  return { camera, zoom };
}

interface ModelSlot {
  kind?: string;
  name?: string;
  mode?: number;
  diffuse?: number;
  controllers?: unknown[];
}

interface ModelNode {
  className?: string;
  slots?: Array<ModelSlot | undefined>;
  slotOccurrences?: Array<{ value?: unknown } | undefined>;
  children?: ModelNode[];
}

/**
 * A toon node without a texture name draws with the toon texture before it
 * (the scene assembly's "Toon 空纹理" inheritance): the frame icon of the
 * 中秋节 and 破裂海浪 slot backgrounds, which the other slot backgrounds name
 * `slot` like their frame.
 */
export function inheritToonTextureNames(root: ModelNode): void {
  let previous: string | undefined;
  const visit = (node: ModelNode) => {
    if (node.className === "ReToonRigid") {
      const slot = node.slots?.find(candidate => candidate?.kind === "texture");
      if (slot?.name) previous = slot.name;
      else if (slot && previous) slot.name = previous;
    }
    node.children?.forEach(visit);
  };
  visit(root);
}

/**
 * Toon nodes lit by MtlProperty mode 2 (the 马赫之翼 and 锁孔之翼 wings, in
 * the shop model as in the worn _2 slot) draw as mode 0, the only mode the
 * scene assembly maps for toon nodes: the toon shader takes its shading
 * from the toon ramp, and their plain white diffuse adds no colour.
 */
export function unlitToonMaterials(root: ModelNode): void {
  const visit = (node: ModelNode) => {
    if (node.className === "ReToonRigid") {
      const material = node.slots?.find(candidate => candidate?.kind === "material");
      if (material?.mode === 2 && (material.diffuse ?? 0) >>> 0 === 0xffffffff &&
          !(material.controllers ?? []).some(Boolean))
        material.mode = 0;
    }
    node.children?.forEach(visit);
  };
  visit(root);
}

interface ControllerBase { startTimeWord?: unknown; stopTimeWord?: unknown; frequency?: unknown }

/** Pictures are chosen from this many moments of an animated model. */
const PICTURE_FRAMES = 8;
/** Animations longer than this are sampled over their first part only. */
const MAX_ANIMATION_MS = 10_000;

/**
 * Animation times (ms) a still picture is chosen from: eighths of the
 * model's longest controller (node PRS, texture and material controllers),
 * or just the start of a still model. A still of a fading aura (巨兽炫光's
 * texture starts fully transparent) must not be its empty first frame.
 */
export function pictureFrames(root: ModelNode): number[] {
  let length = 0;
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 4) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const base = (value as { base?: ControllerBase }).base;
    if (base && typeof base.stopTimeWord === "number") {
      const start = typeof base.startTimeWord === "number" ? base.startTimeWord : 0;
      const frequency = typeof base.frequency === "number" && base.frequency > 0 ? base.frequency : 1;
      length = Math.max(length, (base.stopTimeWord - start) / frequency);
    }
    for (const [key, child] of Object.entries(value))
      if (key !== "base" && key !== "keys" && key !== "records" && key !== "property") visit(child, depth + 1);
  };
  const walk = (node: ModelNode) => {
    for (const occurrence of node.slotOccurrences ?? []) visit(occurrence?.value, 0);
    node.children?.forEach(walk);
  };
  walk(root);
  if (!(length > 0)) return [0];
  const span = Math.min(length, MAX_ANIMATION_MS);
  return Array.from({ length: PICTURE_FRAMES }, (_, index) => Math.round(index * span / PICTURE_FRAMES));
}

/** vehicle.js le0: aura textures without transparency are drawn as light (src·α + dst). */
function blendAdditively(root: Object3D): void {
  const seen = new Set<Material>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (seen.has(material)) continue;
      seen.add(material);
      const map = (material as Material & { uniforms?: { baseMap?: { value?: unknown } } }).uniforms?.baseMap?.value;
      if (!(map instanceof DataTexture) || !opaque(map)) continue;
      material.transparent = true;
      material.blending = CustomBlending;
      material.blendSrc = SrcAlphaFactor;
      material.blendDst = OneFactor;
      material.blendEquation = AddEquation;
      material.needsUpdate = true;
    }
  });
}

function opaque(texture: DataTexture): boolean {
  const data = (texture.image as unknown as { data?: ArrayLike<number> } | undefined)?.data;
  if (!data || data.length === 0 || data.length % 4 !== 0) return false;
  for (let index = 3; index < data.length; index += 4) if (data[index] !== 255) return false;
  return true;
}

/** A loaded model with its camera, drawn like a garage equipment card. */
export interface ShopModelCard {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Animation times (ms) worth a picture (pictureFrames). */
  readonly frames: readonly number[];
  /** Fits the camera to a width × height picture and poses the scene at frame ms into its animation. */
  update(width: number, height: number, frame: number): void;
  dispose(): void;
}

interface PetPreview {
  readonly object: Object3D;
  update(time: number, camera: PerspectiveCamera, width: number, height: number): void;
  dispose(): void;
}

const FLYING_PET_ROOT = "flyingPet_/";
const petLibraries = new WeakMap<object, object>();

/**
 * The library as the flying pet loader sees pets: its flyingPet_/… lookups
 * (model, motions, textures, the common folder) read pet_/….
 */
function petLibrary(library: object): object {
  let view = petLibraries.get(library);
  if (!view) {
    const rewrite = (path: unknown) => typeof path === "string" && path.startsWith(FLYING_PET_ROOT)
      ? `pet_/${path.slice(FLYING_PET_ROOT.length)}` : path;
    view = new Proxy(library, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key === "get" || key === "exactCanonicalCandidates" || key === "canonicalCandidates")
          return (path: unknown, ...rest: unknown[]) => value.call(target, rewrite(path), ...rest);
        return value.bind(target);
      },
    });
    petLibraries.set(library, view);
  }
  return view;
}

/**
 * Loads a pet like the garage's flying pet card (ui.js La0): the flying pet
 * preview at the origin, turned from KartRider's z-up into the scene's y-up,
 * seen with the itemPanels2 Pet camera.
 */
export async function loadShopPetCard(library: ShopModelLibrary, model: ShopPetModel,
  environment: unknown, stageBinding: unknown): Promise<ShopModelCard> {
  const layout = await panelLayout(library);
  const pet = await S4.preview({
    library: petLibrary(library), item: { internalId: model.pet }, environment, binding: stageBinding,
    colors: { primary: 0xff000000, high: 0xff000000 },
  }, true) as PetPreview;
  const { camera, zoom } = panelCamera(layout, "Pet");
  const turn = new Group();
  turn.rotation.x = -Math.PI / 2;
  turn.add(pet.object);
  const scene = new Scene();
  scene.add(turn);
  return {
    scene, camera, frames: [0],
    update(width, height) {
      camera.aspect = width / height;
      camera.fov = we(75 / zoom, camera.aspect);
      camera.updateProjectionMatrix();
      pet.update(performance.now(), camera, width, height);
    },
    dispose: () => pet.dispose(),
  };
}

/** The shop backend's item-panel models (shop-preview-garage.ts ShopModelSource) over the library. */
export function shopModels(library: ShopModelLibrary, environment: unknown, stageBinding: unknown): {
  resolve(request: ShopPreviewRequest): ShopItemModel | ShopPetModel | undefined;
  load(model: { readonly key: string }): Promise<ShopModelCard>;
} {
  return {
    resolve: request => shopItemModel(library, request) ?? shopPetModel(library, request),
    load: model => "pet" in model
      ? loadShopPetCard(library, model as ShopPetModel, environment, stageBinding)
      : loadShopModelCard(library, model as ShopItemModel, environment, stageBinding),
  };
}

interface BuiltScene {
  object: Object3D;
  reset(time: number): void;
  update(time: number, camera: PerspectiveCamera, width: number, height: number): void;
  dispose(): void;
}

/** Loads one item-panel model over the shop's environment and stage binding. */
export async function loadShopModelCard(library: ShopModelLibrary, model: ShopItemModel,
  environment: unknown, stageBinding: unknown): Promise<ShopModelCard> {
  const [parsed, layout] = await Promise.all([model.entry.bytes().then(bytes => y9(bytes)), panelLayout(library)]);
  const root = (parsed as { root?: ModelNode & { kind?: string } }).root;
  if (root?.kind !== "node") throw new Error(`${model.key} 的 .1s 根节点不是 Relement。`);
  inheritToonTextureNames(root);
  unlitToonMaterials(root);
  const frames = pictureFrames(root);
  const built = await W1(parsed, library, `shop/${model.key}`, shopModelTextures(library, model.folder), {
    environment, stageBinding, advanceEnvironment: false,
  }) as BuiltScene;
  if (model.additive) blendAdditively(built.object);
  const { camera, zoom } = panelCamera(layout, model.panel);
  const scene = new Scene();
  scene.add(built.object);
  return {
    scene, camera, frames,
    update(width, height, frame) {
      camera.aspect = width / height;
      camera.fov = we(75 / zoom, camera.aspect);
      camera.updateProjectionMatrix();
      const time = performance.now();
      built.reset(time - frame);
      built.update(time, camera, width, height);
    },
    dispose: () => built.dispose(),
  };
}
