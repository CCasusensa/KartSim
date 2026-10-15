import { gameLocale, type GameLocale } from "../i18n/locale";
import { normalizeCanonicalPath } from "./resource-lookup";

/** An independent archive: original containers and their checksums stay intact. */
export const LOCALIZED_PNG_CONTAINER = "locale_ui.rho";
export const LOCALIZED_PNG_MOUNT = "locale_ui";

export interface LocalizedPngLibrary {
  canonicalCandidates(path: string): readonly unknown[];
}

/** Native @zz artwork is selected only after its language has been checked. */
const koreanAliases = new Map<string, string>();
// The original Korean PERFECT sprite is wider than the Chinese result layout.
// The package contains the complete native bitmap fitted to the original extent.
const adaptedKoreanImages = new Set(["stage_/mqgamefinal/perpect.png"]);
for (const series of ["btn_mainMulti_", "btn_mainSingle_", "btn_mainMyroom_",
  "btn_mainShop_", "튜닝_0", "클럽_0"]) {
  for (let state = 1; state <= 4; state++) {
    const path = `gui_/window/menu/${series}${state}`;
    koreanAliases.set(`${path}.png`.toLowerCase(), `${path}@zz.png`);
  }
}

/** Locale suffixes belong to the filename, never directory or resource IDs. */
export function localizedPngSourcePath(canonicalPath: string): string {
  return normalizeCanonicalPath(canonicalPath).replace(/@(cn|zz|kr|us|en)(?=\.png$)/i, "");
}

/** Path inside locale_ui.rho, shared by the packer and runtime lookup. */
export function localizedPngArchivePath(canonicalPath: string, locale: GameLocale): string {
  return `${locale}/${localizedPngSourcePath(canonicalPath)}`;
}

/** Canonical path after the independent archive has been mounted. */
export function localizedPngPath(canonicalPath: string, locale: GameLocale = gameLocale()): string {
  return `${LOCALIZED_PNG_MOUNT}/${localizedPngArchivePath(canonicalPath, locale)}`;
}

/** Native locale artwork wins; generated assets replace a whole image, never a text layer. */
export function localizedPngCandidates(canonicalPath: string, locale: GameLocale = gameLocale()): string[] {
  const path = normalizeCanonicalPath(canonicalPath);
  if (!/\.png$/i.test(path) || path.startsWith(`${LOCALIZED_PNG_MOUNT}/`)) return [path];
  const source = localizedPngSourcePath(path);
  const base = source.slice(0, -4);
  const fallback = /@zz\.png$/i.test(path)
    ? [path.replace(/@zz(?=\.png$)/i, "@cn"), path, source] : [path];
  const native = locale === "en" ? [`${base}@us.png`, `${base}@en.png`]
    : locale === "ko" ? [`${base}@kr.png`, koreanAliases.get(source.toLowerCase())]
      : [];
  const adapted = locale === "ko" && adaptedKoreanImages.has(source.toLowerCase());
  const preferred = adapted ? [localizedPngPath(source, locale), ...native]
    : [...native, localizedPngPath(source, locale)];
  return [...new Set([...preferred, ...fallback]
    .filter((candidate): candidate is string => candidate !== undefined))];
}

/** Resolve a PNG without changing the source identity of unrelated resource lookups. */
export function resolveLocalizedPngPath(library: LocalizedPngLibrary, canonicalPath: string,
  locale: GameLocale = gameLocale()): string {
  return localizedPngCandidates(canonicalPath, locale)
    .find(path => library.canonicalCandidates(path).length > 0) ?? normalizeCanonicalPath(canonicalPath);
}
