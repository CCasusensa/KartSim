/**
 * 我的回放 (TIMEATTACK.md 4): the 回放 tab of the 单人游戏 page lists this
 * browser's Ghost records (the replay library's summaries with a Ghost) as
 * release replayCard rows; a card plays the record through the OB viewer
 * (replay-session.ts), its 删除 button removes the record. 联赛回放 and
 * 其他回放 are not built.
 */
import type { ReplayLibraryBridge } from "../app/host-bridges";
import { makeGhostRecordKey, trackIdFromGhostKey } from "../game/ghost-records";
import { openMessengerMessage } from "../ui/messenger-dialogs";
import type { ReplayMenuEntry } from "../ui/main-menu-view";
import type { ReadyTrack } from "./ready-flow";
import { openReadyHome, type ReadyHomeController } from "./ready-home";
import { startReplaySession } from "./replay-session";
import { formatRecordTime } from "./timeattack-api";

const TITLE = "我的回放";
/** Browser storage of when each record was made (the summaries carry no date). */
const DATES_KEY = "kartsim:replay-dates";

export interface ReadyReplayController extends ReadyHomeController {
  replayBusy?: boolean;
}

interface ReplayLibraryHost {
  trackMetadata(trackId: string): Promise<{ cnTitle?: string } | undefined>;
  timeAttackTrackCatalog(): Promise<ReadyTrack[]>;
}

/** A record summary as the replay library keeps it (record-service promote). */
export interface ReplaySummary {
  hasGhost?: boolean;
  elapsedMs?: number;
  kartName?: string;
  speed?: number;
  booster?: number;
}

