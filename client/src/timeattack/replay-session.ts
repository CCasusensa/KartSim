/**
 * OB 观看 (TIMEATTACK.md 4): plays a .ksv as a solo race whose only participant
 * is the watched ghost. The local kart is hidden and its input off
 * (stage-update / action-dispatch read session.observe), the camera follows
 * the ghost (shell-routing) and the replay console steers the clock.
 */
import { ReplayConsole } from "../ui/replay-console";
import type { StoryMission } from "../story/story-data";
import type { ReadyOptions, ReadySelection } from "./ready-flow";
import type { ReadyHomeController } from "./ready-home";
import { storyGhostSources } from "./ready-story";
import { ReplayClock, type ObserveState } from "./replay-observe";
import { tellPlayer } from "../ui/game-popups";

export interface ReplaySessionRequest {
  trackId: string;
  trackPath: string;
  trackTitle: string;
  ksv: Uint8Array;
  riderName: string;
  kartName: string;
  recordMs: number;
  speed: number;
  booster: number;
  onReturn(): void;
}

/** Decode the .ksv and start the viewer race; resolves once the race is running. */
export async function startReplaySession(controller: ReadyHomeController, request: ReplaySessionRequest): Promise<void> {
  const host = controller.host;
  const library = host.getLibrary();
  if (!library) throw new Error("缺少资源库。");
  const previous = host.getSelection();
  if (!previous) throw new Error("请先在计时赛选好车辆和人物。");
  const previousOptions = host.getReadyOptions();
  const catalog = await library.timeAttackGarageCatalog();
  const mission = { kind: "Shadow", track: request.trackId, laps: 0, timeLimitMs: 0, speed: request.speed,
    rival: undefined } as unknown as StoryMission;
  const decoded = storyGhostSources(request.ksv, request.trackId, mission, catalog as never);
  const source = decoded.sources[0];
  if (!source) throw new Error("录像里没有车手。");
  source.equipment.playerName = request.riderName;
  const durationMs = Math.max(decoded.timeMs, request.recordMs, stampsDuration(source.record));
  const observe: ObserveState = { riderName: request.riderName, kartName: request.kartName, recordMs: request.recordMs,
    clock: new ReplayClock(durationMs), camera: "A", hudVisible: true, naturalMs: 0 };
  const restore = (): void => {
    observe.console?.dispose();
    observe.console = undefined;
    host.setSelection(previous);
    host.setReadyOptions(previousOptions);
    controller.homeRequested = true;
    controller.homePage = "single";
  };
  const selection: ReadySelection = {
    ...previous, mapPath: request.trackPath, trackId: request.trackId,
    story: { ghosts: [source], observe, restore, judge: () => true, onReturn: () => request.onReturn() },
  };
  const options: ReadyOptions = { ...previousOptions, speed: request.speed, settingSpeed: request.speed, version: "国服",
    booster: request.booster, showGhost: true };
  await controller.startRaceFromReady(selection, options);
  if (controller.disposed) return;
  if (host.shell.current === "Ready") {
    restore();
    throw new Error("录像未能开始播放。");
  }
  try {
    observe.console = await ReplayConsole.open({
      library: library as never, root: host.root, observe,
      naturalMs: () => observe.naturalMs,
      onExit: () => observe.exit?.(),
      onHover: () => host.getInterfaceAudio()?.playHover(),
      onActivate: () => host.getInterfaceAudio()?.playClick(),
    });
    if (host.shell.current === "Ready") { observe.console.dispose(); observe.console = undefined; }
  } catch (error) {
    tellPlayer(host.hud, `回放操作台：${error instanceof Error ? error.message : String(error)}`);
  }
}

function stampsDuration(record: unknown): number {
  const stamps = (record as { stamps?: Array<{ time: number }> } | undefined)?.stamps;
  const last = stamps?.[stamps.length - 1];
  return last ? last.time * 100 : 0;
}
