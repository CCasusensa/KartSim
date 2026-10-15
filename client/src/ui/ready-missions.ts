import { translateItemName } from "../i18n/item-names";
import { tr } from "../i18n/locale";
/**
 * The 赛道对决 / 练习目标 tabs of the single-player 计时赛 window
 * (stage_timeAttackReady): the release Web build hid them (ready-options
 * hiddenReadyNodes); this module draws them over the generated Ready view
 * `ty` (TIMEATTACK.md). It owns the tab state, the mission rows cloned from
 * duelMissionTemplate / trainingMissionTemplate, the NPC's rider preview and
 * the duel info, and the buttons they add (tabs, reward claims, 开始对决,
 * the 难度设定 cycle). Everything else stays the release drawing.
 */
import { activeBrowserSession } from "../account/account-runtime";
import { claimTimeAttackGoal, fetchTimeAttackMissions, formatRecordTime, timeAttackErrorMessage,
  type DuelEvent, type DuelStage, type DuelStanding, type GoalSet, type MissionReward,
  type TimeAttackMissions } from "../timeattack/timeattack-api";
import { newRequestId } from "../account/rewards";
import { ItemIcons } from "../menus/item-icons";
import { U1 } from "../generated/library.js";
import { activateReadyButton, type ReadyButtonRect } from "./ready-view-actions";
import { readyButtonImageState, type ReadyOptions } from "./ready-options";

interface Node { name: string; attributes: Array<{ name: string; value: string }>; children: Node[] }
interface Texture { image: CanvasImageSource; width: number; height: number }
interface Rect { x: number; y: number; width: number; height: number }
interface ResourceFile { bytes(): Promise<Uint8Array>; virtualPath?: string }

/** A duel stage to race: the NPC and the time to beat (ready-duel.ts). */
export interface DuelRaceRequest {
  event: DuelEvent;
  stage: DuelStage;
  standing: DuelStanding;
  /** The 难度设定 level raced at (0 无 … 3). */
  difficulty: number;
}

/** The generated Ready view (ui.js ty) as this module uses it. */
export interface MissionReadyView {
  options: {
    library: unknown;
    trackId: string;
    randomGroup?: unknown;
    environment: unknown;
    stageBinding: unknown;
    profile: { equipment: { itemIds: Record<number, unknown>; [key: string]: unknown }; [key: string]: unknown };
    kart: unknown;
    character: unknown;
    onActivate?(): void;
    onStartActivate?(): void;
    onDuel?(options: ReadyOptions, duel: DuelRaceRequest): void;
    onNotice?(message: string): void;
    recordFor(options: ReadyOptions): unknown;
  };
  assets: {
    definition: Node;
    strings: Map<string, string>;
    images: Map<string, Texture>;
    buttonImages: Map<string, Texture[]>;
    buttonStyles: Map<Node, unknown>;
    frameConfig: unknown;
    frames: Map<string, unknown>;
    frame: { image: CanvasImageSource };
    trackDifficulty: Node;
    trackTitle: string;
  };
  context: CanvasRenderingContext2D;
  preview: { render(context: CanvasRenderingContext2D, rect: Rect, time: number): void; dispose(): void };
  readyOptions: ReadyOptions;
  record: unknown;
  hasReplay: boolean;
  buttonHits: Array<{ id: string; name: string; rect: ReadyButtonRect }>;
  hoveredButton?: string;
  pressedButton?: string;
  renderTimeMs: number;
  disposed: boolean;
  reverseTrack: boolean;
  nodeId(node: Node): string;
  render(): void;
  refreshRecord(): void;
  drawButtonText(node: Node, rect: Rect, state: number): void;
  drawNodeSelf(node: Node, rect: Rect, parent?: Node): void;
  drawNodeChildren(node: Node, rect: Rect): void;
  drawNodeCaption(node: Node, rect: Rect, frame: unknown): void;
  drawNode(node: Node, parentRect: Rect, parent?: Node): void;
  missions?: ReadyMissionState;
  /** Installed here: the record the 对手信息 panel shows and the tab buttons' image state (ready-view-actions). */
  recordOverride?(options: ReadyOptions): unknown;
  missionButtonState?(id: string, name: string): number | undefined;
}

