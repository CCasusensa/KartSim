/**
 * 50人乱斗 (server-go/BRAWL.md) identity shared by the lobby, the room
 * validator, the generated mode tables and race start: an individual speed
 * race on speedIndiCombine with up to 50 seats, whose open seats the game
 * node fills with AI racers when it starts. The release knows rooms of
 * eight; everything that counts seats asks here.
 */

import { BRAWL_TRACK_IDS } from "./brawl-tracks";

export const BRAWL_GAMEPLAY = "brawl";
/** Seats, start places and racers of a 50人乱斗 race. */
export const BRAWL_SLOTS = 50;
/** Seats of every other room (the release). */
export const RELEASE_SLOTS = 8;
/**
 * Game type of a 50人乱斗 race in the generated mode tables (SX → vI): not an
 * original one; its driving mode kind "brawl" drives like an ordinary race.
 */
export const BRAWL_GAME_TYPE = 101;
/** Frozen per-race rules the game node appends as `race.brawl`. */
export const BRAWL_RULESET = "web-brawl-v1";

export function isBrawl(gameplay: unknown): boolean {
  return gameplay === BRAWL_GAMEPLAY;
}

/** The most seats a room of this gameplay has. */
export function roomSlotCount(gameplay: unknown): number {
  return isBrawl(gameplay) ? BRAWL_SLOTS : RELEASE_SLOTS;
}

const brawlTracks = new Set(BRAWL_TRACK_IDS);

/** A track the game node's AI racers can drive. */
export function isBrawlTrack(trackId: unknown): boolean {
  return typeof trackId === "string" && brawlTracks.has(trackId);
}

export interface BrawlRaceRules { ruleset: typeof BRAWL_RULESET; aiIds: string[] }

/**
 * A valid `race.brawl`: the ruleset and the AI racers, which are exactly the
 * roster entries marked `ai`.
 */
export function isBrawlRaceRules(value: unknown, roster: readonly unknown[]): value is BrawlRaceRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rules = value as Record<string, unknown>;
  if (rules.ruleset !== BRAWL_RULESET || !Array.isArray(rules.aiIds)) return false;
  const ai = roster.filter(entry => !!entry && typeof entry === "object" &&
    (entry as Record<string, unknown>).ai === true)
    .map(entry => (entry as Record<string, unknown>).playerId);
  return rules.aiIds.length === ai.length && new Set(rules.aiIds).size === ai.length &&
    rules.aiIds.every(id => ai.includes(id));
}

/** The AI racers of a race snapshot (none outside 50人乱斗). */
export function brawlAiIds(race: unknown): ReadonlySet<string> {
  const rules = race && typeof race === "object" ? (race as { brawl?: unknown }).brawl : undefined;
  const ids = rules && typeof rules === "object" ? (rules as { aiIds?: unknown }).aiIds : undefined;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/** Room title / mode label. */
export const BRAWL_LABEL = "50人乱斗";

/**
 * The level start heading the 50人乱斗 grid rows line up behind
 * (race-start-slots.ts raceStartPosition), as the game node's track export
 * computes it from the start frame.
 */
export function brawlGridForward(forward: { x: number; y: number; z: number }):
  { x: number; y: number; z: number } {
  const size = Math.hypot(forward.x, forward.z);
  return size > 1e-6 ? { x: forward.x / size, y: 0, z: forward.z / size } : { x: 0, y: 0, z: 1 };
}
