/**
 * OB 观看 (TIMEATTACK.md): watching a ranked record's replay through the
 * release replay stage. The viewer itself is replay-session.ts; this module
 * downloads the record and starts the viewer from the ranking window.
 */
import { activeBrowserSession } from "../account/account-runtime";
import type { RankingSettings } from "../ui/ranking-ready-window";
import type { ReadyHomeController } from "./ready-home";
import type { RankingTrack } from "./ready-ranking";
import { fetchTimeAttackReplay, type RankingRow } from "./timeattack-api";
import { startReplaySession } from "./replay-session";

export interface RankedReplayRequest {
  track: RankingTrack;
  settings: RankingSettings;
  row: RankingRow;
  /** Reopens the window the viewer was started from. */
  resume(): Promise<void> | void;
  /** Closes that window before the viewer takes the screen. */
  close(): void;
}

/** Download a ranked record's .ksv and play it in the replay stage. */
export async function openRankedReplay(controller: ReadyHomeController, request: RankedReplayRequest): Promise<void> {
  const session = activeBrowserSession();
  if (!session) throw new Error("请先登录后再观看录像。");
  const bytes = await fetchTimeAttackReplay(session, request.track.id, request.settings.speed, request.settings.booster,
    request.row.accountId);
  request.close();
  await startReplaySession(controller, {
    trackId: request.track.id, trackPath: request.track.path, trackTitle: request.track.title,
    ksv: bytes, riderName: request.row.nickname, kartName: request.row.kartName, recordMs: request.row.bestMs,
    speed: request.settings.speed, booster: request.settings.booster,
    onReturn: () => { void request.resume(); },
  });
}
