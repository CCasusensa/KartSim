/**
 * The targets of a 驾照考试 item mission (RiderSchoolItemStage): the models of
 * stage_/riderSchoolItem placed at the course's ToDummy points. A step's
 * targetName (target2, the pirate-captain board; iron, the magnet weight)
 * stands at every target<N> dummy; a course's own `iron` dummy always gets
 * the iron. targetArrow / goalArrow put arrow.1s over the boards still up /
 * over the iron.
 *
 * arrow.1s is a flat green arrow with its tip along the model's -y; it hangs
 * over its target tip down, turned to face the player's kart (the green
 * arrow of the 连续导弹 briefing picture, stage_/riderSchoolReady/20/02.jpg).
 * A board caught by a water bomb rides its bubble like a trapped kart (the
 * item's firedkart motion), the bubble grown to the board: the pirate
 * captain lifted in a bubble over the water bomb's splash of the 水炸弹练习
 * briefing picture (11/02.jpg).
 *
 * How a board reacts to a missile, the arrow height, its bobbing and the
 * bubble size are not in the data [还原].
 */
import { Group, type Matrix4 } from "three";
import { drivenPose } from "../item/item-kart-motion";
import type { ItemPresenterPose } from "../item/item-race-presenter-contract";
import { clientToThreePoint, distance, threeToClient, type Vec3 } from "../item/item-race-rules";

const FOLDER = "stage_/riderSchoolItem";
/** Without targetName (水炸弹练习) the target<N> dummies get the plain board [还原]. */
const DEFAULT_TARGET = "target";
/** A board falls this long after it is shot, then is gone [还原]. */
const FALL_MS = 500;
/** Aims and hits land this high above a board's foot (its face) [还原]. */
const BOARD_CENTRE = 4;
/**
 * A board a water bomb is to catch (水炸弹练习): the bubble (common
 * 물방울갇힘_일반, its shell about 4.6 × 3.9 when grown, centred 0.87 over
 * the kart it holds) is drawn this much bigger so the board (7.7 wide, 8
 * tall) fits in it, and the board's pose stands where a kart would, so the
 * shell's centre is the board's centre [还原].
 */
const BUBBLE_SCALE = 2.5;
const BUBBLE_CENTRE = 0.87;
/**
 * The arrow's origin floats this high over its target's foot, its tip (3.9
 * below the origin) clear of the board (8.1 tall) and the iron (9.5), and bobs
 * this much [还原].
 */
const ARROW_HEIGHT = 15;
const ARROW_BOB = 1;
const ARROW_PERIOD_MS = 1200;

export type LicenseTargetRole = "board" | "iron";

export interface LicenseTarget {
  /** Roster id of the item race (target0…, iron). */
  id: string;
  role: LicenseTargetRole;
  /** Name in the item notices. */
  name: string;
  /** three.js pose the items aim at and hit. */
  pose: ItemPresenterPose;
  /** three.js foot on the road: where a water bomb's splash is measured from. */
  ground: Vec3;
  /** Up until it is shot (a board); the iron always is. */
  alive: boolean;
  /** When it was shot (effective race clock). */
  hitAtMs?: number;
}

interface SceneNode {
  kind: string;
  className: string;
  name: string;
  transform: number[][];
  position: number[];
  scale: number[];
  slots: unknown[];
  slotOccurrences: unknown[];
  childOccurrences: unknown[];
  nodeEnabled: number;
  children: SceneNode[];
}

interface ModelData { root: SceneNode; settings?: unknown }

interface RenderedScene {
  object: Group;
  rootObjects: Array<{ name: string; visible: boolean } | undefined>;
  reset(nowMs: number): void;
  /** Re-serializes a wrapper's basis and position (item-cubes.ts). */
  setNodeScale(node: SceneNode, scale: number[]): void;
  update(nowMs: number, camera?: unknown, width?: number, height?: number): void;
  dispose(): void;
}

export interface LicenseTargetOps<Archive> {
  originalAsset(archive: Archive, path: string): { bytes(): Promise<Uint8Array> };
  decodeModel(bytes: Uint8Array): unknown;
  loadModel(data: ModelData, archive: Archive, path: string, identity: { id: string },
    options: Record<string, unknown>): Promise<unknown>;
}

interface DummyObject {
  kind: string;
  name: string;
  transform?: { basis?: number[][]; position?: number[] };
}

/** A target<N> or iron dummy of the course. */
export interface LicenseDummy {
  name: string;
  /** Client (Z-up) position and basis rows. */
  position: [number, number, number];
  basis: number[][];
}

