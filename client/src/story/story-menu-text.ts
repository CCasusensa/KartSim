import { gameLocale } from "../i18n/locale";
import { storyMenuTranslations } from "../i18n/catalogs/story-menu";

/** Display fields from scenario.bml/scenarioSteps.bml; never scene commands or resource IDs. */
export function storyMenuText(source: string): string {
  const locale = gameLocale();
  if (locale === "zh-CN") return source;
  return storyMenuTranslations[source]?.[locale === "en" ? 0 : 1] ?? source;
}
