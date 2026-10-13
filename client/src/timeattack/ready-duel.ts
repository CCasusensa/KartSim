/**
 * 赛道对决 races (TIMEATTACK.md): the practice window's 开始对决 starts a story
 * style race against the stage's NPC ghost, which the race builder generates
 * along the course line (duel-npc-ghost.ts); back on Ready the data service
 * settles the duel and the NPC's line is shown.
 */
import { activeBrowserSession } from "../account/account-runtime";
import { newRequestId } from "../account/rewards";
import type { StoryRaceOutcome } from "../story/story-race";
import { openMessengerMessage } from "../ui/messenger-dialogs";
import type { DuelRaceRequest } from "../ui/ready-missions";
import type { ReadyFlowController, ReadyOptions, ReadySelection } from "./ready-flow";
import type { ReadyHomeController } from "./ready-home";
import { formatRecordTime, settleDuelRace, timeAttackErrorMessage } from "./timeattack-api";

const TITLE = "赛道对决";

export interface ReadyDuelController extends ReadyFlowController {
  duelMessage?: AbortController;
}

/** Start the duel race; the window closes with Ready's rebuild when the race returns. */
export async function startDuelRace(controller: ReadyDuelController, selection: ReadySelection,
  options: ReadyOptions, duel: DuelRaceRequest): Promise<void> {
  const host = controller.host;
  const library = host.getLibrary();
  if (!library) return;
  const previousOptions = host.getReadyOptions();
  const catalog = await library.timeAttackGarageCatalog() as { karts: Array<{ itemId: number }>;
    characters: Array<{ itemId: number }> };
  const npc = duel.stage.npc;
  const kart = catalog.karts.some(entry => entry.itemId === npc.kartId) ? npc.kartId : selection.vehicleItemId ?? 0;
  const character = catalog.characters.some(entry => entry.itemId === npc.characterId) ? npc.characterId
    : selection.characterItemId ?? 0;
  const advantageMs = duel.stage.difficulties[duel.difficulty]?.advantageMs ?? 0;
  const targetMs = duel.stage.targetMs + advantageMs;
  // The duel runs on the event's track, whatever track the window shows.
  const tracks = await library.timeAttackTrackCatalog();
  const track = tracks.find(entry => entry.id.toLowerCase() === duel.event.trackId.toLowerCase());
  if (!track) throw new Error(`赛道 ${duel.event.trackId} 不在本地资源中`);
  const previous = host.getSelection();
  const restore = (): void => {
    if (previous) host.setSelection(previous);
    host.setReadyOptions(previousOptions);
  };
  const raceSelection: ReadySelection = {
    ...selection,
    mapPath: track.path, trackId: track.id,
    story: {
      ghosts: [],
      npc: {
        targetMs: duel.stage.targetMs, advantageMs,
        equipment: { character, kart, kartPaint: npc.color || 0, characterColor: npc.dye || 0, plate: 0, goggle: 0,
          balloon: 0, headBand: 0, handGearL: 0, plateText: "", playerName: npc.name, startSlot: 1 },
      },
      restore,
      judge: (elapsedMs: number) => elapsedMs < targetMs,
      onReturn: (outcome: StoryRaceOutcome) => { void finishDuel(controller, duel, outcome); },
    },
  };
  const raceOptions: ReadyOptions = { ...options, speed: duel.stage.speed, settingSpeed: duel.stage.speed,
    version: "国服", booster: duel.stage.teamBooster ? 1 : 0, showGhost: true };
  await controller.startRaceFromReady(raceSelection, raceOptions);
  if (!controller.disposed && host.shell.current === "Ready") {
    host.setReadyOptions(previousOptions);
    message(controller, "比赛未能开始，请重试。");
  }
}

async function finishDuel(controller: ReadyDuelController, duel: DuelRaceRequest,
  outcome: StoryRaceOutcome): Promise<void> {
  const session = activeBrowserSession();
  const npc = duel.stage.npc.name;
  if (!session) {
    message(controller, outcome.finished && outcome.cleared !== false ? `对决胜利！战胜了 ${npc}。` : `对决失败，没有赢过 ${npc}。`);
    return;
  }
  try {
    const result = await settleDuelRace(session, { requestId: newRequestId(), key: duel.event.key, stage: duel.stage.stage,
      difficulty: duel.difficulty, elapsedMs: outcome.elapsedMs, finished: outcome.finished });
    const lines = result.won
      ? [`对决胜利！用时 ${formatRecordTime(outcome.elapsedMs)}，战胜了 ${npc}（${formatRecordTime(result.targetMs)}）。`,
        ...duel.stage.messages.win,
        ...(result.firstWin ? ["胜利奖励已放入奖励箱。"] : []),
        ...(result.bonus ? ["难度奖励已放入奖励箱。"] : [])]
      : [outcome.finished ? `对决失败，用时 ${formatRecordTime(outcome.elapsedMs)}，没有赢过 ${npc}（${
        formatRecordTime(result.targetMs)}）。` : `对决失败，没有完成比赛。`,
      ...(result.difficulty > duel.difficulty && result.difficulty > 0
        ? [`已连续落败 ${result.losses} 次：可在 难度设定 中让 ${npc} 晚 ${
          duel.stage.difficulties[result.difficulty]?.advantageMs ?? 0 / 1000}秒 出发。`, ...duel.stage.messages.difficulty]
        : [])];
    message(controller, lines.join("\n"));
  } catch (error) {
    message(controller, `赛道对决结算失败：${timeAttackErrorMessage(error)}`);
  }
}

function message(controller: ReadyDuelController, text: string): void {
  const library = controller.host.getLibrary();
  if (!library || controller.disposed) return;
  controller.duelMessage?.abort();
  const abort = new AbortController();
  controller.duelMessage = abort;
  const home = controller as unknown as ReadyHomeController;
  void openMessengerMessage(library as never, controller.host.root, TITLE, text.replaceAll("\n", "|"), {}, abort.signal)
    .catch(() => home.activeHome?.showNotice(text)).finally(() => {
      if (controller.duelMessage === abort) controller.duelMessage = undefined;
    });
}
