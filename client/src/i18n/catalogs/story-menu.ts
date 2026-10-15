import { storyMenuTitles } from "./story-menu-titles";
import { storyMenuObjectives } from "./story-menu-objectives";
import { storyMenuSummaries } from "./story-menu-summaries";

/** Display fields from 52 active chapters and 831 steps. Never used for scene dialogue or IDs. */
export const storyMenuTranslations: Readonly<Record<string, readonly [string, string]>> = {
  ...storyMenuTitles, ...storyMenuObjectives, ...storyMenuSummaries,
};
