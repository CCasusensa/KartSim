/**
 * Centre lines of a (closed) road raster: Zhang–Suen thinning like
 * vice-city-navigation.py, then the skeleton pixels are chained between
 * junction and end pixels. Neighbouring pixels only link when their road
 * heights differ by at most `maxStep` m, so a road never joins one it
 * passes over.
 */

const OFFSETS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];

/** Thins the raster's road cells to one-pixel lines (a Uint8Array mask). */
export function thin(raster) {
  const { width, height, heights } = raster;
  const skeleton = new Uint8Array(width * height);
  let active = [];
  for (let i = 0; i < skeleton.length; i++) if (Number.isFinite(heights[i])) { skeleton[i] = 1; active.push(i); }
  const at = (row, col) => (row < 0 || col < 0 || row >= height || col >= width ? 0 : skeleton[row * width + col]);
  for (let iteration = 0; iteration < 600; iteration++) {
    let removed = 0;
    for (let phase = 0; phase < 2; phase++) {
      const doomed = [];
      for (const i of active) {
        if (!skeleton[i]) continue;
        const row = Math.floor(i / width), col = i % width;
        const n = OFFSETS.map(([dy, dx]) => at(row + dy, col + dx));
        let degree = 0, transitions = 0;
        for (let k = 0; k < 8; k++) {
          degree += n[k];
          if (!n[k] && n[(k + 1) % 8]) transitions++;
        }
        if (degree < 2 || degree > 6 || transitions !== 1) continue;
        const guard = phase === 0
          ? !(n[0] && n[2] && n[4]) && !(n[2] && n[4] && n[6])
          : !(n[0] && n[2] && n[6]) && !(n[0] && n[4] && n[6]);
        if (guard) doomed.push(i);
      }
      for (const i of doomed) skeleton[i] = 0;
      removed += doomed.length;
    }
    if (!removed) break;
    active = active.filter(i => skeleton[i]);
  }
  return skeleton;
}

/**
 * The skeleton as polylines [[x, z, y], ...] (design coordinates) between
 * pixels that are not plain line pixels; pieces shorter than `minLength`
 * m are dropped (none by default: the graph merges what is short).
 */
export function skeletonLines(raster, skeleton, { maxStep = 1.0, minLength = 0 } = {}) {
  const { width, height, heights, step, minX, minZ } = raster;
  const links = new Map();
  const has = (row, col) => row >= 0 && col >= 0 && row < height && col < width && skeleton[row * width + col];
  for (let i = 0; i < skeleton.length; i++) {
    if (!skeleton[i]) continue;
    const row = Math.floor(i / width), col = i % width;
    const list = [];
    for (const [dy, dx] of [[-1, 0], [0, -1], [0, 1], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      if (!has(row + dy, col + dx)) continue;
      // A diagonal step that a straight one already covers would make a triangle.
      if (dx && dy && (has(row, col + dx) || has(row + dy, col))) continue;
      const j = (row + dy) * width + col + dx;
      if (Math.abs(heights[i] - heights[j]) <= maxStep) list.push(j);
    }
    links.set(i, list);
  }
  const world = i => [minX + (i % width) * step, minZ + Math.floor(i / width) * step, Math.round(heights[i] * 1000) / 1000];
  const used = new Set();
  const edgeKey = (a, b) => (a < b ? a * 1e8 + b : b * 1e8 + a);
  const lines = [];
  const starts = [...links.keys()].filter(i => links.get(i).length !== 2);
  for (const start of [...starts, ...links.keys()]) {
    for (const first of links.get(start)) {
      if (used.has(edgeKey(start, first))) continue;
      const chain = [start];
      let previous = start, current = first;
      for (;;) {
        used.add(edgeKey(previous, current));
        chain.push(current);
        const next = links.get(current).filter(p => p !== previous);
        if (current === start || links.get(current).length !== 2 || !next.length) break;
        if (used.has(edgeKey(current, next[0]))) break;
        previous = current;
        current = next[0];
      }
      const points = chain.map(world);
      let length = 0;
      for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
      // A closed chain ends on its first pixel again (the graph makes it a loop).
      if (length >= minLength) lines.push({ points });
    }
  }
  return lines;
}
