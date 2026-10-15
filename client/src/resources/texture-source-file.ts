/**
 * A model texture's file in one texture source (release `mK`): the first of
 * `<source>/<stem>.dds|png|jpg|tga|kng` that exists.
 *
 * The release client ran on Windows, where file names match whatever their
 * case, so a stem or extension cased differently from the file still finds
 * it: WKC 美洲赛道 ships `track_/wkc_R12/skydome.PNG`, and the web release's
 * exact lookup missed it and drew the common blue sky. An exact spelling
 * under any extension still wins (村庄 可乐版's `W_fence00.png` is the
 * Coca-Cola banner, `w_fence00.dds` beside it the plain fence).
 */
import { normalizeCanonicalPath } from "./resource-lookup";

export const TEXTURE_EXTENSIONS = ["dds", "png", "jpg", "tga", "kng"] as const;

export interface TextureSourceLookup<Entry> {
  exactCanonicalCandidates(path: string): Entry[];
  /** Case-insensitive candidates. */
  canonicalCandidates?(path: string): Entry[];
}

export interface TextureSource { canonicalPrefix: string }

export type TextureSourceFile<Entry, Source> =
  | { status: "found"; entry: Entry; source: Source; stem: string; extension: string }
  | { status: "unresolved"; reason: string; source: Source; stem: string };

export function findTextureSourceFile<Entry, Source extends TextureSource>(
  library: TextureSourceLookup<Entry>, source: Source, stem: string,
): TextureSourceFile<Entry, Source> | undefined {
  const lookups = [
    (path: string) => library.exactCanonicalCandidates(path),
    (path: string) => library.canonicalCandidates?.(path) ?? [],
  ];
  for (const lookup of lookups) {
    for (const extension of TEXTURE_EXTENSIONS) {
      const path = `${normalizeCanonicalPath(source.canonicalPrefix)}/${stem}.${extension}`;
      const entries = lookup(path);
      if (entries.length > 1) return { status: "unresolved", reason: `${path} 在 source 中不唯一。`, source, stem };
      if (entries.length === 1) return { status: "found", entry: entries[0]!, source, stem, extension };
    }
  }
  return undefined;
}
