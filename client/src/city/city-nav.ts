/**
 * 卡丁城导航 (design/open-world/PLAN.md "导航"): the road network the M map
 * routes on. tools/city/build-city-nav.mjs writes city-nav.bin from the
 * city's native collision and the Vice City road surfaces: 2 m cells, each
 * with one or two ground layers (a deck over a road), road cells and the
 * slower connectors around them (kerbs, aprons, bridge decks).
 *
 * A destination grows a distance field from its node over the whole network
 * (Dijkstra, a few milliseconds a frame); from then on the route from
 * anywhere is the chain of next-hops, so driving off the route re-routes for
 * free.
 */

/** Neighbour offsets (cells), the bit order of a node's edge mask. */
export const NAV_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
export const NAV_MAGIC = 0x564e434b; // "KCNV"
export const NAV_VERSION = 1;

/** How much slower a connector cell is than road, and road near its edge than its middle. */
export const CONNECTOR_COST = 4;
const EDGE_COST = [1.9, 1.4, 1.15, 1.05, 1];

export interface NavPoint { x: number; z: number }

export class CityNav {
  readonly cell: number;
  readonly x0: number;
  readonly z0: number;
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly seaLevel: number;
  /** The cell of each node. */
  readonly nodeCell: Int32Array;
  /** The first (lower) node of each cell, -1 for none. */
  readonly cellFirst: Int32Array;
  readonly edges: Uint16Array;
  readonly road: Uint8Array;
  /** Cost factor of entering each node. */
  readonly factor: Float32Array;
  /** Two-layer cells (ascending) and their layer heights (m). */
  private readonly multiCells: Uint32Array;
  private readonly multiHeights: Float32Array;

  constructor(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0;
    const u8 = () => view.getUint8(at++), u16 = () => { const v = view.getUint16(at, true); at += 2; return v; };
    const i16 = () => { const v = view.getInt16(at, true); at += 2; return v; };
    const u32 = () => { const v = view.getUint32(at, true); at += 4; return v; };
    const f32 = () => { const v = view.getFloat32(at, true); at += 4; return v; };
    if (u32() !== NAV_MAGIC) throw new Error("导航数据格式不对。");
    if (u16() !== NAV_VERSION) throw new Error("导航数据版本不对。");
    u16();
    this.cell = f32(); this.x0 = f32(); this.z0 = f32();
    this.width = u16(); this.height = u16();
    this.count = u32();
    const runs = u32(), multi = u32();
    this.seaLevel = f32();
    const runData = new Uint16Array(runs * 3);
    for (let i = 0; i < runData.length; i++) runData[i] = u16();
    this.multiCells = new Uint32Array(multi);
    for (let i = 0; i < multi; i++) this.multiCells[i] = u32();
    this.multiHeights = new Float32Array(multi * 2);
    for (let i = 0; i < this.multiHeights.length; i++) this.multiHeights[i] = i16() / 10;
    this.edges = new Uint16Array(this.count);
    for (let i = 0; i < this.count; i++) this.edges[i] = u16();
    this.road = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) this.road[i] = u8();
    if (at !== bytes.byteLength) throw new Error("导航数据长度不对。");

