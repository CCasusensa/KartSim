// 赛道场景的网格收集：按「贴图表面 × 200 米分块」合并三角形，最后
// 变成 ReTriList 节点。贴图用名字引用：theme_xyy 的原版贴图不进赛道包
// （游戏按赛道 id 的主题前缀到 theme_/xyy/texture/ 查找，和官方赛道一样），
// Tripo 摆件的贴图和透明碰撞贴图作为生成文件放进赛道包。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MeshBuilder } from "../../src/mapeditor/mesh-builder.ts";
import { encodePng } from "../../src/mapeditor/png.ts";
import {
  makeAlphaProperty, makeBackFaceProperty, makeNode, makeTexProperty, makeTriListNode, makeVertexData, makeXml,
} from "../../src/resources/track-binary-writer.ts";
import { readGlb, transformDirection, transformPoint } from "../city/blender/glb.mjs";

export const CHUNK = 200;
const TRANSPARENT_PNG = encodePng(4, 4, new Uint8Array(64));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function roadProperty(attributes) {
  if (!attributes) return undefined;
  return makeXml("property", {}, [makeXml("road", attributes.map(([name, value]) => ({ name, value })))]);
}

export class Scene {
  constructor() {
    this.surfaces = new Map();
    this.builders = new Map();
    this.generated = new Map();
    this.extraNodes = [];
  }

  /**
   * 表面：texture 是贴图名（不带扩展名）；generated = { extension, bytes } 时
   * 把文件放进赛道包。road = 路面属性列表（[] = 可碰撞无特殊属性，
   * undefined = 只显示）；alpha "test"/"blend"；doubleSided。
   */
  surface(id, texture, { road, alpha, doubleSided, generated, sortBias = 0 } = {}) {
    let surface = this.surfaces.get(id);
    if (surface) return surface;
    if (generated && !this.generated.has(texture.toLowerCase()))
      this.generated.set(texture.toLowerCase(), { path: `${texture}.${generated.extension}`, bytes: generated.bytes });
    const slots = [makeTexProperty(texture, { magFilter: 2, property: roadProperty(road) })];
    if (alpha === "test") slots.push(makeAlphaProperty({ alphaTestEnable: 1, alphaRef: 128 }));
    if (alpha === "blend") slots.push(makeAlphaProperty({ blendEnable: 1, alphaTestEnable: 0, alphaRef: 0 }));
    if (doubleSided) slots.push(makeBackFaceProperty(1));
    surface = { id, texture, slots, sortBias };
    this.surfaces.set(id, surface);
    return surface;
  }

  /** 透明碰撞面（只有碰撞，看不见）。 */
  collider() {
    return this.surface("kr_collider", "kr_collider", { road: [], alpha: "test", doubleSided: true, generated: { extension: "png", bytes: TRANSPARENT_PNG } });
  }

  mesh(surface, x, y) {
    const key = `${surface.id}|${Math.floor(x / CHUNK)}_${Math.floor(y / CHUNK)}`;
    let builder = this.builders.get(key);
    if (!builder) { builder = new MeshBuilder(); builder.surface = surface; builder.chunk = key.split("|")[1]; this.builders.set(key, builder); }
    return builder;
  }

  /** 竖直四边形（a、b 底边两端，高 h），UV 横向 u0→u1、纵向上 0 下 1。 */
  wall(surface, a, b, h, u0, u1, facing, v0 = 0, v1 = 1) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    this.mesh(surface, mid[0], mid[1]).pushQuad(
      [a, [u0, v1]], [b, [u1, v1]], [[b[0], b[1], b[2] + h], [u1, v0]], [[a[0], a[1], a[2] + h], [u0, v0]], facing);
  }

  /** 十字交叉的两片公告板（树、灌木、花），uv = [u0, v0, u1, v1]。 */
  billboard(surface, p, width, height, uv = [0, 0, 1, 1], yaw = 0) {
    const [u0, v0, u1, v1] = uv;
    for (const angle of [yaw, yaw + Math.PI / 2]) {
      const dx = Math.cos(angle) * width / 2, dy = Math.sin(angle) * width / 2;
      const a = [p[0] - dx, p[1] - dy, p[2]], b = [p[0] + dx, p[1] + dy, p[2]];
      const m = this.mesh(surface, p[0], p[1]);
      const n = [-Math.sin(angle), Math.cos(angle), 0];
      m.pushQuad([a, [u0, v1]], [b, [u1, v1]], [[b[0], b[1], b[2] + height], [u1, v0]], [[a[0], a[1], a[2] + height], [u0, v0]], n);
    }
  }

  /** 竖直朝向的盒子（隐形碰撞或贴图盒）。 */
  box(surface, center, size, yaw = 0, { top = true, uvScale = 0 } = {}) {
    const [sx, sy, sz] = size;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corner = (dx, dy, z) => [center[0] + dx * c - dy * s, center[1] + dx * s + dy * c, center[2] + z];
    const p = [corner(-sx / 2, -sy / 2, 0), corner(sx / 2, -sy / 2, 0), corner(sx / 2, sy / 2, 0), corner(-sx / 2, sy / 2, 0)];
    const m = this.mesh(surface, center[0], center[1]);
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      const out = normalize([(a[0] + b[0]) / 2 - center[0], (a[1] + b[1]) / 2 - center[1], 0]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u1 = uvScale ? len / uvScale : 1, v1 = uvScale ? sz / uvScale : 1;
      m.pushQuad([a, [0, v1]], [b, [u1, v1]], [[b[0], b[1], b[2] + sz], [u1, 0]], [[a[0], a[1], a[2] + sz], [0, 0]], out);
    }
    if (top) {
      const t = p.map(q => [q[0], q[1], q[2] + sz]);
      m.pushQuad([t[0], [0, 0]], [t[1], [1, 0]], [t[2], [1, 1]], [t[3], [0, 1]], [0, 0, 1]);
    }
  }

  /** 摆件实例：prepared = prepareProp() 的结果。 */
  placeProp(prepared, position, yaw = 0, scale = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const part of prepared.parts) {
      const surface = this.surface(`prop_${part.texture}`, part.texture, { doubleSided: true, generated: part.generated });
      const m = this.mesh(surface, position[0], position[1]);
      const base = m.vertexCount;
      for (let i = 0; i < part.positions.length; i++) {
        const p = part.positions[i], n = part.normals[i];
        m.vertex([position[0] + (p[0] * c - p[1] * s) * scale, position[1] + (p[0] * s + p[1] * c) * scale, position[2] + p[2] * scale],
          part.uvs[i], [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]]);
      }
      for (let i = 0; i < part.indices.length; i += 3) m.triangle(base + part.indices[i], base + part.indices[i + 1], base + part.indices[i + 2]);
    }
  }

  /** 全部网格节点（Scene Root 的子节点）。 */
  nodes() {
    const chunks = new Map();
    let meshes = 0, triangles = 0;
    for (const builder of [...this.builders.values()].sort((a, b) => a.surface.sortBias - b.surface.sortBias)) {
      if (builder.isEmpty()) continue;
      let chunk = chunks.get(builder.chunk);
      if (!chunk) { chunk = makeNode("Relement", { name: `chunk_${builder.chunk}`, children: [] }); chunks.set(builder.chunk, chunk); }
      builder.split(60000).forEach((piece, index) => {
        chunk.children.push(makeTriListNode(`${builder.surface.id}_${builder.chunk}${index ? `_${index}` : ""}`,
          makeVertexData({ positions: piece.positions, normals: piece.normals, uvs: piece.uvs, indices: piece.indices }),
          { properties: builder.surface.slots, sortDepthBias: builder.surface.sortBias }));
        meshes++; triangles += piece.indices.length / 3;
      });
    }
    return { nodes: [...chunks.values(), ...this.extraNodes], meshes, triangles };
  }

  generatedFiles() { return [...this.generated.values()]; }
}

