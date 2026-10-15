import { tr } from "../i18n/locale";
import { cityContentName } from "../i18n/catalogs/city-content-names";
import { cityDialogueText } from "./city-dialogue";
/**
 * 卡丁城任务的数据（server-go/CITY-QUESTS.md）：city-quests.json，与节点内嵌的
 * 是同一份（client/tools/city/quests/build-city-quests.mjs 生成）。这里是界面
 * 用到的说明文字、对话页、结算行和距离方向。四种任务：送货、载客、收集、寻物。
 */
import questData from "./city-quests.json";
import type { StoryScenePage } from "../story/story-data";

export type QuestKind = "normal" | "speed" | "collision" | "time";
export type QuestType = "delivery" | "passenger" | "collect" | "search";

export interface QuestLine { who: "npc" | "me"; text: string }

/** A named spot (design x/z; a stop's y is its road height). */
export interface QuestPoint { name: string; x: number; y?: number; z: number }

export interface QuestDef {
  id: string;
  type: QuestType;
  giver: string;
  receiver: string;
  /** What is carried, collected or searched for; a passenger quest's passenger. */
  item: string;
  title: string;
  kind: QuestKind;
  distanceM: number;
  lucci: number;
  exp: number;
  maxKmh?: number;
  maxCollisions?: number;
  timeLimitMs?: number;
  /** 收集: the stops, in the order a driver would take them. */
  stops?: QuestPoint[];
  /** 寻物: the area (design x/z, radius m); the item lies at one of its spots. */
  area?: QuestPoint & { radius: number; spots: Array<{ x: number; z: number }> };
  synopsis: string;
  offer: QuestLine[];
  thanks: string;
}

export interface QuestNpc {
  name: string;
  character: number;
  dye: number;
  /** stage_scene emotion.bml sprite id and stage_scene/bg background. */
  sprite: string;
  background: string;
  story: string;
  /** Design coordinates. */
  x: number;
  z: number;
}

export interface QuestRules {
  arriveRadius: number;
  talkRadius: number;
  pickupRadius: number;
  speedGraceMs: number;
  types: Record<QuestType, { label: string; multiplier: number }>;
  kinds: Record<QuestKind, { label: string; multiplier: number }>;
  passenger: { collisionPenalty: number; comfortKmh: number; speedPenaltyPerS: number; tipMax: number };
  search: { spots: number; allowance: number; signalBands: number[]; extraTimeS: number };
}

export const QUEST_RULES = questData.rules as unknown as QuestRules;
export const QUEST_NPCS = questData.npcs as unknown as Record<string, QuestNpc>;
export const QUESTS = questData.quests as unknown as QuestDef[];
export const QUEST_BY_ID = new Map(QUESTS.map(quest => [quest.id, quest]));

/** Localized display labels; canonical quest objects and IDs remain untouched. */
export function questTitle(quest: Pick<QuestDef, "title">): string { return cityContentName(quest.title); }
export function questSynopsis(quest: Pick<QuestDef, "synopsis">): string { return cityContentName(quest.synopsis); }
export function npcName(npc: Pick<QuestNpc, "name"> | undefined): string { return cityContentName(npc?.name ?? ""); }

/** The NPC's name without its title ("导游 · 皮蛋" → "皮蛋"). */
export function shortName(npc: QuestNpc | undefined): string {
  const name = npcName(npc);
  const dot = name.lastIndexOf("·");
  return dot >= 0 ? name.slice(dot + 1).trim() : name;
}

/** "载客 · 限时": the quest's type and, when it has one, its limit. */
export function questLabel(quest: QuestDef): string {
  const type = tr(QUEST_RULES.types[quest.type].label);
  return quest.kind === "normal" ? type : `${type} · ${tr(QUEST_RULES.kinds[quest.kind].label)}`;
}

/** The story-mode mission picture (stage_scenarioReady) for the quest's type. */
export function questMissionImage(quest: QuestDef): string {
  switch (quest.type) {
    case "passenger": return "mq_멀티@zz";
    case "collect": return "mq_주행거리@zz";
    case "search": return "mq_추격@zz";
    default: return "mq_배달@zz";
  }
}

/** The mission card's 执行条件 line: what to do, where and how far. */
export function questGoal(quest: QuestDef): string {
  const receiver = shortName(QUEST_NPCS[quest.receiver]);
  const km = tr("约 {value0} km", { value0: (quest.distanceM / 1000).toFixed(1) });
  const back = quest.receiver === quest.giver ? tr("带回来") : tr("交给{value0}", { value0: receiver });
  switch (quest.type) {
    case "passenger": return tr("载{value0}去找{value1}（{value2}）", { value0: shortName(QUEST_NPCS[quest.giver]), value1: receiver, value2: km });
    case "collect": return tr("收集 {value0} 处{value1}，{value2}（{value3}）", { value0: quest.stops?.length ?? 0, value1: cityContentName(quest.item), value2: back, value3: km });
    case "search": return tr("在{value0}找到{value1}，{value2}", { value0: cityContentName(quest.area?.name ?? tr("附近")), value1: cityContentName(quest.item), value2: back });
    default: return `${cityContentName(quest.item)} → ${receiver}（${km}）`;
  }
}

