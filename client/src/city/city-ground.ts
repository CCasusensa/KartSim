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
 * How far over the hint (m) the floor may lie: kerbs, cambered pavements and
 * traffic lanes drawn a little under their road; and how far under it.
 */
const REACH_ABOVE = 1;
const REACH_BELOW = 2;
/** A downward-wound floor counts this close (m) to the hint. */
const WOUND_DOWN_NEAR = 0.3;

/**
 * The floor under (x, z) for something at about hintY: the first upward
 * face dropping from REACH_ABOVE over the hint to REACH_BELOW under it, so a
 * pavement does not give way to an older floor hidden less than a metre
 * under it (卡丁城 果果's). A downward-wound face right at the hint is a
 * floor too: the kart's wheels stand on those all the same (跳跳's pavement).
 *
 * With nothing there, the lowest upward road surface above the hint,
 * otherwise the highest upward surface below it. This keeps a tunnel floor
 * below its roof and a bridge deck above its real solid underside when
 * placing a kart.
 */
export function groundHeightAt(track: CityGroundTrack, x: number, z: number, hintY: number): number | undefined {
  const bottom = hintY - REACH_BELOW;
  let from = hintY + REACH_ABOVE;
  // Rays without walls only meet flat faces.
  for (let i = 0; i < 8 && from > bottom; i++) {
    const hit = track.rayQuery({ x, y: from, z }, { x: 0, y: bottom - from, z: 0 }, false);
    if (!hit) break;
    if (hit.normal.y >= MIN_GROUND_NORMAL_Y || Math.abs(hit.point.y - hintY) <= WOUND_DOWN_NEAR) return hit.point.y;
    from = hit.point.y - 0.05;
  }
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
  const above = hits.filter(h => h >= hintY - REACH_BELOW);
  return above.length > 0 ? Math.min(...above) : Math.max(...hits);
}