/**
 * Tripo GLB → 局部网格（客户端坐标：x 朝前、z 向上，底面中心在原点），
 * 等比缩放到 size 盒子里。贴图缩到 512 像素 JPEG（ImageMagick），结果
 * 缓存在 cacheDir。
 */
export function prepareProp(id, file, size, cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const glb = readGlb(file);
  // 缓存名带上模型内容的哈希：重新生成的模型不会拿到旧贴图
  const version = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 6);
  const parts = [];
  const textures = new Map();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh, world } of glb.instances()) {
    if (!mesh) continue;
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      // glTF（y 向上）→ 客户端（z 向上）：(x, -z, y)
      const positions = glb.accessor(primitive.attributes.POSITION).map(p => { const q = transformPoint(world, p); return [q[0], -q[2], q[1]]; });
      const normals = primitive.attributes.NORMAL !== undefined
        ? glb.accessor(primitive.attributes.NORMAL).map(n => { const q = normalize(transformDirection(world, n)); return [q[0], -q[2], q[1]]; })
        : positions.map(() => [0, 0, 1]);
      const uvs = primitive.attributes.TEXCOORD_0 !== undefined ? glb.accessor(primitive.attributes.TEXCOORD_0).map(uv => [uv[0], uv[1]]) : positions.map(() => [0, 0]);
      const indices = primitive.indices !== undefined ? glb.accessor(primitive.indices) : positions.map((_, i) => i);
      const material = primitive.material !== undefined ? glb.json.materials[primitive.material] : undefined;
      const imageIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index !== undefined
        ? glb.json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source : undefined;
      let texture;
      if (imageIndex !== undefined) {
        if (!textures.has(imageIndex)) {
          const stem = `xyy_${id}_${version}_${imageIndex}`;
          const out = path.join(cacheDir, `${stem}.jpg`);
          if (!existsSync(out)) {
            const image = glb.image(imageIndex);
            const source = path.join(cacheDir, `${stem}.src`);
            writeFileSync(source, image.bytes);
            const r = spawnSync("magick", [source, "-resize", "512x512>", "-quality", "85", out]);
            if (r.status !== 0) throw new Error(`${id}: 贴图转换失败 ${r.stderr}`);
          }
          textures.set(imageIndex, { texture: stem, generated: { extension: "jpg", bytes: readFileSync(out) } });
        }
        texture = textures.get(imageIndex);
      } else {
        const c = material?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
        const rgba = new Uint8Array(64);
        for (let i = 0; i < 16; i++) rgba.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4);
        texture = { texture: `xyy_${id}_flat${primitive.material ?? 0}`, generated: { extension: "png", bytes: encodePng(4, 4, rgba) } };
      }
      for (const p of positions) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
      parts.push({ positions, normals, uvs, indices, ...texture });
    }
  }
  const extent = sub(max, min);
  const scale = Math.min(size[0] / extent[0], size[1] / extent[1], size[2] / extent[2]);
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  for (const part of parts) part.positions = part.positions.map(p => [(p[0] - cx) * scale, (p[1] - cy) * scale, (p[2] - min[2]) * scale]);
  return { id, parts, size: [extent[0] * scale, extent[1] * scale, extent[2] * scale], triangles: parts.reduce((n, p) => n + p.indices.length / 3, 0) };
}

/** 三角形法线（右手，逆时针为正面）。 */
export function faceNormal(a, b, c) { return normalize(cross(sub(b, a), sub(c, a))); }
