import { gameLocale, type GameLocale } from "../i18n/locale";
import { localizedPngCandidates, type LocalizedPngLibrary } from "../resources/localized-png";

export const STORY_CARD_ROOT = "zeta_/cn/scenario/select";

/** A numbered chapter can collide with a preceding chapter's hover sprite.
 * Select a complete four-state family before considering its single image.
 */
export function storyChapterCardPaths(library: LocalizedPngLibrary, chapter: string,
  locale: GameLocale = gameLocale()): string[] {
  const find = (name: string) => localizedPngCandidates(`${STORY_CARD_ROOT}/${name}.png`, locale)
    .find(path => library.canonicalCandidates(path).length > 0);
  const states = [1, 2, 3, 4].map(index => find(`${chapter}${index}`));
  if (states.every((path): path is string => !!path)) return states;
  const single = find(chapter);
  return single ? [single] : [];
}
