/**
 * 排位计时赛 (TIMEATTACK.md): a ranked run rides on the solo race selection
 * like a story race does. The result screen settles it as mode "ranked"
 * with the paid entry's requestId and the run's .ksv recording, and leaving
 * the race hands the outcome back to the ranking window.
 */
import { ksvCompression } from "../codecs/ksv-compression";
import { encodeKsvFile, type KsvRecording } from "../game/ghost/ksv-codec";
import type { StoryRaceOutcome } from "../story/story-race";
import { buildGhostKsvHeader } from "./ghost-ksv-export";

export interface RankedRaceRequest {
  /** The paid entry (POST /api/timeattack/ranked/enter requestId). */
  requestId: string;
  speed: number;
  booster: number;
  /** Put the player's Ready options back. */
  restore(): void;
  /** Runs once Ready has been rebuilt after the race. */
  onReturn(outcome: StoryRaceOutcome, settlement?: RankedSettlement): void;
  /** Set by the result screen: the settle in flight (its answer carries the rank). */
  settlement?: Promise<RankedSettlement | undefined>;
}

export interface RankedSettlement {
  modeBestMs: number;
  modeNewRecord: boolean;
  rank: number;
  topTen: boolean;
}

export function rankedRaceOf(selection: unknown): RankedRaceRequest | undefined {
  if (!selection || typeof selection !== "object") return undefined;
  const ranked = (selection as { ranked?: unknown }).ranked;
  return ranked && typeof ranked === "object" ? ranked as RankedRaceRequest : undefined;
}

/** The z ceiling of a track's ghost stamps (the release's B6). */
export function ghostZCeiling(trackId: string): number {
  return trackId.toLowerCase() === "transformer_r02" ? 3000 : 1500;
}

/** The speed channel a record is keyed by (the release's Ue). */
export function recordSpeedChannel(options: { speed: number; version?: string; settingSpeed?: number }): number {
  const version = options.version ?? "国服";
  const setting = options.settingSpeed ?? 7;
  return version === "国服" && setting === 7 ? options.speed : setting;
}

/**
 * Encode a finished run's recorder output as a v12 .ksv file, the form the
 * ranking keeps and the replay viewer reads (the ghost export's format).
 */
export function encodeRunReplay(recorded: { record: { stamps: unknown[] } },
  equipment: Record<string, unknown> & { playerName?: string }, trackId: string, elapsedMs: number,
  speed: number): Uint8Array {
  const header = buildGhostKsvHeader({ frames: [], metadata: { equipment, trackId,
    summary: { elapsedMs }, speed } }, recorded.record);
  return encodeKsvFile(header as unknown as KsvRecording, ghostZCeiling(trackId), ksvCompression);
}

/** base64 of a replay for the settle body. */
export function replayBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
