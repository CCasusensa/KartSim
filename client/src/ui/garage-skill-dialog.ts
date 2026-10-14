import { attribute, clone, formatSb, loadBml, mapTree, node, nodeName, withAttributes, type Node,
  type NodeState, type Rect } from "./bml-kit";
import type { XunGarageProgression } from "./garage-progression-panel";
import type { GarageSkillSelectionState } from "./garage-progression-session";
import { garageWindowLibrary, openGarageReleaseWindow, paintColorText, type GarageReleaseWindow,
  type OpenGarageReleaseWindow } from "./garage-release-window";

/**
 * 性能槽N 性能选择 drawn by the release window renderer on the original
 * dialog2_kart12SkillTuning.rho kart12SkillTuning@zz layout: the
 * tuning_selectperformPopupBg_s board with its tuningPopup_x_ close button,
 * the 竞速 / 道具 tab images (tuning_selectperformPopup_tab_), the three
 * 性能研究 lines with their marks, the nine speedSkillTuningCard cards
 * (slotBg_s, hover/selected slotBg_c, the selected glow, the
 * tuning_slotNum_0N tag of the slot wearing it, the dim face and
 * 已装至其他性能槽中 when another slot wears it), the two tuning_dot1 help
 * lines and the release TextButtons. The board's three white boxes (the
 * release's material counts, nothing is spent here) carry the rules of
 * the local version instead; the material buttons, the spanner change
 * button, the line locks and the 道具 page are left out.
 */

const FOLDER = "dialog2_/kart12SkillTuning";
const ROOTS = [FOLDER, "stage_/common"];

/** kart12SkillTuning_stringBag (cn). */
export const SKILL_STRINGS = {
  caption: "[color:255 22 225 255]性能槽%d[/color]性能选择",
  speed: "竞速",
  item: "道具",
  alreadyUse: "已装至其他性能槽中",
  cancel: "取消",
};

/** The board's white boxes (tuning_selectperformPopupBg_s pixels 16–248, 257–488, 497–729 × 93–120). */
const GUIDES: Array<[string, string]> = [
  ["16 93 233 28", "竞速：九选三，不可重复"],
  ["257 93 232 28", "本次仅更换当前性能槽"],
  ["497 93 233 28", "本地不消耗材料"],
];
const TEXT = "255 42 55 80";
const HELP = "rgba(179, 195, 228, 1)";
const GREEN = "255 62 255 14";

/** Release nodes the local picker leaves out (material counts and buttons, locks, the spanner button). */
const LEFT_OUT = new Set(["buyStudyDataBtn", "buyDeepStudyDataBtn", "buyEthisSpannerBtn", "haveStudyData",
  "haveDeepStudyData", "haveEthisSpannerData", "tuningChangeBtn", "skillLineLock", "unlockBtn", "unlockTuning"]);
const MATERIAL_ICONS = new Set(["icon_ethisTuning_1", "icon_ethisTuning_2", "icon_ethisSpanner"]);

export interface GarageSkillLayout { window: Node; card: Node }

export interface GarageSkillDialogDependencies {
  createState(progression: XunGarageProgression, row: number): GarageSkillSelectionState;
  availablePoints(progression: XunGarageProgression): number;
  skills: readonly { id: number; label: string }[];
  /** Left from the HTML dialog; the generated wiring still passes them. */
  loadAssets?(library: unknown): Promise<unknown>;
  styleAction?(button: HTMLButtonElement, style: unknown, kind: "primary" | "secondary"): void;
  /** kart12SkillTuning@zz and speedSkillTuningCard from the library. */
  loadLayout?(library: unknown): Promise<GarageSkillLayout>;
  /** The release window (te.load in a popup layer over the game area). */
  openWindow?: OpenGarageReleaseWindow;
}

export async function loadGarageSkillLayout(library: unknown): Promise<GarageSkillLayout> {
  const files = garageWindowLibrary(library);
  const [window, card] = await Promise.all([loadBml(files, FOLDER, "kart12SkillTuning@zz"),
    loadBml(files, FOLDER, "speedSkillTuningCard")]);
  return { window, card };
}

