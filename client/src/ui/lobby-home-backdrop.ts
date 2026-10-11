/**
 * The last frame of the lobby home scene, kept so the multiplayer room list
 * can show the same lobby, blurred, behind its panels; and the same frame
 * without the rider and kart, for the shop opened away from the lobby (its
 * stage draws the rider itself).
 */

import { coverCrop } from "./main-menu-view";

export interface LobbyBackdropImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

let backdrop: LobbyBackdropImage | undefined;

export function lobbyHomeBackdrop(): LobbyBackdropImage | undefined {
  return backdrop;
}

export function setLobbyHomeBackdrop(image: LobbyBackdropImage | undefined): void {
  if (image) backdrop = image;
}

let shopBackdrop: LobbyBackdropImage | undefined;

/** The lobby's last frame without its rider and kart, if one was taken. */
export function lobbyShopBackdrop(): LobbyBackdropImage | undefined {
  return shopBackdrop;
}

export function setLobbyShopBackdrop(image: LobbyBackdropImage | undefined): void {
  if (image) shopBackdrop = image;
}

const blurredBackdrops = new WeakMap<object, HTMLCanvasElement>();

/**
 * A small pre-blurred copy of a lobby frame (800×417, 5 px blur), cached per
 * source so hover redraws do not blur the full stage each time. undefined
 * without a document.
 */
export function blurredLobbyBackdrop(source: LobbyBackdropImage): HTMLCanvasElement | undefined {
  const key = source.image as object;
  const cached = blurredBackdrops.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 417;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const crop = coverCrop(source, canvas);
  context.filter = "blur(5px)";
  // Draw past the edges so the blur does not darken them.
  context.drawImage(source.image, crop.x, crop.y, crop.width, crop.height, -12, -12,
    canvas.width + 24, canvas.height + 24);
  blurredBackdrops.set(key, canvas);
  return canvas;
}
