import { localizedPngPath } from "../resources/localized-png";

interface ModeArtResource { bytes(): Promise<Uint8Array> }
interface ModeArtLibrary { canonicalCandidates(path: string): ModeArtResource[] }
interface ImageResponse { ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }

/** Complete translated mode cards are shipped inside the shared locale archive. */
export async function loadMultiplayerModeImage(library: ModeArtLibrary, filename: string,
  fetchImage: (url: string) => Promise<ImageResponse> = fetch): Promise<ImageResponse> {
  const path = localizedPngPath(`ui/multiplayer/${filename}`);
  const candidates = library.canonicalCandidates(path);
  if (candidates.length > 1) throw new Error(`${path}: expected one localized image`);
  if (candidates.length === 1) {
    const bytes = await candidates[0]!.bytes();
    return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
  }
  return fetchImage(`/ui/multiplayer/${filename}`);
}
