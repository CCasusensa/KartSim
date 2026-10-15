import { cityDialogueTranslations } from "../i18n/catalogs/city-dialogue";
import { cityAmbientDialogueTranslations } from "../i18n/catalogs/city-ambient-dialogue";
import { gameLocale, type GameLocale } from "../i18n/locale";

/** Display only: do not apply this to player names, chat, quest IDs or resource paths. */
export function cityDialogueText(source: string, locale: GameLocale = gameLocale()): string {
  if (locale === "zh-CN") return source;
  const pair = cityDialogueTranslations[source] ?? cityAmbientDialogueTranslations[source];
  return pair?.[locale === "en" ? 0 : 1] ?? source;
}
