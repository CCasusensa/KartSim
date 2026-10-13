// Independent audit of the six source GLBs. Does not run or import the city exporter.
// node tools/city/blender/verify-vice-city.mjs [source-directory] [report.json]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Matrix4, Quaternion, Triangle, Vector3 } from 'three';

const client = fileURLToPath(new URL('../../../', import.meta.url));
const source = path.resolve(process.argv[2] ?? path.join(client, 'build/vice-city/source'));
const output = path.resolve(process.argv[3] ?? path.join(client, 'build/vice-city/source-audit.json'));
const failures = [], warnings = [], parts = [], geometryGroups = new Map(), imageGroups = new Map();
const roadVertices = new Map(), roadEdges = new Map(), roadTriangles = [], roadNodes = [];
const sharedVertexPairs = new Map(), sharedEdgePairs = new Map();
const collisionChunks = [];
const globalBounds = bounds();
function bounds() { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
function expand(b, p) { for (let i = 0; i < 3; i++) { b.min[i] = Math.min(b.min[i], p[i]); b.max[i] = Math.max(b.max[i], p[i]); } }
function finishBounds(b) { return { ...b, size: b.max.map((v, i) => v - b.min[i]) }; }
function hash(b) { return createHash('sha256').update(b).digest('hex'); }
function fail(kind, details) { failures.push({ kind, ...details }); }
// A 0.00001 source-unit tolerance is 1 mm after the agreed 100x scale.
const sourceQuantization = 100000, scale = 100;
// Embedded texture images were inspected in addition to their names. In
// particular DT_ROAD supplies the mainland north streets and ROOSVELTBRIDGE
// supplies the northern cross-bay bridge; omitting them breaks the map graph.
const laneMaterials = new Set([
  'ROAD2_256', 'ROAD1256', 'ROAD2_256_SHEDOW', 'ROAD_AP_TARMAC', 'AP_TARMAC',
  'ROAD_TARMACPLAIN_BANK', 'TARMACPLAIN_BANK', 'ROAD_RUNWAY_64', 'RUNWAY_64',
  'ROAD_DT_ROAD', 'ROAD_DT_ROAD_STOPLINEA', 'ROAD_DT_ROAD_STOPLINEB',
  'ROAD_BOW_ROAD_CNTR', 'ROAD_PLANE ROAD', 'ROAD_ROOSVELTBRIDGE',
  'ROAD_ROOSVELTBRIDGETARMAC02', 'ROAD_CI_ROADJUNCT1', 'ROAD_TAR_1LINE256HV',
  'ROAD_TAR_2LINE128', 'CONCROADSLAB_256', 'STARBRIDGE', 'ROAD_AP_ROADCORN1',
  'ROAD_YELLOWLINE256HV128',
]);
function pointKey(p) { return p.map(v => Math.round(v * sourceQuantization)).join(','); }
function addMask(map, key, part) { map.set(key, (map.get(key) ?? 0) | (1 << part)); }
function quantiles(values) {
  values.sort((a, b) => a - b);
  return Object.fromEntries([0, .01, .1, .5, .9, .99, 1].map(q => [String(q), values[Math.floor((values.length - 1) * q)] ?? null]));
}
function loadGlb(filename) {
  const data = readFileSync(filename);
  assert.equal(data.toString('ascii', 0, 4), 'glTF', `${filename}: magic`);
  assert.equal(data.readUInt32LE(4), 2, `${filename}: GLB version`);
  assert.equal(data.readUInt32LE(8), data.length, `${filename}: declared size`);
  let json, bin;
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset), type = data.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + length <= data.length, 'Chunk bounds');
    const bytes = data.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString());
    if (type === 0x004e4942) bin = bytes;
    offset += 8 + length;
  }
  assert.ok(json && bin, `${filename}: JSON and BIN chunks required`);
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const readers = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
  const cache = new Map();
  function accessor(index) {
    if (cache.has(index)) return cache.get(index);
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    assert.ok(!a.sparse, `${filename}: sparse accessor ${index} unsupported`);
    assert.equal(view.buffer, 0, 'Embedded single buffer');
    const [reader, bytes] = readers[a.componentType], width = widths[a.type], stride = view.byteStride ?? bytes * width;
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), end = start + (a.count - 1) * stride + bytes * width;
    assert.ok(end <= (view.byteOffset ?? 0) + view.byteLength && end <= bin.length, `${filename}: accessor ${index} bounds`);
    const result = new Float64Array(a.count * width), dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) result[i * width + c] = dv[reader](start + i * stride + c * bytes, true);
    cache.set(index, result);
    return result;
  }
  return { data, json, bin, accessor };
}

