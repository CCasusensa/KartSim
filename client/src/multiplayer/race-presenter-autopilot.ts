/** 创世 9 自动版 in a multiplayer race (ui/autopilot-prank.ts). */
import type { AutopilotParkingView, AutopilotPrank } from "../ui/autopilot-prank";

export interface RacePresenterAutopilotHost {
  /** Set by the race loader when any racer drives 创世 9 自动版. */
  autopilot?: AutopilotPrank;
  /** Each such racer's rider mount (ReKart child 6), by player. */
  autopilotSeats?: Map<unknown, object>;
  views: Map<unknown, unknown>;
  runtime: { local: { lifecycle: { state: number }; scheduledStartAtMs: number } };
}

/**
 * From the local GO every such kart, the local one and the remote ones, stays
 * at its grid slot while its rider drives on; the local driver's prompts
 * follow the same GO.
 */
export function updateRacePresenterAutopilot(host: RacePresenterAutopilotHost,
  racingState: number): void {
  const prank = host.autopilot;
  if (!prank || !host.autopilotSeats) return;
  const racing = host.runtime.local.lifecycle.state >= racingState;
  for (const [playerId, seat] of host.autopilotSeats) {
    const view = host.views.get(playerId) as AutopilotParkingView | undefined;
    if (view) prank.park(view, seat, racing);
  }
  prank.setGo(host.runtime.local.scheduledStartAtMs || undefined);
}
