/**
 * 大厅宣传 (server-go/ADMIN.md 10): the lobby home's carousel pictures and
 * its two promotion boards as the admin console sets them, each with an
 * optional link. Without settings (or without the data service) the lobby
 * keeps its built-in pictures and COMING SOON boards.
 */
import type { LobbyImage } from "./lobby-home-view";
import { gameLocale, type GameLocale } from "../i18n/locale";

export const LOBBY_PROMOS_PATH = "/api/lobby/promos";
/** Home reopens often (after every race); the settings are read again after this. */
const CACHE_MS = 60_000;
const PICTURE_PATH = /^\/api\/lobby\/promo-images\/[0-9a-f]{32}$/;

/** A carousel picture or a board as the service describes it. */
export interface LobbyPromoEntry {
  /** Picture path on the data service; empty for none. */
  url: string;
  width: number;
  height: number;
  link?: string;
  title?: string;
}

export interface LobbyPromoSettings {
  /** Seconds per carousel picture. */
  interval: number;
  carousel: LobbyPromoEntry[];
  /** Blue, then purple. */
  boards: [LobbyPromoEntry | undefined, LobbyPromoEntry | undefined];
}

/** A carousel picture ready to draw. */
export interface LobbyBanner extends LobbyImage {
  link?: string;
  title?: string;
}

/** A promotion board: its picture (else the drawn board), link and text. */
export interface LobbyBoard {
  image?: LobbyImage;
  link?: string;
  title?: string;
}

/** What the lobby home shows once the pictures are loaded. */
export interface LobbyPromos {
  /** Milliseconds per carousel picture. */
  intervalMs: number;
  /** Empty keeps the built-in pictures. */
  banners: LobbyBanner[];
  boards: [LobbyBoard, LobbyBoard];
}

/** Complete localized artwork for the known built-in promotions. Custom art is untouched. */
export function localizedLobbyPromoPath(promo: Pick<LobbyBoard, "title" | "link">,
  locale: GameLocale = gameLocale()): string | undefined {
  if (locale === "zh-CN") return undefined;
  let host = "";
  try { host = new URL(safeLobbyLink(promo.link) ?? "").hostname.toLowerCase(); } catch { /* No external link. */ }
  if (host === "ccraft.app" || host.endsWith(".ccraft.app") || /^ccraft(?:\s|$)/i.test(promo.title ?? ""))
    return "lobby/ccraft.png";
  if (host === "qun.qq.com" || host === "jq.qq.com" || host === "qm.qq.com" || /^加入\s*QQ\s*群\s*\+?$/.test(promo.title ?? ""))
    return "lobby/qq-group.png";
  return undefined;
}

export type LobbyPromoArtLoader = (canonicalPath: string, locale: GameLocale) => Promise<LobbyImage | undefined>;

/**
 * The link to open, or undefined: an http(s) URL, or a path of the game's
 * own site (resolved against origin). Anything else (javascript:, data:,
 * protocol-relative) is ignored even if the service sent it.
 */