export function licenseDummies(trackObjects: readonly DummyObject[]): LicenseDummy[] {
  const dummies: LicenseDummy[] = [];
  for (const object of trackObjects) {
    if (object.kind !== "ToDummy" || !/^(target\d+|iron)$/.test(object.name)) continue;
    const position = object.transform?.position;
    if (!position || position.length !== 3 || !position.every(Number.isFinite)) continue;
    const basis = object.transform?.basis;
    dummies.push({ name: object.name, position: [position[0]!, position[1]!, position[2]!],
      basis: basis?.length === 3 ? basis.map(row => [...row]) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
  }
  // target0, target1, … in course order, the iron last.
  return dummies.sort((a, b) => order(a.name) - order(b.name));
}

function order(name: string): number {
  return name === "iron" ? Number.MAX_SAFE_INTEGER : Number(name.slice(6));
}

const vector = (row: readonly number[] | undefined): Vec3 =>
  clientToThreePoint({ x: row?.[0] ?? 0, y: row?.[1] ?? 0, z: row?.[2] ?? 0 });

const footOf = (dummy: LicenseDummy): Vec3 =>
  clientToThreePoint({ x: dummy.position[0], y: dummy.position[1], z: dummy.position[2] });

function pose(dummy: LicenseDummy, lift: number, scale: number): ItemPresenterPose {
  const up = vector(dummy.basis[2]);
  const foot = footOf(dummy);
  return {
    position: { x: foot.x + up.x * lift, y: foot.y + up.y * lift, z: foot.z + up.z * lift },
    right: vector(dummy.basis[0]), forward: vector(dummy.basis[1]), up,
    ...(scale !== 1 ? { scale } : {}),
  };
}

/** What a step puts where: the model of each target dummy, and the arrows. */
export interface LicenseTargetPlan {
  targetName?: string;
  targetArrow?: boolean;
  goalArrow?: boolean;
  /** The step's items (itemslot0/1): with the water bomb the boards are to be caught in its bubble. */
  slots?: readonly string[];
}

/** The targets of a course for a step (no model is loaded). */
export function licenseTargets(dummies: readonly LicenseDummy[], plan: LicenseTargetPlan): LicenseTarget[] {
  const caught = plan.slots?.includes("waterBomb") === true;
  return dummies.map(dummy => {
    const iron = dummy.name === "iron" || plan.targetName === "iron";
    return {
      id: dummy.name, role: iron ? "iron" as const : "board" as const,
      name: iron ? "铁块" : plan.targetName === "target2" ? "海盗船长" : "目标物",
      pose: iron ? pose(dummy, 0, 1)
        : caught ? pose(dummy, BOARD_CENTRE - BUBBLE_CENTRE * BUBBLE_SCALE, BUBBLE_SCALE)
          : pose(dummy, BOARD_CENTRE, 1),
      ground: footOf(dummy), alive: true,
    };
  });
}

/** One model instance: its wrapper node and its object in the rendered scene. */
interface Instance {
  scene: RenderedScene;
  wrapper: SceneNode;
  view?: RenderedScene["rootObjects"][number];
  /** Client position at load. */
  base: number[];
  /** Client basis rows at load (an arrow: the last way it faced). */
  basis: number[][];
  /** Moved off its load pose by a bubble. */
  riding?: boolean;
}

interface Placed {
  target: LicenseTarget;
  model?: Instance;
  arrow?: Instance;
}

const IDENTITY = (): number[][] => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ONE = [1, 1, 1];

function wrapper(template: SceneNode, name: string, position: readonly number[], basis: number[][],
  children: SceneNode[]): SceneNode {
  return {
    ...template, name, transform: basis.map(row => [...row]), position: [...position], scale: [...ONE],
    slots: Array.from({ length: template.slots.length }),
    slotOccurrences: Array.from({ length: template.slotOccurrences.length }),
    childOccurrences: [], nodeEnabled: 1, children,
  };
}

function cloneTree(node: SceneNode): SceneNode {
  return { ...node, children: node.children.map(cloneTree) };
}

/** Puts an instance at a client position and basis; like the cubes, through its node. */
function place(instance: Instance, position: readonly number[], basis: readonly (readonly number[])[]): void {
  instance.wrapper.position = [...position];
  instance.wrapper.transform = basis.map(row => [...row]);
  instance.scene.setNodeScale(instance.wrapper, ONE);
}

/** Moves an instance to its load pose raised by `rise` (client z). */
function raise(instance: Instance, rise: number): void {
  place(instance, [instance.base[0]!, instance.base[1]!, instance.base[2]! + rise], instance.basis);
}

/*
 * A node's basis is the rows of its matrix (formats Jm): the model's axes are
 * its columns. A dummy's basis rows are its axes (right, forward, up).
 */
const columns = (x: Vec3, y: Vec3, z: Vec3): number[][] =>
  [[x.x, y.x, z.x], [x.y, y.y, z.y], [x.z, y.z, z.z]];
const transpose = (m: readonly (readonly number[])[]): number[][] =>
  [0, 1, 2].map(r => [0, 1, 2].map(c => m[c]![r]!));
const multiply = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number[][] =>
  a.map(row => [0, 1, 2].map(c => row[0]! * b[0]![c]! + row[1]! * b[1]![c]! + row[2]! * b[2]![c]!));

/** An arrow's node basis: tip (model -y) down, its face (model z) turned level toward `toward`; x = y × z. */
function arrowBasis(toward: { x: number; y: number }): number[][] {
  return columns({ x: -toward.y, y: toward.x, z: 0 }, { x: 0, y: 0, z: 1 }, { x: toward.x, y: toward.y, z: 0 });
}

const client = (vector: Vec3): Vec3 => threeToClient(vector);

/**
 * A board held by a water bubble rides it like a trapped kart: the item's
 * firedkart motion drives its pose (item-kart-motion.ts), the lift grown with
 * the bubble (the pose's scale).
 */
function ride(instance: Instance, target: LicenseTarget, motion: Matrix4): void {
  const { pose, ground } = target;
  const scale = pose.scale ?? 1;
  const grown = (vector: Vec3): Vec3 => ({ x: vector.x * scale, y: vector.y * scale, z: vector.z * scale });
  const drawn = drivenPose({ position: pose.position, right: grown(pose.right), up: grown(pose.up),
    forward: grown(pose.forward) }, motion);
  // The pose stands this far over the board's foot.
  const lift = distance(pose.position, ground);
  const foot = client({ x: drawn.position.x - drawn.up.x * lift, y: drawn.position.y - drawn.up.y * lift,
    z: drawn.position.z - drawn.up.z * lift });
  // The motion's turn (drawn axes against the pose's), applied to the board's own basis.
  const turn = multiply(columns(client(drawn.right), client(drawn.forward), client(drawn.up)),
    transpose(columns(client(pose.right), client(pose.forward), client(pose.up))));
  place(instance, [foot.x, foot.y, foot.z], multiply(turn, instance.basis));
}

/** What the field reads from the race each frame besides the clock. */
export interface LicenseTargetSurroundings {
  /** The player's kart (three.js): the arrows face it. */
  viewer?: Vec3;
  /** A racer's hit motion now (the item presenter's kartMotion), if it rides one. */
  motion?(targetId: string): Matrix4 | undefined;
}

/** Course targets with their models in the track group. */
export class LicenseTargetField {
  readonly object = new Group();
  private readonly scenes: RenderedScene[] = [];
  private readonly placed: Placed[];
  private readonly textures = new Map<unknown, { dispose(): void }>();
  private disposed = false;

  private constructor(readonly targets: LicenseTarget[], private readonly plan: LicenseTargetPlan) {
    this.object.name = "licenseTargets";
    this.placed = targets.map(target => ({ target }));
  }

  static async load<Archive>(archive: Archive, dummies: readonly LicenseDummy[], plan: LicenseTargetPlan,
    environment: unknown, stageBinding: unknown, ops: LicenseTargetOps<Archive>): Promise<LicenseTargetField> {
    const field = new LicenseTargetField(licenseTargets(dummies, plan), plan);
    try {
      await field.loadModels(archive, dummies, environment, stageBinding, ops);
      return field;
    } catch (error) {
      field.dispose();
      throw error;
    }
  }

  private async loadModels<Archive>(archive: Archive, dummies: readonly LicenseDummy[],
    environment: unknown, stageBinding: unknown, ops: LicenseTargetOps<Archive>): Promise<void> {
    const byModel = new Map<string, number[]>();
    this.placed.forEach((entry, index) => {
      const model = entry.target.role === "iron" ? "iron" : this.plan.targetName ?? DEFAULT_TARGET;
      byModel.set(model, [...byModel.get(model) ?? [], index]);
    });
    const options = { environment, stageBinding, advanceEnvironment: false as const,
      textureCache: this.textures };
    for (const [model, indices] of byModel) {
      const instances = await this.loadInstances(archive, model, indices.map(index => {
        const dummy = dummies[index]!;
        return { name: `${model}#${dummy.name}`, position: dummy.position, basis: dummy.basis };
      }), options, ops);
      indices.forEach((index, at) => { this.placed[index]!.model = instances[at]; });
    }
    const arrowed = this.placed.map((entry, index) => ({ entry, index })).filter(({ entry }) =>
      entry.target.role === "board" ? this.plan.targetArrow : this.plan.goalArrow);
    if (arrowed.length) {
      const instances = await this.loadInstances(archive, "arrow", arrowed.map(({ index }) => {
        const dummy = dummies[index]!;
        const up = dummy.basis[2] ?? [0, 0, 1];
        return { name: `arrow#${dummy.name}`, basis: arrowBasis({ x: 1, y: 0 }),
          position: dummy.position.map((value, axis) => value + (up[axis] ?? 0) * ARROW_HEIGHT) };
      }), options, ops);
      arrowed.forEach(({ entry }, at) => { entry.arrow = instances[at]; });
    }
  }

  private async loadInstances<Archive>(archive: Archive, model: string,
    instances: Array<{ name: string; position: readonly number[]; basis: number[][] }>,
    options: Record<string, unknown>, ops: LicenseTargetOps<Archive>): Promise<Instance[]> {
    const path = `${FOLDER}/${model}.1s`;
    const data = ops.decodeModel(await ops.originalAsset(archive, path).bytes()) as ModelData;
    if (data.root?.kind !== "node") throw new Error(`${path} 必须是独立 Relement。`);
    const root = wrapper(data.root, `license-${model}`, [0, 0, 0], IDENTITY(), []);
    const wrappers = instances.map(instance =>
      wrapper(data.root, instance.name, instance.position, instance.basis, [cloneTree(data.root)]));
    const scene = await ops.loadModel({ root, settings: data.settings }, archive, path,
      { id: `license-${model}` }, { ...options, additionalRoots: wrappers }) as RenderedScene;
    this.scenes.push(scene);
    this.object.add(scene.object);
    if (scene.rootObjects.length !== wrappers.length + 1) throw new Error(`${path} 场景根节点数量不一致。`);
    scene.reset(0);
    return wrappers.map((node, index) => ({ scene, wrapper: node, view: scene.rootObjects[index + 1],
      base: [...node.position], basis: node.transform.map(entry => [...entry]) }));
  }

  /** The race (re)starts: every board up again. */
  reset(): void {
    for (const entry of this.placed) {
      entry.target.alive = true;
      entry.target.hitAtMs = undefined;
      if (entry.model) {
        raise(entry.model, 0);
        entry.model.riding = false;
        if (entry.model.view) entry.model.view.visible = true;
      }
      if (entry.arrow?.view) entry.arrow.view.visible = true;
    }
  }

  /** A board was shot (or trapped): it no longer counts as up. */
  hit(target: LicenseTarget, nowMs: number, falls: boolean): void {
    if (target.role !== "board" || !target.alive) return;
    target.alive = false;
    target.hitAtMs = falls ? nowMs : undefined;
    const entry = this.placed.find(placed => placed.target === target);
    if (entry?.arrow?.view) entry.arrow.view.visible = false;
  }

  update(nowMs: number, camera?: unknown, width?: number, height?: number,
    surroundings: LicenseTargetSurroundings = {}): void {
    if (this.disposed) return;
    const bob = Math.sin((nowMs % ARROW_PERIOD_MS) / ARROW_PERIOD_MS * Math.PI * 2) * ARROW_BOB;
    const viewer = surroundings.viewer ? threeToClient(surroundings.viewer) : undefined;
    for (const entry of this.placed) {
      const arrow = entry.arrow;
      if (arrow?.view?.visible) {
        const dx = viewer ? viewer.x - arrow.base[0]! : 0, dy = viewer ? viewer.y - arrow.base[1]! : 0;
        const length = Math.hypot(dx, dy);
        // Right over its target it keeps the way it last faced.
        if (length > 1e-3) arrow.basis = arrowBasis({ x: dx / length, y: dy / length });
        raise(arrow, bob);
      }
      const { model, target } = entry;
      if (!model?.view?.visible) continue;
      if (target.hitAtMs !== undefined) {
        // A shot board sinks into the ground, then is gone.
        const progress = Math.min(1, Math.max(0, (nowMs - target.hitAtMs) / FALL_MS));
        raise(model, -progress * BOARD_CENTRE * 2);
        if (progress >= 1) model.view.visible = false;
        continue;
      }
      const motion = surroundings.motion?.(target.id);
      if (motion) {
        ride(model, target, motion);
        model.riding = true;
      } else if (model.riding) {
        raise(model, 0);
        model.riding = false;
      }
    }
    for (const scene of this.scenes) scene.update(Math.trunc(nowMs) >>> 0, camera, width, height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    for (const scene of this.scenes) scene.dispose();
    this.scenes.length = 0;
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
