/**
 * What lies behind the multiplayer room window.
 *
 * The original MqGameReadyStage shows the room window over the lobby: the
 * lobby scene stays, softened, behind the 1360×758 board, and the lobby's
 * status bar stays along the top. Its stage_window@zz starts with a
 * fullscreen "200 0 0 0" panel, but an untextured panel's color is a tint in
 * the original engine, not a fill: the lobby behind the room is not darkened
 * (lobby-room-template.ts drops that panel for this renderer, which fills
 * colors). The room therefore paints the lobby home's latest frame, blurred
 * the way the room list blurs it behind its panels, under the window, and
 * lobby-room-top-bar.ts mounts the status bar over it.
 */

import { blurredLobbyBackdrop, lobbyHomeBackdrop } from "./lobby-home-backdrop";
import { coverCrop, mainMenuBackdrop } from "./main-menu-view";

export interface LobbyRoomBackdropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The deep blue under the lobby frame, the same base as the room list. */
export const LOBBY_ROOM_BACKDROP_FILL = "#0d2350";

/**
 * Fill `area` with the lobby home frame, blurred and cover-cropped (sharp
 * where a blurred copy cannot be made), or with the home illustration before
 * the lobby scene has rendered; plain deep blue when neither exists yet.
 */
export function drawLobbyRoomBackdrop(context: CanvasRenderingContext2D,
  area: LobbyRoomBackdropArea): void {
  context.fillStyle = LOBBY_ROOM_BACKDROP_FILL;
  context.fillRect(area.x, area.y, area.width, area.height);
  const source = lobbyHomeBackdrop() ?? mainMenuBackdrop();
  if (!source) return;
  const blurred = blurredLobbyBackdrop(source);
  if (blurred) {
    context.drawImage(blurred, 0, 0, blurred.width, blurred.height,
      area.x, area.y, area.width, area.height);
    return;
  }
  const crop = coverCrop(source, area);
  context.drawImage(source.image, crop.x, crop.y, crop.width, crop.height,
    area.x, area.y, area.width, area.height);
}
