// Minimal glTF 2.0 binary (.glb) reader: JSON, buffers, typed accessor
// arrays, images and world transforms of mesh nodes.
import { readFileSync } from "node:fs";

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(file) {
  const bytes = readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${file}: not a glb`);
  const length = view.getUint32(8, true);
  let offset = 12, json, bin;
  while (offset < length) {
    const chunkLength = view.getUint32(offset, true), chunkType = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(Buffer.from(chunk).toString("utf8"));
    else if (chunkType === 0x004e4942) bin = chunk;
    offset += 8 + chunkLength;
  }
  return new Glb(json, bin, file);
}

export class Glb {
  constructor(json, bin, file) { this.json = json; this.bin = bin; this.file = file; }
  bufferView(index) {
    const bv = this.json.bufferViews[index];
    if (bv.buffer !== 0) throw new Error("external buffers are not supported");
    return { bytes: this.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), stride: bv.byteStride };
  }
  /** Accessor → array of tuples (numbers for SCALAR). */
  accessor(index) {
    const a = this.json.accessors[index];
    const Type = COMPONENT[a.componentType], n = SIZE[a.type];
    const out = [];
    if (a.bufferView === undefined) { for (let i = 0; i < a.count; i++) out.push(n === 1 ? 0 : new Array(n).fill(0)); return out; }
    const { bytes, stride } = this.bufferView(a.bufferView);
    const elementBytes = Type.BYTES_PER_ELEMENT * n;
    const step = stride ?? elementBytes;
    const base = bytes.byteOffset + (a.byteOffset ?? 0);
    const norm = a.normalized ? (v => Type === Uint8Array ? v / 255 : Type === Uint16Array ? v / 65535 : Type === Int8Array ? Math.max(v / 127, -1) : Type === Int16Array ? Math.max(v / 32767, -1) : v) : (v => v);
    for (let i = 0; i < a.count; i++) {
      const arr = new Type(bytes.buffer, base + i * step, n);
      out.push(n === 1 ? norm(arr[0]) : Array.from(arr, norm));
    }
    return out;
  }
  image(index) {
    const img = this.json.images[index];
    if (img.bufferView === undefined) return undefined;
    return { bytes: this.bufferView(img.bufferView).bytes, mimeType: img.mimeType, name: img.name };
  }
  /** Mesh instances with world matrices (column-major 16) and the node. */
  instances() {
    const out = [];
    const nodes = this.json.nodes ?? [];
    const visit = (index, parent) => {
      const node = nodes[index];
      const local = node.matrix ?? trs(node.translation, node.rotation, node.scale);
      const world = multiply(parent, local);
      out.push({ index, node, world, mesh: node.mesh !== undefined ? this.json.meshes[node.mesh] : undefined });
      for (const c of node.children ?? []) visit(c, world);
    };
    const scene = this.json.scenes?.[this.json.scene ?? 0];
    for (const root of scene?.nodes ?? []) visit(root, IDENTITY);
    return out;
  }
}

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
export function multiply(a, b) {
  const r = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return r;
}
export const transformPoint = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
export const transformDirection = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];

/** Quick summary for the command line. */
export function summarize(glb) {
  const j = glb.json;
  const lines = [`${glb.file}: ${j.meshes?.length ?? 0} meshes, ${j.nodes?.length ?? 0} nodes, ${j.materials?.length ?? 0} materials, ${j.images?.length ?? 0} images, bin ${glb.bin?.length ?? 0} bytes, extensionsUsed ${JSON.stringify(j.extensionsUsed ?? [])}`];
  let triangles = 0;
  for (const mesh of j.meshes ?? []) for (const p of mesh.primitives) {
    const count = p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count;
    triangles += count / 3;
    lines.push(`  mesh ${mesh.name ?? ""}: ${count / 3} tris, attrs ${Object.keys(p.attributes).join(",")}, material ${p.material}`);
  }
  for (const [i, m] of (j.materials ?? []).entries()) lines.push(`  material ${i} ${m.name ?? ""}: baseColorTexture ${m.pbrMetallicRoughness?.baseColorTexture?.index ?? "-"} extras ${JSON.stringify(m.extras ?? {})}`);
  for (const [i, img] of (j.images ?? []).entries()) lines.push(`  image ${i} ${img.name ?? ""} ${img.mimeType} ${img.bufferView !== undefined ? j.bufferViews[img.bufferView].byteLength + " bytes" : img.uri}`);
  const inst = glb.instances();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh, world } of inst) if (mesh) for (const p of mesh.primitives) for (const q of glb.accessor(p.attributes.POSITION)) { const w = transformPoint(world, q); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); } }
  lines.push(`  total ${triangles} tris; bounds min ${min.map(v => v.toFixed(2))} max ${max.map(v => v.toFixed(2))} size ${max.map((v, k) => (v - min[k]).toFixed(2))}`);
  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("glb.mjs")) {
  for (const file of process.argv.slice(2)) console.log(summarize(readGlb(file)));
}