    this.nodeCell = new Int32Array(this.count);
    this.cellFirst = new Int32Array(this.width * this.height).fill(-1);
    let id = 0, next = 0;
    for (let r = 0; r < runs; r++) {
      const z = runData[r * 3]!, x = runData[r * 3 + 1]!, length = runData[r * 3 + 2]!;
      for (let c = 0; c < length; c++) {
        const cell = z * this.width + x + c;
        this.cellFirst[cell] = id;
        this.nodeCell[id++] = cell;
        if (next < multi && this.multiCells[next] === cell) { this.nodeCell[id++] = cell; next++; }
      }
    }
    if (id !== this.count || next !== multi) throw new Error("导航数据节点数不对。");
    this.factor = this.costFactors();
  }

  /** The node across direction d of n, -1 when there is no edge. */
  neighbour(n: number, d: number): number {
    const bits = this.edges[n]!;
    if (!(bits & (1 << d))) return -1;
    const cell = this.nodeCell[n]!, [dx, dz] = NAV_DIRECTIONS[d]!;
    return this.cellFirst[cell + dz * this.width + dx]! + ((bits >> (d + 8)) & 1);
  }

  /** Design x/z of a node's cell centre. */
  point(n: number): NavPoint {
    const cell = this.nodeCell[n]!;
    return { x: this.x0 + ((cell % this.width) + 0.5) * this.cell, z: this.z0 + (Math.floor(cell / this.width) + 0.5) * this.cell };
  }

  /** The node of a cell nearest a height (two-layer cells pick by height). */
  private nodeInCell(cell: number, y: number | undefined): number {
    const first = this.cellFirst[cell]!;
    if (first < 0) return -1;
    if (first + 1 >= this.count || this.nodeCell[first + 1] !== cell || y === undefined) return first;
    let low = 0, high = this.multiCells.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1, value = this.multiCells[mid]!;
      if (value === cell) {
        const lower = this.multiHeights[mid * 2]!, upper = this.multiHeights[mid * 2 + 1]!;
        return Math.abs(y - upper) < Math.abs(y - lower) ? first + 1 : first;
      }
      if (value < cell) low = mid + 1; else high = mid - 1;
    }
    return first;
  }

  /**
   * The network node nearest a design point within radius m (a kart on the
   * grass, a click beside the road), preferring the layer nearest y; accept
   * narrows the candidates (for example to nodes a field reached).
   */
  nearest(x: number, z: number, radius = 60, y?: number, accept?: (node: number) => boolean): number {
    const cx = Math.floor((x - this.x0) / this.cell), cz = Math.floor((z - this.z0) / this.cell);
    const rings = Math.ceil(radius / this.cell);
    let best = -1, bestDistance = Infinity;
    for (let r = 0; r <= rings; r++) {
      // A hit at ring r may still lose to one in ring r + 1 (corner vs side).
      if (best >= 0 && (r - 1) * this.cell > bestDistance) break;
      for (let dz = -r; dz <= r; dz++) {
        const z1 = cz + dz;
        if (z1 < 0 || z1 >= this.height) continue;
        const step = Math.abs(dz) === r ? 1 : 2 * r;
        for (let dx = -r; dx <= r; dx += step || 1) {
          const x1 = cx + dx;
          if (x1 < 0 || x1 >= this.width) continue;
          const cell = z1 * this.width + x1;
          let node = this.nodeInCell(cell, y);
          if (node < 0) continue;
          if (accept && !accept(node)) {
            // The other layer of a two-layer cell may still do.
            const first = this.cellFirst[cell]!, other = node === first ? first + 1 : first;
            if (other < this.count && this.nodeCell[other] === cell && accept(other)) node = other;
            else continue;
          }
          const p = this.point(node), distance = Math.hypot(p.x - x, p.z - z);
          if (distance < bestDistance && distance <= radius) { best = node; bestDistance = distance; }
        }
      }
    }
    return best;
  }

  /** Road is cheaper in its middle; connectors cost CONNECTOR_COST. */
  private costFactors(): Float32Array {
    const factor = new Float32Array(this.count);
    const depth = new Uint8Array(this.count).fill(255);
    let frontier: number[] = [];
    for (let n = 0; n < this.count; n++) {
      if (!this.road[n]) { factor[n] = CONNECTOR_COST; continue; }
      // Road at its rim: a missing neighbour or a connector one.
      let rim = false;
      for (let d = 0; d < 8 && !rim; d++) {
        const m = this.neighbour(n, d);
        rim = m < 0 || !this.road[m];
      }
      if (rim) { depth[n] = 0; frontier.push(n); }
    }
    for (let ring = 1; ring < EDGE_COST.length && frontier.length; ring++) {
      const next: number[] = [];
      for (const n of frontier) for (let d = 0; d < 4; d++) {
        const m = this.neighbour(n, d);
        if (m >= 0 && this.road[m] && depth[m] === 255) { depth[m] = ring; next.push(m); }
      }
      frontier = next;
    }
    for (let n = 0; n < this.count; n++) if (this.road[n]) factor[n] = EDGE_COST[Math.min(depth[n]!, EDGE_COST.length - 1)]!;
    return factor;
  }
}

/** A binary min-heap of nodes keyed by a float (lazy decrease-key). */
class NodeHeap {
  private keys = new Float64Array(1024);
  private nodes = new Int32Array(1024);
  size = 0;
  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2), nodes = new Int32Array(this.size * 2);
      keys.set(this.keys); nodes.set(this.nodes);
      this.keys = keys; this.nodes = nodes;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.keys[i] = this.keys[parent]!; this.nodes[i] = this.nodes[parent]!;
      i = parent;
    }
    this.keys[i] = key; this.nodes[i] = node;
  }
  /** Pops the smallest; its key is left in `key`. */
  key = 0;
  pop(): number {
    const node = this.nodes[0]!;
    this.key = this.keys[0]!;
    const lastKey = this.keys[--this.size]!, lastNode = this.nodes[this.size]!;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1]! < this.keys[child]!) child++;
      if (this.keys[child]! >= lastKey) break;
      this.keys[i] = this.keys[child]!; this.nodes[i] = this.nodes[child]!;
      i = child;
    }
    this.keys[i] = lastKey; this.nodes[i] = lastNode;
    return node;
  }
}

