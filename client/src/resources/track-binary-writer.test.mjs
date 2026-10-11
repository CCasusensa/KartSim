import assert from "node:assert/strict";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { RhoReader } from "../codecs/rho.ts";
import { Rho5Reader } from "../codecs/rho5.ts";
import {
  encodeTrackModel, encodeTrackXml, makeAlphaProperty, makeBackFaceProperty,
  makeNode, makeTexProperty, makeTrackContainer, makeTriListNode,
  makeVertexData, makeXml, makeZBufProperty, NODE_SLOT, TrackBinaryWriter,
} from "./track-binary-writer.ts";
import { TrackBinaryCursor } from "./track-binary-reader.ts";

// The generated parser touches document at import time.
globalThis.document ??= {
  createElement: () => ({ relList: { supports: () => true }, getContext: () => null, style: {} }),
};
const formats = await import("../generated/formats.js");
const { y9: parseTrackModel, L6: decodeXml } = formats;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mirrorRoots = [path.join(root, "mirror"), path.resolve(root, "../KartSim/mirror")];
const mirror = mirrorRoots.find(candidate => existsSync(path.join(candidate, "p3553/aaa.pk")) &&
  existsSync(path.join(candidate, "__p3553/archive-index")));

function fileSource(filename, name) {
  const descriptor = openSync(filename, "r");
  const size = fstatSync(descriptor).size;
  closeSync(descriptor);
  const read = (start, end) => {
    const fd = openSync(filename, "r");
    try {
      const bytes = new Uint8Array(end - start);
      let cursor = 0;
      while (cursor < bytes.length) {
        const count = readSync(fd, bytes, cursor, bytes.length - cursor, start + cursor);
        assert.ok(count > 0, `${name}: short read`);
        cursor += count;
      }
      return bytes.buffer;
    } finally { closeSync(fd); }
  };
  return { name, size, arrayBuffer: async () => read(0, size),
    slice: (start = 0, end = size) => ({ arrayBuffer: async () => read(start, end) }) };
}

/**
 * Every `.1s` inside the track_* containers plus every track*.1s / skydome*.1s
 * elsewhere (myRoom, stage, DataPack rho5 ...), read through the archive index.
 * Other `.1s` files are model.1s-style assets with their own format.
 */
async function trackModelEntries() {
  const index = JSON.parse(inflateSync(readFileSync(path.join(mirror, "__p3553/archive-index")))
    .toString("utf8"), (_key, value) =>
    value && typeof value === "object" && typeof value.$u8 === "string"
      ? Uint8Array.from(Buffer.from(value.$u8, "base64")) : value);
  const wanted = (archive, filePath) => /\.1s$/i.test(filePath) &&
    (/^track_/i.test(archive) || /(^|\/)(track|skydome)[^/]*\.1s$/i.test(filePath));
  const entries = [];
  for (const archive of index.rho) {
    const reader = new RhoReader(fileSource(path.join(mirror, "p3553", archive.name), archive.name), archive);
    for (const file of reader.files) {
      if (!wanted(archive.name, file.path)) continue;
      entries.push({ archive: archive.name, path: file.path, bytes: () => reader.readRecord(file) });
    }
  }
  for (const group of index.rho5) {
    const parts = [...group.parts].sort((a, b) => a.id - b.id)
      .map(part => fileSource(path.join(mirror, "p3553", part.name), part.name));
    const reader = new Rho5Reader(group, parts);
    for (const file of reader.files) {
      if (!wanted(group.name, file.path)) continue;
      entries.push({ archive: group.name, path: file.path, bytes: () => reader.readRecord(file) });
    }
  }
  return entries;
}

/** Deep clone without the parser's `*Occurrence` metadata. */
function stripOccurrences(value, seen = new Map()) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(item => stripOccurrences(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return seen.get(value);
    const result = {};
    seen.set(value, result);
    for (const [key, item] of Object.entries(value)) {
      // The decoders spell absent optionals as explicit undefined keys.
      if (/Occurrences?$/.test(key) || item === undefined) continue;
      result[key] = stripOccurrences(item, seen);
    }
    return result;
  }
  return value;
}

function firstDifference(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++)
    if (left[index] !== right[index]) return index;
  return left.length === right.length ? -1 : length;
}

