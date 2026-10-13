interface GroundVector { x: number; y: number; z: number }

export interface CityGroundTrack {
  rayQuery(origin: GroundVector, movement: GroundVector, includeWalls: boolean): {
    point: { y: number };
    normal: { y: number };
  } | undefined;
}

// Match the native static surface's walkable-plane threshold, but require the
// upward sign: native rays also return downward-facing bridge undersides.
const MIN_GROUND_NORMAL_Y = Math.fround(0.65);

/**
 * Choose the lowest upward road surface at or above hintY - 2, otherwise the
 * highest upward surface below it. This keeps a tunnel floor below its roof
 * and a bridge deck above its real solid underside when placing a kart.
 */
export function groundHeightAt(track: CityGroundTrack, x: number, z: number, hintY: number): number | undefined {
  const hits: number[] = [];
  let y = Math.max(800, hintY + 100);
  for (let i = 0; i < 8 && y > -40; i++) {
    const hit = track.rayQuery({ x, y, z }, { x: 0, y: -(y + 40), z: 0 }, false);
    if (!hit) break;
    if (hit.normal.y >= MIN_GROUND_NORMAL_Y) hits.push(hit.point.y);
    // Continue below rejected ceilings too; their physical collision remains
    // intact and must not hide the accessible floor beneath them.
    y = hit.point.y - 0.05;
  }
  if (hits.length === 0) return undefined;
  const above = hits.filter(h => h >= hintY - 2);
  return above.length > 0 ? Math.min(...above) : Math.max(...hits);
}
