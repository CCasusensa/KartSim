/**
 * 卡丁城的马路沿（server-go/CITY.md「马路沿」）：城市里卡丁车缩到一半，车身
 * 碰撞盒离地只有 0.15 m，15–17 cm 的路缘立面就成了墙，车开不上人行道，还会
 * 记一次碰撞。这里找出这些低矮台阶的立面——顶边后面紧接着一块能站上去的
 * 地面、前面的地面低 2 cm～KERB_MAX_STEP、台阶上没有别的东西挡着——让车身
 * 碰撞盒穿过它们（StaticTrackSurface.obbIgnored）。车轮射线照常看得到路沿
 * 顶面，车靠悬挂自己爬上去；步行的人和镜头也照旧把它当实体。
 *
 * 找一遍要几秒，所以由 tools/city/build-city-kerbs.mjs 离线算好写进
 * city-kerbs.bin（三角形编号的差分变长整数），进城时按三角形个数和抽样
 * 校验和对上再用。
 */

interface Vec3 { x: number; y: number; z: number }
interface KerbTriangle { a: Vec3; b: Vec3; c: Vec3; normal: Vec3 }
interface KerbSurface {
  queryBest(origin: Vec3, movement: Vec3, includeWalls: boolean): number;
  buildHit(origin: Vec3, movement: Vec3, fraction: number): { point: Vec3; normal: Vec3 };
}

/** The highest step (m) a city kart climbs on its wheels. */
export const KERB_MAX_STEP = 0.3;
/** A face this steep (|normal.y| below it) is a wall to the kart (track-collision.ts uses 0.65). */
const STEEP = 0.5;
/** A floor this level (normal.y) is ground one can stand on. */
const LEVEL = 0.65;
/** How far (m) beside the face the floors are probed. */
const BESIDE = 0.25;

export const KERB_MAGIC = 0x4b455242; // "KERB"
export const KERB_VERSION = 1;

function floorAt(surface: KerbSurface, x: number, z: number, from: number, depth: number): Vec3 | undefined {
  const origin = { x, y: from, z }, movement = { x: 0, y: -depth, z: 0 };
  const fraction = surface.queryBest(origin, movement, false);
  if (!Number.isFinite(fraction)) return undefined;
  const hit = surface.buildHit(origin, movement, fraction);
  return hit.normal.y >= LEVEL ? hit.point : undefined;
}

/**
 * Whether triangle t is a kerb face: a steep face no taller than maxStep
 * whose top edge meets level ground on one side, with lower level ground
 * (2 cm … maxStep below) on the other side and nothing standing on the step.
 */
export function isKerbFace(surface: KerbSurface, t: KerbTriangle, maxStep = KERB_MAX_STEP): boolean {
  const n = t.normal;
  if (Math.abs(n.y) >= STEEP) return false;
  const top = Math.max(t.a.y, t.b.y, t.c.y), bottom = Math.min(t.a.y, t.b.y, t.c.y);
  if (top - bottom > maxStep) return false;
  const h = Math.hypot(n.x, n.z) || 1, nx = n.x / h, nz = n.z / h;
  const cx = (t.a.x + t.b.x + t.c.x) / 3, cz = (t.a.z + t.b.z + t.c.z) / 3;
  for (const side of [1, -1]) {
    // side: +1 the lower floor lies along the normal, −1 against it.
    const high = floorAt(surface, cx - nx * BESIDE * side, cz - nz * BESIDE * side, top + 0.3, 0.6);
    if (!high || Math.abs(high.y - top) > 0.06) continue;
    const low = floorAt(surface, cx + nx * BESIDE * side, cz + nz * BESIDE * side, top + 0.05, maxStep + 0.3);
    if (!low || top - low.y > maxStep || top - low.y < 0.02) continue;
    // A kart-high sweep from the low side over the top edge meets no wall.
    const origin = { x: cx + nx * 0.3 * side, y: top + 0.12, z: cz + nz * 0.3 * side };
    const movement = { x: -nx * 0.8 * side, y: 0, z: -nz * 0.8 * side };
    if (Number.isFinite(surface.queryBest(origin, movement, true))) continue;
    return true;
  }
  return false;
}