test("镜像中 track_* 容器内的每个 .1s 及其他 track*/skydome*.1s 经 encodeTrackModel 重编码后逐字节一致", { skip: !mirror && "mirror/p3553 不存在" }, async () => {
  const entries = await trackModelEntries();
  assert.ok(entries.length > 1000, `only ${entries.length} .1s entries`);
  let exact = 0;
  const inexact = [];
  const unparsable = [];
  for (const entry of entries) {
    const bytes = await entry.bytes();
    let parsed;
    try { parsed = parseTrackModel(bytes); }
    catch (error) { unparsable.push(`${entry.archive}:${entry.path}: ${error.message}`); continue; }
    const encoded = encodeTrackModel(parsed.root);
    const difference = firstDifference(bytes, encoded);
    if (difference < 0) { exact++; continue; }
    // Not byte-exact: the re-encoded stream must still parse to the same graph.
    const reparsed = parseTrackModel(encoded);
    assert.deepEqual(stripOccurrences(reparsed.root), stripOccurrences(parsed.root),
      `${entry.archive}:${entry.path} re-parse differs`);
    inexact.push(`${entry.archive}:${entry.path} differs at 0x${difference.toString(16)} (${bytes.length} -> ${encoded.length} bytes)`);
  }
  console.log(`track .1s round trip: ${exact} byte-exact, ${inexact.length} inexact, ${unparsable.length} unparsable of ${entries.length}`);
  for (const line of inexact.slice(0, 20)) console.log("  inexact:", line);
  for (const line of unparsable.slice(0, 20)) console.log("  unparsable:", line);
  assert.equal(inexact.length, 0, `inexact files:\n${inexact.join("\n")}`);
  assert.equal(unparsable.length, 0, `unparsable files:\n${unparsable.join("\n")}`);
});

test("TrackBinaryWriter 的数值、向量和 UTF-16 字符串与 TrackBinaryCursor 互逆", () => {
  const writer = new TrackBinaryWriter(4);
  writer.uint8(9);
  writer.int16(-2);
  writer.uint16(23456);
  writer.uint32(0x12345678);
  writer.float32(1.25);
  writer.vec2([-2.5, 3.75]);
  writer.vec3([4, 5, 6]);
  writer.string("赛A");
  writer.bytes(Uint8Array.from([1, 2, 3]));
  const cursor = new TrackBinaryCursor(writer.finish());
  assert.deepEqual([cursor.uint8(), cursor.int16(), cursor.uint16(), cursor.uint32(),
    cursor.float32(), cursor.vec2(), cursor.vec3(), cursor.string(), [...cursor.bytes(3)]],
  [9, -2, 23456, 0x12345678, 1.25, [-2.5, 3.75], [4, 5, 6], "赛A", [1, 2, 3]]);
  assert.equal(cursor.remaining, 0);
  assert.throws(() => writer.uint8(256), /uint8/);
  assert.throws(() => writer.uint16(-1), /uint16/);
  assert.throws(() => writer.uint32(1.5), /uint32/);
  assert.throws(() => writer.float32("x"), /float32/);
});

test("makeXml 编码为 L6 二进制 XML 并可解码", () => {
  const xml = makeXml("property", { a: "1", b: "二" },
    [makeXml("child", [{ name: "x", value: "y" }], [], "text")]);
  const bytes = encodeTrackXml(xml);
  const cursor = new TrackBinaryCursor(bytes);
  const decoded = decodeXml(cursor);
  assert.equal(cursor.remaining, 0);
  assert.deepEqual(decoded, {
    name: "property", text: "",
    attributes: [{ name: "a", value: "1" }, { name: "b", value: "二" }],
    children: [{ name: "child", text: "text", attributes: [{ name: "x", value: "y" }], children: [] }],
  });
});