/** "限速 85 km/h" etc.: what the quest must keep to. */
export function limitText(quest: QuestDef): string {
  switch (quest.kind) {
    case "speed": return tr("全程车速不超过 {value0} km/h（超速超过 {value1} 秒即失败）", { value0: quest.maxKmh ?? 0, value1: QUEST_RULES.speedGraceMs / 1000 });
    case "collision": return tr("碰撞不超过 {value0} 次", { value0: quest.maxCollisions ?? 0 });
    case "time": return tr("{value0} 内完成", { value0: formatDuration(quest.timeLimitMs ?? 0) });
    default: return quest.type === "passenger" ? tr("开得平稳，乘客满意会给小费") : tr("没有特别要求");
  }
}

/** The same, short enough for the mission card's 执行条件 line. */
export function limitShort(quest: QuestDef): string {
  switch (quest.kind) {
    case "speed": return tr("限速 {value0} km/h", { value0: quest.maxKmh ?? 0 });
    case "collision": return tr("碰撞不超过 {value0} 次", { value0: quest.maxCollisions ?? 0 });
    case "time": return tr("限时 {value0}", { value0: formatDuration(quest.timeLimitMs ?? 0) });
    default: return quest.type === "passenger" ? tr("平稳驾驶有小费") : tr("没有特别要求");
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds >= 60 ? tr("{value0} 分 {value1} 秒", { value0: Math.floor(seconds / 60), value1: String(seconds % 60).padStart(2, "0") }) : tr("{value0} 秒", { value0: seconds });
}

/** The quest's combined reward multiplier (type × limit). */
export function questMultiplier(quest: QuestDef): number {
  return Math.round(QUEST_RULES.types[quest.type].multiplier * QUEST_RULES.kinds[quest.kind].multiplier * 100) / 100;
}

export function rewardText(quest: QuestDef): string {
  const multiplier = questMultiplier(quest);
  const bonus = multiplier > 1 ? `（${questLabel(quest)} ×${multiplier}）` : "";
  const tip = quest.type === "passenger" ? tr("，另有小费") : "";
  return tr("金币 {value0} · 经验 {value1}{value2}{value3}", { value0: quest.lucci, value1: quest.exp, value2: bonus, value3: tip });
}

/** Why a quest failed, for the player. */
export function failureText(quest: QuestDef | undefined, reason: string): string {
  if (quest?.type === "passenger") {
    const who = cityContentName(quest.item);
    switch (reason) {
      case "SPEED": return tr("车速超过了 {value0} km/h，{value1}吓得要下车。", { value0: quest.maxKmh ?? 0, value1: who });
      case "COLLISION": return tr("碰撞超过了 {value0} 次，{value1}受不了了。", { value0: quest.maxCollisions ?? 0, value1: who });
      case "TIMEOUT": return tr("没能在规定时间内赶到，{value0}已经来不及了。", { value0: who });
      case "UNHAPPY": return tr("{value0}被颠得受不了，半路下车了。", { value0: who });
      case "EXITED": return tr("你下了车，{value0}只好自己走了。", { value0: who });
      case "TELEPORT": return tr("离开了路线（传送或拖车），{value0}没能跟着过去。", { value0: who });
    }
  }
  const what = cityContentName(quest?.item ?? tr("货物"));
  switch (reason) {
    case "SPEED": return tr("车速超过了 {value0} km/h，{value1}受损了。", { value0: quest?.maxKmh ?? "", value1: what });
    case "COLLISION": return tr("碰撞超过了 {value0} 次，{value1}摔坏了。", { value0: quest?.maxCollisions ?? "", value1: what });
    case "TIMEOUT": return tr("没能在规定时间内完成，{value0}来不及了。", { value0: what });
    case "TELEPORT": return tr("离开了路线（传送或拖车），{value0}没能跟着过去。", { value0: what });
    default: return tr("任务失败了。");
  }
}

type ResultRow = { label: string; value: string; color?: string };

/** Rows of the 任务成功 window: time, distance, what was earned (CityQuestDone fields). */
export function successResult(quest: QuestDef, done: { elapsedMs: number; collisions: number; exp: number;
  lucci: number; capped: boolean; walletLucci: number; level: number; satisfaction?: number; tip?: number;
  levelUps: ReadonlyArray<{ level: number; lucci: number; koin: number; coupon: number }> }) {
  const rows: ResultRow[] = [
    { label: quest.type === "passenger" ? tr("送到") : tr("交给"), value: npcName(QUEST_NPCS[quest.receiver]) },
    { label: tr("用时"), value: formatDuration(done.elapsedMs) },
    { label: tr("路程"), value: tr("约 {value0} km", { value0: (quest.distanceM / 1000).toFixed(1) }) },
  ];
  if (quest.type === "collect")
    rows.push({ label: tr("收集"), value: tr("{value0} / {value1} 处", { value0: quest.stops?.length ?? 0, value1: quest.stops?.length ?? 0 }) });
  if (quest.kind === "collision") rows.push({ label: tr("碰撞"), value: tr("{value0} / {value1} 次", { value0: done.collisions, value1: quest.maxCollisions ?? 0 }) });
  if (quest.type === "passenger" && done.satisfaction !== undefined)
    rows.push({ label: tr("乘客满意度"), value: `${done.satisfaction}%`, color: moodColor(done.satisfaction) });
  const multiplier = questMultiplier(quest);
  if (multiplier > 1) rows.push({ label: tr("报酬倍率"), value: `${questLabel(quest)} ×${multiplier}` });
  if (done.tip) rows.push({ label: tr("小费"), value: tr("+{value0}（含在金币里）", { value0: done.tip }), color: "rgb(214, 120, 0)" });
  rows.push({ label: tr("获得金币"), value: `+${done.lucci}`, color: "rgb(214, 120, 0)" },
    { label: tr("获得经验"), value: `+${done.exp}`, color: "rgb(30, 110, 210)" });
  for (const up of done.levelUps) {
    const extra = [up.lucci ? tr("金币 {value0}", { value0: up.lucci }) : "", up.koin ? tr("K币 {value0}", { value0: up.koin }) : "", up.coupon ? tr("点券 {value0}", { value0: up.coupon }) : ""]
      .filter(Boolean).join("、");
    rows.push({ label: tr("升到 {value0} 级", { value0: up.level }), value: extra ? tr("奖励 {value0}", { value0: extra }) : tr("恭喜升级！"), color: "rgb(214, 120, 0)" });
  }
  rows.push({ label: tr("现有金币"), value: `${done.walletLucci}` });
  return { success: true, heading: tr("「{value0}」完成！", { value0: questTitle(quest) }), rows,
    note: done.capped ? tr("今天的任务报酬已经领满了，这次没有金币和经验。明天 0 点后再来吧。") : undefined };
}

const REASONS: Record<string, string> = { SPEED: "超速", COLLISION: "碰撞过多", TIMEOUT: "超时",
  TELEPORT: "离开了路线", UNHAPPY: "乘客不满意", EXITED: "中途下车" };

/** Rows of the 任务失败 window. */
export function failureResult(quest: QuestDef | undefined, reason: string, collisions: number) {
  const rows: ResultRow[] = [
    { label: tr("失败原因"), value: tr(REASONS[reason] ?? "任务失败"), color: "rgb(206, 40, 40)" },
  ];
  if (quest?.kind === "speed") rows.push({ label: tr("限速"), value: `${quest.maxKmh} km/h` });
  if (quest?.kind === "collision") rows.push({ label: tr("碰撞"), value: tr("{value0} / {value1} 次", { value0: collisions, value1: quest.maxCollisions ?? 0 }) });
  if (quest?.kind === "time") rows.push({ label: tr("时限"), value: formatDuration(quest.timeLimitMs ?? 0) });
  rows.push({ label: tr("报酬"), value: tr("无") });
  const giver = quest ? shortName(QUEST_NPCS[quest.giver]) : tr("委托人");
  return { success: false, heading: quest ? tr("「{value0}」失败", { value0: questTitle(quest) }) : tr("任务失败"), rows,
    note: tr("{value0}可以回到{value1}那里重新接这个任务。", { value0: failureText(quest, reason), value1: giver }) };
}

/** A satisfaction's colour: green, yellow, then red. */
export function moodColor(satisfaction: number): string {
  return satisfaction >= 70 ? "rgb(40, 150, 60)" : satisfaction >= 40 ? "rgb(214, 150, 0)" : "rgb(206, 40, 40)";
}

const QUESTS_BY_GIVER = new Map<string, QuestDef[]>();
for (const quest of QUESTS) {
  if (!QUESTS_BY_GIVER.has(quest.giver)) QUESTS_BY_GIVER.set(quest.giver, []);
  QUESTS_BY_GIVER.get(quest.giver)!.push(quest);
}

/** The quests an NPC gives, in file order. */
export function questsOf(npcId: string): QuestDef[] {
  return QUESTS_BY_GIVER.get(npcId) ?? [];
}

/** Character item → story-mode sprite (stage_scene emotion.bml), for the player's lines. */
const PLAYER_SPRITES: Record<number, string> = {
  1: "bazzi", 2: "dao", 3: "dizini", 4: "ethi", 5: "kephi", 6: "marid", 7: "mos", 8: "uni", 9: "lodumani",
  15: "mobi", 16: "brodi", 18: "tutu", 25: "wenwen",
};

export function playerSprite(character: number | undefined): string | undefined {
  return character === undefined ? undefined : PLAYER_SPRITES[character];
}

/**
 * The dialogue before a quest: the NPC's story (the first talk of a visit),
 * then the request; the player's lines show its own rider when the story
 * mode has a sprite for it.
 */
export function offerPages(quest: QuestDef, options: { withStory: boolean; playerName: string;
  playerSprite?: string }): StoryScenePage[] {
  const npc = QUEST_NPCS[quest.giver]!;
  const name = shortName(npc);
  const npcChar = { id: npc.sprite, x: 4.5, flip: false, emotion: "normal" };
  const meChar = options.playerSprite ? { id: options.playerSprite, x: 11, flip: true, emotion: "normal" } : undefined;
  const pages: StoryScenePage[] = [];
  const page = (who: "npc" | "me", text: string): void => {
    const characters = who === "me" && meChar ? [npcChar, meChar] : [npcChar];
    pages.push({ background: npc.background, characters, speaker: who === "me" ? options.playerName : name,
      text: cityDialogueText(text) });
  };
  if (options.withStory) page("npc", npc.story);
  for (const line of quest.offer) page(line.who, line.text);
  return pages;
}

/** The thanks at the end: from the passenger after a ride, else from the receiver. */
export function thanksPages(quest: QuestDef): StoryScenePage[] {
  const npc = QUEST_NPCS[quest.type === "passenger" ? quest.giver : quest.receiver]!;
  return [{ background: npc.background, characters: [{ id: npc.sprite, x: 7.5, flip: false, emotion: "normal" }],
    speaker: shortName(npc), text: cityDialogueText(quest.thanks) }];
}

/** What the quest has done so far (CityQuestProgress). */
export interface QuestProgress { collected?: boolean[]; found?: boolean; signal?: number; satisfaction?: number }

/** What the HUD line says about a quest under way, beyond where it goes. */
export function progressText(quest: QuestDef, progress: QuestProgress): string {
  switch (quest.type) {
    case "passenger": return tr("乘客满意度 {value0}%", { value0: progress.satisfaction ?? 100 });
    case "collect": {
      const got = progress.collected?.filter(Boolean).length ?? 0;
      return `${cityContentName(quest.item)} ${got}/${quest.stops?.length ?? 0}`;
    }
    case "search": return progress.found ? tr("已找到{value0}", { value0: cityContentName(quest.item) }) : tr("信号 {value0}", { value0: signalBars(progress.signal ?? 1) });
    default: return "";
  }
}

/** "▮▮▮▯▯" for 3 bars of 5. */
export function signalBars(bars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(bars)));
  return "▮".repeat(n) + "▯".repeat(5 - n);
}

