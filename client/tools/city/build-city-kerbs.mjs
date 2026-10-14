// Build the 卡丁城 kerb list (src/city/city-kerbs.bin): which native
// collision faces are low kerb steps the city karts climb on their wheels
// instead of hitting (src/city/city-kerbs.ts, server-go/CITY.md「马路沿」).
//
//   node --max-old-space-size=12000 --import ./src/physics/node-raw-test-hook.mjs --import tsx \
//     tools/city/build-city-kerbs.mjs [--check]
//
// Input: the registered city track (mirror/p3553/track_kartcity.rho). Rebuild
// whenever the track changes; the browser refuses a list whose triangle
// count or checksum does not match. --check rebuilds and compares with the
// committed file.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diskSource } from './register-container.mjs';
import { scanRhoArchiveIndex } from '../../src/codecs/rho-index-scan.ts';
import { RhoReader } from '../../src/codecs/rho.ts';
import { encodeKerbs, findKerbFaces, triangleChecksum } from '../../src/city/city-kerbs.ts';

const client = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return path.resolve(client, i < 0 ? fallback : args[i + 1]); };
const rhoFile = option('--rho', '../mirror/p3553/track_kartcity.rho');
const designFile = option('--design', 'src/city/city-map.json');
const outFile = option('--out', 'src/city/city-kerbs.bin');
const check = args.includes('--check');

export async function buildCityKerbs({ rho, design }) {
  const [[x0, z0], [x1, z1]] = design.meta.extent;
  globalThis.document ??= { createElement: () => ({ relList: { supports: () => true }, getContext: () => null, style: {} }) };
  const [formats, { _L }, { T2 }] = await Promise.all([
    import('../../src/generated/formats.js'), import('../../src/generated/world.js'), import('../../src/generated/vendor.js'),
  ]);
  const source = diskSource(rho);
  const track = await new RhoReader(source, await scanRhoArchiveIndex(source)).read('track.1s');
  const admitted = formats.YW(formats.y9(new Uint8Array(track)), 'time-attack', { roadExtent: Math.max(x1 - x0, z1 - z0) + 1 });
  const world = new _L({ ...admitted, resourceVersion: 'p3553', trackId: 'kartcity' }, new T2());
  const triangles = world.surface.triangles;
  const kerbs = findKerbFaces(world.surface, triangles);
  return { bytes: encodeKerbs(triangles.length, triangleChecksum(triangles), kerbs), triangles: triangles.length, kerbs: kerbs.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = performance.now();
  const built = await buildCityKerbs({ rho: rhoFile, design: JSON.parse(readFileSync(designFile, 'utf8')) });
  const summary = `${built.kerbs} 个路缘面 / ${built.triangles} 个碰撞三角形，${built.bytes.length} 字节，${Math.round(performance.now() - started)} ms`;
  if (check) {
    let old;
    try { old = readFileSync(outFile); } catch { /* missing */ }
    if (!old || Buffer.compare(old, Buffer.from(built.bytes)) !== 0) { console.error(`过期：${path.relative(client, outFile)}（${summary}）`); process.exit(1); }
    console.log(`一致：${summary}`);
  } else {
    writeFileSync(outFile, built.bytes);
    console.log(`写入 ${path.relative(client, outFile)}：${summary}`);
  }
}