/** What the generated module hands over (private helpers of ui.js). */
export interface ReadyMissionDependencies {
  layout(node: Node, parent: Rect, frame?: unknown, texture?: Texture): Rect;
  paintFrame(context: CanvasRenderingContext2D, frame: unknown, image: CanvasImageSource, rect: Rect): void;
  innerRect(frame: unknown, rect: Rect): Rect;
  attribute(node: Node, name: string): string | undefined;
  visible(node: Node, hasReplay: boolean, reverse: boolean, random: boolean): boolean;
  drawImage(context: CanvasRenderingContext2D, texture: Texture, rect: Rect): void;
  translate(text: string, strings: Map<string, string>): string;
  paintText(context: CanvasRenderingContext2D, text: string, rect: Rect,
    style: { kind?: string; render: string; align: string; color: string; strokeColor?: string }): void;
  color(value: string): string;
  image(images: Map<string, Texture>, name: string): Texture;
  requireAttribute(node: Node, name: string): string;
  trackCardPanel(node: Node | undefined): boolean;
  paintButtonFrame(context: CanvasRenderingContext2D, texture: Texture, rect: Rect): void;
  buttonStyle(node: Node, frameConfig: unknown, frameBml: Node): unknown;
  parseBml(bytes: Uint8Array): Node;
  loadPreview(library: unknown, kart: unknown, character: unknown, environment: unknown, stageBinding: unknown,
    profile: unknown): Promise<MissionReadyView["preview"]>;
  loadTexture(file: ResourceFile): Promise<Texture>;
}

/** A resource under roots by name (@cn before @zz, like every window's images). */
function resource(library: unknown, roots: string[], name: string, extension = ".png"): ResourceFile {
  return U1(library as never, roots, name, extension) as ResourceFile;
}

export type MissionTab = "duel" | "training";

interface RowLayout { node: Node; rect: Rect }

export interface ReadyMissionState {
  tab: MissionTab;
  templates?: { duel: Node; training: Node };
  data?: TimeAttackMissions;
  loadError?: string;
  /** The duel stage shown (1-based), and the 难度设定 level picked for it. */
  stage: number;
  difficulty: number;
  npc?: { stage: number; preview?: MissionReadyView["preview"]; loading?: Promise<void>; portrait?: Texture };
  icons?: ItemIcons;
  rows: { duel: Node[]; training: Node[]; revision: number };
  busy: boolean;
  disposed: boolean;
  frameBml?: Node;
  catalog?: { karts: Array<{ itemId: number; title?: string; path?: string }>;
    characters: Array<{ itemId: number; path?: string }> };
  /** The generated module's helpers, for the button handlers. */
  deps?: ReadyMissionDependencies;
}

const READY_ROOT = "stage_/timeAttackReady";
const SCENE_ROOT = "stage_/scene";
/** Rows of the two GridSelectors (duelMissionTemplate 416×146, trainingMissionTemplate 416×110). */
const DUEL_ROW = { width: 416, height: 146 };
const TRAINING_ROW = { width: 416, height: 110 };
/** Nodes the duel tab adds (hidden by the release's hiddenReadyNodes). */
const DUEL_NODES = new Set(["duelInfoPanel", "vsIconOn", "difficulty"]);
/** Images of the duel nodes and the row templates (not loaded by the release's visible-node scan). */
const EXTRA_IMAGES = ["timeAttack_main_periodBG", "timeAttack_match_iconVS", "timeAttack_match_iconVsComplete@zz",
  "timeAttack_main_iconLevel0", "timeAttack_main_iconLevel1", "timeAttack_main_slotVsBG1", "timeAttack_main_slotVsBG2",
  "timeAttack_enemy_slotBreak@zz", "timeAttack_main_slotVsClear", "timeAttack_main_slotVsEmpty",
  "timeAttack_main_slotNormalBG", "timeAttack_main_slotNormalClear", "timeAttack_main_slotGageBar",
  "timeAttack_main_slotSpecialBG", "timeAttack_main_slotSpecialClear"];
const EXTRA_BUTTONS = ["timeAttack_main_tabBtn_", "timeAttack_main_btnVsMatching_@zz", "timeAttack_main_btnReward_"];

const attr = (node: Node, name: string): string | undefined =>
  node.attributes.find(entry => entry.name === name)?.value;
const nodeName = (node: Node | undefined): string | undefined => node && attr(node, "name");

function setAttr(node: Node, name: string, value: string): void {
  const entry = node.attributes.find(item => item.name === name);
  if (entry) entry.value = value;
  else node.attributes.push({ name, value });
}

function clone(node: Node): Node {
  return { name: node.name, attributes: node.attributes.map(entry => ({ ...entry })),
    children: node.children.map(clone) };
}

