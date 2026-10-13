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

/** The NPC's name without its title ("导游 · 皮蛋" → "皮蛋"). */
export function shortName(npc: QuestNpc | undefined): string {
  const name = npc?.name ?? "";
  const dot = name.lastIndexOf("·");
  return dot >= 0 ? name.slice(dot + 1).trim() : name;
}

/** "载客 · 限时": the quest's type and, when it has one, its limit. */
export function questLabel(quest: QuestDef): string {
  const type = QUEST_RULES.types[quest.type].label;
  return quest.kind === "normal" ? type : `${type} · ${QUEST_RULES.kinds[quest.kind].label}`;
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
  const km = `约 ${(quest.distanceM / 1000).toFixed(1)} km`;
  const back = quest.receiver === quest.giver ? "带回来" : `交给${receiver}`;
  switch (quest.type) {
    case "passenger": return `载${shortName(QUEST_NPCS[quest.giver])}去找${receiver}（${km}）`;
    case "collect": return `收集 ${quest.stops?.length ?? 0} 处${quest.item}，${back}（${km}）`;
    case "search": return `在${quest.area?.name ?? "附近"}找到${quest.item}，${back}`;
    default: return `${quest.item} → ${receiver}（${km}）`;
  }
}

/** "限速 45 km/h" etc.: what the quest must keep to. */
export function limitText(quest: QuestDef): string {
  switch (quest.kind) {
    case "speed": return `全程车速不超过 ${quest.maxKmh} km/h（超速超过 ${QUEST_RULES.speedGraceMs / 1000} 秒即失败）`;
    case "collision": return `碰撞不超过 ${quest.maxCollisions} 次`;
    case "time": return `${formatDuration(quest.timeLimitMs ?? 0)} 内完成`;
    default: return quest.type === "passenger" ? "开得平稳，乘客满意会给小费" : "没有特别要求";
  }
}

