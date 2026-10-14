import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { StaticTrackSurface } from "../world/static-track-surface";
import { applyCityKerbs, decodeKerbs, encodeKerbs, findKerbFaces, isKerbFace, triangleChecksum } from "./city-kerbs";

(globalThis as { document?: unknown }).document ??= { createElement: () => ({ relList: { supports: () => true } }) };
const { Oo, di0 } = await import("../generated/driving.js") as never as { Oo: never; di0: never };
const { Vm } = await import("../generated/formats.js") as never as { Vm: never };
const dependencies = { p3553ObbQuery: Oo, p3553ObbBounds: di0, roadDescriptorIssue: Vm };

type P = { x: number; y: number; z: number };
const road = { road: { text: "", children: [], attributes: [] } };
function triangle(a: P, b: P, c: P) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const l = Math.hypot(n.x, n.y, n.z);
  return { a, b, c, normal: { x: n.x / l, y: n.y / l, z: n.z / l }, auxiliaryDirection: { x: 1, y: 0, z: 0 }, roadDescriptor: road };
}
const p = (x: number, y: number, z: number) => ({ x, y, z });
/** A level floor over x0…x1, z0…z1 at height y (facing up). */
const floor = (x0: number, x1: number, z0: number, z1: number, y: number) =>
  [triangle(p(x0, y, z0), p(x0, y, z1), p(x1, y, z1)), triangle(p(x0, y, z0), p(x1, y, z1), p(x1, y, z0))];
/** A face across z0…z1 at x, from y0 to y1, facing −x. */
const face = (x: number, z0: number, z1: number, y0: number, y1: number) =>
  [triangle(p(x, y0, z0), p(x, y1, z1), p(x, y1, z0)), triangle(p(x, y0, z0), p(x, y0, z1), p(x, y1, z1))];

/**
 * Two streets (road at y 0 for x < 0, pavement at 0.15 for x > 0): along
 * z 0…10 a plain kerb with a building wall 5 m back; along z 20…30 a kerb
 * with a fence standing right on it.
 */
function city() {
  const triangles = [
    ...floor(-10, 0, 0, 10, 0), ...floor(0, 5, 0, 10, 0.15),
    ...face(0, 0, 10, 0, 0.15), // 4, 5: the kerb
    ...face(5, 0, 10, 0.15, 3), // 6, 7: the building
    ...floor(-10, 0, 20, 30, 0), ...floor(0, 5, 20, 30, 0.15),
    ...face(0, 20, 30, 0, 0.15), // 12, 13: a kerb under a fence
    ...face(0.2, 20, 30, 0.15, 1.2), // 14, 15: the fence
  ];
  return new StaticTrackSurface(triangles as never, Oo, dependencies as never);
}

test("a low step up onto a pavement is a kerb; walls and steps with something on them are not", () => {
  const surface = city();
  const t = surface.triangles as never as Parameters<typeof isKerbFace>[1][];
  assert.equal(isKerbFace(surface as never, t[4]!), true);
  assert.equal(isKerbFace(surface as never, t[5]!), true);
  assert.equal(isKerbFace(surface as never, t[6]!), false);
  assert.equal(isKerbFace(surface as never, t[12]!), false);
  assert.equal(isKerbFace(surface as never, t[14]!), false);
  // A step higher than the kart climbs is a wall.
  assert.equal(isKerbFace(surface as never, t[4]!, 0.1), false);
  assert.deepEqual(findKerbFaces(surface as never, t), [4, 5]);
});

test("the kart's box passes the listed kerb faces while rays still meet them", () => {
  const surface = city();
  const box = { center: p(-0.1, 0.4, 5), axes: [p(1, 0, 0), p(0, 1, 0), p(0, 0, 1)], halfExtents: [0.4, 0.35, 0.6] };
  const walls = () => surface.queryObb(box).filter(hit => Math.abs(hit.normal.y) < 0.5).length;
  assert.ok(walls() > 0);
  const triangles = surface.triangles as never as Parameters<typeof triangleChecksum>[0];
  const bytes = encodeKerbs(triangles.length, triangleChecksum(triangles), [4, 5]);
  assert.deepEqual(decodeKerbs(bytes).indices, [4, 5]);
  assert.equal(applyCityKerbs(surface as never, bytes), 2);
  assert.equal(walls(), 0);
  // The kerb face still stops a ray (walkers, the camera).
  assert.ok(Number.isFinite(surface.queryBest(p(-1, 0.05, 5), p(2, 0, 0), true)));
  // A list for other collision is refused.
  assert.throws(() => applyCityKerbs(city() as never, encodeKerbs(3, 0, [1])), /不符/);
});

test("kerb lists round-trip far indices", () => {
  const indices = [0, 1, 127, 128, 16_383, 16_384, 979_385];
  assert.deepEqual(decodeKerbs(encodeKerbs(979_386, 0xdeadbeef, indices)), { triangleCount: 979_386, checksum: 0xdeadbeef, indices });
  assert.throws(() => decodeKerbs(new Uint8Array(8)), /格式/);
});

const rho = new URL("../../../mirror/p3553/track_kartcity.rho", import.meta.url);
test("city-kerbs.bin belongs to the registered city collision", { skip: !existsSync(rho) && "mirror/p3553 is not in this checkout" }, async () => {
  const { diskSource } = await import("../../tools/city/register-container.mjs") as never as { diskSource(path: string): never };
  const { scanRhoArchiveIndex } = await import("../codecs/rho-index-scan");
  const { RhoReader } = await import("../codecs/rho");
  const formats = await import("../generated/formats.js") as never as { YW: (...args: never[]) => { collisionTriangles: never[] }; y9: (bytes: Uint8Array) => never };
  const source = diskSource(rho.pathname);
  const track = await new RhoReader(source, await scanRhoArchiveIndex(source)).read("track.1s");
  const design = JSON.parse(readFileSync(new URL("./city-map.json", import.meta.url), "utf8"));
  const [[x0, z0], [x1, z1]] = design.meta.extent;
  const admitted = formats.YW(formats.y9(new Uint8Array(track as Uint8Array)), "time-attack" as never,
    { roadExtent: Math.max(x1 - x0, z1 - z0) + 1 } as never);
  const kerbs = decodeKerbs(new Uint8Array(readFileSync(new URL("./city-kerbs.bin", import.meta.url))));
  assert.equal(kerbs.triangleCount, admitted.collisionTriangles.length);
  assert.equal(kerbs.checksum, triangleChecksum(admitted.collisionTriangles));
  assert.ok(kerbs.indices.length > 10_000);
});