function find(node: Node, name: string): Node | undefined {
  if (attr(node, "name") === name) return node;
  for (const child of node.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

/** The Ready painter admits bold/outline 14/16/20 only; the templates' bare "outline" is sized. */
function admitTextRenders(node: Node): void {
  if (node.name === "Label") {
    const render = attr(node, "textRender") ?? "";
    if (!/(?:bold|outline)(?:14|16|20)$/.test(render))
      setAttr(node, "textRender", render.startsWith("outline") ? "outline14" : "bold14");
  }
  node.children.forEach(admitTextRenders);
}

function findAll(node: Node, name: string, out: Node[] = []): Node[] {
  if (attr(node, "name") === name) out.push(node);
  for (const child of node.children) findAll(child, name, out);
  return out;
}

/** Loads the templates, images and buttons the tabs need; without an account the window stays the release one. */
export async function installReadyMissions(view: MissionReadyView, deps: ReadyMissionDependencies): Promise<void> {
  const state: ReadyMissionState = { tab: "training", stage: 1, difficulty: 0, busy: false, disposed: false,
    rows: { duel: [], training: [], revision: -1 }, deps };
  view.missions = state;
  view.recordOverride = options => missionRecordFor(view, options);
  view.missionButtonState = (id, name) => missionButtonState(view, id, name);
  const library = view.options.library;
  const session = activeBrowserSession();
  if (view.options.randomGroup !== undefined) return; // random pools have no goals or duel
  try {
    const [duel, training, frameBml] = await Promise.all([
      resource(library, [READY_ROOT], "duelMissionTemplate", ".bml").bytes().then(deps.parseBml),
      resource(library, [READY_ROOT], "trainingMissionTemplate", ".bml").bytes().then(deps.parseBml),
      resource(library, ["gui_/monocoque"], "frame", ".bml").bytes().then(deps.parseBml),
    ]);
    admitTextRenders(duel);
    admitTextRenders(training);
    state.templates = { duel, training };
    state.frameBml = frameBml;
    await Promise.all([
      ...EXTRA_IMAGES.filter(name => !view.assets.images.has(name)).map(async name => {
        try {
          view.assets.images.set(name, await deps.loadTexture(resource(library, [READY_ROOT], name)));
        } catch { /* a missing decoration is drawn without */ }
      }),
      ...EXTRA_BUTTONS.filter(name => !view.assets.buttonImages.has(name)).map(async name => {
        const states = await Promise.all([1, 2, 3, 4].map(index => deps.loadTexture(resource(library, [READY_ROOT],
          `${name.replace("@zz", "")}${index}${name.includes("@zz") ? "@zz" : ""}`))));
        view.assets.buttonImages.set(name, states);
      }),
    ]);
    // The tab, 开始对决 and reward buttons get their four-state text styles like the others.
    for (const node of [...findAll(view.assets.definition, "duelBtn"), ...findAll(view.assets.definition, "trainingBtn"),
      ...findAll(view.assets.definition, "duel").filter(entry => entry.name === "ImageButton")]) {
      view.assets.buttonStyles.set(node, deps.buttonStyle(node, view.assets.frameConfig, frameBml));
    }
    state.icons = new ItemIcons(library as never, session as never, () => { if (!view.disposed) view.render(); });
    state.catalog = await (library as { timeAttackGarageCatalog(): Promise<ReadyMissionState["catalog"]> })
      .timeAttackGarageCatalog();
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
    state.templates = undefined;
    console.warn("练习目标 / 赛道对决 资源未能载入", error);
    return;
  }
  if (!session) {
    state.loadError = tr("登录后可查看练习目标与赛道对决。");
    return;
  }
  try {
    state.data = await fetchTimeAttackMissions(session, view.options.trackId);
    state.rows.revision = -1;
    const standing = state.data.duel?.standing ?? [];
    state.stage = Math.max(1, standing.findIndex(entry => entry.open && !entry.won) + 1 ||
      (standing.length && standing.every(entry => entry.won) ? standing.length : 1));
    state.difficulty = 0;
    // The window opens on the duel when the event runs on this track.
    if (state.data.duel && state.data.duel.trackId === view.options.trackId) selectTab(view, "duel", deps);
  } catch (error) {
    state.loadError = timeAttackErrorMessage(error);
  }
  if (!view.disposed) view.render();
}

export function disposeReadyMissions(view: MissionReadyView): void {
  const state = view.missions;
  if (!state || state.disposed) return;
  state.disposed = true;
  state.npc?.preview?.dispose();
  state.npc = undefined;
}

function selectTab(view: MissionReadyView, tab: MissionTab, deps: ReadyMissionDependencies): void {
  const state = view.missions;
  if (!state || state.tab === tab) return;
  state.tab = tab;
  view.refreshRecord();
  if (tab === "duel") ensureNpcPreview(view, deps);
}

function currentDuel(state: ReadyMissionState): { event: DuelEvent; stage: DuelStage; standing: DuelStanding } | undefined {
  const event = state.data?.duel;
  if (!event) return undefined;
  const stage = event.stages[state.stage - 1];
  const standing = event.standing[state.stage - 1];
  return stage && standing ? { event, stage, standing } : undefined;
}

/** The opponent's record as the 对手信息 panel words it (the release's recordFor summary shape). */
function npcRecord(view: MissionReadyView): unknown {
  const state = view.missions!;
  const duel = currentDuel(state);
  if (!duel) return undefined;
  const kart = state.catalog?.karts.find(entry => entry.itemId === duel.stage.npc.kartId);
  const advantage = duel.stage.difficulties[state.difficulty]?.advantageMs ?? 0;
  return { speed: duel.stage.speed, booster: duel.stage.teamBooster ? 1 : 0, elapsedMs: duel.stage.targetMs + advantage,
    kartName: kart?.title ?? tr("卡丁车 {id}", { id: duel.stage.npc.kartId }), crashCount: 0 };
}

/** The NPC rider's preview, loaded on demand for the stage shown. */
function ensureNpcPreview(view: MissionReadyView, deps: ReadyMissionDependencies): void {
  const state = view.missions!;
  const duel = currentDuel(state);
  if (!duel || !state.catalog || (state.npc?.stage === state.stage)) return;
  state.npc?.preview?.dispose();
  const npc = { stage: state.stage } as NonNullable<ReadyMissionState["npc"]>;
  state.npc = npc;
  const kart = state.catalog.karts.find(entry => entry.itemId === duel.stage.npc.kartId) ?? view.options.kart;
  const character = state.catalog.characters.find(entry => entry.itemId === duel.stage.npc.characterId) ??
    view.options.character;
  // The NPC wears its paint and dye only (0 = none for every decoration); the plate is the player's.
  const itemIds = view.options.profile.equipment.itemIds;
  const profile = { ...view.options.profile, initial: "", equipment: { ...view.options.profile.equipment,
    itemIds: { 2: duel.stage.npc.color || 0, 70: duel.stage.npc.dye || 0, 3: duel.stage.npc.kartId, 4: itemIds[4] ?? 0,
      8: 0, 9: 0, 11: 0, 16: 0, 26: 0, 27: 0, 52: 0 }, kartSerial: 0 } };
  npc.loading = Promise.all([
    deps.loadPreview(view.options.library, kart, character, view.options.environment, view.options.stageBinding, profile)
      .then(preview => {
        if (state.disposed || state.npc !== npc) { preview.dispose(); return; }
        npc.preview = preview;
      }),
    loadPortrait(view, deps, duel.stage).then(texture => { npc.portrait = texture; }),
  ]).then(() => { if (!view.disposed) view.render(); }).catch(error => {
    view.options.onNotice?.(tr("对手预览加载失败：{error}", { error: error instanceof Error ? error.message : String(error) }));
  });
}

/** The NPC's scene emotion picture (stage_scene <character>_<emotion>), when the mirror has it. */
async function loadPortrait(view: MissionReadyView, deps: ReadyMissionDependencies,
  stage: DuelStage): Promise<Texture | undefined> {
  const names = PORTRAITS[stage.npc.characterId];
  if (!names) return undefined;
  try {
    return await deps.loadTexture(resource(view.options.library, [SCENE_ROOT], `${names}_05`));
  } catch {
    return undefined;
  }
}

/** Scene picture prefixes by character id (timeAttackMission.xml scene textures). */
const PORTRAITS: Record<number, string> = { 1: "배찌", 3: "디지니", 4: "에띠", 5: "케피", 8: "우니" };

// ---- visibility ---------------------------------------------------------------

function missionNodeVisible(view: MissionReadyView, node: Node, parent: Node | undefined,
  deps: ReadyMissionDependencies): boolean {
  const state = view.missions;
  const name = attr(node, "name");
  const random = view.options.randomGroup !== undefined;
  if (!state?.templates || random) return deps.visible(node, view.hasReplay, view.reverseTrack, random);
  const duelTab = state.tab === "duel";
  if (name === "dualTabBtnPanel") return true;
  if (name === "duel") return duelTab; // the duel list container and the 开始对决 button
  if (name === "training") return !duelTab; // the goal list container and the 开始 button
  if (name !== undefined && DUEL_NODES.has(name)) return duelTab;
  if (name === "clearPanel") return duelTab && currentDuel(state)?.standing.won === true;
  if (name === "shadow" && nodeName(parent) === "gameOption") return !duelTab;
  if (name === "shadowBtnPanel") return !duelTab && view.hasReplay;
  if (name === "randomInfoText") return false;
  // The release hides every "desc" label but the ghost's 无纪录; the rows' and the 难度设定's show.
  if (node.name === "Label" && name === "desc") {
    if (nodeName(parent) === "progressPanel") return attr(node, "visible") !== "false";
    if (duelTab && isDifficultyDesc(view, node)) return true;
  }
  return deps.visible(node, view.hasReplay, view.reverseTrack, random);
}

// ---- drawing ------------------------------------------------------------------

/** ty.drawNode with the tabs' visibility. */
export function drawReadyMissionNode(view: MissionReadyView, node: Node, parentRect: Rect, parent: Node | undefined,
  deps: ReadyMissionDependencies): void {
  if (!missionNodeVisible(view, node, parent, deps)) return;
  const frameName = attr(node, "frame");
  const frame = frameName === undefined ? undefined : view.assets.frames.get(frameName);
  const texture = view.assets.images.get(attr(node, "texture") ?? "");
  const rect = deps.layout(node, parentRect, frame, texture);
  let client = rect;
  if (frame) {
    deps.paintFrame(view.context, frame, view.assets.frame.image, rect);
    client = deps.innerRect(frame, rect);
  }
  view.drawNodeSelf(node, rect, parent);
  view.drawNodeChildren(node, client);
  view.drawNodeCaption(node, rect, frame);
}

/** ty.drawNodeChildren plus the mission rows and the reward pictures. */
export function drawReadyMissionChildren(view: MissionReadyView, node: Node, rect: Rect,
  deps: ReadyMissionDependencies): void {
  const name = attr(node, "name");
  const state = view.missions;
  if (name === "missionListPanel" && state?.templates) {
    drawRows(view, node, rect, deps);
    return;
  }
  if (state?.templates && (name === "rewardPanel" || name === "icon") && node.children.length === 0) {
    drawRewardPicture(view, node, rect, deps);
    return;
  }
  for (const child of node.children) {
    if (view.options.randomGroup && attr(child, "name") === "trackInfoPanel") continue;
    view.drawNode(child, rect, node);
  }
  if (name === "trackCardPanel" && !view.options.randomGroup) view.drawNode(view.assets.trackDifficulty, rect);
}

/** Which list a GridSelector is: its container is named duel or training. */
function listKind(view: MissionReadyView, node: Node): MissionTab | undefined {
  const content = find(view.assets.definition, "content");
  for (const kind of ["duel", "training"] as const) {
    const container = content?.children.find(child => attr(child, "name") === kind);
    if (container?.children.includes(node)) return kind;
  }
  return undefined;
}

function drawRows(view: MissionReadyView, grid: Node, rect: Rect, deps: ReadyMissionDependencies): void {
  const state = view.missions!;
  const kind = listKind(view, grid);
  if (!kind) return;
  buildRows(view, deps);
  const rows = state.rows[kind];
  const size = kind === "duel" ? DUEL_ROW : TRAINING_ROW;
  if (rows.length === 0) {
    const message = state.loadError ?? (kind === "duel" ? tr("当前没有进行中的赛道对决。") : tr("该赛道没有练习目标。"));
    deps.paintText(view.context, message, { x: rect.x, y: rect.y + 20, width: rect.width, height: 40 },
      { render: "bold16", align: "center", color: deps.color("255 220 231 242") });
    return;
  }
  view.context.save();
  view.context.beginPath();
  view.context.rect(rect.x, rect.y, rect.width, Math.max(rect.height, rows.length * size.height));
  view.context.clip();
  rows.forEach((row, index) => {
    const slot = { x: rect.x, y: rect.y + index * size.height, width: size.width, height: size.height };
    view.drawNode(row, slot, grid);
    if (kind === "duel") {
      // The row selects its stage.
      const standing = state.data?.duel?.standing[index];
      if (standing?.open) view.buttonHits.push({ id: `duel-row-${index}`, name: `duelRow_${index + 1}`, rect: slot });
    }
  });
  view.context.restore();
}

function stageLayout(set: GoalSet): { stage: number; count: number; value: number; cleared: boolean; claimed: boolean;
  requirement: number; rewards: MissionReward[] } {
  const current = set.stages[Math.min(set.stages.length, Math.max(1, set.current)) - 1] ?? set.stages[0]!;
  return { stage: current.stage, count: current.count, value: current.value, cleared: current.cleared,
    claimed: current.claimed, requirement: current.requirement, rewards: current.rewards };
}

/** The row nodes, rebuilt when the data changes (node identity keys the button hit state). */
function buildRows(view: MissionReadyView, deps: ReadyMissionDependencies): void {
  const state = view.missions!;
  const revision = (state.data ? 1 : 0) + (state.npc?.portrait ? 2 : 0) + state.stage * 10 + state.difficulty * 100 +
    (state.data?.goals.reduce((sum, set) => sum + set.stages.reduce((inner, stage) =>
      inner + stage.value + (stage.claimed ? 1000 : 0) + (stage.cleared ? 100 : 0), 0), 0) ?? 0) * 1000 +
    (state.data?.duel?.standing.reduce((sum, entry) => sum + entry.losses + (entry.won ? 50 : 0), 0) ?? 0) * 1_000_000;
  if (revision === state.rows.revision) return;
  state.rows.revision = revision;
  const templates = state.templates!;
  const strings = view.assets.strings;
  const translate = (key: string, fallback: string) => deps.translate(`#sb(${key})`, strings).replace(/^#sb\(.*\)$/, fallback);
  state.rows.training = (state.data?.goals ?? []).map(set => {
    const row = clone(templates.training);
    const current = stageLayout(set);
    const normal = find(row, "normalMissionPanel")!;
    const hidden = find(row, "hiddenMissionPanel")!;
    setAttr(hidden, "visible", "false");
    const allClaimed = set.stages.every(stage => stage.claimed);
    const title = set.type === "crash" ? tr(set.title).replace("%s", String(current.requirement)) : tr(set.title);
    setAttr(find(normal, "title")!, "text", title);
    const progress = find(normal, "progressPanel")!;
    const desc = find(progress, "desc")!;
    const cur = find(progress, "cur")!, sepa = find(progress, "sepa")!, tar = find(progress, "tar")!;
    const bar = find(progress, "bar")!;
    if (set.type === "record") {
      const target = set.stages[0]!.requirement;
      setAttr(desc, "text", `${translate("trainingMissionRacordDesc", tr("目标时间"))} ${formatRecordTime(target)} ${
        translate("trainingMissionRacordTarget", tr("以内完成"))}`);
      setAttr(desc, "windowSize", "230 16");
      setAttr(cur, "visible", "false");
      setAttr(sepa, "visible", "false");
      setAttr(tar, "visible", "false");
      setAttr(bar, "visible", current.value > 0 ? "true" : "false");
    } else {
      setAttr(desc, "text", tr("{stage}阶段", { stage: current.stage }));
      setAttr(cur, "text", String(Math.min(current.value, current.count)));
      setAttr(tar, "text", String(current.count));
      const fraction = Math.max(0, Math.min(1, current.value / current.count));
      if (fraction <= 0) setAttr(bar, "visible", "false");
      else setAttr(bar, "windowSize", `${Math.max(4, Math.round(244 * fraction))} 6`);
    }
    const rewardButton = find(progress, "rewardBtn")!;
    const claimable = current.cleared && !current.claimed;
    setAttr(rewardButton, "visible", claimable ? "true" : "false");
    setAttr(rewardButton, "name", `rewardBtn_${set.index}_${current.stage}`);
    if (claimable) view.assets.buttonStyles.set(rewardButton,
      deps.buttonStyle(rewardButton, view.assets.frameConfig, state.frameBml!));
    setAttr(find(row, "clearCover")!, "visible", allClaimed ? "true" : "false");
    const rewardPanel = find(row, "rewardPanel")!;
    setAttr(rewardPanel, "name", "rewardPanel");
    rewardPanel.children = [];
    (rewardPanel as Node & { reward?: MissionReward }).reward = current.rewards[0];
    return row;
  });
  const duel = state.data?.duel;
  state.rows.duel = duel ? duel.stages.map((stage, index) => {
    const row = clone(templates.duel);
    const standing = duel.standing[index]!;
    // slotVsBG1 is the lit card of the stage shown; the others are dark.
    setAttr(row, "texture", state.stage === stage.stage ? "timeAttack_main_slotVsBG1" : "timeAttack_main_slotVsBG2");
    const info = find(row, "infoPanel")!;
    const portraitPanel = find(row, "portraitPanel")!;
    const rewardPanel = find(row, "rewardPanel")!;
    const closeMsg = find(row, "closeMsg")!;
    setAttr(find(info, "step")!, "text", tr("{stage} 阶段", { stage: stage.stage }));
    setAttr(find(info, "name")!, "text", stage.npc.name);
    // A locked stage shows only 在上一阶段胜利时开放.
    setAttr(closeMsg, "visible", standing.open ? "false" : "true");
    setAttr(info, "visible", standing.open ? "true" : "false");
    setAttr(rewardPanel, "visible", standing.open ? "true" : "false");
    setAttr(portraitPanel, "visible", standing.open ? "true" : "false");
    const portrait = find(portraitPanel, "portrait")!;
    const portraitName = `npc-portrait-${stage.npc.characterId}`;
    if (standing.open && state.npc?.stage === stage.stage && state.npc.portrait) {
      view.assets.images.set(portraitName, state.npc.portrait);
      setAttr(portrait, "texture", portraitName);
    } else {
      portrait.attributes = portrait.attributes.filter(entry => entry.name !== "texture");
    }
    setAttr(find(portraitPanel, "clearCover")!, "visible", standing.won ? "true" : "false");
    rewardPanel.children.forEach((slot, slotIndex) => {
      const reward = stage.rewards[slotIndex];
      const icon = find(slot, "icon")!;
      icon.children = [];
      (icon as Node & { reward?: MissionReward }).reward = reward;
      setAttr(find(slot, "option")!, "text", reward && (reward.count ?? 1) > 1 ? tr("{count}个", { count: reward.count ?? 1 }) : "");
      setAttr(find(slot, "option")!, "visible", reward ? "true" : "false");
      setAttr(find(slot, "emptyCover")!, "visible", reward ? "false" : "true");
      setAttr(find(slot, "clearCover")!, "visible", reward && standing.won ? "true" : "false");
      setAttr(find(slot, "special")!, "visible", "false");
    });
    return row;
  }) : [];
}

function drawRewardPicture(view: MissionReadyView, node: Node, rect: Rect, deps: ReadyMissionDependencies): void {
  const reward = (node as Node & { reward?: MissionReward }).reward;
  const icons = view.missions?.icons;
  if (!reward || !icons) return;
  const texture = reward.type === "lucci" ? icons.icon({ category: 0, itemId: 0, currency: "lucci" })
    : reward.type === "emblem" ? icons.icon({ category: 0, itemId: 0, emblem: reward.value })
      : reward.type === "rp" ? undefined
        : icons.icon({ category: reward.category ?? 0, itemId: reward.itemId ?? 0 });
  const inset = Math.min(rect.width, rect.height) >= 80 ? 6 : 2;
  const box = { x: rect.x + inset, y: rect.y + inset, width: rect.width - inset * 2, height: rect.height - inset * 2 };
  if (texture) {
    const scale = Math.min(box.width / texture.width, box.height / texture.height);
    const width = texture.width * scale, height = texture.height * scale;
    view.context.drawImage(texture.image, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2,
      width, height);
  }
  // Currency and RP amounts, and item names, are written under the picture.
  const caption = reward.type === "lucci" ? tr("{amount}金币", { amount: reward.value }) : reward.type === "rp" ? `RP ${reward.value}`
    : rect.width >= 80 ? translateItemName(reward.name) : "";
  if (caption) {
    deps.paintText(view.context, caption, { x: rect.x - 20, y: rect.y + rect.height - 16, width: rect.width + 40,
      height: 16 }, { render: "outline14", align: "center", color: "rgba(255,255,255,1)",
      strokeColor: "rgba(0,0,0,1)" });
  }
}

/** ty.drawLabel with the tab titles, the duel period, the 难度设定 and the opponent's record. */
export function drawReadyMissionLabel(view: MissionReadyView, node: Node, rect: Rect, parent: Node | undefined,
  deps: ReadyMissionDependencies): string | undefined {
  const state = view.missions;
  const name = attr(node, "name");
  const duelTab = state?.templates !== undefined && state.tab === "duel";
  let text: string | undefined;
  if (deps.trackCardPanel(parent)) {
    text = `${view.reverseTrack ? tr("[反]") : ""}${view.assets.trackTitle}`;
  } else if (name === "value" && parent !== undefined) {
    const record = view.record as Record<string, string> | undefined;
    const keys: Record<string, string> = { setting: "setting", record: "time", kart: "kart", crash: "crash",
      booster: "booster" };
    const key = keys[nodeName(parent) ?? ""];
    text = key && record ? record[key] ?? "" : attr(node, "text") ?? "";
  } else if (name === "title" && nodeName(parent) === "recordInfoPanel") {
    text = duelTab ? "#sb(counterPartInfo)" : "#sb(myRecord)";
  } else if (name === "title" && nodeName(parent) === "gameOption") {
    text = duelTab ? "#sb(duelMissionOption)" : "#sb(option)";
  } else if (name === "period" && state?.data?.duel) {
    text = `${periodText(state.data.duel.from)} ~ ${periodText(state.data.duel.to)}`;
  } else if (name === "desc" && nodeName(parent) === "controlPanel" && duelTab && state && isDifficultyDesc(view, node)) {
    const duel = currentDuel(state);
    const level = state.difficulty;
    const advantage = duel?.stage.difficulties[level]?.advantageMs ?? 0;
    text = level === 0 ? "#sb(duelMissionDifficulty0)" : `${advantage / 1000}${deps.translate("#sb(duelMissionDifficultyStr)",
      view.assets.strings)}`;
    if (duel && duel.standing.difficulty > 0 && !duel.standing.won)
      view.buttonHits.push({ id: `difficulty-cycle`, name: "difficultyCycle", rect });
  } else if (attr(node, "text") === "#sb(trainingGoal)" && node.name === "Label" && parent?.name === "ImageBoard" &&
    duelTab) {
    text = "#sb(trackDuel)";
  } else {
    text = attr(node, "text") ?? "";
  }
  const translated = deps.translate(text, view.assets.strings);
  deps.paintText(view.context, translated, rect, {
    render: attr(node, "textRender") ?? "bold14",
    align: attr(node, "textAlign") ?? "left",
    color: deps.color(attr(node, "textColor") ?? "white"),
    strokeColor: deps.color(attr(node, "textColor2") ?? "255 0 0 0"),
  });
  return translated;
}

function isDifficultyDesc(view: MissionReadyView, node: Node): boolean {
  const difficulty = find(view.assets.definition, "difficulty");
  return difficulty !== undefined && findAll(difficulty, "desc").includes(node);
}

function periodText(ms: number): string {
  const date = new Date(ms);
  const beijing = new Date(date.getTime() + 8 * 3600_000);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${beijing.getUTCFullYear()}-${beijing.getUTCMonth() + 1}-${beijing.getUTCDate()} ${pad(beijing.getUTCHours())}:${
    pad(beijing.getUTCMinutes())}`;
}

/** ty.drawRiderPreview: the player's rider, and on the duel tab the opponent's beside the VS mark. */
export function drawReadyMissionRiderPreview(view: MissionReadyView, rect: Rect, parent: Node | undefined,
  deps: ReadyMissionDependencies): void {
  const state = view.missions;
  const training = parent?.children.find(child => attr(child, "name") === "캐릭터창_training");
  if (!training) throw new Error("P3528 READY 缺少车手预览的训练布局。");
  if (!state?.templates || state.tab !== "duel") {
    view.preview.render(view.context, deps.layout(training, rect), view.renderTimeMs);
    return;
  }
  view.preview.render(view.context, rect, view.renderTimeMs);
  const riderPanel = parent && find(parent, "riderPanel");
  const npc = state.npc?.preview;
  if (riderPanel && npc) {
    const duelInfo = find(parent!, "duelInfoPanel")!;
    const counterPart = find(duelInfo, "counterPartPanel")!;
    const infoRect = deps.layout(duelInfo, rect);
    const counterRect = deps.layout(counterPart, infoRect);
    const target = deps.layout(riderPanel, counterRect);
    npc.render(view.context, { x: target.x - 80, y: target.y - 60, width: 586, height: 480 }, view.renderTimeMs);
  }
}

// ---- buttons ------------------------------------------------------------------

/** The tab, row, reward, 难度设定 and 开始对决 buttons; everything else is the release's. */
export function activateReadyMissionButton(view: MissionReadyView, name: string): void {
  const state = view.missions;
  if (!state?.templates) { activateReadyButton(view as never, name); return; }
  const deps = state.deps;
  if (name === "duelBtn" || name === "trainingBtn") {
    view.options.onActivate?.();
    if (deps) selectTab(view, name === "duelBtn" ? "duel" : "training", deps);
    view.render();
    return;
  }
  const row = /^duelRow_(\d+)$/.exec(name);
  if (row) {
    const stage = Number(row[1]);
    if (state.data?.duel?.standing[stage - 1]?.open && stage !== state.stage) {
      view.options.onActivate?.();
      state.stage = stage;
      state.difficulty = 0;
      state.rows.revision = -1;
      view.refreshRecord();
      if (deps) ensureNpcPreview(view, deps);
    }
    view.render();
    return;
  }
  if (name === "difficultyCycle") {
    const duel = currentDuel(state);
    if (duel) {
      view.options.onActivate?.();
      state.difficulty = (state.difficulty + 1) % (duel.standing.difficulty + 1);
      state.rows.revision = -1;
      view.refreshRecord();
    }
    view.render();
    return;
  }
  const claim = /^rewardBtn_(\d+)_(\d+)$/.exec(name);
  if (claim) {
    view.options.onActivate?.();
    void claimReward(view, Number(claim[1]), Number(claim[2]));
    return;
  }
  if (name === "duel") {
    const duel = currentDuel(state);
    if (!duel || !duel.standing.open) {
      view.options.onNotice?.(deps ? deps.translate("#sb(duelMissionCloseMessage)", view.assets.strings) : tr("在上一阶段胜利时开放"));
      return;
    }
    view.options.onStartActivate?.();
    view.options.onDuel?.(view.readyOptions, { event: duel.event, stage: duel.stage, standing: duel.standing,
      difficulty: state.difficulty });
    return;
  }
  activateReadyButton(view as never, name);
}

async function claimReward(view: MissionReadyView, set: number, stage: number): Promise<void> {
  const state = view.missions!;
  const session = activeBrowserSession();
  if (!session || !state.data || state.busy) return;
  state.busy = true;
  try {
    const result = await claimTimeAttackGoal(session, { requestId: newRequestId(), trackId: state.data.trackId, set, stage });
    if (state.disposed) return;
    state.data = { ...state.data, goals: result.goals };
    state.rows.revision = -1;
    view.options.onNotice?.(tr("已领取练习目标奖励，请到奖励箱查收。"));
  } catch (error) {
    view.options.onNotice?.(tr("领取失败：{error}", { error: timeAttackErrorMessage(error) }));
  } finally {
    state.busy = false;
    if (!view.disposed) view.render();
  }
}

/** The opponent's record replaces the player's while the duel tab shows (ty.refreshRecord hook). */
export function missionRecordFor(view: MissionReadyView, options: ReadyOptions): unknown {
  const state = view.missions;
  if (state?.templates && state.tab === "duel") return npcRecord(view);
  return view.options.recordFor(options);
}

/** Image state of the tab buttons: the active tab is the pressed/checked one. */
export function missionButtonState(view: MissionReadyView, id: string, name: string): number | undefined {
  const state = view.missions;
  if (!state?.templates) return undefined;
  if (name === "duelBtn" || name === "trainingBtn") {
    if ((name === "duelBtn") === (state.tab === "duel")) return 4;
    return readyButtonImageState(id, name, view.readyOptions, view.hoveredButton, view.pressedButton);
  }
  return undefined;
}

