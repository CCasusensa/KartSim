/**
 * The drivable-asphalt raster of the Vice City map: the audited road
 * triangles (design/open-world/vice-city/assets/source-road-surfaces.json)
 * filled into a grid with the lowest road height per cell. Source triangles
 * are y-up world coordinates ×100, which are the design coordinates (x east,
 * z south). Traffic keeps the ramps and bridge approaches the recovery
 * roads leave out (vice-city-navigation.py stops at grade 0.20): the
 * Vice City bridges climb at up to about 0.25.
 */
import { readFileSync } from "node:fs";

export const RASTER_RULES = {
  /** Grid spacing (m). */
  step: 1,
  /** Steepest road triangle (rise over run) kept. */
  maxGrade: 0.4,
  /** Road triangles with their centroid outside this height range (m) are left out. */
  minHeight: 1,
  maxHeight: 80,
};

export class RoadRaster {
  constructor(minX, minZ, maxX, maxZ, step = RASTER_RULES.step) {
    this.minX = minX; this.minZ = minZ; this.step = step;
    this.width = Math.floor((maxX - minX) / step) + 1;
    this.height = Math.floor((maxZ - minZ) / step) + 1;
    this.heights = new Float32Array(this.width * this.height).fill(NaN);
  }

  /** Fills a triangle (points [x, y, z]) keeping the lower road at overpasses. */
  fill(a, b, c) {
    const { minX, minZ, step, width, height, heights } = this;
    const left = Math.max(0, Math.ceil((Math.min(a[0], b[0], c[0]) - minX) / step));
    const right = Math.min(width - 1, Math.floor((Math.max(a[0], b[0], c[0]) - minX) / step));
    const top = Math.max(0, Math.ceil((Math.min(a[2], b[2], c[2]) - minZ) / step));
    const bottom = Math.min(height - 1, Math.floor((Math.max(a[2], b[2], c[2]) - minZ) / step));
    if (right < left || bottom < top) return;
    const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-8) return;
    for (let row = top; row <= bottom; row++) {
      const z = minZ + row * step;
      for (let col = left; col <= right; col++) {
        const x = minX + col * step;
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
        const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const h = u * a[1] + v * b[1] + (1 - u - v) * c[1];
        const index = row * width + col;
        const old = heights[index];
        if (!(old <= h)) heights[index] = h;
      }
    }
  }

  cell(x, z) {
    const col = Math.round((x - this.minX) / this.step), row = Math.round((z - this.minZ) / this.step);
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return -1;
    return row * this.width + col;
  }

  /** Road height at a design point (nearest cell), NaN off the road. */
  heightAt(x, z) {
    const index = this.cell(x, z);
    return index < 0 ? NaN : this.heights[index];
  }

  isRoad(x, z) { return Number.isFinite(this.heightAt(x, z)); }

  /**
   * How far the road reaches from (x, z) along the unit direction (dx, dz)
   * before leaving the asphalt (m), tolerating gaps up to `gap` m (painted
   * lines and seams between source meshes) and stopping at `limit`.
   */
  reach(x, z, dx, dz, limit = 40, gap = 1.5) {
    let last = 0, missing = 0;
    const step = this.step * 0.5;
    for (let d = step; d <= limit; d += step) {
      if (this.isRoad(x + dx * d, z + dz * d)) { last = d; missing = 0; }
      else if ((missing += step) > gap) break;
    }
    return last;
  }

  /**
   * The first stretch of asphalt from (x, z) along (dx, dz): where it starts
   * (after up to `skip` m of median or kerb) and ends, in m from the point;
   * undefined when there is none.
   */
  run(x, z, dx, dz, skip = 14, limit = 40, gap = 1.5) {
    const step = this.step * 0.5;
    let start;
    for (let d = 0; d <= skip; d += step) {
      if (this.isRoad(x + dx * d, z + dz * d)) { start = d; break; }
    }
    if (start === undefined) return undefined;
    let end = start, missing = 0;
    for (let d = start + step; d <= limit; d += step) {
      if (this.isRoad(x + dx * d, z + dz * d)) { end = d; missing = 0; }
      else if ((missing += step) > gap) break;
    }
    return { start, end };
  }

  /**
   * A coarser copy (`step` m) with gaps and medians up to 2 × `radius` m
   * closed (square dilation then erosion); the cells it adds take the mean
   * height of the road around them.
   */
  closed(step, radius) {
    const out = new RoadRaster(this.minX, this.minZ, this.minX + (this.width - 1) * this.step,
      this.minZ + (this.height - 1) * this.step, step);
    const { width, height } = out;
    const mask = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const h = this.heightAt(out.minX + col * step, out.minZ + row * step);
      if (Number.isFinite(h)) { out.heights[row * width + col] = h; mask[row * width + col] = 1; }
    }
    const r = Math.max(0, Math.round(radius / step));
    const closedMask = erode(dilate(mask, width, height, r), width, height, r);
    // Heights of the added cells: repeated neighbour averaging, outward from the road.
    let pending = [];
    for (let i = 0; i < closedMask.length; i++) if (closedMask[i] && !mask[i]) pending.push(i);
    for (let pass = 0; pending.length && pass < 4 * r + 4; pass++) {
      const next = [], updates = [];
      for (const i of pending) {
        const row = Math.floor(i / width), col = i % width;
        let sum = 0, count = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = row + dr, cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
          const h = out.heights[rr * width + cc];
          if (Number.isFinite(h)) { sum += h; count++; }
        }
        if (count) updates.push([i, sum / count]); else next.push(i);
      }
      for (const [i, h] of updates) out.heights[i] = h;
      pending = next;
    }
    for (let i = 0; i < closedMask.length; i++) if (!closedMask[i]) out.heights[i] = NaN;
    return out;
  }
}

function dilate(mask, width, height, r) {
  return squareFilter(mask, width, height, r, 1);
}

function erode(mask, width, height, r) {
  return squareFilter(mask, width, height, r, 0);
}

/** Separable square max (keep = 1) or min (keep = 0) filter of radius r cells. */
function squareFilter(mask, width, height, r, keep) {
  if (r <= 0) return mask.slice();
  const rows = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let hit = !keep;
      for (let d = -r; d <= r; d++) {
        const c = col + d;
        const v = c < 0 || c >= width ? 0 : mask[row * width + c];
        if (keep ? v : !v) { hit = keep; break; }
      }
      rows[row * width + col] = hit ? 1 : 0;
    }
  }
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      let hit = !keep;
      for (let d = -r; d <= r; d++) {
        const rr = row + d;
        const v = rr < 0 || rr >= height ? 0 : rows[rr * width + col];
        if (keep ? v : !v) { hit = keep; break; }
      }
      out[row * width + col] = hit ? 1 : 0;
    }
  }
  return out;
}

/** The raster of the published Vice City asphalt within the map extent. */
export function loadRoadRaster(surfacesPath, extent, rules = RASTER_RULES) {
  const source = JSON.parse(readFileSync(surfacesPath, "utf8"));
  const [[minX, minZ], [maxX, maxZ]] = extent;
  const raster = new RoadRaster(minX, minZ, maxX, maxZ, rules.step);
  for (const triangle of source.triangles) {
    const height = triangle.centroid[1];
    if (triangle.grade > rules.maxGrade || !(height > rules.minHeight && height < rules.maxHeight)) continue;
    const [a, b, c] = triangle.points;
    raster.fill(a, b, c);
  }
  return raster;
}
