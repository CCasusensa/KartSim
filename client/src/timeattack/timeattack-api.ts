/**
 * The data service's 练习计时赛 / 排位计时赛 endpoints (server-go/TIMEATTACK.md):
 * a track's 赛道排名 with the viewer's records (GET /api/timeattack/ranking),
 * the ranked entry fee (POST /api/timeattack/ranked/enter), a ranked record's
 * replay (GET /api/timeattack/replay), the training goals and the active
 * 赛道对决 (GET /api/timeattack/missions), a goal reward
 * (POST /api/timeattack/goals/claim) and a duel race
 * (POST /api/timeattack/duel/settle). Responses are validated here; failures
 * are AccountServiceErrors, worded by timeAttackErrorMessage.
 */
import { AccountServiceError, errorCode, parseAccountSummary } from "../account/account-api";
import type { AccountSummary } from "../account/account-session";
import { accountErrorMessages, formatAccountServiceError } from "../multiplayer/account-ui-support";

export interface TimeAttackSession {
  requestJson(path: string, init?: RequestInit): Promise<unknown>;
  applySummary?(summary: AccountSummary): void;
  /** A raw authorized request (the replay bytes). */
  authorizedFetch?(path: string, init?: RequestInit): Promise<Response>;
}

/** The fee of one ranked run (the service tells the current one). */
export const RANKED_ENTRY_LUCCI = 500;

export interface TimeAttackKart { itemId: number; systemKey?: string; name: string }

export interface TimeAttackRecord {
  bestMs: number;
  kart: TimeAttackKart;
  crashCount: number;
  boosterCount: number;
  updatedAt: number;
}

export interface RankingRow {
  rank: number;
  accountId: string;
  nickname: string;
  kartName: string;
  bestMs: number;
  updatedAt: number;
  hasReplay: boolean;
  self: boolean;
}

export interface TimeAttackRanking {
  trackId: string;
  speed: number;
  booster: number;
  rows: RankingRow[];
  ranked?: TimeAttackRecord;
  practice?: TimeAttackRecord;
  myRank: number;
  fee: number;
}

export interface MissionReward {
  type: "stock" | "lucci" | "rp" | "emblem";
  value: number;
  name: string;
  category?: number;
  itemId?: number;
  count?: number;
  days?: number;
}

export interface GoalStage {
  stage: number;
  count: number;
  requirement: number;
  value: number;
  cleared: boolean;
  claimed: boolean;
  rewards: MissionReward[];
}

export type GoalType = "finish" | "booster" | "crash" | "record";

export interface GoalSet {
  index: number;
  title: string;
  type: GoalType;
  hidden: boolean;
  /** The stage the card shows: the first unclaimed, or the last. */
  current: number;
  stages: GoalStage[];
}

export interface DuelNpc { name: string; characterId: number; kartId: number; color: number; dye: number }

export interface DuelDifficulty { point: number; advantageMs: number }

export interface DuelStage {
  stage: number;
  speed: number;
  teamBooster: boolean;
  npc: DuelNpc;
  messages: { difficulty: string[]; win: string[] };
  difficulties: DuelDifficulty[];
  /** The NPC's time (its 最高纪录); the player must finish under it plus the level's advantage. */
  targetMs: number;
  rewards: MissionReward[];
}

export interface DuelStanding {
  stage: number;
  open: boolean;
  won: boolean;
  losses: number;
  /** The highest 难度设定 level available (0 无 … 3). */
  difficulty: number;
  bonus: boolean[];
}

export interface DuelEvent {
  key: string;
  trackId: string;
  track: string;
  from: number;
  to: number;
  stages: DuelStage[];
  standing: DuelStanding[];
}

export interface TimeAttackMissions {
  trackId: string;
  goals: GoalSet[];
  duel?: DuelEvent;
  recordGoalMs: number;
}

export interface DuelResult {
  won: boolean;
  targetMs: number;
  firstWin: boolean;
  /** The difficulty level's special reward, filed this time. */
  bonus?: { type: string; value: number };
  losses: number;
  difficulty: number;
  duel?: DuelEvent;
  summary?: AccountSummary;
}