export function safeLobbyLink(link: string | undefined, origin?: string): string | undefined {
  const value = link?.trim();
  if (!value || value.length > 500 || /[\s\\<>"'`]/.test(value)) return undefined;
  try {
    if (value.startsWith("/")) {
      if (value.startsWith("//") || !origin) return undefined;
      const url = new URL(value, origin);
      return url.origin === new URL(origin).origin ? url.href : undefined;
    }
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host && !url.username
      ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Opens a lobby link in a new tab; false when there is none to open. */
export function openLobbyLink(link: string | undefined): boolean {
  const origin = typeof window !== "undefined" ? window.location?.origin : undefined;
  const url = safeLobbyLink(link, origin);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function parseEntry(value: unknown): LobbyPromoEntry | undefined {
  const entry = record(value);
  if (!entry) return undefined;
  const text = (key: string) => typeof entry[key] === "string" ? (entry[key] as string).trim() : "";
  const size = (key: string) => {
    const number = entry[key];
    return typeof number === "number" && Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  };
  const url = text("url");
  const link = text("link");
  const title = text("title").slice(0, 40);
  return {
    url: PICTURE_PATH.test(url) ? url : "", width: size("width"), height: size("height"),
    ...(link ? { link } : {}), ...(title ? { title } : {}),
  };
}

/** Validates GET /api/lobby/promos; bad entries are dropped. */
export function parseLobbyPromos(value: unknown): LobbyPromoSettings {
  const body = record(value) ?? {};
  const interval = typeof body.interval === "number" && Number.isFinite(body.interval)
    ? Math.min(60, Math.max(2, Math.round(body.interval))) : 5;
  const carousel = (Array.isArray(body.carousel) ? body.carousel : []).slice(0, 8)
    .map(parseEntry).filter((entry): entry is LobbyPromoEntry => !!entry?.url);
  const boards = Array.isArray(body.boards) ? body.boards : [];
  return { interval, carousel, boards: [parseEntry(boards[0]), parseEntry(boards[1])] };
}

function loadPicture(url: string): Promise<LobbyImage | undefined> {
  return new Promise(resolve => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image.naturalWidth && image.naturalHeight
      ? { image, width: image.naturalWidth, height: image.naturalHeight } : undefined));
    image.addEventListener("error", () => resolve(undefined));
    image.src = url;
  });
}

export interface LobbyPromoSession {
  readonly backendOrigin: string;
  requestJson(path: string, init?: RequestInit): Promise<unknown>;
}

/**
 * Reads the settings and loads their pictures; pictures that fail are left
 * out (a board then keeps its drawn look). Undefined when the service has
 * none to give (an older service, no connection).
 */
export async function fetchLobbyPromos(session: LobbyPromoSession,
  load: (url: string) => Promise<LobbyImage | undefined> = loadPicture,
  loadArt?: LobbyPromoArtLoader, locale: GameLocale = gameLocale()): Promise<LobbyPromos | undefined> {
  let settings: LobbyPromoSettings;
  try {
    settings = parseLobbyPromos(await session.requestJson(LOBBY_PROMOS_PATH));
  } catch {
    return undefined;
  }
  const picture = async (entry: LobbyPromoEntry | undefined): Promise<LobbyImage | undefined> => {
    if (!entry?.url) return undefined;
    const path = localizedLobbyPromoPath(entry, locale);
    if (path && loadArt) {
      const localized = await loadArt(path, locale).catch(() => undefined);
      if (localized) return localized;
    }
    // A missing optional locale pack must never hide an administrator's picture.
    return load(session.backendOrigin + entry.url).catch(() => undefined);
  };
  const [slides, boards] = await Promise.all([
    Promise.all(settings.carousel.map(picture)),
    Promise.all(settings.boards.map(picture)),
  ]);
  const banners = settings.carousel.flatMap((entry, index): LobbyBanner[] => {
    const image = slides[index];
    return image ? [{ ...image, ...(entry.link ? { link: entry.link } : {}),
      ...(entry.title ? { title: entry.title } : {}) }] : [];
  });
  const board = (index: 0 | 1): LobbyBoard => {
    const entry = settings.boards[index];
    const image = boards[index];
    return { ...(image ? { image } : {}), ...(entry?.link ? { link: entry.link } : {}),
      ...(entry?.title ? { title: entry.title } : {}) };
  };
  return { intervalMs: settings.interval * 1000, banners, boards: [board(0), board(1)] };
}

let cached: { session: LobbyPromoSession; locale: GameLocale; loadArt?: LobbyPromoArtLoader;
  at: number; pending: Promise<LobbyPromos | undefined> } | undefined;

/** fetchLobbyPromos, shared by the home openings of the next minute. */
export function loadLobbyPromos(session: LobbyPromoSession | undefined,
  loadArt?: LobbyPromoArtLoader): Promise<LobbyPromos | undefined> {
  if (!session) return Promise.resolve(undefined);
  const now = Date.now();
  const locale = gameLocale();
  if (cached && cached.session === session && cached.locale === locale && cached.loadArt === loadArt &&
      now - cached.at < CACHE_MS) return cached.pending;
  const pending = fetchLobbyPromos(session, loadPicture, loadArt, locale);
  cached = { session, locale, loadArt, at: now, pending };
  // A failed read is tried again at the next opening.
  void pending.then(promos => { if (!promos && cached?.pending === pending) cached = undefined; });
  return pending;
}
