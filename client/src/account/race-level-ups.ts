/**
 * 升级: the racers whose race exp reached a new level, for the award stand's
 * level-up effect (GET /api/races/{raceId}/level-ups). The game node sends
 * its settlement when the race ends, seconds before the stand opens, so it
 * is usually stored already; until it is, the stand asks again every second
 * for a few seconds.
 */

export interface RaceLevelUp { playerId: string; level: number }

export interface RaceLevelUpSession {
  requestJson(path: string, init?: RequestInit): Promise<unknown>;
}

export const RACE_LEVEL_UP_ATTEMPTS = 6;
export const RACE_LEVEL_UP_RETRY_MS = 1_000;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The answer's `stored` flag and level-ups; malformed entries are skipped. */
export function parseRaceLevelUps(value: unknown): { stored: boolean; levelUps: RaceLevelUp[] } {
  if (!record(value)) return { stored: false, levelUps: [] };
  const levelUps = (Array.isArray(value.levelUps) ? value.levelUps : []).flatMap(entry =>
    record(entry) && typeof entry.playerId === "string" && Number.isInteger(entry.level)
      ? [{ playerId: entry.playerId, level: entry.level as number }] : []);
  return { stored: value.stored === true, levelUps };
}

/** The race's level-ups once the data service has stored it; none when it never does. */
export async function fetchRaceLevelUps(session: RaceLevelUpSession, raceId: string,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = RACE_LEVEL_UP_ATTEMPTS): Promise<RaceLevelUp[]> {
  const path = `/api/races/${encodeURIComponent(raceId)}/level-ups`;
  for (let attempt = 1; ; attempt++) {
    try {
      const answer = parseRaceLevelUps(await session.requestJson(path));
      if (answer.stored) return answer.levelUps;
    } catch {
      // Network trouble: ask again like an unsettled race.
    }
    if (attempt >= attempts) return [];
    await wait(RACE_LEVEL_UP_RETRY_MS);
  }
}