const ERROR_MESSAGES: Record<string, string> = {
  ...accountErrorMessages,
  INVALID_TRACK: "该赛道没有计时赛记录。",
  INVALID_SPEED_MODE: "速度或加速模式无效。",
  INSUFFICIENT_FUNDS: "金币不足，无法进行排位计时赛。",
  NO_RANKED_ENTRY: "本局没有排位入场记录，成绩不计入排名。",
  INVALID_REPLAY: "录像无效，未能上传。",
  REPLAY_NOT_FOUND: "该纪录没有可观看的录像。",
  GOAL_NOT_CLEARED: "练习目标尚未完成。",
  GOAL_CLAIMED: "该奖励已经领取过了。",
  INVALID_GOAL: "练习目标无效。",
  DUEL_NOT_ACTIVE: "赛道对决期间已结束。",
  INVALID_DUEL: "赛道对决无效。",
  DUEL_STAGE_LOCKED: "在上一阶段胜利时开放。",
  TOO_MANY_ATTEMPTS: "操作过于频繁，请稍后再试。",
};

export function timeAttackErrorMessage(error: unknown): string {
  return formatAccountServiceError(error, ERROR_MESSAGES);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountServiceError("INVALID_RESPONSE", 0, `${what}：数据服务回应格式不正确。`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function textOr(value: unknown, fallback: string): string { return text(value, fallback); }

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseKart(value: unknown): TimeAttackKart {
  const kart = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { itemId: integer(kart.itemId), name: text(kart.name),
    ...(typeof kart.systemKey === "string" && kart.systemKey ? { systemKey: kart.systemKey } : {}) };
}

export function parseTimeAttackRecord(value: unknown): TimeAttackRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return { bestMs: integer(raw.bestMs), kart: parseKart(raw.kart), crashCount: integer(raw.crashCount),
    boosterCount: integer(raw.boosterCount), updatedAt: integer(raw.updatedAt) };
}

export function parseTimeAttackRanking(value: unknown): TimeAttackRanking {
  const body = record(value, "赛道排名");
  return {
    trackId: text(body.trackId), speed: integer(body.speed, 7), booster: integer(body.booster),
    rows: list(body.rows).map((row, index) => {
      const raw = record(row, "赛道排名");
      return { rank: integer(raw.rank, index + 1), accountId: text(raw.accountId), nickname: text(raw.nickname),
        kartName: text(raw.kartName), bestMs: integer(raw.bestMs), updatedAt: integer(raw.updatedAt),
        hasReplay: raw.hasReplay === true, self: raw.self === true };
    }),
    ranked: parseTimeAttackRecord(body.ranked),
    practice: parseTimeAttackRecord(body.practice),
    myRank: integer(body.myRank),
    fee: integer(body.fee, RANKED_ENTRY_LUCCI),
  };
}

function parseRewards(value: unknown): MissionReward[] {
  return list(value).map(entry => {
    const raw = record(entry, "奖励");
    const type = text(raw.type) as MissionReward["type"];
    return { type: (["stock", "lucci", "rp", "emblem"] as const).includes(type) ? type : "stock",
      value: integer(raw.value), name: text(raw.name), category: integer(raw.category), itemId: integer(raw.itemId),
      count: integer(raw.count, 1), days: integer(raw.days) };
  });
}

function parseDuel(value: unknown): DuelEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    key: text(raw.key), trackId: text(raw.trackId), track: text(raw.track), from: integer(raw.from), to: integer(raw.to),
    stages: list(raw.stages).map((entry, index) => {
      const stage = record(entry, "赛道对决");
      const npc = record(stage.npc ?? {}, "赛道对决");
      const messages = stage.messages && typeof stage.messages === "object" ? stage.messages as Record<string, unknown> : {};
      return {
        stage: integer(stage.stage, index + 1), speed: integer(stage.speed, 7), teamBooster: stage.teamBooster === true,
        npc: { name: text(npc.name), characterId: integer(npc.characterId), kartId: integer(npc.kartId),
          color: integer(npc.color), dye: integer(npc.dye) },
        messages: { difficulty: list(messages.difficulty).map(line => text(line)),
          win: list(messages.win).map(line => text(line)) },
        difficulties: list(stage.difficulties).map(level => {
          const item = record(level, "赛道对决");
          return { point: integer(item.point), advantageMs: integer(item.advantageMs) };
        }),
        targetMs: integer(stage.targetMs), rewards: parseRewards(stage.rewards),
      };
    }),
    standing: list(raw.standing).map((entry, index) => {
      const standing = record(entry, "赛道对决");
      return { stage: integer(standing.stage, index + 1), open: standing.open === true, won: standing.won === true,
        losses: integer(standing.losses), difficulty: integer(standing.difficulty),
        bonus: list(standing.bonus).map(flag => flag === true) };
    }),
  };
}

