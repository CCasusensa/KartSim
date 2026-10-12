/**
 * Race rewards (ECONOMY.md 2, 7.7): multiplayer `race.rewards` from the game
 * node and the time attack settlement on the data service.
 */
import { parseAccountSummary } from "./account-api";
import type { AccountSummary } from "./account-session";

/** Coupon and koin are the admin-set per-race grant of a finisher (ECONOMY.md 2.4). */
export interface RaceReward { exp: number; lucci: number; coupon?: number; koin?: number }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= 1_000_000_000 ? value : undefined;
}

/** `race.rewards` ({playerId: {exp, lucci, coupon?, koin?}}); malformed entries are skipped. */
export function parseRaceRewards(value: unknown): Map<string, RaceReward> {
  const rewards = new Map<string, RaceReward>();
  if (!record(value)) return rewards;
  for (const [playerId, entry] of Object.entries(value)) {
    if (!record(entry)) continue;
    const exp = amount(entry.exp);
    const lucci = amount(entry.lucci);
    const coupon = entry.coupon === undefined ? 0 : amount(entry.coupon);
    const koin = entry.koin === undefined ? 0 : amount(entry.koin);
    if (exp === undefined || lucci === undefined || coupon === undefined || koin === undefined) continue;
    rewards.set(playerId, { exp, lucci, ...(coupon ? { coupon } : {}), ...(koin ? { koin } : {}) });
  }
  return rewards;
}

/** "+85经验 +120金币" for a result row. */
export function formatRaceReward(reward: RaceReward): string {
  return formatRaceRewardLines(reward).join(" ");
}

/** ["+85经验", "+120金币 +100点券"]: the reward on two lines; the per-race grant joins the second. */
export function formatRaceRewardLines(reward: RaceReward): [string, string] {
  const money = [`+${reward.lucci}金币`];
  if (reward.coupon) money.push(`+${reward.coupon}点券`);
  if (reward.koin) money.push(`+${reward.koin}K币`);
  return [`+${reward.exp}经验`, money.join(" ")];
}

export interface TimeAttackSettlement {
  exp: number;
  lucci: number;
  newRecord: boolean;
  /** The daily reward limit was reached; nothing (or less) was credited. */
  capped: boolean;
  summary?: AccountSummary;
  /** TIMEATTACK.md: the mode's record (practice or ranked by track, speed and booster). */
  modeBestMs?: number;
  modeNewRecord?: boolean;
  /** A ranked run's rank once settled, and whether it is in the top ten. */
  rank?: number;
  topTen?: boolean;
}

/** TIMEATTACK.md: what a practice or ranked run reports besides its time. */
export interface TimeAttackRunDetails {
  mode: "practice" | "ranked";
  speed: number;
  booster: number;
  kart: { itemId: number; systemKey?: string; name: string };
  crashCount: number;
  boosterCount: number;
  /** A ranked run's .ksv recording, base64. */
  replay?: string;
}

export interface SettleSession {
  requestJson(path: string, init?: RequestInit): Promise<unknown>;
  applySummary?(summary: AccountSummary): void;
}

export function newRequestId(random: () => string = () => crypto.randomUUID()): string {
  try {
    return random();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function settlementSummary(body: Record<string, unknown>): AccountSummary | undefined {
  for (const key of ["account", "summary"]) {
    const value = body[key];
    if (record(value) && record(value.progress) && record(value.wallet)) {
      try { return parseAccountSummary(value); } catch { return undefined; }
    }
  }
  return undefined;
}

/** `POST /api/timeattack/settle`; the returned account summary is applied to the session. */
export async function settleTimeAttack(session: SettleSession,
  run: { trackId: string; elapsedMs: number; requestId?: string; details?: TimeAttackRunDetails }):
  Promise<TimeAttackSettlement> {
  const body = await session.requestJson("/api/timeattack/settle", {
    method: "POST",
    body: JSON.stringify({ trackId: run.trackId, elapsedMs: Math.round(run.elapsedMs),
      requestId: run.requestId ?? newRequestId(), ...(run.details ?? {}) }),
  });
  const value = record(body) ? body : {};
  const summary = settlementSummary(value);
  if (summary) session.applySummary?.(summary);
  return {
    exp: amount(value.exp) ?? 0,
    lucci: amount(value.lucci) ?? 0,
    newRecord: value.newRecord === true,
    capped: value.capped === true,
    ...(summary ? { summary } : {}),
    ...(run.details ? {
      modeBestMs: amount(value.modeBestMs) ?? 0,
      modeNewRecord: value.modeNewRecord === true,
      rank: amount(value.rank) ?? 0,
      topTen: value.topTen === true,
    } : {}),
  };
}