/** The same, short enough for the mission card's 执行条件 line. */
export function limitShort(quest: QuestDef): string {
  switch (quest.kind) {
    case "speed": return `限速 ${quest.maxKmh} km/h`;
    case "collision": return `碰撞不超过 ${quest.maxCollisions} 次`;
    case "time": return `限时 ${formatDuration(quest.timeLimitMs ?? 0)}`;
    default: return quest.type === "passenger" ? "平稳驾驶有小费" : "没有特别要求";
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒` : `${seconds} 秒`;
}

/** The quest's combined reward multiplier (type × limit). */
export function questMultiplier(quest: QuestDef): number {
  return Math.round(QUEST_RULES.types[quest.type].multiplier * QUEST_RULES.kinds[quest.kind].multiplier * 100) / 100;
}

export function rewardText(quest: QuestDef): string {
  const multiplier = questMultiplier(quest);
  const bonus = multiplier > 1 ? `（${questLabel(quest)} ×${multiplier}）` : "";
  const tip = quest.type === "passenger" ? "，另有小费" : "";
  return `金币 ${quest.lucci} · 经验 ${quest.exp}${bonus}${tip}`;
}

/** Why a quest failed, for the player. */
export function failureText(quest: QuestDef | undefined, reason: string): string {
  if (quest?.type === "passenger") {
    const who = quest.item;
    switch (reason) {
      case "SPEED": return `车速超过了 ${quest.maxKmh} km/h，${who}吓得要下车。`;
      case "COLLISION": return `碰撞超过了 ${quest.maxCollisions} 次，${who}受不了了。`;
      case "TIMEOUT": return `没能在规定时间内赶到，${who}已经来不及了。`;
      case "UNHAPPY": return `${who}被颠得受不了，半路下车了。`;
      case "EXITED": return `你下了车，${who}只好自己走了。`;
      case "TELEPORT": return `离开了路线（传送或拖车），${who}没能跟着过去。`;
    }
  }
  const what = quest?.item ?? "货物";
  switch (reason) {
    case "SPEED": return `车速超过了 ${quest?.maxKmh ?? ""} km/h，${what}受损了。`;
    case "COLLISION": return `碰撞超过了 ${quest?.maxCollisions ?? ""} 次，${what}摔坏了。`;
    case "TIMEOUT": return `没能在规定时间内完成，${what}来不及了。`;
    case "TELEPORT": return `离开了路线（传送或拖车），${what}没能跟着过去。`;
    default: return "任务失败了。";
  }
}

type ResultRow = { label: string; value: string; color?: string };

/** Rows of the 任务成功 window: time, distance, what was earned (CityQuestDone fields). */
export function successResult(quest: QuestDef, done: { elapsedMs: number; collisions: number; exp: number;
  lucci: number; capped: boolean; walletLucci: number; level: number; satisfaction?: number; tip?: number;
  levelUps: ReadonlyArray<{ level: number; lucci: number; koin: number; coupon: number }> }) {
  const rows: ResultRow[] = [
    { label: quest.type === "passenger" ? "送到" : "交给", value: QUEST_NPCS[quest.receiver]?.name ?? "" },
    { label: "用时", value: formatDuration(done.elapsedMs) },
    { label: "路程", value: `约 ${(quest.distanceM / 1000).toFixed(1)} km` },
  ];
  if (quest.type === "collect")
    rows.push({ label: "收集", value: `${quest.stops?.length ?? 0} / ${quest.stops?.length ?? 0} 处` });
  if (quest.kind === "collision") rows.push({ label: "碰撞", value: `${done.collisions} / ${quest.maxCollisions} 次` });
  if (quest.type === "passenger" && done.satisfaction !== undefined)
    rows.push({ label: "乘客满意度", value: `${done.satisfaction}%`, color: moodColor(done.satisfaction) });
  const multiplier = questMultiplier(quest);
  if (multiplier > 1) rows.push({ label: "报酬倍率", value: `${questLabel(quest)} ×${multiplier}` });
  if (done.tip) rows.push({ label: "小费", value: `+${done.tip}（含在金币里）`, color: "rgb(214, 120, 0)" });
  rows.push({ label: "获得金币", value: `+${done.lucci}`, color: "rgb(214, 120, 0)" },
    { label: "获得经验", value: `+${done.exp}`, color: "rgb(30, 110, 210)" });
  for (const up of done.levelUps) {
    const extra = [up.lucci ? `金币 ${up.lucci}` : "", up.koin ? `K币 ${up.koin}` : "", up.coupon ? `点券 ${up.coupon}` : ""]
      .filter(Boolean).join("、");
    rows.push({ label: `升到 ${up.level} 级`, value: extra ? `奖励 ${extra}` : "恭喜升级！", color: "rgb(214, 120, 0)" });
  }
  rows.push({ label: "现有金币", value: `${done.walletLucci}` });
  return { success: true, heading: `「${quest.title}」完成！`, rows,
    note: done.capped ? "今天的任务报酬已经领满了，这次没有金币和经验。明天 0 点后再来吧。" : undefined };
}

const REASONS: Record<string, string> = { SPEED: "超速", COLLISION: "碰撞过多", TIMEOUT: "超时",
  TELEPORT: "离开了路线", UNHAPPY: "乘客不满意", EXITED: "中途下车" };

/** Rows of the 任务失败 window. */
export function failureResult(quest: QuestDef | undefined, reason: string, collisions: number) {
  const rows: ResultRow[] = [
    { label: "失败原因", value: REASONS[reason] ?? "任务失败", color: "rgb(206, 40, 40)" },
  ];
  if (quest?.kind === "speed") rows.push({ label: "限速", value: `${quest.maxKmh} km/h` });
  if (quest?.kind === "collision") rows.push({ label: "碰撞", value: `${collisions} / ${quest.maxCollisions} 次` });
  if (quest?.kind === "time") rows.push({ label: "时限", value: formatDuration(quest.timeLimitMs ?? 0) });
  rows.push({ label: "报酬", value: "无" });
  const giver = quest ? shortName(QUEST_NPCS[quest.giver]) : "委托人";
  return { success: false, heading: quest ? `「${quest.title}」失败` : "任务失败", rows,
    note: `${failureText(quest, reason)}可以回到${giver}那里重新接这个任务。` };
}

/** A satisfaction's colour: green, yellow, then red. */
export function moodColor(satisfaction: number): string {
  return satisfaction >= 70 ? "rgb(40, 150, 60)" : satisfaction >= 40 ? "rgb(214, 150, 0)" : "rgb(206, 40, 40)";
}

/** The quests an NPC gives, in file order. */
export function questsOf(npcId: string): QuestDef[] {
  return QUESTS.filter(quest => quest.giver === npcId);
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
    pages.push({ background: npc.background, characters, speaker: who === "me" ? options.playerName : name, text });
  };
  if (options.withStory) page("npc", npc.story);
  for (const line of quest.offer) page(line.who, line.text);
  return pages;
}

/** The thanks at the end: from the passenger after a ride, else from the receiver. */
export function thanksPages(quest: QuestDef): StoryScenePage[] {
  const npc = QUEST_NPCS[quest.type === "passenger" ? quest.giver : quest.receiver]!;
  return [{ background: npc.background, characters: [{ id: npc.sprite, x: 7.5, flip: false, emotion: "normal" }],
    speaker: shortName(npc), text: quest.thanks }];
}

/** What the quest has done so far (CityQuestProgress). */
export interface QuestProgress { collected?: boolean[]; found?: boolean; signal?: number; satisfaction?: number }

/** What the HUD line says about a quest under way, beyond where it goes. */
export function progressText(quest: QuestDef, progress: QuestProgress): string {
  switch (quest.type) {
    case "passenger": return `乘客满意度 ${progress.satisfaction ?? 100}%`;
    case "collect": {
      const got = progress.collected?.filter(Boolean).length ?? 0;
      return `${quest.item} ${got}/${quest.stops?.length ?? 0}`;
    }
    case "search": return progress.found ? `已找到${quest.item}` : `信号 ${signalBars(progress.signal ?? 1)}`;
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
      if (!progress.collected?.[i]) marks.push({ mark: "★", x: stop.x, y: stop.y, z: stop.z, label: stop.name });
    });
  if (questReady(quest, progress)) {
    const receiver = QUEST_NPCS[quest.receiver]!;
    const verb = quest.type === "passenger" ? "目的地" : quest.type === "delivery" ? "送货目标" : "交付";
    marks.push({ mark: "?", x: receiver.x, z: receiver.z, label: `${verb} · ${receiver.name}`, npc: quest.receiver });
  }
  return marks;
}

const DIRECTIONS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

/** Compass word from (x, z) towards (tx, tz) in design coordinates (x east, z south). */
export function compass(x: number, z: number, tx: number, tz: number): string {
  const degrees = (Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI;
  return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
}