/** The indices of the kerb faces among the surface's triangles. */
export function findKerbFaces(surface: KerbSurface, triangles: readonly KerbTriangle[], maxStep = KERB_MAX_STEP): number[] {
  const kerbs: number[] = [];
  triangles.forEach((triangle, index) => { if (isKerbFace(surface, triangle, maxStep)) kerbs.push(index); });
  return kerbs;
}

/** FNV-1a over the triangle count and every 997th triangle's corners (cm): which collision a kerb list belongs to. */
export function triangleChecksum(triangles: readonly KerbTriangle[]): number {
  let h = 0x811c9dc5;
  const mix = (value: number) => { h = Math.imul(h ^ (value | 0), 0x01000193) >>> 0; };
  mix(triangles.length);
  for (let i = 0; i < triangles.length; i += 997) {
    const t = triangles[i]!;
    for (const p of [t.a, t.b, t.c]) { mix(Math.round(p.x * 100)); mix(Math.round(p.y * 100)); mix(Math.round(p.z * 100)); }
  }
  return h;
}

/** city-kerbs.bin: magic, version, triangle count, checksum, kerb count (u32 LE), then index deltas as varints. */
export function encodeKerbs(triangleCount: number, checksum: number, indices: readonly number[]): Uint8Array {
  const bytes: number[] = [];
  const header = new DataView(new ArrayBuffer(20));
  [KERB_MAGIC, KERB_VERSION, triangleCount, checksum, indices.length].forEach((value, i) => header.setUint32(i * 4, value, true));
  bytes.push(...new Uint8Array(header.buffer));
  let previous = 0;
  for (const index of indices) {
    let delta = index - previous;
    previous = index;
    while (delta >= 0x80) { bytes.push((delta & 0x7f) | 0x80); delta >>>= 7; }
    bytes.push(delta);
  }
  return new Uint8Array(bytes);
}

export function decodeKerbs(bytes: Uint8Array): { triangleCount: number; checksum: number; indices: number[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== KERB_MAGIC || view.getUint32(4, true) !== KERB_VERSION)
    throw new Error("city-kerbs.bin 格式不对。");
  const triangleCount = view.getUint32(8, true), checksum = view.getUint32(12, true), count = view.getUint32(16, true);
  const indices: number[] = [];
  let at = 20, previous = 0;
  for (let i = 0; i < count; i++) {
    let delta = 0, shift = 0, byte: number;
    do {
      if (at >= bytes.byteLength) throw new Error("city-kerbs.bin 不完整。");
      byte = bytes[at++]!;
      delta += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    previous += delta;
    indices.push(previous);
  }
  return { triangleCount, checksum, indices };
}

/**
 * Lets the kart's collision box pass the kerb faces of `bytes` on the
 * city's surface. Throws when the list was built for other collision
 * (rebuild with build-city-kerbs.mjs); returns how many faces it marked.
 */
export function applyCityKerbs(surface: { triangles: readonly KerbTriangle[]; obbIgnored?: Uint8Array }, bytes: Uint8Array): number {
  const kerbs = decodeKerbs(bytes);
  if (kerbs.triangleCount !== surface.triangles.length || kerbs.checksum !== triangleChecksum(surface.triangles))
    throw new Error("city-kerbs.bin 与当前卡丁城碰撞不符，需要用 build-city-kerbs.mjs 重新生成。");
  const ignored = surface.obbIgnored ?? new Uint8Array(surface.triangles.length);
  for (const index of kerbs.indices) ignored[index] = 1;
  surface.obbIgnored = ignored;
  return kerbs.indices.length;
}

/** The city's kerb list (a Vite asset next to this module). */
export async function loadCityKerbs(): Promise<Uint8Array> {
  const response = await fetch(new URL("./city-kerbs.bin", import.meta.url).href);
  if (!response.ok) throw new Error(`city-kerbs.bin ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
