import { trackNames } from "../i18n/catalogs/tracks";
import { gameLocale, type GameLocale } from "../i18n/locale";

const namesById = new Map(Object.entries(trackNames).map(([id, names]) => [id.toLowerCase(), names]));
const localeIndex = { "zh-CN": 0, en: 1, ko: 2 } as const;
const reversePrefix = { "zh-CN": "[反]", en: "[Reverse] ", ko: "[역방향] " } as const;

/**
 * Resolve official track names at display time. IDs are case-insensitive because
 * recorded Ghost keys use lower case. Unknown IDs (including workshop maps) keep
 * their supplied name verbatim; no name-based translation touches player text.
 * This never changes cnTitle, track IDs, region rules or saved replay metadata.
 */
export function trackDisplayTitle(id: string, fallback = id, locale: GameLocale = gameLocale()): string {
  const key = id.toLowerCase();
  const reverse = key.endsWith("_rvs");
  const names = namesById.get(key) ?? (reverse ? namesById.get(key.slice(0, -4)) : undefined);
  if (!names) return fallback;
  return `${reverse ? reversePrefix[locale] : ""}${names[localeIndex[locale]]}`;
}
