/**
 * 卡丁城 as a track: the generated container `track_kartcity.rho` is mounted
 * at `track_kartcity/` (no aaa.pk entry), so its id is "kartcity" and the
 * model path is `track_kartcity/track.1s`. The release track table does not
 * know it; this metadata override is what the race loader falls back to.
 */
import { registerTrackMetadata, trackMetadataOverride } from "../resources/track-overrides";
import cityMap from "./city-map.json";

export const CITY_TRACK_ID = "kartcity";
export const CITY_TRACK_PATH = "track_kartcity/track.1s";
export const CITY_CONTAINER = "track_kartcity.rho";

/** The design data (roads, districts, points of interest, rules). */
export const CITY_MAP = cityMap;

export function registerCityTrack(): void {
  if (trackMetadataOverride(CITY_TRACK_ID)) return;
  const extent = CITY_MAP.meta.extent;
  const size = Math.max((extent[1]?.[0] ?? 0) - (extent[0]?.[0] ?? 0), (extent[1]?.[1] ?? 0) - (extent[0]?.[1] ?? 0));
  registerTrackMetadata({
    id: CITY_TRACK_ID,
    cnTitle: CITY_MAP.meta.name,
    gameType: "speed",
    laps: 1,
    difficulty: 1,
    folder: CITY_TRACK_ID,
    theme: "village",
    texTheme: "village|world|china|beach|factory|forest|ice|wkc|park|mechanic",
    bgmTheme: "village",
    choosable: true,
    blocked: false,
    speedPool: false,
    roadExtent: size + 1,
  });
}
