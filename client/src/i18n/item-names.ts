import { gameLocale } from "./locale";
import { itemChineseNameOverrides, itemNameTranslations } from "./catalogs/item-names";
import sources from "./catalogs/item-name-sources.json";
import { raceItemNames } from "./catalogs/race-item-names";

/** Canonical CN resource labels, keyed by the unchanged category and item ID. */
export const itemNameSources: Readonly<Record<string, string>> = sources;

// Older recordings can contain a displayed English or Korean vehicle title.
// Only reverse unique labels: two distinct original items must not be merged.
const canonicalByTranslation = new Map<string, string | null>();
for (const [source, labels] of Object.entries(itemNameTranslations)) {
  for (const label of labels) {
    const previous = canonicalByTranslation.get(label);
    canonicalByTranslation.set(label, previous === undefined || previous === source ? source : null);
  }
}
// Original StringBags use this spelling for the system practice kart.
canonicalByTranslation.set("연습카트", "练习用卡丁车");

/** Only use for authored item labels; never pass rider names, chat, or resource identifiers. */
export function translateItemName(source: string): string {
  const locale = gameLocale();
  const canonical = Object.hasOwn(itemNameTranslations, source.trim()) ? source.trim()
    : canonicalByTranslation.get(source.trim()) ?? source;
  if (locale === "zh-CN") return Object.hasOwn(itemChineseNameOverrides, canonical)
    ? itemChineseNameOverrides[canonical]! : canonical;
  const translation = Object.hasOwn(itemNameTranslations, canonical) ? itemNameTranslations[canonical] : undefined;
  return translation?.[locale === "en" ? 0 : 1] ?? source;
}

/** Keep record summaries independent of the language used while driving. */
export function canonicalItemName(category: number, itemId: number, source: string): string {
  const known = itemNameSources[`${category}:${itemId}`];
  if (known && (source === known || itemNameTranslations[known]?.includes(source))) return known;
  // Unknown/custom resource identities retain their supplied name.
  return source;
}

export function canonicalKartName(itemId: number, systemKey: unknown, source: string): string {
  if (itemId !== 0) return canonicalItemName(3, itemId, source);
  const systemNames: Readonly<Record<string, string>> = {
    practiceKart: "练习用卡丁车 V1", legacyPracticeX: "练习用卡丁车 X",
    legacyPractice: "旧版练习用卡丁车", legacyPracticeBlackline: "旧版黑线练习用卡丁车",
  };
  return typeof systemKey === "string" ? systemNames[systemKey] ?? source : source;
}

/**
 * Resolve a display label without rewriting the object's identity or API data.
 * An explicitly supplied label wins over the static catalog, including custom
 * or future items. Missing/numeric labels can use the known resource name.
 */
export function itemDisplayName(category: number, itemId: number, source?: string): string {
  const known = itemNameSources[`${category}:${itemId}`];
  const empty = !source?.trim() || source === String(itemId) || source === `${category}-${itemId}`;
  return translateItemName((empty ? known : source) ?? source ?? "");
}

/** Race item keys are engine identifiers; only the returned label is localized. */
export function raceItemDisplayName(key: string, source: string): string {
  const locale = gameLocale();
  if (locale === "zh-CN") return source;
  return raceItemNames[key]?.[locale === "en" ? 1 : 2] ?? translateItemName(source);
}
