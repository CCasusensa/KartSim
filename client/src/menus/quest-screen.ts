import { te } from "../generated/library.js";
import type { AccountSession } from "../account/account-session";
import { clone, drawFitted, FONT, ImageCache, indexRows, loadBml, loadStrings, mapTree, node, nodeName, paintText,
  prepare, resolveStrings, withAttributes, wrapText, type BmlLibrary, type Node, type NodeState, type Rect,
  type WindowView } from "../ui/bml-kit";
import { ItemIcons } from "./item-icons";
import { QUEST_DISTANCE, type MenusApi, type Quest, type QuestGroup, type QuestReward } from "./menus-api";

/**
 * 任务 (dialog2_questInfo2KartPass questInfo2KartPass@zz, the KartPass
 * QuestUX2nd dialog): three boxes of QuestUX2ndButton rows on the left —
 * 跑跑通行证每日任务 (the daily stage chain), 普通任务 and 俱乐部任务 (dimmed
 * without a club) — and the selected quest's title, 任务时间, description,
 * 可进行状态, 任务详情 with its gauge and the QuestUX2ndReward slots on the
 * right. The quests are the server's (server-go MENUS.md 2); rewards go to
 * the 奖励箱, 通行证积分 to the account. There is no 跑跑通行证 system, so
 * its shortcut (goKartPassBtn) is left out.
 */

const FOLDER = "dialog2_/questInfo2KartPass";
const ROOTS = [FOLDER, "dialog2_/questInfo2", "stage_/common"];
const ROW = { width: 390, height: 30, gap: 2 };
/**
 * Where quest_img_baseBG draws each box's slots: 2 px in from the box's left
 * border, under its 32 px title, 2 px grey lines between them (the release
 * grid's adjust "-1 29" plus its client margin).
 */
const ROW_ORIGIN = { x: 2, y: 32 };
/** QuestUX2ndButton title: right after the slot's "|" (where the hidden PC-room icon sits). */
const TITLE_X = 60;
const REWARD = { width: 237, height: 60, gapX: 8, gapY: 8 };
const MAX_REWARDS = 4;
/** One 14 px line of a release multiLine label: a 20 px line box plus lineGap 1. */
const LINE_STEP = 21;
const TEXT = { dark: "rgb(42,55,80)", grey: "rgb(88,105,129)", white: "white" };
/** thisQuestStatus on the black status plate of quest_img_baseBG. */
const STATUS_COLORS = { enable: "rgb(60,200,96)", disable: "rgb(255,96,96)", complete: "rgb(255,226,72)" };
const SEEN_KEY = "kartsim.questSeen.";
/** Rows each box shows (the release GridSelectorEx maxLine); 普通任务 scrolls past its seven. */
const BOX_ROWS: Record<QuestGroup, number> = { pass: 3, normal: 7, club: 3 };
const BOX_NAMES: Record<QuestGroup, string> = { pass: "kartPassDailyList", normal: "normalQuestList", club: "clubQuestList" };
const RESET_KEYS: Record<string, string> = { daily: "daily", weekly: "weekly", none: "none" };
/** The row looks (QuestUX2ndButton autoLoadImage1..3): in progress, completed, locked. */
const ROW_LOOKS = { doing: "quest_btn_slotBase_", done: "quest_btn_slotClear_", locked: "quest_btn_slotNormal_" };

type Rows = Record<QuestGroup | "reward", WeakMap<Node, number>>;

export interface QuestScreenOptions {
  library: BmlLibrary;
  root: HTMLElement;
  api: MenusApi;
  session?: AccountSession;
  now?(): number;
  onClose(): void;
  onActivate?(): void;
  /** Where the quests already shown are remembered (img_queNew marks the others); localStorage by default. */
  storage?: Pick<Storage, "getItem" | "setItem">;
}

