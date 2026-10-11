/**
 * The lobby status bar over the multiplayer room, as the original keeps the
 * lobby's top bar above the ready room. The bar's host spans the lobby area
 * (the screen above the taskbar, like .ks-lobby) as a size container, since
 * the bar's sizes are container query units of that area; the host itself
 * lets pointer events through to the room canvas, the bar does not.
 */

export interface LobbyRoomTopBarHandle { dispose(): void }

/** The taskbar's share of the game screen, as .ks-lobby leaves it (lobby-home-view.ts). */
export const LOBBY_ROOM_TASKBAR_SHARE = "7.333333%";

export function attachLobbyRoomTopBar(element: HTMLElement,
  mount: (host: HTMLElement) => LobbyRoomTopBarHandle | undefined,
): LobbyRoomTopBarHandle | undefined {
  const host = element.ownerDocument.createElement("div");
  host.className = "ks-room-topbar";
  host.setAttribute("role", "presentation");
  Object.assign(host.style, { position: "absolute", left: "0", right: "0", top: "0",
    bottom: LOBBY_ROOM_TASKBAR_SHARE, pointerEvents: "none" });
  host.style.setProperty("container-type", "size");
  element.append(host);
  const bar = mount(host);
  if (!bar) {
    host.remove();
    return undefined;
  }
  for (const child of Array.from(host.children)) {
    (child as HTMLElement).style.pointerEvents = "auto";
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      bar.dispose();
      host.remove();
    },
  };
}