export function parseGoals(value: unknown): GoalSet[] {
  return list(value).map((entry, index) => {
    const raw = record(entry, "练习目标");
    const type = text(raw.type) as GoalType;
    return {
      index: integer(raw.index, index), title: text(raw.title),
      type: (["finish", "booster", "crash", "record"] as const).includes(type) ? type : "finish",
      hidden: raw.hidden === true, current: integer(raw.current, 1),
      stages: list(raw.stages).map((stageEntry, stageIndex) => {
        const stage = record(stageEntry, "练习目标");
        return { stage: integer(stage.stage, stageIndex + 1), count: integer(stage.count, 1),
          requirement: integer(stage.requirement), value: integer(stage.value), cleared: stage.cleared === true,
          claimed: stage.claimed === true, rewards: parseRewards(stage.rewards) };
      }),
    };
  });
}

export function parseTimeAttackMissions(value: unknown): TimeAttackMissions {
  const body = record(value, "练习目标");
  return { trackId: text(body.trackId), goals: parseGoals(body.goals), duel: parseDuel(body.duel),
    recordGoalMs: integer(body.recordGoalMs) };
}

function summaryOf(session: TimeAttackSession, body: Record<string, unknown>): AccountSummary | undefined {
  const value = body.summary;
  if (!value || typeof value !== "object") return undefined;
  try {
    const summary = parseAccountSummary(value);
    session.applySummary?.(summary);
    return summary;
  } catch {
    return undefined;
  }
}

export async function fetchTimeAttackRanking(session: TimeAttackSession, trackId: string, speed: number,
  booster: number): Promise<TimeAttackRanking> {
  const query = new URLSearchParams({ trackId, speed: String(speed), booster: String(booster) });
  return parseTimeAttackRanking(await session.requestJson(`/api/timeattack/ranking?${query}`));
}

/** Charges the ranked entry fee; the same requestId is charged once. */
export async function enterRankedTimeAttack(session: TimeAttackSession, entry: { requestId: string; trackId: string;
  speed: number; booster: number }): Promise<{ fee: number; summary?: AccountSummary }> {
  const body = record(await session.requestJson("/api/timeattack/ranked/enter",
    { method: "POST", body: JSON.stringify(entry) }), "排位入场");
  return { fee: integer(body.fee, RANKED_ENTRY_LUCCI), summary: summaryOf(session, body) };
}

/** A ranked record's replay, a .ksv file. */
export async function fetchTimeAttackReplay(session: TimeAttackSession, trackId: string, speed: number,
  booster: number, accountId: string): Promise<Uint8Array> {
  const query = new URLSearchParams({ trackId, speed: String(speed), booster: String(booster), accountId });
  return authorizedBytes(session, `/api/timeattack/replay?${query}`);
}

/** 联赛回放 (TIMEATTACK.md 4): an admin-published replay. */
export interface FeaturedReplay {
  id: number;
  title: string;
  note: string;
  trackId: string;
  trackName: string;
  speed: number;
  booster: number;
  accountId: string;
  nickname: string;
  kartName: string;
  bestMs: number;
  createdBy: string;
  createdAt: number;
}

