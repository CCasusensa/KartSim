/**
 * The lobby scene behind the multiplayer room.
 *
 * The original MqGameReadyStage keeps the lobby scene drawn under
 * stage_mqReady.rho/stage_window@zz: that window's first child is a
 * fullscreen "200 0 0 0" panel that dims whatever lies beneath, and its
 * 1360×758 board leaves the dimmed lobby visible around it. The room paints the
 * lobby home's latest frame (the frame the room list blurs behind its panels)
 * under the window, so the panel dims the lobby as it did there, instead of
 * the page's black.
 */

import { lobbyHomeBackdrop } from "./lobby-home-backdrop";
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
 * Fill `area` with the lobby home frame, cover-cropped, or with the home
 * illustration before the lobby scene has rendered; plain deep blue when
 * neither exists yet.
 */
export function drawLobbyRoomBackdrop(context: CanvasRenderingContext2D,
  area: LobbyRoomBackdropArea): void {
  context.fillStyle = LOBBY_ROOM_BACKDROP_FILL;
  context.fillRect(area.x, area.y, area.width, area.height);
  const source = lobbyHomeBackdrop() ?? mainMenuBackdrop();
  if (!source) return;
  const crop = coverCrop(source, area);
  context.drawImage(source.image, crop.x, crop.y, crop.width, crop.height,
    area.x, area.y, area.width, area.height);
}