for (let part = 0; part < 6; part++) {
  const filename = `bolum${part + 1}.glb`, { data, json: j, bin, accessor } = loadGlb(path.join(source, filename));
  const report = { file: filename, bytes: data.length, sha256: hash(data), asset: j.asset, nodes: j.nodes.length, meshes: j.meshes.length, materials: j.materials.length, textures: j.textures.length, images: j.images.length, embeddedImages: 0, imageBytes: 0, imageDimensions: {}, alphaModes: {}, doubleSidedMaterials: 0, visitedNodes: 0, meshInstances: 0, primitives: 0, vertices: 0, triangles: 0, degenerateTriangles: 0, missingUvs: 0, transformedNodes: [], bounds: bounds(), roadBounds: bounds(), roadTriangleCount: 0, roadProjectedArea: 0, roadHeights: [], roadGrades: [], materialRoadTriangles: {}, imageSignatureFailures: 0 };
  const instanceIndexCount = j.nodes.reduce((sum, node) => sum + (node.mesh === undefined ? 0 : j.meshes[node.mesh].primitives.reduce((n, p) => n + j.accessors[p.indices ?? p.attributes.POSITION].count, 0)), 0);
  const collisionCoordinates = new Float32Array(instanceIndexCount * 3); let collisionOffset = 0;
  for (const [i, im] of j.images.entries()) {
    if (im.bufferView === undefined) { fail('external-image', { file: filename, image: i, uri: im.uri }); continue; }
    const v = j.bufferViews[im.bufferView], bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    assert.equal(bytes.length, v.byteLength, 'Image buffer bounds');
    report.embeddedImages++; report.imageBytes += bytes.length;
    if (im.mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      const key = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
      report.imageDimensions[key] = (report.imageDimensions[key] ?? 0) + 1;
    } else if (im.mimeType !== 'image/jpeg' || bytes[0] !== 255 || bytes[1] !== 216) {
      report.imageSignatureFailures++; fail('image-signature', { file: filename, image: i, mime: im.mimeType });
    }
    const key = hash(bytes), existing = imageGroups.get(key);
    if (existing) { existing.copies++; existing.partMask |= 1 << part; }
    else imageGroups.set(key, { bytes: bytes.length, copies: 1, partMask: 1 << part });
  }
  for (const [i, material] of j.materials.entries()) {
    const alpha = material.alphaMode ?? 'OPAQUE'; report.alphaModes[alpha] = (report.alphaModes[alpha] ?? 0) + 1;
    if (material.doubleSided) report.doubleSidedMaterials++;
    const tex = material.pbrMetallicRoughness?.baseColorTexture?.index;
    if (tex !== undefined && (!j.textures[tex] || !j.images[j.textures[tex].source])) fail('material-texture', { file: filename, material: i, tex });
  }
  const active = new Set();
  function visit(index, parent) {
    if (active.has(index)) throw Error(`Cycle at node ${index}`);
    active.add(index);
    const node = j.nodes[index]; assert.ok(node, 'Valid child node'); report.visitedNodes++;
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (node.matrix || node.translation || node.rotation || node.scale) report.transformedNodes.push({ index, name: node.name, matrix: world.elements });
    if (node.mesh !== undefined) {
      report.meshInstances++;
      for (const [pi, p] of j.meshes[node.mesh].primitives.entries()) {
        assert.equal(p.mode ?? 4, 4, 'Triangle primitives required');
        const positions = accessor(p.attributes.POSITION), count = positions.length / 3, indices = p.indices === undefined ? Uint32Array.from({ length: count }, (_, i) => i) : accessor(p.indices);
        assert.equal(indices.length % 3, 0, 'Triangle index count');
        const uv = p.attributes.TEXCOORD_0 === undefined ? undefined : accessor(p.attributes.TEXCOORD_0);
        const material = j.materials[p.material], materialName = material?.name ?? '';
        if (material?.pbrMetallicRoughness?.baseColorTexture && (!uv || uv.length !== count * 2)) { report.missingUvs++; fail('missing-uv', { file: filename, node: index, primitive: pi }); }
        if (uv && !uv.every(Number.isFinite)) fail('nonfinite-uv', { file: filename, node: index });
        const worldPositions = new Float64Array(positions.length), quantized = Buffer.alloc(positions.length * 4), nodeBounds = bounds();
        for (let v = 0; v < count; v++) {
          const q = new Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]).applyMatrix4(world).toArray();
          assert.ok(q.every(Number.isFinite), `${filename}: finite position`);
          worldPositions.set(q, v * 3); expand(report.bounds, q); expand(globalBounds, q); expand(nodeBounds, q);
          q.forEach((value, c) => quantized.writeInt32LE(Math.round(value * sourceQuantization), (v * 3 + c) * 4));
        }
        const triangleIndexBytes = Buffer.alloc(indices.length * 4); indices.forEach((v, i) => triangleIndexBytes.writeUInt32LE(v, i * 4));
        const fingerprint = createHash('sha256').update(quantized).update(triangleIndexBytes).digest('hex');
        const ref = { part: part + 1, node: index, name: node.name, triangles: indices.length / 3, material: materialName };
        const existing = geometryGroups.get(fingerprint); if (existing) existing.push(ref); else geometryGroups.set(fingerprint, [ref]);
        report.primitives++; report.vertices += count; report.triangles += indices.length / 3;
        // Only asphalt/runway materials identify candidate main driving lanes;
        // ROAD_* also labels walls, floors and sewer meshes in this source.
        const mainRoad = laneMaterials.has(materialName.replace(/\.\d{3}$/, '').toUpperCase());
        if (mainRoad) roadNodes.push({ ...ref, bounds: finishBounds(nodeBounds) });
        for (let t = 0; t < indices.length; t += 3) {
          const ids = [indices[t], indices[t + 1], indices[t + 2]];
          assert.ok(ids.every(v => Number.isInteger(v) && v >= 0 && v < count), `${filename}: valid vertex indices`);
          const [a, b, c] = ids.map(v => Array.from(worldPositions.subarray(v * 3, v * 3 + 3)));
          for (const point of [a, b, c]) for (const value of point) collisionCoordinates[collisionOffset++] = value * scale;
          const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
          const nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0], length = Math.hypot(nx, ny, nz);
          if (length < 1e-9) { report.degenerateTriangles++; continue; }
          if (!mainRoad || ny / length < .85) continue;
          report.roadTriangleCount++; report.roadProjectedArea += ny / 2;
          const centroid = a.map((v, i) => (v + b[i] + c[i]) / 3), grade = Math.hypot(nx, nz) / ny;
          report.roadHeights.push(centroid[1]); report.roadGrades.push(grade);
          report.materialRoadTriangles[materialName] = (report.materialRoadTriangles[materialName] ?? 0) + 1;
          const keys = [a, b, c].map(pointKey);
          for (const q of [a, b, c]) expand(report.roadBounds, q);
          for (const key of keys) addMask(roadVertices, key, part);
          for (let edge = 0; edge < 3; edge++) addMask(roadEdges, [keys[edge], keys[(edge + 1) % 3]].sort().join('|'), part);
          roadTriangles.push({ part: part + 1, node: index, name: node.name, material: materialName, centroid, grade, projectedArea: ny / 2, points: [a, b, c], keys });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
    active.delete(index);
  }
  for (const n of j.scenes[j.scene ?? 0].nodes) visit(n, new Matrix4());
  report.bounds = finishBounds(report.bounds); report.roadBounds = finishBounds(report.roadBounds);
  report.roadHeightQuantiles = quantiles(report.roadHeights); report.roadGradeQuantiles = quantiles(report.roadGrades);
  delete report.roadHeights; delete report.roadGrades;
  if (report.visitedNodes !== j.nodes.length) warnings.push({ kind: 'unvisited-nodes', file: filename, count: j.nodes.length - report.visitedNodes });
  parts.push(report);
  collisionChunks.push(collisionCoordinates.subarray(0, collisionOffset));
  console.log(`${filename}: ${report.triangles} triangles, ${report.materials} materials, bounds ${JSON.stringify(report.bounds)}`);
}
for (const [map, target] of [[roadVertices, sharedVertexPairs], [roadEdges, sharedEdgePairs]]) for (const mask of map.values()) for (let a = 0; a < 6; a++) if (mask & (1 << a)) for (let b = a + 1; b < 6; b++) if (mask & (1 << b)) {
  const key = `${a + 1}-${b + 1}`; target.set(key, (target.get(key) ?? 0) + 1);
}
const duplicates = [...geometryGroups.values()].filter(v => v.length > 1);
const duplicatePairs = {};
for (const group of duplicates) for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
  const key = [group[a].part, group[b].part].sort().join('-');
  duplicatePairs[key] ??= { primitives: 0, triangles: 0, examples: [] };
  duplicatePairs[key].primitives++; duplicatePairs[key].triangles += group[a].triangles;
  if (duplicatePairs[key].examples.length < 6) duplicatePairs[key].examples.push([group[a], group[b]]);
}
// Shared exact lane vertices are evidence of common coordinates, not proof
// that every junction is traversable. Report evidence without inventing a pass.
const steepRoadTriangles = roadTriangles.filter(t => t.grade > .20).sort((a, b) => b.projectedArea - a.projectedArea).slice(0, 30).map(({ keys, points, ...t }) => t);
const roadCells = new Map();
for (const t of roadTriangles) {
  const key = [Math.floor(t.centroid[0] / 250), Math.floor(t.centroid[2] / 250)].join(',');
  const cell = roadCells.get(key) ?? { key, triangles: 0, minHeight: Infinity, maxHeight: -Infinity, projectedArea: 0, parts: new Set() };
  cell.triangles++; cell.minHeight = Math.min(cell.minHeight, t.centroid[1]); cell.maxHeight = Math.max(cell.maxHeight, t.centroid[1]); cell.projectedArea += t.projectedArea; cell.parts.add(t.part); roadCells.set(key, cell);
}
const report = {
  source, coordinateSystem: 'glTF world coordinates, Y up; node hierarchy fully applied; no recentering',
  quantizationForDuplicateAndSeamEvidence: 1 / sourceQuantization, parts, bounds: finishBounds(globalBounds),
  totals: Object.fromEntries(['bytes', 'nodes', 'meshes', 'meshInstances', 'primitives', 'vertices', 'triangles', 'materials', 'textures', 'images', 'imageBytes', 'degenerateTriangles', 'roadTriangleCount', 'roadProjectedArea'].map(k => [k, parts.reduce((a, p) => a + p[k], 0)])),
  imageDeduplication: { uniqueImages: imageGroups.size, uniqueBytes: [...imageGroups.values()].reduce((a, im) => a + im.bytes, 0) },
  geometryDeduplication: { uniquePrimitiveGeometry: geometryGroups.size, duplicateGroups: duplicates.length, duplicatePrimitiveCopies: duplicates.reduce((n, group) => n + group.length - 1, 0), repeatedTriangles: duplicates.reduce((n, group) => n + group[0].triangles * (group.length - 1), 0), pairEvidence: duplicatePairs },
  sharedRoadVerticesByPartPair: Object.fromEntries(sharedVertexPairs), sharedRoadEdgesByPartPair: Object.fromEntries(sharedEdgePairs),
  roadCells250: [...roadCells.values()].map(c => ({ ...c, parts: [...c.parts] })),
  roadNodes, steepRoadTriangles,
  caveats: ['Main-road classifier uses explicit asphalt/runway material names and upward normals; it is not a complete collision or road-network proof.', 'No geographic district labels are assumed from file numbering.', 'Duplicate geometry at coincident coordinates must be addressed before merge to avoid z-fighting and redundant collision.'],
  failures, warnings,
};
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const uniqueRoadTriangles = new Map();
for (const triangle of roadTriangles) {
  const key = triangle.keys.slice().sort().join('|');
  if (!uniqueRoadTriangles.has(key)) uniqueRoadTriangles.set(key, triangle);
}
const roadOutput = path.join(path.dirname(output), 'source-road-surfaces.json');
const roadSurfaceData = {
  coordinateSystem: 'Y-up original world coordinates multiplied by 100; not recentered', scale,
  sourceFiles: parts.map(p => ({ file: p.file, sha256: p.sha256 })),
  classification: 'Upward asphalt/runway material triangles only, including inspected downtown/northern bridge textures; ROAD_* name alone does not classify roads. Includes stadium stunts, so navigation must reject steep faces.',
  laneMaterials: [...laneMaterials],
  originalTriangleCount: roadTriangles.length, duplicateTrianglesRemoved: roadTriangles.length - uniqueRoadTriangles.size,
  triangles: [...uniqueRoadTriangles.values()].map(({ points, centroid, keys, projectedArea, ...t }) => ({ ...t, points: points.map(p => p.map(v => v * scale)), centroid: centroid.map(v => v * scale), projectedArea: projectedArea * scale * scale })),
};
writeFileSync(roadOutput, JSON.stringify(roadSurfaceData) + '\n');
// Select source-space spawn candidates from broad, nearly flat lane triangles.
// A 3.6 x 3.6 x 2.05 m empty box proves initial kart clearance, independently
// of a future collision-exporter's material filtering.
const possibleSpawns = roadSurfaceData.triangles.filter(t => t.grade < .025).map(t => {
  const [a, b, c] = t.points, lengths = [[b, c], [a, c], [a, b]].map(([p, q]) => Math.hypot(p[0] - q[0], p[2] - q[2]));
  const perimeter = lengths.reduce((x, y) => x + y, 0), radius = 2 * t.projectedArea / perimeter;
  const point = a.map((_, axis) => (a[axis] * lengths[0] + b[axis] * lengths[1] + c[axis] * lengths[2]) / perimeter);
  const edges = [[a, b], [b, c], [c, a]].sort((x, y) => Math.hypot(y[1][0] - y[0][0], y[1][2] - y[0][2]) - Math.hypot(x[1][0] - x[0][0], x[1][2] - x[0][2]));
  const [e0, e1] = edges[0], yaw = Math.atan2(e1[0] - e0[0], e1[2] - e0[2]);
  return { part: t.part, node: t.node, material: t.material, grade: t.grade, point, inscribedRoadRadius: radius, yaw };
}).filter(t => t.inscribedRoadRadius >= 3.5).sort((a, b) => Math.min(b.inscribedRoadRadius, 12) - Math.min(a.inscribedRoadRadius, 12));
const spawnCandidates = [], rejectedSpawns = [], tri = new Triangle(), box = new Box3();
for (const candidate of possibleSpawns) {
  if (spawnCandidates.some(s => Math.hypot(s.point[0] - candidate.point[0], s.point[2] - candidate.point[2]) < 350)) continue;
  const [x, y, z] = candidate.point;
  box.min.set(x - 1.8, y + .25, z - 1.8); box.max.set(x + 1.8, y + 2.3, z + 1.8);
  let obstructed = false;
  for (const chunk of collisionChunks) {
    for (let i = 0; i < chunk.length; i += 9) {
      const ax = chunk[i], ay = chunk[i + 1], az = chunk[i + 2], bx = chunk[i + 3], by = chunk[i + 4], bz = chunk[i + 5], cx = chunk[i + 6], cy = chunk[i + 7], cz = chunk[i + 8];
      if (Math.max(ay, by, cy) < box.min.y || Math.min(ay, by, cy) > box.max.y || Math.max(ax, bx, cx) < box.min.x || Math.min(ax, bx, cx) > box.max.x || Math.max(az, bz, cz) < box.min.z || Math.min(az, bz, cz) > box.max.z) continue;
      tri.a.set(ax, ay, az); tri.b.set(bx, by, bz); tri.c.set(cx, cy, cz);
      if (box.intersectsTriangle(tri)) { obstructed = true; break; }
    }
    if (obstructed) break;
  }
  if (obstructed) { rejectedSpawns.push(candidate); continue; }
  spawnCandidates.push({ ...candidate, emptyBox: { min: box.min.toArray(), max: box.max.toArray() } });
  if (spawnCandidates.length === 24) break;
}
const spawnOutput = path.join(path.dirname(output), 'source-spawn-candidates.json');
function asphaltWidth(candidate) {
  const [x, y, z] = candidate.point;
  const nearby = roadSurfaceData.triangles.filter(t => Math.abs(t.centroid[0] - x) < 700 && Math.abs(t.centroid[2] - z) < 700);
  let best;
  // The minimum of 36 cross sections avoids confusing a diagonal triangle's
  // longest edge with the real lane direction; this is a measured asphalt
  // width at the chosen point, not a guessed road category width.
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 36) {
    const dx = Math.cos(angle), dz = Math.sin(angle), intervals = [];
    for (const t of nearby) {
      const coords = t.points.map(p => ({ distance: (p[0] - x) * -dz + (p[2] - z) * dx, along: (p[0] - x) * dx + (p[2] - z) * dz, y: p[1] }));
      if (coords.every(p => p.distance > 0) || coords.every(p => p.distance < 0)) continue;
      const hits = [];
      for (let e = 0; e < 3; e++) {
        const a = coords[e], b = coords[(e + 1) % 3];
        if (Math.abs(a.distance) < 1e-8) hits.push([a.along, a.y]);
        if (a.distance * b.distance < 0) { const fraction = a.distance / (a.distance - b.distance); hits.push([a.along + (b.along - a.along) * fraction, a.y + (b.y - a.y) * fraction]); }
      }
      if (hits.length < 2) continue;
      hits.sort((a, b) => a[0] - b[0]);
      if (Math.abs((hits[0][1] + hits.at(-1)[1]) / 2 - y) > 2) continue;
      intervals.push([hits[0][0], hits.at(-1)[0]]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      if (merged.length && interval[0] <= merged.at(-1)[1] + .03) merged.at(-1)[1] = Math.max(merged.at(-1)[1], interval[1]);
      else merged.push(interval.slice());
    }
    const interval = merged.find(([a, b]) => a <= 0 && b >= 0);
    if (interval && (!best || interval[1] - interval[0] < best.width)) best = { width: interval[1] - interval[0], crossDirection: [dx, dz], sides: interval, roadYaw: Math.atan2(-dz, dx) };
  }
  return best;
}
for (const candidate of spawnCandidates) {
  candidate.asphaltCrossSection = asphaltWidth(candidate);
  candidate.levelAbove30m = candidate.point[1] > 30;
}
writeFileSync(spawnOutput, JSON.stringify({ coordinateSystem: roadSurfaceData.coordinateSystem, note: 'Source road incenter with >=3.5m inscribed radius, <2.5% slope, and full-source triangle SAT clearance of 3.6m square body volume. Width is the minimum asphalt-union cross section over 36 directions, allowing 3cm numerical seams and excluding surfaces >2m from the local level. Runtime wheel and travel probes still required.', accepted: spawnCandidates, rejectedCount: rejectedSpawns.length }, null, 2) + '\n');
console.log(JSON.stringify({ output, totals: report.totals, bounds: report.bounds, imageDeduplication: report.imageDeduplication, geometryDeduplication: { ...report.geometryDeduplication, pairEvidence: undefined }, sharedRoadEdges: report.sharedRoadEdgesByPartPair, failures: failures.length }));
console.log(JSON.stringify({ roadOutput, uniqueRoadTriangles: uniqueRoadTriangles.size }));
console.log(JSON.stringify({ spawnOutput, accepted: spawnCandidates.length, rejected: rejectedSpawns.length }));
assert.equal(failures.length, 0, 'GLB structural validation failed');
