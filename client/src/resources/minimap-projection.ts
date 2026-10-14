/**
 * The HUD minimap (`oI` in generated/library.js) places the track's
 * xt_minimap.png and every racer marker with the track's own ToMinimap
 * record: canvas texel = 128 + (x - centerX) * scale, 128 - (y - centerY) * scale.
 * The original data has a few tracks whose map art was drawn with a
 * different projection, so the road on the minimap and the markers drift
 * apart. Those tracks keep their art and take the projection it was drawn with.
 */
export interface MinimapProjection {
  centerX: number;
  centerY: number;
  scale: number;
}

/** track_/china_R01/track.1s ToMinimap. */
const CHINA_R01: MinimapProjection = {
  centerX: 910.6017456054688, centerY: 803.107666015625, scale: 0.2286231815814972,
};

/** track_/desert_R02/track.1s ToMinimap. */
const DESERT_R02: MinimapProjection = {
  centerX: 560.2811279296875, centerY: 867.1986083984375, scale: 0.16869057714939117,
};

const projections = new Map<string, MinimapProjection>([
  // 滨海大道 火车: xt_minimap.png and xt_bigmap.png follow an older frame of
  // the course (ToMinimap says 452.3/605.8 at 0.3). Fitted against the
  // track's road and sand surfaces: the piers, both turntables and the
  // beach road land on the drawn road again.
  ["beach_r02", { centerX: 453.1, centerY: 546.5, scale: 0.2617 }],
  // Story-mode cuts ship the full track's map art byte for byte, but their
  // ToMinimap frames only the cut.
  ["china_r01_sn09", CHINA_R01],
  ["china_r01_sn10", CHINA_R01],
  ["desert_r02_sn15", DESERT_R02],
]);

/** The projection the track's minimap art was drawn with. */
export function minimapProjection<T extends MinimapProjection>(trackId: string, record: T): T {
  const projection = projections.get(trackId.toLowerCase());
  return projection ? { ...record, ...projection } : record;
}