/** The card template for skill `id`, its nodes named card<id>:<release name> (the face itself card<id>). */
function skillCard(template: Node, id: number, equippedSlot: number | undefined): Node {
  const rename = (entry: Node, root: boolean): Node => {
    const name = nodeName(entry);
    const changes: Record<string, string | undefined> = {
      name: root ? `card${id}:root` : name ? `card${id}:${name}` : `card${id}`,
    };
    if (name === "skillIcon") changes.texture = `tuning_icon_${id}`;
    if (name === "curSkillSlotTag") changes.texture = `tuning_slotNum_0${equippedSlot ?? 1}`;
    // 已装至其他性能槽中 is wider than the card at 14 px and ran into the next card's name.
    if (name === "alreadyUse") changes.textRender = "outline12";
    return { ...withAttributes(entry, changes), children: entry.children.map(child => rename(child, false)) };
  };
  return rename(clone(template), true);
}

/**
 * The release layout made into the local picker (see the file comment);
 * `equipped` maps a skill to the slot wearing it.
 */
export function skillSelectionDefinition(layout: GarageSkillLayout, equipped: (id: number) => number | undefined):
  Node {
  const container = layout.window.children.find(entry => nodeName(entry) === "container");
  if (!container) throw new Error("技能窗口缺少 container。");
  const adapted = mapTree(container, entry => {
    const children = entry.children.filter(child => !LEFT_OUT.has(nodeName(child)) &&
      child.name !== "Play1SPanel" && !MATERIAL_ICONS.has(attribute(child, "texture") ?? "") &&
      !(child.name === "TabPage" && nodeName(child) === "itemPage"));
    const name = nodeName(entry);
    if (name === "skillTuning_bg")
      return { ...withAttributes(entry, { image: "tuning_selectperformPopupBg_s" }), children };
    if (entry.name === "ImageButton" && (name === "speedPage" || name === "itemPage"))
      return { ...withAttributes(entry, { name: name === "speedPage" ? "speedTab" : "itemTab",
        autoLoadNoDisable: undefined,
        texture: `tuning_selectperformPopup_tab_${name === "speedPage" ? 3 : 1}` }), children };
    if (entry.name === "ColorLabel" && attribute(entry, "text") === "#sb(helpDesc)")
      return { ...withAttributes(entry, { name: "helpDesc", windowSize: undefined, adjust: undefined,
        align: undefined, leftTopWH: "236 589 490 44" }), children };
    if (entry.name === "Container" && /^[1-9]$/.test(name))
      return { ...entry, children: [...children, skillCard(layout.card, Number(name), equipped(Number(name)))] };
    return { ...entry, children };
  });
  const guides = GUIDES.map(([rect], index) => node("Label", { name: `guide${index + 1}`, leftTopWH: rect,
    textAlign: "center", textRender: "bold14", textColor: TEXT }));
  return node("Panel", { windowRect: "fullscreen", color: "100 0 0 0", alphaBlend: "true" }, [
    { ...withAttributes(adapted, { adjust: "0 -33" }), children: [...adapted.children, ...guides] },
  ]);
}

/** Editable, accessible XUN skill picker backed by an uncommitted selection state. */
export class GarageSkillSelectionDialog {
  readonly previousFocus = typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement
    ? document.activeElement : undefined;
  readonly state: GarageSkillSelectionState;
  window?: GarageReleaseWindow;
  disposed = false;
  /** The card faces as the renderer hands them to state(), for the hover look. */
  readonly cards = new Map<number, unknown>();

  constructor(_surface: HTMLElement, readonly library: unknown, progression: XunGarageProgression,
    readonly row: number, readonly onClose: (value?: XunGarageProgression) => void,
    readonly dependencies: GarageSkillDialogDependencies) {
    if (!Number.isInteger(row) || row < 0 || row > 2)
      throw new Error("无效的技能栏。");
    this.state = dependencies.createState(progression, row);
    void this.open();
  }

