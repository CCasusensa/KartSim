/**
 * 可增长的三角网格（位置、法线、UV、顶点色、索引），生成 ReTriList 前
 * 按 65535 顶点上限切块。与卡丁城工具 tools/city/geometry.mjs 的
 * MeshBuilder 相同，改成浏览器也能用的 TypeScript。
 */
import type { Vec3 } from "./design";

export type Vec2 = [number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

export type Corner = [Vec3, Vec2];

export class MeshBuilder {
  positions: Vec3[] = [];
  normals: Vec3[] = [];
  uvs: Vec2[] = [];
  colors: number[] = [];
  indices: number[] = [];

  get vertexCount(): number { return this.positions.length; }

  vertex(position: Vec3, uv: Vec2 = [0, 0], normal: Vec3 = [0, 0, 1], color = 0xffffffff): number {
    this.positions.push(position);
    this.uvs.push(uv);
    this.normals.push(normal);
    this.colors.push(color);
    return this.positions.length - 1;
  }

  triangle(a: number, b: number, c: number): void { this.indices.push(a, b, c); }

  /**
   * 四个角 a、b、c、d（对角线 a–c）组成的四边形；`facing` 是它应朝向的
   * 一侧，自然法线朝反方向时翻转绕序。
   */
  pushQuad(a: Corner, b: Corner, c: Corner, d: Corner, facing?: Vec3, color?: number): void {
    const n = normalize(cross(sub(b[0], a[0]), sub(c[0], a[0])));
    const flip = facing ? dot(n, facing) < 0 : false;
    const normal: Vec3 = flip ? [-n[0], -n[1], -n[2]] : n;
    const ia = this.vertex(a[0], a[1], normal, color), ib = this.vertex(b[0], b[1], normal, color);
    const ic = this.vertex(c[0], c[1], normal, color), id = this.vertex(d[0], d[1], normal, color);
    if (flip) { this.triangle(ia, ic, ib); this.triangle(ia, id, ic); }
    else { this.triangle(ia, ib, ic); this.triangle(ia, ic, id); }
  }

  /** 带逐顶点法线的四边形（平滑路面）；绕序让面法线与 `facing` 同向。 */
  pushSmoothQuad(corners: [Corner, Corner, Corner, Corner], normals: [Vec3, Vec3, Vec3, Vec3], facing: Vec3): void {
    const [a, b, c] = corners;
    const n = cross(sub(b[0], a[0]), sub(c[0], a[0]));
    const flip = dot(n, facing) < 0;
    const ids = corners.map((corner, i) => this.vertex(corner[0], corner[1], normals[i]!));
    if (flip) { this.triangle(ids[0]!, ids[2]!, ids[1]!); this.triangle(ids[0]!, ids[3]!, ids[2]!); }
    else { this.triangle(ids[0]!, ids[1]!, ids[2]!); this.triangle(ids[0]!, ids[2]!, ids[3]!); }
  }

  isEmpty(): boolean { return this.indices.length === 0; }

  /** 按三角形切成每块至多 `maxVertices` 个顶点。 */
  split(maxVertices = 60000): MeshBuilder[] {
    if (this.positions.length <= maxVertices && this.indices.length <= 65535) return [this];
    const pieces: MeshBuilder[] = [];
    let current = new MeshBuilder();
    let map = new Map<number, number>();
    const flush = () => {
      if (!current.isEmpty()) pieces.push(current);
      current = new MeshBuilder();
      map = new Map();
    };
    for (let i = 0; i < this.indices.length; i += 3) {
      if (current.positions.length + 3 > maxVertices || current.indices.length + 3 > 65535) flush();
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const source = this.indices[i + k]!;
        let target = map.get(source);
        if (target === undefined) {
          target = current.vertex(this.positions[source]!, this.uvs[source]!, this.normals[source]!, this.colors[source]!);
          map.set(source, target);
        }
        tri.push(target);
      }
      current.triangle(tri[0]!, tri[1]!, tri[2]!);
    }
    flush();
    return pieces;
  }
}
