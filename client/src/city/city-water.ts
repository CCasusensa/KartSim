/** Water recovery is based on water surfaces, never distance from the highway. */
export interface CityCoastalWaterMap {
  kind?: 'coast-river-lake';
  coast: number[][];
  river: number[][];
  lake: { center: number[]; radius: number; level: number };
  seaLevel: number;
}

/** A shared sea plane under an imported city, including its separate islands. */
export interface CityOceanWaterMap {
  kind: 'ocean-plane';
  seaLevel: number;
}

export type CityWaterMap = CityCoastalWaterMap | CityOceanWaterMap;

function inside(x: number, z: number, polygon: number[][]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a[1]! > z) !== (b[1]! > z) && x < (b[0]! - a[0]!) * (z - a[1]!) / (b[1]! - a[1]!) + a[0]!) result = !result;
  }
  return result;
}

export function cityWaterLevel(world: CityWaterMap | undefined, x: number, z: number): number | undefined {
  if (!world) return undefined;
  // This is a surface elevation, not a land/water mask. Callers must compare
  // the kart's height so that streets, islands and bridges above it stay safe.
  if (world.kind === 'ocean-plane') return world.seaLevel;
  if (!inside(x, z, world.coast)) return world.seaLevel;
  const { lake } = world;
  if (Math.hypot(x - lake.center[0]!, z - lake.center[1]!) < lake.radius - 3) return lake.level;
  let nearest = Infinity, level: number | undefined;
  for (let i = 1; i < world.river.length; i++) {
    const a = world.river[i - 1]!, b = world.river[i]!;
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / (dx * dx + dz * dz || 1)));
    const distance = Math.hypot(x - a[0]! - t * dx, z - a[1]! - t * dz);
    if (distance < 29 && distance < nearest) {
      nearest = distance;
      level = a[2]! + (b[2]! - a[2]!) * t;
    }
  }
  return level;
}
