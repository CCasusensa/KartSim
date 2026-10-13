/**
 * 最小的 PNG 编码器（8 位 RGBA、无滤波）和一块简单的 RGBA 画布，给小地图、
 * 透明碰撞贴图用。浏览器和 Node 都能运行（压缩用 fflate）。
 */
import { zlibSync } from "fflate";

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error("encodePng：RGBA 长度不匹配。");
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; header[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { png.set(part, offset); offset += part.length; }
  return png;
}

export type Rgba = [number, number, number, number];

export class RgbaCanvas {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number, fill: Rgba = [0, 0, 0, 0]) {
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < this.data.length; i += 4) this.data.set(fill, i);
  }

  set(x: number, y: number, [r, g, b, a]: Rgba): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    if (a >= 255) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255; return; }
    const t = a / 255, u = 1 - t;
    this.data[i] = Math.round(this.data[i]! * u + r * t);
    this.data[i + 1] = Math.round(this.data[i + 1]! * u + g * t);
    this.data[i + 2] = Math.round(this.data[i + 2]! * u + b * t);
    this.data[i + 3] = Math.max(this.data[i + 3]!, a);
  }

  fillCircle(cx: number, cy: number, r: number, color: Rgba): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, color);
  }

  /** 扫描线填充多边形 [[x, y] …]（像素坐标）。 */
  fillPolygon(points: [number, number][], color: Rgba): void {
    if (points.length < 3) return;
    const ys = points.map(p => p[1]);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i]!, [x1, y1] = points[(i + 1) % points.length]!;
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.ceil(xs[i]!); x <= Math.floor(xs[i + 1]!); x++) this.set(x, y, color);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Rgba): void {
    const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy) || 1;
    const steps = Math.ceil(length * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.fillCircle(x0 + dx * t, y0 + dy * t, width / 2, color);
    }
  }

  png(): Uint8Array { return encodePng(this.width, this.height, this.data); }
}
