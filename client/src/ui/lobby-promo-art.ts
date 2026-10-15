import { localizedPngPath } from "../resources/localized-png";
import { decodePngRgba } from "../resources/png-decoder";
import type { LobbyPromoArtLoader } from "./lobby-promos";

interface PromoArtLibrary {
  canonicalCandidates(path: string): readonly { bytes(): Promise<Uint8Array> }[];
}

const loaders = new WeakMap<object, LobbyPromoArtLoader>();

/** Decode complete PNG assets mounted from the independent locale_ui.rho archive. */
export function lobbyPromoArtLoader(library: PromoArtLibrary): LobbyPromoArtLoader {
  let load = loaders.get(library);
  if (!load) {
    load = async (canonicalPath, locale) => {
      const resource = library.canonicalCandidates(localizedPngPath(canonicalPath, locale))[0];
      if (!resource) return undefined;
      const decoded = await decodePngRgba(await resource.bytes());
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.putImageData(new ImageData(new Uint8ClampedArray(decoded.pixels),
        decoded.width, decoded.height), 0, 0);
      return { image: canvas, width: decoded.width, height: decoded.height };
    };
    loaders.set(library, load);
  }
  return load;
}
