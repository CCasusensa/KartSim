/**
 * 卡丁城送货任务的数据（server-go/CITY-QUESTS.md）：city-quests.json，与节点
 * 内嵌的是同一份（client/tools/city/quests/build-city-quests.mjs 生成）。这里
 * 是界面用到的说明文字、对话页和距离方向。
 */
import questData from "./city-quests.json";
import type { StoryScenePage } from "../story/story-data";

export type QuestKind = "normal" | "speed" | "collision" | "time";

export interface QuestLine { who: "npc" | "me"; text: string }

export interface QuestDef {
  id: string;
  giver: string;
  receiver: string;
  item: string;
  title: string;
  kind: QuestKind;
  distanceM: number;
  lucci: number;
  exp: number;
  maxKmh?: number;
  maxCollisions?: number;
  timeLimitMs?: number;
  synopsis: string;
  offer: QuestLine[];
  thanks: string;
}

export interface QuestNpc {
  name: string;
  character: number;
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
  speedGraceMs: number;
  kinds: Record<QuestKind, { label: string; multiplier: number }>;
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

/** "限速 45 km/h" etc.: what the delivery must keep to. */
export function limitText(quest: QuestDef): string {
  switch (quest.kind) {
    case "speed": return `全程车速不超过 ${quest.maxKmh} km/h（超速超过 ${QUEST_RULES.speedGraceMs / 1000} 秒即失败）`;
    case "collision": return `碰撞不超过 ${quest.maxCollisions} 次`;
    case "time": return `${formatDuration(quest.timeLimitMs ?? 0)} 内送达`;
    default: return "没有特别要求，安全送达即可";
  }
}

/** The same, short enough for the mission card's 执行条件 line. */
export function limitShort(quest: QuestDef): string {
  switch (quest.kind) {
    case "speed": return `限速 ${quest.maxKmh} km/h`;
    case "collision": return `碰撞不超过 ${quest.maxCollisions} 次`;
    case "time": return `限时 ${formatDuration(quest.timeLimitMs ?? 0)}`;
    default: return "安全送达即可";
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒` : `${seconds} 秒`;
}

export function rewardText(quest: QuestDef): string {
  const kind = QUEST_RULES.kinds[quest.kind];
  const bonus = kind.multiplier > 1 ? `（${kind.label} ×${kind.multiplier}）` : "";
  return `金币 ${quest.lucci} · 经验 ${quest.exp}${bonus}`;
}

/** Why a delivery failed, for the player. */
export function failureText(quest: QuestDef | undefined, reason: string): string {
  switch (reason) {
    case "SPEED": return `车速超过了 ${quest?.maxKmh ?? ""} km/h，${quest?.item ?? "货物"}受损了。`;
    case "COLLISION": return `碰撞超过了 ${quest?.maxCollisions ?? ""} 次，${quest?.item ?? "货物"}摔坏了。`;
    case "TIMEOUT": return `没能在规定时间内送到，${quest?.item ?? "货物"}送晚了。`;
    case "TELEPORT": return `离开了送货路线（传送或拖车），${quest?.item ?? "货物"}没能跟着过去。`;
    default: return "送货任务失败了。";
  }
}

/** Rows of the 任务成功 window: time, distance, what was earned (CityQuestDone fields). */
export function successResult(quest: QuestDef, done: { elapsedMs: number; collisions: number; exp: number;
  lucci: number; capped: boolean; walletLucci: number; level: number;
  levelUps: ReadonlyArray<{ level: number; lucci: number; koin: number; coupon: number }> }) {
  const kind = QUEST_RULES.kinds[quest.kind];
  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: "送达", value: QUEST_NPCS[quest.receiver]?.name ?? "" },
    { label: "用时", value: formatDuration(done.elapsedMs) },
    { label: "路程", value: `约 ${(quest.distanceM / 1000).toFixed(1)} km` },
  ];
  if (quest.kind === "collision") rows.push({ label: "碰撞", value: `${done.collisions} / ${quest.maxCollisions} 次` });
  if (kind.multiplier > 1) rows.push({ label: "报酬倍率", value: `${kind.label} ×${kind.multiplier}` });
  rows.push({ label: "获得金币", value: `+${done.lucci}`, color: "rgb(214, 120, 0)" },
    { label: "获得经验", value: `+${done.exp}`, color: "rgb(30, 110, 210)" });
  for (const up of done.levelUps) {
    const extra = [up.lucci ? `金币 ${up.lucci}` : "", up.koin ? `K币 ${up.koin}` : "", up.coupon ? `点券 ${up.coupon}` : ""]
      .filter(Boolean).join("、");
    rows.push({ label: `升到 ${up.level} 级`, value: extra ? `奖励 ${extra}` : "恭喜升级！", color: "rgb(214, 120, 0)" });
  }
  rows.push({ label: "现有金币", value: `${done.walletLucci}` });
  return { success: true, heading: `「${quest.title}」完成！`, rows,
    note: done.capped ? "今天的送货报酬已经领满了，这次没有金币和经验。明天 0 点后再来吧。" : undefined };
}

const REASONS: Record<string, string> = { SPEED: "超速", COLLISION: "碰撞过多", TIMEOUT: "超时", TELEPORT: "离开了送货路线" };

/** Rows of the 任务失败 window. */
export function failureResult(quest: QuestDef | undefined, reason: string, collisions: number) {
  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: "失败原因", value: REASONS[reason] ?? "任务失败", color: "rgb(206, 40, 40)" },
  ];
  if (quest?.kind === "speed") rows.push({ label: "限速", value: `${quest.maxKmh} km/h` });
  if (quest?.kind === "collision") rows.push({ label: "碰撞", value: `${collisions} / ${quest.maxCollisions} 次` });
  if (quest?.kind === "time") rows.push({ label: "时限", value: formatDuration(quest.timeLimitMs ?? 0) });
  rows.push({ label: "报酬", value: "无" });
  const giver = quest ? shortName(QUEST_NPCS[quest.giver]) : "委托人";
  return { success: false, heading: quest ? `「${quest.title}」失败` : "送货失败", rows,
    note: `${failureText(quest, reason)}可以回到${giver}那里重新接这个任务。` };
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
 * The dialogue before a delivery: the NPC's story (the first talk of a
 * visit), then the request; the player's lines show its own rider when the
 * story mode has a sprite for it.
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

/** The receiver's thanks after a delivery. */
export function thanksPages(quest: QuestDef): StoryScenePage[] {
  const npc = QUEST_NPCS[quest.receiver]!;
  return [{ background: npc.background, characters: [{ id: npc.sprite, x: 7.5, flip: false, emotion: "normal" }],
    speaker: shortName(npc), text: quest.thanks }];
}

const DIRECTIONS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

/** Compass word from (x, z) towards (tx, tz) in design coordinates (x east, z south). */
export function compass(x: number, z: number, tx: number, tz: number): string {
  const degrees = (Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI;
  return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
}
