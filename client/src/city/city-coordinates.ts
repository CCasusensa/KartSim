/**
 * 卡丁城 coordinates. The design (city-map.json, the server protocol) uses
 * x east, z south, y up with the origin at the fountain; the generated track
 * sits in the engine's world with the design shifted so client coordinates
 * are positive (client x = design x + 1200, client y = 1200 − design z).
 * In the three.js world that is x = design x + 1200, z = design z − 1200.
 */
import cityMap from "./city-map.json";

const extent = cityMap.meta.extent;
export const OFFSET_X = -(extent[0]?.[0] ?? -1200);
export const OFFSET_Z = extent[1]?.[1] ?? 1200;

export function designToWorld(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: x + OFFSET_X, y, z: z - OFFSET_Z };
}

export function worldToDesign(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: x - OFFSET_X, y, z: z + OFFSET_Z };
}

/** Physics heading (body.forward = (sin h, 0, cos h)) for a design heading in degrees (0 = north, clockwise). */
export function physicsHeading(degrees: number): number {
  return Math.PI - (degrees * Math.PI) / 180;
}

/** Design heading in degrees for a world forward vector. */
export function designHeading(forward: { x: number; z: number }): number {
  const degrees = (Math.atan2(forward.x, -forward.z) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

interface RoadSample { x: number; z: number; tx: number; tz: number }
let roadSamples: RoadSample[] | undefined;

/** Road centre-line samples (design coordinates) for "reset to the nearest road". */
export function roadSamplePoints(): RoadSample[] {
  if (roadSamples) return roadSamples;
  const samples: RoadSample[] = [];
  for (const road of cityMap.roads) {
    const points = road.points as number[][];
    const count = road.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      const dx = (b[0] ?? 0) - (a[0] ?? 0), dz = (b[1] ?? 0) - (a[1] ?? 0);
      const length = Math.hypot(dx, dz) || 1;
      const steps = Math.max(1, Math.ceil(length / 10));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        samples.push({ x: (a[0] ?? 0) + dx * t, z: (a[1] ?? 0) + dz * t, tx: dx / length, tz: dz / length });
      }
    }
  }
  roadSamples = samples;
  return samples;
}

/** The nearest road sample to a design position. */
export function nearestRoadPoint(x: number, z: number): RoadSample {
  let best = roadSamplePoints()[0]!;
  let bestDistance = Infinity;
  for (const sample of roadSamplePoints()) {
    const d = (sample.x - x) ** 2 + (sample.z - z) ** 2;
    if (d < bestDistance) { bestDistance = d; best = sample; }
  }
  return best;
}

/** The district containing a design point. */
export function districtAt(x: number, z: number): { id: string; name: string } | undefined {
  for (const d of cityMap.districts) {
    if (d.circle) { const [cx, cz, r] = d.circle; if (Math.hypot(x - (cx ?? 0), z - (cz ?? 0)) <= (r ?? 0)) return d; }
  }
  for (const d of cityMap.districts) {
    if (!d.polygon) continue;
    let inside = false;
    const polygon = d.polygon as number[][];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i]!, [xj, zj] = polygon[j]!;
      if (((zi ?? 0) > z) !== ((zj ?? 0) > z) &&
          x < (((xj ?? 0) - (xi ?? 0)) * (z - (zi ?? 0))) / ((zj ?? 0) - (zi ?? 0)) + (xi ?? 0)) inside = !inside;
    }
    if (inside) return d;
  }
  return undefined;
}