/**
 * The distance (m, weighted) from every node to a goal node, grown a slice
 * at a time; next[n] is the neighbour of n on its way to the goal.
 */
export class NavField {
  readonly distance: Float32Array;
  readonly next: Int32Array;
  readonly closed: Uint8Array;
  private readonly heap = new NodeHeap();
  done = false;

  constructor(readonly nav: CityNav, readonly goal: number) {
    this.distance = new Float32Array(nav.count).fill(Infinity);
    this.next = new Int32Array(nav.count).fill(-1);
    this.closed = new Uint8Array(nav.count);
    this.distance[goal] = 0;
    this.heap.push(0, goal);
  }

  /** Settles nodes until the budget (ms of now()) runs out; true once the whole network is done. */
  grow(budgetMs: number, now: () => number = () => performance.now()): boolean {
    if (this.done) return true;
    const { nav, distance, next, closed, heap } = this;
    const until = now() + budgetMs;
    let steps = 0;
    while (heap.size) {
      const n = heap.pop(), key = heap.key;
      if (closed[n]) continue;
      closed[n] = 1;
      for (let d = 0; d < 8; d++) {
        const m = nav.neighbour(n, d);
        if (m < 0 || closed[m]) continue;
        // Symmetric edges: the cost of m → n is the cost of entering n.
        const value = key + (d < 4 ? 1 : Math.SQRT2) * nav.cell * nav.factor[n]!;
        if (value < distance[m]!) { distance[m] = value; next[m] = n; heap.push(value, m); }
      }
      if ((++steps & 1023) === 0 && now() >= until) return false;
    }
    this.done = true;
    return true;
  }

  /** The cell-centre chain from a settled node to the goal; undefined while not settled. */
  chain(from: number): NavPoint[] | undefined {
    if (!this.closed[from]) return undefined;
    const points: NavPoint[] = [];
    for (let n = from, guard = 0; n >= 0 && guard <= this.nav.count; n = this.next[n]!, guard++) {
      points.push(this.nav.point(n));
      if (n === this.goal) return points;
    }
    return undefined;
  }
}

/** Douglas–Peucker: the points a polyline needs within tolerance (m). */
export function simplify(points: readonly NavPoint[], tolerance = 1.5): NavPoint[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const p = points[a]!, q = points[b]!, dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz);
    let worst = -1, worstDistance = tolerance;
    for (let i = a + 1; i < b; i++) {
      const r = points[i]!;
      const distance = length < 1e-9 ? Math.hypot(r.x - p.x, r.z - p.z) : Math.abs(dx * (p.z - r.z) - dz * (p.x - r.x)) / length;
      if (distance > worstDistance) { worst = i; worstDistance = distance; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Rounds a polyline's corners: each bend is cut radius m (at most a third
 * of either leg) before and after the vertex and joined by a quadratic
 * curve, so a route bends along the road instead of in grid steps.
 */
export function roundCorners(points: readonly NavPoint[], radius = 6, steps = 4): NavPoint[] {
  if (points.length < 3) return points.slice();
  const out: NavPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const la = Math.hypot(b.x - a.x, b.z - a.z), lc = Math.hypot(c.x - b.x, c.z - b.z);
    const cut = Math.min(radius, la / 3, lc / 3);
    if (cut < 0.2) { out.push(b); continue; }
    const p = { x: b.x + ((a.x - b.x) / la) * cut, z: b.z + ((a.z - b.z) / la) * cut };
    const q = { x: b.x + ((c.x - b.x) / lc) * cut, z: b.z + ((c.z - b.z) / lc) * cut };
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push({ x: u * u * p.x + 2 * u * t * b.x + t * t * q.x, z: u * u * p.z + 2 * u * t * b.z + t * t * q.z });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Length (m) of a polyline. */
export function pathLength(points: readonly NavPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  return length;
}

/** gzip bytes → bytes (browser DecompressionStream). */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let loading: Promise<CityNav> | undefined;

/** The city's network, loaded once (city-nav.bin is a Vite asset). */
export function loadCityNav(): Promise<CityNav> {
  loading ??= (async () => {
    const response = await fetch(new URL("./city-nav.bin", import.meta.url).href);
    if (!response.ok) throw new Error(`导航数据下载失败（${response.status}）。`);
    return new CityNav(await gunzip(new Uint8Array(await response.arrayBuffer())));
  })();
  loading.catch(() => { loading = undefined; });
  return loading;
}