test("builder helpers 生成的 TrackContainer 可被 y9 解析且共享对象编码为引用", () => {
  const texture = makeTexProperty("road00", { addressU: 3, addressV: 3,
    property: makeXml("property", {}, [], "NiOptimizeKeep") });
  const alpha = makeAlphaProperty({ blendEnable: 1, alphaRef: 0 });
  const backface = makeBackFaceProperty(2);
  const zbuffer = makeZBufProperty();
  const quad = makeVertexData({
    positions: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
    normals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    indices: [0, 1, 2, 0, 2, 3],
  });
  assert.equal(quad.vertexCount, 4);
  assert.equal(quad.uvSetsPerVertex, 1);
  assert.deepEqual(quad.uvs[1], [[1, 0]]);
  const first = makeTriListNode("road_a", quad, { properties: [texture, alpha, backface, zbuffer] });
  // Second node shares the vertex data and texture: both must become references.
  const second = makeTriListNode("road_b", quad, { className: "ReTriStrip",
    properties: [texture, makeAlphaProperty()], position: [0, 0, 20] });
  assert.deepEqual(first.bounds0, { min: [0, 0, 0], max: [10, 0, 10] });
  assert.equal(first.slots[NODE_SLOT.texture], texture);
  assert.equal(first.slots[NODE_SLOT.alpha], alpha);
  assert.equal(first.slots[NODE_SLOT.backface], backface);
  assert.equal(first.slots[NODE_SLOT.zbuffer], zbuffer);
  const group = makeNode("Relement", { name: "roads", children: [first, second],
    additionalProperty: makeXml("property", {}, [], "group") });
  const scene = makeNode("Relement", { name: "scene", children: [group] });
  const container = makeTrackContainer("kartcity", scene, [
    { kind: "TrackObject", name: "settings", property: makeXml("property", { cameraFar: "550" }) },
    { kind: "ToDummy", name: "start", transform: { basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      position: [1, 2, 3], scale: [1, 1, 1] } },
    { kind: "ToItemCube", name: "cube", transform: { basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      position: [4, 5, 6], scale: [1, 1, 1] }, instanceOrdinal: 7 },
    { kind: "ToMesh", name: "wall", indices: [0, 1, 2], positions: [[0, 0, 0], [1, 0, 0], [0, 0, 1]] },
    { kind: "ToEventMesh", name: "trigger", indices: [0, 1, 2],
      positions: [[0, 0, 0], [1, 0, 0], [0, 0, 1]], eventName: "boost" },
    { kind: "ToBlackPlane", name: "plane", vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      planeNormal: [0, 1, 0], edgeEnabled: [1, 1, 0, 0] },
    { kind: "ToMinimap", name: "minimap", centerX: 1.5, centerY: -2.5, scale: 0.25,
      canvasWidth: 256, canvasHeight: 256, padding: 8 },
    { kind: "ToRoad", name: "road", cyclic: true, records: [{
      name: "main", positions: [[0, 0, 0], [1, 0, 0], [0, 0, 1]], gateIndices: [[0, 1, 2]],
      surface: "asphalt", surfaceIndices: [[0, 1, 2], [2, 1, 0]],
      frames: [{ position: [0, 0, 0], storedForward: [0, 0, 1], up: [0, 1, 0] }] }] },
  ]);
  const bytes = encodeTrackModel(container);
  const parsed = parseTrackModel(bytes);
  assert.equal(parsed.root.kind, "track");
  assert.equal(parsed.root.name, "kartcity");
  assert.deepEqual(stripOccurrences(parsed.root), stripOccurrences(container));
  const [nodeA, nodeB] = parsed.root.scene.children[0].children;
  assert.equal(nodeA.vertexDataOccurrence.encoding, "new");
  assert.equal(nodeB.vertexDataOccurrence.encoding, "reference");
  assert.equal(nodeB.vertexDataOccurrence.id, nodeA.vertexDataOccurrence.id);
  assert.equal(nodeA.slotOccurrences[NODE_SLOT.texture].encoding, "new");
  assert.equal(nodeB.slotOccurrences[NODE_SLOT.texture].encoding, "reference");
  assert.equal(nodeA.vertexData, nodeB.vertexData);
  assert.equal(nodeA.slots[NODE_SLOT.texture], nodeB.slots[NODE_SLOT.texture]);
  assert.deepEqual(parsed.root.trackObjects[0].property,
    { name: "property", text: "", attributes: [{ name: "cameraFar", value: "550" }], children: [] });
  // Re-encoding the parse is byte-exact, as with the original files.
  assert.deepEqual(encodeTrackModel(parsed.root), bytes);
  // Same texture name on two different TexProperty objects: shared name field.
  const other = makeTriListNode("road_c", quad, { properties: [makeTexProperty("road00")] });
  scene.children.push(other);
  const reparsed = parseTrackModel(encodeTrackModel(container));
  const textures = [reparsed.root.scene.children[0].children[0], reparsed.root.scene.children[1]]
    .map(node => node.slots[NODE_SLOT.texture]);
  assert.notEqual(textures[0], textures[1]);
  assert.equal(textures[0].nameOccurrence.encoding, "new");
  assert.equal(textures[1].nameOccurrence.encoding, "reference");
  assert.equal(textures[1].name, "road00");
});

test("bare Relement 场景也可作为 .1s 根对象", () => {
  const scene = makeNode("Relement", { name: "sky", children: [
    makeNode("ReBillboard", { name: "sun", orientationMode: 2 }),
    makeNode("ReCamera", { name: "cam", camera: { projectionMode: 0, fieldOfViewDegrees: 60,
      nearClip: 1, farClip: 1000 } }),
  ] });
  const parsed = parseTrackModel(encodeTrackModel(scene));
  assert.equal(parsed.root.kind, "node");
  assert.deepEqual(stripOccurrences(parsed.root), stripOccurrences(scene));
  assert.throws(() => encodeTrackModel({ kind: "alpha" }), /根对象/);
  assert.throws(() => encodeTrackModel(makeNode("ReTriList", { name: "x" })), /vertexData/);
});

test("对象 / 字段编号与原版 registry 一致：按首次出现顺序递增", () => {
  const texture = makeTexProperty("t");
  const data = makeVertexData({ positions: [[0, 0, 0]], uvs: [[0, 0]], indices: [0] });
  const scene = makeNode("Relement", { name: "s", children: [
    makeTriListNode("a", data, { properties: [texture] }),
    makeTriListNode("b", data, { properties: [texture] }),
  ] });
  const parsed = parseTrackModel(encodeTrackModel(scene));
  assert.equal(parsed.rootOccurrence.id, 0);
  const [a, b] = parsed.root.children;
  assert.deepEqual(parsed.root.childOccurrences.map(o => [o.encoding, o.id]), [["new", 1], ["new", 3]]);
  assert.deepEqual([a.slotOccurrences[7].id, b.slotOccurrences[7].encoding], [2, "reference"]);
  assert.deepEqual([a.vertexDataOccurrence.id, b.vertexDataOccurrence.encoding], [1, "reference"]);
  // The texture object itself is shared, so its name field is written once.
  assert.equal(a.slots[7], b.slots[7]);
  assert.deepEqual([a.slots[7].nameOccurrence.id, a.slots[7].nameOccurrence.encoding], [0, "new"]);
});
