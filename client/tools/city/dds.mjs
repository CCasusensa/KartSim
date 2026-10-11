// DDS (DXT1/DXT3/DXT5 and uncompressed RGB(A)) → RGBA decoder for previews.
export function decodeDds(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x20534444) throw new Error("not a DDS file");
  const height = view.getUint32(12, true), width = view.getUint32(16, true);
  const pfFlags = view.getUint32(80, true);
  const fourCC = String.fromCharCode(bytes[84], bytes[85], bytes[86], bytes[87]);
  const bitCount = view.getUint32(88, true);
  const masks = [view.getUint32(92, true), view.getUint32(96, true), view.getUint32(100, true), view.getUint32(104, true)];
  let offset = 128;
  if (fourCC === "DX10") offset += 20;
  const rgba = new Uint8Array(width * height * 4);
  const put = (x, y, r, g, b, a) => { if (x >= width || y >= height) return; const i = (y * width + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a; };
  const c565 = v => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
  if (pfFlags & 4 && (fourCC === "DXT1" || fourCC === "DXT3" || fourCC === "DXT5")) {
    const blockBytes = fourCC === "DXT1" ? 8 : 16;
    for (let by = 0; by < Math.ceil(height / 4); by++) for (let bx = 0; bx < Math.ceil(width / 4); bx++) {
      let p = offset + (by * Math.ceil(width / 4) + bx) * blockBytes;
      if (p + blockBytes > bytes.length) return { width, height, rgba };
      let alphas = null;
      if (fourCC === "DXT3") { alphas = []; for (let i = 0; i < 4; i++) { const w = view.getUint16(p + i * 2, true); for (let k = 0; k < 4; k++) alphas.push(((w >> (k * 4)) & 15) * 17); } p += 8; }
      else if (fourCC === "DXT5") {
        const a0 = bytes[p], a1 = bytes[p + 1];
        const table = [a0, a1];
        if (a0 > a1) for (let i = 1; i <= 6; i++) table.push(((7 - i) * a0 + i * a1) / 7);
        else { for (let i = 1; i <= 4; i++) table.push(((5 - i) * a0 + i * a1) / 5); table.push(0, 255); }
        let bits = 0n; for (let i = 0; i < 6; i++) bits |= BigInt(bytes[p + 2 + i]) << BigInt(i * 8);
        alphas = []; for (let i = 0; i < 16; i++) alphas.push(table[Number((bits >> BigInt(i * 3)) & 7n)]);
        p += 8;
      }
      const q0 = view.getUint16(p, true), q1 = view.getUint16(p + 2, true);
      const c0 = c565(q0), c1 = c565(q1);
      const colors = [c0, c1];
      if (q0 > q1 || fourCC !== "DXT1") { colors.push(c0.map((v, i) => (2 * v + c1[i]) / 3)); colors.push(c0.map((v, i) => (v + 2 * c1[i]) / 3)); }
      else { colors.push(c0.map((v, i) => (v + c1[i]) / 2)); colors.push([0, 0, 0]); }
      const lookup = view.getUint32(p + 4, true);
      for (let i = 0; i < 16; i++) {
        const code = (lookup >> (i * 2)) & 3;
        const [r, g, b] = colors[code];
        const alpha = alphas ? alphas[i] : (fourCC === "DXT1" && !(q0 > q1) && code === 3 ? 0 : 255);
        put(bx * 4 + (i % 4), by * 4 + Math.floor(i / 4), r, g, b, alpha);
      }
    }
    return { width, height, rgba };
  }
  if (pfFlags & 0x40 || pfFlags & 0x41) {
    const bpp = bitCount / 8;
    const shift = mask => { if (!mask) return null; let s = 0; while (!((mask >> s) & 1)) s++; let w = 0; while ((mask >> (s + w)) & 1) w++; return [s, w]; };
    const sh = masks.map(shift);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = offset + (y * width + x) * bpp;
      let v = 0; for (let i = 0; i < bpp; i++) v |= bytes[p + i] << (i * 8);
      const ch = i => sh[i] ? Math.round(((v >>> sh[i][0]) & ((1 << sh[i][1]) - 1)) * 255 / ((1 << sh[i][1]) - 1)) : (i === 3 ? 255 : 0);
      put(x, y, ch(0), ch(1), ch(2), ch(3));
    }
    return { width, height, rgba };
  }
  throw new Error(`unsupported DDS format ${fourCC} flags ${pfFlags}`);
}