function replayLibrary(controller: ReadyHomeController): ReplayLibraryBridge | undefined {
  return (controller.host as { replayLibrary?: ReplayLibraryBridge }).replayLibrary;
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readDates(): Record<string, number> {
  try {
    const raw = storage()?.getItem(DATES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

/** A run was just promoted to a record: remember when. */
export function noteReplayRecorded(key: string, now = Date.now()): void {
  const dates = readDates();
  dates[key] = now;
  try { storage()?.setItem(DATES_KEY, JSON.stringify(dates)); } catch { /* storage unavailable */ }
}

export function forgetReplayDate(key: string): void {
  const dates = readDates();
  if (!(key in dates)) return;
  delete dates[key];
  try { storage()?.setItem(DATES_KEY, JSON.stringify(dates)); } catch { /* storage unavailable */ }
}

/** The key of a finished run's record (the library's recordKey over the Ready options). */
export function runRecordKey(trackId: string, options: { speed: number; booster: number; version?: string;
  settingSpeed?: number }): string {
  const version = options.version ?? "国服";
  const speed = version === "国服" && (options.settingSpeed ?? 7) === 7 ? options.speed : options.settingSpeed ?? options.speed;
  return makeGhostRecordKey(trackId, speed, options.booster, version);
}

/** "标准速度 / 个人赛", as the 排位计时赛 window words its settings. */
export function replaySettingsLabel(summary: ReplaySummary, key: string): string {
  const retro = key.split("\0")[3] === "retro";
  const speed = summary.speed ?? Number(key.split("\0")[1] ?? 7);
  const booster = summary.booster ?? Number(key.split("\0")[2] ?? 0);
  const speedText = retro ? `复古 S${speed}` : speed === 7 ? "标准速度" : speed === 4 ? "无限" : `S${speed}`;
  return `${speedText} / ${booster ? "组队赛" : "个人赛"}`;
}

/** "2026-10-12 18:05" in Beijing time. */
export function replayDateText(ms: number | undefined): string {
  if (!ms) return "—";
  const date = new Date(ms + 8 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())} ${
    two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

/** The cards: records with a Ghost, newest first. */
export function replayEntries(records: Iterable<[string, ReplaySummary]>, riderName: string,
  trackTitle: (trackId: string) => string | undefined,
  recordedAt: (key: string) => number | undefined = key => readDates()[key]): ReplayMenuEntry[] {
  const entries: ReplayMenuEntry[] = [];
  for (const [key, summary] of records) {
    if (!summary?.hasGhost) continue;
    const trackId = trackIdFromGhostKey(key);
    const title = trackTitle(trackId) ?? trackId;
    const at = recordedAt(key);
    entries.push({
      key, trackId, trackTitle: title, riderName, kartName: summary.kartName ?? "",
      elapsedMs: summary.elapsedMs ?? 0, recordedAt: at,
      title: `${title}　${formatRecordTime(summary.elapsedMs)}`,
      settings: replaySettingsLabel(summary, key), dateText: replayDateText(at),
    });
  }
  return entries.sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0) || a.key.localeCompare(b.key));
}

/** The 回放 tab's cards for this browser's records. */
export async function loadReplayMenu(controller: ReadyHomeController, riderName: string): Promise<ReplayMenuEntry[]> {
  const library = replayLibrary(controller);
  const lib = controller.host.getLibrary() as unknown as ReplayLibraryHost | undefined;
  if (!library) return [];
  // Record keys carry the track id in lower case; the catalog and metadata use its own.
  const tracks = lib ? await lib.timeAttackTrackCatalog().catch(() => [] as ReadyTrack[]) : [];
  const titles = new Map<string, string | undefined>();
  const records = [...library.records.entries()] as Array<[string, ReplaySummary]>;
  await Promise.all(records.filter(([, summary]) => summary?.hasGhost).map(async ([key]) => {
    const trackId = trackIdFromGhostKey(key);
    if (titles.has(trackId) || !lib) return;
    titles.set(trackId, undefined);
    const cased = tracks.find(track => track.id.toLowerCase() === trackId)?.id ?? trackId;
    titles.set(trackId, (await lib.trackMetadata(cased).catch(() => undefined))?.cnTitle);
  }));
  return replayEntries(records, riderName, trackId => titles.get(trackId));
}

/** Play a local record in the OB viewer; the 回放 tab reopens when it ends. */
export async function openLocalReplay(controller: ReadyReplayController, entry: ReplayMenuEntry): Promise<void> {
  const library = replayLibrary(controller);
  const lib = controller.host.getLibrary() as unknown as ReplayLibraryHost | undefined;
  if (!library || !lib) throw new Error("缺少资源库。");
  if (controller.replayBusy) return;
  controller.replayBusy = true;
  try {
    const summary = library.records.get(entry.key) as ReplaySummary | undefined;
    const tracks = await lib.timeAttackTrackCatalog();
    const track = tracks.find(candidate => candidate.id.toLowerCase() === entry.trackId.toLowerCase());
    if (!track) throw new Error(`赛道 ${entry.trackTitle} 不在当前目录。`);
    const stored = await library.store.get(entry.key).catch(() => undefined) as
      { participants?: Array<{ equipment?: { playerName?: unknown } }> } | undefined;
    const playerName = stored?.participants?.[0]?.equipment?.playerName;
    const { bytes } = await library.exportKsv(entry.key);
    const parts = entry.key.split("\0");
    const speed = summary?.speed ?? Number(parts[1] ?? 7);
    const booster = summary?.booster ?? Number(parts[2] ?? 0);
    await startReplaySession(controller, {
      trackId: track.id, trackPath: track.path, trackTitle: entry.trackTitle, ksv: bytes,
      riderName: typeof playerName === "string" && playerName ? playerName : entry.riderName,
      kartName: entry.kartName, recordMs: entry.elapsedMs, speed: speed === 4 ? 4 : 7, booster,
      onReturn: () => { void openReadyHome(controller, "single").then(() => controller.activeHome?.selectCategory("cat_replay")); },
    });
  } finally {
    controller.replayBusy = false;
  }
}

/** 删除 on a card: confirm, then drop the record and its date. */
export async function deleteLocalReplay(controller: ReadyReplayController, entry: ReplayMenuEntry): Promise<boolean> {
  const library = replayLibrary(controller);
  const lib = controller.host.getLibrary();
  if (!library || !lib || controller.replayBusy) return false;
  const agreed = await openMessengerMessage(lib as never, controller.host.root, TITLE,
    `要删除这条回放吗？|${entry.trackTitle}　${formatRecordTime(entry.elapsedMs)}`, { yes: "删除", no: "取消" })
    .catch(() => false);
  if (!agreed || controller.disposed) return false;
  await library.delete(entry.key);
  forgetReplayDate(entry.key);
  return true;
}