/** "10-09 06:00" in Beijing time. */
function shortTime(ms: number): string {
  const date = new Date(ms + 8 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

/** "2026-10-11 6:00 ~ 2026-10-12 5:59" (the KartPass dialog's 任务时间). */
function periodText(start: number, end: number): string {
  const part = (ms: number): string => {
    const date = new Date(ms + 8 * 60 * 60 * 1000);
    return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} ${date.getUTCHours()}:${
      String(date.getUTCMinutes()).padStart(2, "0")}`;
  };
  return `${part(start)} ~ ${part(end - 60_000)}`;
}

/** missionTextDefault / missionTextDistance with their [color:…] runs: "[color:255 36 129 255]目前 2回[/color] / 目标 3回". */
export function questProgressMarkup(quest: Pick<Quest, "kind" | "value" | "target">, strings: Map<string, string>): string {
  if (quest.kind === QUEST_DISTANCE) {
    return (strings.get("missionTextDistance") ?? "[color:255 36 129 255]目前 %.1fkm[/color] / 目标 %.1fkm")
      .replace("%.1f", (quest.value / 10).toFixed(1)).replace("%.1f", (quest.target / 10).toFixed(1));
  }
  return (strings.get("missionTextDefault") ?? "[color:255 36 129 255]目前 %d回[/color] / 目标 %d回")
    .replace("%d", String(quest.value)).replace("%d", String(quest.target));
}

/** The progress words alone: "目前 2回 / 目标 3回", "目前 3.4km / 目标 10.0km". */
export function questProgressText(quest: Pick<Quest, "kind" | "value" | "target">, strings: Map<string, string>): string {
  return questProgressMarkup(quest, strings).replace(/\[color:[^\]]*\]|\[\/color\]/g, "");
}

/** The 进行中 and 完成 lists of the older questInfo2 dialog (kept for callers and tests). */
export function questLists(quests: Quest[]): { doing: Quest[]; done: Quest[] } {
  return { doing: quests.filter(quest => !quest.completedAt), done: quests.filter(quest => !!quest.completedAt) };
}

/** The three boxes of the KartPass dialog. */
export function questBoxes(quests: Quest[]): Record<QuestGroup, Quest[]> {
  return { pass: quests.filter(quest => quest.group === "pass"), normal: quests.filter(quest => quest.group === "normal"),
    club: quests.filter(quest => quest.group === "club") };
}

/** "(35%)" after a row's title, as the release rows word progress. */
export function questPercent(quest: Pick<Quest, "value" | "target" | "completedAt">): number {
  if (quest.completedAt) return 100;
  return Math.min(100, Math.floor((quest.value / Math.max(1, quest.target)) * 100));
}

/** "[color:255 36 129 255]目前 %d回[/color] / 目标 %d回" → the coloured runs of a ColorLabel. */
export function colorRuns(text: string, fallback: string): Array<{ text: string; color: string }> {
  const runs: Array<{ text: string; color: string }> = [];
  const pattern = /\[color:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\]([\s\S]*?)\[\/color\]/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), color: fallback });
    runs.push({ text: match[5]!, color: `rgba(${match[2]},${match[3]},${match[4]},${Number(match[1]) / 255})` });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), color: fallback });
  return runs.filter(run => run.text);
}

/**
 * The quests shown before (by id), so only the others carry img_queNew;
 * undefined before the first opening, which only records the list (every
 * quest is new then, so the marks would tell nothing).
 */
export function readSeenQuests(storage: Pick<Storage, "getItem"> | undefined, account: string): Set<number> | undefined {
  try {
    const raw = storage?.getItem(SEEN_KEY + account);
    if (raw == null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : []);
  } catch {
    return undefined;
  }
}

function rewardText(reward: QuestReward): string {
  if (reward.currency || reward.emblem || reward.passPoints) return reward.name;
  return reward.count > 1 ? `${reward.name} ×${reward.count}` : reward.name;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export class QuestScreen {
  private view?: WindowView;
  private quests: Quest[] = [];
  /** Quests this window shows for the first time (img_queNew). */
  private fresh = new Set<number>();
  private hasClub = false;
  private selected?: number;
  private normalOffset = 0;
  private guide?: QuestGroup;
  private disposed = false;
  private strings = new Map<string, string>();
  private readonly icons: ItemIcons;
  private readonly images: ImageCache;
  private templates?: { dialog: Node; row: Node; reward: Node };
  private readonly onWheel = (event: WheelEvent) => this.scroll(event);

  private constructor(readonly options: QuestScreenOptions) {
    this.icons = new ItemIcons(options.library, options.session, () => this.view?.render());
    this.images = new ImageCache(options.library, () => this.view?.render());
  }

  static async open(options: QuestScreenOptions): Promise<QuestScreen> {
    const screen = new QuestScreen(options);
    try {
      const [list, strings] = await Promise.all([options.api.quests(),
        loadStrings(options.library, FOLDER, "questInfo2KartPass_stringBag")]);
      screen.quests = list.quests;
      screen.hasClub = list.hasClub;
      screen.strings = strings;
      screen.markSeen();
      const boxes = questBoxes(list.quests);
      const first = [...boxes.pass, ...boxes.normal, ...boxes.club];
      screen.selected = (first.find(quest => !quest.locked && !quest.completedAt) ?? first[0])?.id;
      await screen.build();
    } catch (error) {
      screen.dispose();
      throw error;
    }
    return screen;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.view?.element.removeEventListener("wheel", this.onWheel);
    this.view?.dispose();
    this.icons.dispose();
  }

  private quest(): Quest | undefined {
    return this.quests.find(quest => quest.id === this.selected);
  }

  /** Quests not shown before keep img_queNew for this opening; all count as seen afterwards. */
  private markSeen(): void {
    const storage = this.options.storage ?? defaultStorage();
    const account = this.options.session?.summary()?.account.username ?? "";
    const seen = readSeenQuests(storage, account);
    const unseen = this.quests.filter(quest => !seen?.has(quest.id)).map(quest => quest.id);
    this.fresh = new Set(seen ? unseen : []);
    if (seen && !unseen.length) return;
    try {
      storage?.setItem(SEEN_KEY + account, JSON.stringify([...seen ?? [], ...unseen]));
    } catch {
      // Storage may be full or blocked; the marks then show again next time.
    }
  }

  private async loadTemplates(): Promise<{ dialog: Node; row: Node; reward: Node }> {
    if (this.templates) return this.templates;
    const { library } = this.options;
    const [dialog, row, reward] = await Promise.all([loadBml(library, FOLDER, "questInfo2KartPass@zz"),
      loadBml(library, FOLDER, "QuestUX2ndButton@zz"), loadBml(library, FOLDER, "QuestUX2ndReward")]);
    this.templates = { dialog: resolveStrings(dialog, this.strings), row: resolveStrings(row, this.strings),
      reward: resolveStrings(reward, this.strings) };
    return this.templates;
  }

  /** The dialog with each box's rows and the reward slots. */
  private async build(): Promise<void> {
    const { library } = this.options;
    const templates = await this.loadTemplates();
    // QuestUX2ndButton: its ImageButton is painted (the in-progress, completed and locked looks).
    const rowChildren = templates.row.children.map(child => child.name === "ImageButton"
      ? withAttributes(child, { windowRect: undefined, leftTopWH: `0 0 ${ROW.width} ${ROW.height}` })
      : nodeName(child) === "clearIcon" ? withAttributes(child, { texture: "quest_img_slotClear@cn" })
      : nodeName(child) === "title" ? withAttributes(child, { adjust: `${TITLE_X} -1`,
        windowSize: `${ROW.width - TITLE_X} ${ROW.height}` }) : child);
    const box = (group: QuestGroup, entry: Node): Node => ({
      ...entry, children: entry.children.map(child => {
        const childName = nodeName(child);
        // The help button carries its tooltip panel (shown while hovered, or after a click).
        if (childName === "infoBtn") return mapTree(child, inner => {
          const innerName = nodeName(inner);
          return innerName === "infoBtn" || innerName === "guidePanel"
            ? withAttributes(inner, { name: `${innerName}_${group}`, visible: "true" }) : undefined;
        });
        if (child.name !== "GridSelectorEx") return child;
        return { ...withAttributes(child, { name: `questList_${group}`, adjust: `${ROW_ORIGIN.x} ${ROW_ORIGIN.y}`,
          windowSize: `${ROW.width} ${BOX_ROWS[group] * (ROW.height + ROW.gap)}` }), name: "Container",
        children: Array.from({ length: BOX_ROWS[group] }, (_unused, index) => node("Window", { name: `${group}Row${index}`,
          leftTopWH: `0 ${index * (ROW.height + ROW.gap)} ${ROW.width} ${ROW.height}` }, rowChildren.map(clone))) };
      }),
    });
    let definition = mapTree(templates.dialog, entry => {
      const name = nodeName(entry);
      for (const group of ["pass", "normal", "club"] as const)
        if (name === BOX_NAMES[group]) return box(group, entry);
      if (entry.name === "GridSelectorEx" && name === "rewardList") {
        return { ...withAttributes(entry, { windowSize: "490 130" }), name: "Container",
          children: Array.from({ length: MAX_REWARDS }, (_unused, index) =>
            node("Window", { name: `reward${index}`, leftTopWH: `${(index % 2) * (REWARD.width + REWARD.gapX)} ${
              Math.floor(index / 2) * (REWARD.height + REWARD.gapY)} ${REWARD.width} ${REWARD.height}` },
            templates.reward.children.map(clone))) };
      }
      if (entry.children.some(child => nodeName(child) === "goKartPassBtn"))
        return { ...entry, children: entry.children.filter(child => nodeName(child) !== "goKartPassBtn") };
      return undefined;
    });
    const prepared = prepare(library, definition, ROOTS);
    const rows: Rows = { pass: new WeakMap(), normal: new WeakMap(), club: new WeakMap(), reward: new WeakMap() };
    indexRows(prepared, "passRow", rows.pass);
    indexRows(prepared, "normalRow", rows.normal);
    indexRows(prepared, "clubRow", rows.club);
    indexRows(prepared, "reward", rows.reward);
    if (this.disposed) return;
    const view = await te.load({
      library, root: this.options.root, definition: prepared, roots: ROOTS, smoothImages: true, modal: true,
      label: this.strings.get("questInfo") ?? "任务信息", onCancel: () => this.options.onClose(),
      state: (entry: Node) => this.state(entry, rows),
    }) as WindowView;
    if (this.disposed) {
      view.dispose();
      return;
    }
    const previous = this.view;
    this.view = view;
    view.element.addEventListener("wheel", this.onWheel, { passive: false });
    view.show();
    previous?.dispose();
  }

  /** The 普通任务 box scrolls through its quests seven at a time. */
  private scroll(event: WheelEvent): void {
    const normal = questBoxes(this.quests).normal;
    const max = Math.max(0, normal.length - BOX_ROWS.normal);
    if (max === 0) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(max, this.normalOffset + (event.deltaY > 0 ? 1 : -1)));
    if (next === this.normalOffset) return;
    this.normalOffset = next;
    this.view?.render();
  }

  private rowQuest(group: QuestGroup, index: number): Quest | undefined {
    const quests = questBoxes(this.quests)[group];
    return quests[group === "normal" ? index + this.normalOffset : index];
  }

  private state(entry: Node, rows: Rows): NodeState {
    const name = nodeName(entry);
    for (const group of ["pass", "normal", "club"] as const) {
      const index = rows[group].get(entry);
      if (index !== undefined) return this.rowState(name, group, index, rows);
    }
    const reward = rows.reward.get(entry);
    if (reward !== undefined) return this.rewardState(name, reward);
    const quest = this.quest();
    const boxes = questBoxes(this.quests);
    const guide = /^(infoBtn|guidePanel)_(pass|normal|club)$/.exec(name);
    if (guide) {
      const group = guide[2] as QuestGroup;
      if (guide[1] === "guidePanel") {
        const hovered = (this.view as unknown as { hovered?: Node } | undefined)?.hovered;
        return { visible: this.guide === group || (!!hovered && nodeName(hovered) === `infoBtn_${group}`) };
      }
      return { label: "帮助", action: () => {
        this.options.onActivate?.();
        this.guide = this.guide === group ? undefined : group;
        this.view?.render();
      } };
    }
    switch (name) {
      case "cancelButton":
      case "okButton": return { label: this.strings.get("ok") ?? "确认", action: () => this.options.onClose() };
      case "listZeroInfo": return { visible: boxes.pass.length === 0 };
      case "clubDim": return { visible: !this.hasClub };
      case "QuestTitleCaption": return { text: !quest ? "" : quest.group === "pass"
        ? `[${this.stageOf(quest)}${this.strings.get("KartPassDaily") ?? "阶段"}] ${quest.title}` : quest.title };
      case "period": return { text: !quest ? "" : quest.reset === "none" ? "无期限" : periodText(quest.periodStart, quest.periodEnd) };
      // multiLine, vcenter: the lines are centred in the label's 100 px.
      case "QuestDesc": return this.centredLines((quest?.desc ?? "").replaceAll("|", "\n"), TEXT.dark);
      // The black plate under it is quest_img_baseBG's; only the word is coloured.
      case "thisQuestStatus": return !quest ? { text: "" } : quest.completedAt
        ? { text: this.strings.get("questComplete") ?? "完成", textColor: STATUS_COLORS.complete }
        : quest.locked ? { text: this.strings.get("questDisable") ?? "不可以", textColor: STATUS_COLORS.disable }
        : { text: this.strings.get("questEnable") ?? "可以", textColor: STATUS_COLORS.enable };
      // " 可进行状态" (marginRect "5 4"): its leading space kept, centred in the plate's 28 px caption strip.
      case "CaptionQuestStatus": return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        context.save();
        context.font = `bold 14px ${FONT}`;
        context.textBaseline = "middle";
        context.fillStyle = TEXT.grey;
        context.fillText(` ${this.strings.get("enableState") ?? "可进行状态"}`, rect.x + 5, rect.y + 15);
        context.restore();
      } };
      case "lblEmptyConditions": return { visible: !!quest && !quest.locked && quest.group !== "club",
        text: quest?.group === "club" ? "" : this.strings.get("questEnableAll") ?? "所有人均可参与任务。" };
      case "emptyContainer": return quest?.locked ? this.lockedCondition(quest)
        : quest?.group === "club" ? paintText(this.hasClub ? (this.strings.get("kClubJoined") ?? "加入俱乐部") : (this.strings.get("clubQuestNotOpen") ?? "加入俱乐部时开放。"),
          { size: 14, color: "rgb(42,55,80)", align: "center", middle: true, bold: true }) : {};
      case "QuestHowTo": return { text: quest?.mission ?? "" };
      case "questGageBG":
      case "questGageOn":
      case "questGageBGDisable":
      case "questGageOnDisable": return { visible: false };
      case "questProgressLabel": return quest ? this.gauge(quest) : {};
      case "challengeShadow":
      case "btn_trackInfo": return { visible: false };
      case "title":
      case "desc1": case "desc2": case "desc3": case "desc4":
      case "subTitle1": case "subTitle2": case "subTitle3":
      case "dailyDesc": case "weeklyDesc": return { visible: true };
      // This server's third normal kind is 一般: one reward, never reset; no 网吧.
      case "repeatDesc": return { visible: true, text: "完成后可获得1次奖励（不初始化）" };
      case "subTitle4":
      case "onlyPCRoomDesc": return { visible: false };
    }
    return {};
  }

  private stageOf(quest: Quest): number {
    return questBoxes(this.quests).pass.findIndex(entry => entry.id === quest.id) + 1;
  }

  private rowState(name: string, group: QuestGroup, index: number, rows: Rows): NodeState {
    const quest = this.rowQuest(group, index);
    // Without a club the 俱乐部任务 box is only clubDim and its notice.
    if (/^(pass|normal|club)Row\d+$/.test(name)) return { visible: !!quest && (group !== "club" || this.hasClub) };
    if (!quest) return {};
    const locked = quest.locked || (group === "club" && !this.hasClub);
    const hovered = (this.view as unknown as { hovered?: Node } | undefined)?.hovered;
    // The row's ImageButton states: _1 normal, _2 over and selected (selectedTexture), white words on its blue.
    const lit = quest.id === this.selected || (!!hovered && nodeName(hovered) === "questBtn" &&
      rows[group].get(hovered) === index);
    const words = lit && !quest.completedAt && !locked ? { textColor: TEXT.white } : {};
    switch (name) {
      // Without a club the 俱乐部任务 rows sit under clubDim and take no clicks.
      case "questBtn": return { label: quest.title, ...(group === "club" && !this.hasClub ? {} : { action: () => {
        this.options.onActivate?.();
        this.selected = quest.id;
        this.view?.render();
      } }), paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        const look = quest.completedAt ? ROW_LOOKS.done : locked ? ROW_LOOKS.locked : ROW_LOOKS.doing;
        const image = this.images.named(ROOTS, `${look}${lit ? 2 : 1}@zz`);
        if (image) context.drawImage(image.image, rect.x, rect.y, rect.width, rect.height);
      } };
      case "resetType": return { text: group === "pass" ? `${this.stageOf(quest)}${this.strings.get("KartPassDaily") ?? "阶段"}`
        : this.strings.get(RESET_KEYS[quest.reset] ?? "none") ?? "", visible: !(group === "pass" && locked), ...words };
      case "title": return { text: `${quest.title} (${questPercent(quest)}%)`, visible: !(group === "pass" && locked),
        ...words };
      case "clearIcon": return { visible: !!quest.completedAt };
      case "closeImage": return { visible: group === "pass" && locked };
      case "closeLabel": return { visible: group === "pass" && locked, text: this.strings.get("CloseDaily") ?? "完成前阶段任务时开放" };
      case "newButton": return { visible: this.fresh.has(quest.id) && !quest.completedAt && !locked && group !== "pass" };
      case "pc": return { visible: false };
    }
    return {};
  }

  private rewardState(name: string, index: number): NodeState {
    const reward = this.quest()?.rewards[index];
    // All four slots show; empty ones carry icon_slotEmpty.
    if (/^reward\d$/.test(name)) return { visible: true };
    if (!reward) return name === "rewardEmpty" ? { visible: true } : { visible: name === "rewardBG" };
    switch (name) {
      case "rewardEmpty": return { visible: false };
      case "rewardLucci":
      case "rewardCS":
      case "rewardKartPassPoint": return { visible: false };
      case "rewardEmblem": return { visible: false };
      case "rewardStock": return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
        if (reward.passPoints) {
          // The pass point card (card 101, a 3D card model in the release): a small round "P" badge.
          context.save();
          context.beginPath();
          context.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, 12, 0, Math.PI * 2);
          context.fillStyle = "rgb(40,110,200)";
          context.fill();
          context.lineWidth = 2.5;
          context.strokeStyle = "rgb(30,40,60)";
          context.stroke();
          context.beginPath();
          context.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, 9.5, 0, Math.PI * 2);
          context.lineWidth = 1.5;
          context.strokeStyle = "rgba(255,255,255,.85)";
          context.stroke();
          context.font = `bold 13px ${FONT}`;
          context.fillStyle = "white";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText("P", rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
          context.restore();
          return;
        }
        const icon = this.icons.icon(reward);
        if (icon) drawFitted(context, icon, { x: rect.x + 6, y: rect.y + 6, width: rect.width - 12,
          height: rect.height - 12 }, reward.currency ? 1.4 : 1);
      } };
      // marginRect "5 -1 0 0", vcenter (the release's line box sits 2 px lower than ours).
      case "rewardLabel": return this.centredLines(rewardText(reward), TEXT.grey, { x: 5, y: 1 });
    }
    return {};
  }

  /** A release multiLine bold14 label: wrapped lines centred as a block in the label (less its margin). */
  private centredLines(text: string, color: string, margin = { x: 0, y: 0 }): NodeState {
    return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
      context.save();
      context.font = `bold 14px ${FONT}`;
      const lines = wrapText(context, text, rect.width - margin.x);
      const top = rect.y + margin.y + (rect.height - (lines.length * LINE_STEP - 1)) / 2;
      context.textBaseline = "middle";
      context.fillStyle = color;
      lines.forEach((line, index) => context.fillText(line, rect.x + margin.x, top + index * LINE_STEP + 10));
      context.restore();
    } };
  }

  private lockedCondition(quest: Quest): NodeState {
    const pre = this.quests.find(entry => entry.id === quest.pre);
    const text = quest.group === "pass" ? this.strings.get("CloseDaily") ?? "完成前阶段任务时开放"
      : (this.strings.get("kPrevQuestComplete") ?? "[%s] 完成任务").replace("%s", pre?.title ?? String(quest.pre));
    return { paint: (context: CanvasRenderingContext2D, rect: Rect) => {
      const dot = this.images.named(ROOTS, "img_pointImposible");
      if (dot) context.drawImage(dot.image, rect.x + 6, rect.y + 6);
      context.save();
      context.font = `bold 14px ${FONT}`;
      context.textBaseline = "top";
      context.fillStyle = "rgb(42,55,80)";
      context.fillText(text, rect.x + 22, rect.y + 3);
      context.restore();
    } };
  }

  /**
   * The progress gauge (img_questGageBG / On, 비활성 when done or locked) at
   * the foot of questProgressGageBar, and the ColorLabel's text over it.
   */
  private gauge(quest: Quest): NodeState {
    return { text: "", paint: (context: CanvasRenderingContext2D, rect: Rect) => {
      const inactive = quest.locked || !!quest.completedAt ? "_비활성" : "";
      const back = this.images.named(ROOTS, `img_questGageBG${inactive}`);
      const fill = this.images.named(ROOTS, `img_questGageOn${inactive}`);
      // The label sits at adjust "0 -1" in the 35 px bar container; the gauge panels are align="bottom".
      const bar = { x: rect.x, y: rect.y + 1 + 35 - 8, width: rect.width, height: 8 };
      if (back) context.drawImage(back.image, bar.x, bar.y, bar.width, bar.height);
      const ratio = quest.completedAt ? 1 : Math.min(1, quest.value / Math.max(1, quest.target));
      if (fill && ratio > 0) {
        context.drawImage(fill.image, 0, 0, fill.width * ratio, fill.height, bar.x, bar.y, bar.width * ratio,
          bar.height);
      }
      // "[color:…]目前 2回[/color] / 目标 3回": the current count in blue, the rest in the label's grey.
      const runs = colorRuns(questProgressMarkup(quest.completedAt ? { ...quest, value: quest.target } : quest,
        this.strings), TEXT.grey);
      context.save();
      context.font = `bold 14px ${FONT}`;
      context.textBaseline = "middle";
      let x = rect.x + rect.width - runs.reduce((width, run) => width + context.measureText(run.text).width, 0);
      for (const run of runs) {
        context.fillStyle = run.color;
        context.fillText(run.text, x, rect.y + rect.height / 2 + 2);
        x += context.measureText(run.text).width;
      }
      context.restore();
    } };
  }
}

export { shortTime as questShortTime };
