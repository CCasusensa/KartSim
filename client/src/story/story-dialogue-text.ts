import { gameLocale, type GameLocale } from "../i18n/locale";
import { storySpeakers } from "../i18n/catalogs/story-speakers";
import { storyChineseCorrectionChapters, storyDialogueLoaders } from "../i18n/catalogs/story-dialogue";
import type { StorySceneCommand } from "./story-data";

/** The optional Chinese entry repairs the few Korean lines in the CN archive. */
export type StoryDialogueCatalog = Readonly<Record<string, readonly [string, string, string?]>>;

export function storyDialogueText(source: string, catalog: StoryDialogueCatalog,
  locale: GameLocale = gameLocale()): string {
  const entry = Object.hasOwn(catalog, source) ? catalog[source] : undefined;
  return entry?.[locale === "en" ? 0 : locale === "ko" ? 1 : 2] ?? source;
}

/** Called only for built-in scene/mission character names, never player nicknames. */
export function storySpeakerText(source: string, locale: GameLocale = gameLocale()): string {
  return storyDialogueText(source, storySpeakers, locale);
}

const loaded = new Map<string, Promise<StoryDialogueCatalog>>();

/** Import only the chapter being played. Failed downloads remain retryable. */
export function loadStoryDialogueCatalog(chapter: string): Promise<StoryDialogueCatalog> {
  if (gameLocale() === "zh-CN" && !storyChineseCorrectionChapters.has(chapter)) return Promise.resolve({});
  if (!Object.hasOwn(storyDialogueLoaders, chapter)) return Promise.resolve({});
  const load = storyDialogueLoaders[chapter]!;
  let pending = loaded.get(chapter);
  if (!pending) {
    pending = load();
    loaded.set(chapter, pending);
    pending.catch(() => { if (loaded.get(chapter) === pending) loaded.delete(chapter); });
  }
  return pending;
}

/** Preserve every non-display command field, including IDs, textures, sounds and timing. */
export function localizeStoryScene(commands: readonly StorySceneCommand[], catalog: StoryDialogueCatalog,
  locale: GameLocale = gameLocale()): StorySceneCommand[] {
  return commands.map(command => command.type === "message" ? {
    ...command, name: storySpeakerText(command.name, locale),
    text: storyDialogueText(command.text, catalog, locale),
  } : command);
}