export function parseFeaturedReplays(value: unknown): FeaturedReplay[] {
  const body = record(value, "联赛回放");
  const rows = Array.isArray(body.replays) ? body.replays : [];
  return rows.map((raw, index) => {
    const row = record(raw, `联赛回放 ${index + 1}`);
    return { id: integer(row.id), title: text(row.title), note: text(row.note), trackId: text(row.trackId),
      trackName: text(row.trackName), speed: integer(row.speed, 7), booster: integer(row.booster),
      accountId: text(row.accountId), nickname: text(row.nickname), kartName: text(row.kartName),
      bestMs: integer(row.bestMs), createdBy: text(row.createdBy), createdAt: integer(row.createdAt) };
  }).filter(row => row.id > 0);
}

/** The published replays, newest first. */
export async function fetchFeaturedReplays(session: TimeAttackSession): Promise<FeaturedReplay[]> {
  return parseFeaturedReplays(await session.requestJson("/api/timeattack/featured"));
}

/** A published replay's .ksv file. */
export async function fetchFeaturedReplayFile(session: TimeAttackSession, id: number): Promise<Uint8Array> {
  return authorizedBytes(session, `/api/timeattack/featured/replay?${new URLSearchParams({ id: String(id) })}`);
}

async function authorizedBytes(session: TimeAttackSession, path: string): Promise<Uint8Array> {
  if (!session.authorizedFetch) throw new AccountServiceError("LOGIN_REQUIRED");
  const response = await session.authorizedFetch(path);
  if (!response.ok) {
    let code = "INVALID_RESPONSE";
    try { code = textOr((await response.json() as { error?: unknown }).error, code); } catch { /* not JSON */ }
    throw new AccountServiceError(code, response.status);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchTimeAttackMissions(session: TimeAttackSession, trackId: string): Promise<TimeAttackMissions> {
  const query = new URLSearchParams({ trackId });
  return parseTimeAttackMissions(await session.requestJson(`/api/timeattack/missions?${query}`));
}

export async function claimTimeAttackGoal(session: TimeAttackSession, claim: { requestId: string; trackId: string;
  set: number; stage: number }): Promise<{ goals: GoalSet[]; summary?: AccountSummary }> {
  const body = record(await session.requestJson("/api/timeattack/goals/claim",
    { method: "POST", body: JSON.stringify(claim) }), "练习目标");
  return { goals: parseGoals(body.goals), summary: summaryOf(session, body) };
}

export async function settleDuelRace(session: TimeAttackSession, run: { requestId: string; key: string; stage: number;
  difficulty: number; elapsedMs: number; finished: boolean }): Promise<DuelResult> {
  const body = record(await session.requestJson("/api/timeattack/duel/settle",
    { method: "POST", body: JSON.stringify({ ...run, elapsedMs: Math.round(run.elapsedMs) }) }), "赛道对决");
  const result = record(body.result ?? {}, "赛道对决");
  const bonus = result.bonus && typeof result.bonus === "object" ? result.bonus as Record<string, unknown> : undefined;
  return {
    won: body.won === true, targetMs: integer(body.targetMs), firstWin: result.firstWin === true,
    ...(bonus ? { bonus: { type: text(bonus.type), value: integer(bonus.value) } } : {}),
    losses: integer(result.losses), difficulty: integer(result.difficulty),
    duel: parseDuel(body.duel), summary: summaryOf(session, body),
  };
}

/** "01:58:04" — minutes, seconds and centiseconds, as the windows show times. */
export function formatRecordTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return "??'??'??".replaceAll("'", ":");
  const pad = (value: number) => Math.floor(value).toString().padStart(2, "0");
  return `${pad(ms / 60_000)}:${pad((ms / 1_000) % 60)}:${pad((ms / 10) % 100)}`;
}

/** Whether an error only means the service is unreachable (retry later). */
export function isServiceUnavailable(error: unknown): boolean {
  return errorCode(error) === "DATA_SERVICE_UNAVAILABLE";
}
