/**
 * 道具赛 frame presentation: the item cubes, the track hazards and the item
 * presenter follow the track scene update (moving cubes and hazards read its
 * matrices), and the item HUD gets the controller's state. Speed races present
 * their water-mine traps here too.
 */
import type { HazardTrapRacer, HazardTraps } from "../item/hazard-traps";
import type { ItemPresenterPose, ItemRacePresenter } from "../item/item-race-presenter-contract";
import type { ItemHudState } from "../ui/item-hud-state";

export interface RacePresenterItemsHost {
  camera: unknown;
  assets: {
    itemCubes?: { update(nowMs: number, camera: unknown, width: number, height: number): void };
    itemHazards?: { update(nowMs: number): void };
    /** item-mode(fx): the kart looks (invisibility, balloons) and the start item's charger sound. */
    itemPresenter?: Pick<ItemRacePresenter, "kartPresentation" | "kartMotion" | "pulling" | "startItemFlash">;
    /** Speed races: the carriers' water mines that trap karts (item/hazard-traps.ts). */
    hazardTraps?: Pick<HazardTraps, "present">;
  };
  runtime: {
    itemRace?: {
      present(input: { nowMs: number; camera: unknown; width: number; height: number }): void;
    };
  };
}

/** What the trap presentation reads of the race presenter (both of its hosts have it). */
interface HazardTrapFrameHost {
  playerId?: unknown;
  assets: { participants?: Array<{ playerId: unknown }> };
  runtime: {
    local?: { physics?: { body?: ItemPresenterPose } };
    remotes?: { copyWebPose(playerId: unknown): ItemPresenterPose | undefined; hasDeparted?(playerId: unknown): boolean };
  };
}

/** Call right after the track render update, in the race and in the result frames. */
export function updateRacePresenterItems(host: RacePresenterItemsHost, nowMs: number,
  width: number, height: number): void {
  host.assets.itemCubes?.update(nowMs, host.camera, width, height);
  host.assets.itemHazards?.update(nowMs);
  host.runtime.itemRace?.present({ nowMs, camera: host.camera, width, height });
  const traps = host.assets.hazardTraps;
  if (traps) {
    const frame = host as unknown as HazardTrapFrameHost;
    const remotes: HazardTrapRacer[] = [];
    const fleet = frame.runtime.remotes;
    for (const { playerId } of frame.assets.participants ?? []) {
      if (playerId === frame.playerId || !fleet || fleet.hasDeparted?.(playerId)) continue;
      const pose = fleet.copyWebPose(playerId);
      if (pose) remotes.push({ playerId: String(playerId), pose });
    }
    traps.present(nowMs, host.camera, width, height, frame.runtime.local?.physics?.body, remotes);
  }
}

export interface RacePresenterItemHudHost {
  runtime: { itemRace?: { hudState(nowMs: number): ItemHudState } };
  hud: { setItemState?(state: ItemHudState): void };
  /** item-mode(fx): the start item flash the charger sound already played for. */
  itemStartFlashMs?: number;
}

/** The race presenter's assets as the charger sound needs them (any host may omit them). */
type ItemFlashAssets = { assets?: { itemPresenter?: Pick<ItemRacePresenter, "startItemFlash"> } };

/** Feed this frame's item state to the HUD before it updates. */
export function feedRacePresenterItemHud(host: RacePresenterItemHudHost, nowMs: number): void {
  const itemRace = host.runtime.itemRace;
  if (!itemRace || !host.hud.setItemState) return;
  const state = itemRace.hudState(nowMs);
  host.hud.setItemState(state);
  // The XUN start item's slot flash sounds the charger once (ITEM_MODE.md C.3).
  const flash = state.startItemFlash;
  if (flash !== undefined && flash !== host.itemStartFlashMs) {
    host.itemStartFlashMs = flash;
    (host as ItemFlashAssets).assets?.itemPresenter?.startItemFlash?.(flash);
  }
}