/** Whether a quest under way can be finished at its receiver. */
export function questReady(quest: QuestDef, progress: QuestProgress): boolean {
  if (quest.type === "collect") return (progress.collected?.length ?? 0) > 0 && progress.collected!.every(Boolean);
  if (quest.type === "search") return progress.found === true;
  return true;
}

/**
 * The marks of a quest under way, for the 3D view and the M map: a "?" at
 * the receiver once the quest can be finished there, a "★" at each stop
 * still to reach; a search's area is drawn on the map only.
 */
export interface QuestMapMark { mark: "?" | "★"; x: number; y?: number; z: number; label: string; npc?: string }

export function questMarks(quest: QuestDef, progress: QuestProgress): QuestMapMark[] {
  const marks: QuestMapMark[] = [];
  if (quest.type === "collect")
    quest.stops?.forEach((stop, i) => {
      if (!progress.collected?.[i]) marks.push({ mark: "★", x: stop.x, y: stop.y, z: stop.z, label: cityContentName(stop.name) });
    });
  if (questReady(quest, progress)) {
    const receiver = QUEST_NPCS[quest.receiver]!;
    const verb = quest.type === "passenger" ? tr("目的地") : quest.type === "delivery" ? tr("送货目标") : tr("交付");
    marks.push({ mark: "?", x: receiver.x, z: receiver.z, label: `${verb} · ${npcName(receiver)}`, npc: quest.receiver });
  }
  return marks;
}

const DIRECTIONS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

/** Compass word from (x, z) towards (tx, tz) in design coordinates (x east, z south). */
export function compass(x: number, z: number, tx: number, tz: number): string {
  const degrees = (Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI;
  return tr(DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!);
}