  async open(): Promise<void> {
    try {
      const layout = await (this.dependencies.loadLayout ?? loadGarageSkillLayout)(this.library);
      if (this.disposed) return;
      const definition = skillSelectionDefinition(layout, id => this.state.equippedSlot(id));
      const window = await (this.dependencies.openWindow ?? openGarageReleaseWindow)({
        library: this.library, definition, roots: ROOTS, label: "迅竞速技能选择",
        onCancel: () => this.close(false), state: entry => this.nodeState(entry),
      });
      if (this.disposed) {
        window.dispose();
        return;
      }
      this.window = window;
      window.render();
      window.focus(`card${this.state.id}`);
    } catch (error) {
      console.error("技能选择窗口打开失败", error);
      this.close(false);
    }
  }

  skillLabel(id: number): string {
    return this.dependencies.skills.find(skill => skill.id === id)?.label ?? `技能${id}`;
  }

  /** The two help lines: points given back, points free after 变更. */
  statusText(): string {
    const points = (value: number) => `[color:${GREEN}]${value}[/color]`;
    return `本次返还 ${points(this.state.refunded)} 点强化点数，确认后可用 ${points(
      this.dependencies.availablePoints(this.state.value))} 点强化点数。|关闭或取消不修改。`;
  }

  /** What each node of the window shows. */
  nodeState(entry: Node): NodeState {
    const name = nodeName(entry);
    const card = /^card(\d)(?::(.+))?$/.exec(name);
    if (card) {
      const id = Number(card[1]);
      const selected = this.state.id === id;
      const occupied = this.state.isOccupied(id);
      switch (card[2]) {
        case undefined:
          this.cards.set(id, entry);
          return { label: occupied ? `${this.skillLabel(id)}（${SKILL_STRINGS.alreadyUse}）` : this.skillLabel(id),
            checked: selected, disabled: occupied, action: () => this.choose(id) };
        case "selectPerform_1": {
          const face = this.cards.get(id);
          return { visible: !occupied && (selected || (face !== undefined && this.window?.hovered === face)) };
        }
        case "selectPerform_2": return { visible: selected };
        case "noneSkill_2": return { visible: occupied };
        case "curSkillSlotTag": return { visible: this.state.equippedSlot(id) !== undefined };
        case "skillName": return { visible: !occupied, text: this.skillLabel(id) };
        case "alreadyUse": return { visible: occupied, text: SKILL_STRINGS.alreadyUse };
      }
      return {};
    }
    const guide = /^guide(\d)$/.exec(name);
    if (guide) return { text: GUIDES[Number(guide[1]) - 1]![1] };
    switch (name) {
      case "skillTuningCaption": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) =>
        paintColorText(context, formatSb(SKILL_STRINGS.caption, this.row + 1), rect,
          { size: 20, color: "white", align: "center", middle: true, outline: "rgba(3, 38, 64, 0.9)" }) };
      case "speedTab": return { text: SKILL_STRINGS.speed, textColor: "white", label: "竞速技能（当前）" };
      case "itemTab": return { text: SKILL_STRINGS.item, label: "道具技能（未开放）" };
      case "helpDesc": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) =>
        paintColorText(context, this.statusText(), rect, { size: 14, color: HELP, lineGap: 6 }) };
      case "okButton": return { text: "变更", label: "变更", disabled: !this.state.changed,
        action: () => { if (this.state.changed) this.close(true); } };
      case "cancelButton": return { text: SKILL_STRINGS.cancel, label: SKILL_STRINGS.cancel,
        action: () => this.close(false) };
      case "closeButton": return { label: "关闭技能选择", action: () => this.close(false) };
    }
    return {};
  }

  choose(id: number): void {
    if (this.disposed || this.state.isOccupied(id)) return;
    this.state.choose(id);
    this.window?.render();
  }

  close(accept: boolean): void {
    if (this.disposed) return;
    const value = this.state.settle(accept);
    this.dispose();
    this.onClose(value);
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state.settle(false);
    this.window?.dispose();
    this.window = undefined;
  }
}
