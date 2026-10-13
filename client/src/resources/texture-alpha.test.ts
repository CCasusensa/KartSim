import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { hasVisibleTexel, normalizeLegacyTextureAlpha } from "./texture-alpha";

const releaseFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../../recovered/formatted/index.js");

test("旧增压与强化贴图的透明度和边缘扩散与发行版一致", async () => {
  const source = await readFile(releaseFile, "utf8");
  const start = source.indexOf("function aK(");
  const end = source.indexOf("\nfunction uK(", start);
  assert.ok(start >= 0 && end > start);
  const original = new Function(`${source.slice(start, end)}\nreturn {aK,cK};`)() as {
    aK: (pixels: Uint8Array, width: number, height: number) => void;
    cK: (pixels: Uint8Array, width: number, height: number) => void;
  };
  const fixtures: Array<[number, number, number[]]> = [
    [1, 1, [0, 0, 0, 255]],
    [2, 1, [120, 60, 0, 255, 0, 0, 0, 255]],
    [3, 2, [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]],
    [2, 2, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [0, 0, []],
    [2, 2, [255, 0, 0, 255]], // Invalid image size preserves the released early return.
  ];
  let random = 0x12345678;
  for (let sample = 0; sample < 24; sample++) {
    const pixels: number[] = [];
    for (let index = 0; index < 7 * 5 * 4; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      pixels.push((random >>> 16) & 255);
    }
    fixtures.push([7, 5, pixels]);
  }
  for (const [index, [width, height, pixels]] of fixtures.entries()) {
    for (const originalMethod of [original.aK, original.cK]) {
      const expected = Uint8Array.from(pixels);
      const actual = Uint8Array.from(pixels);
      originalMethod(expected, width, height);
      normalizeLegacyTextureAlpha(actual, width, height);
      assert.deepEqual(actual, expected, `texture fixture ${index}`);
    }
  }
});

test("贴图是否有可见像素：RGBA、DXT3 和 DXT5 的 alpha", () => {
  assert.equal(hasVisibleTexel(Uint8Array.of(238, 162, 24, 0, 9, 9, 9, 0), "rgba"), false);
  assert.equal(hasVisibleTexel(Uint8Array.of(238, 162, 24, 0, 9, 9, 9, 1), "rgba"), true);
  // transparency.dds: DXT3 blocks with zero alpha over an orange colour.
  const dxt3 = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0x03, 0xed, 0x02, 0xed, 0x55, 0x55, 0x55, 0x55);
  assert.equal(hasVisibleTexel(Uint8Array.from([...dxt3, ...dxt3]), "dxt3"), false);
  const shown = Uint8Array.from([...dxt3, ...dxt3]);
  shown[16 + 7] = 0x10;
  assert.equal(hasVisibleTexel(shown, "dxt3"), true);
  const dxt5 = (a0: number, a1: number, index: number, texel = 15) => {
    const block = new Uint8Array(16);
    block[0] = a0; block[1] = a1;
    const half = texel < 8 ? 2 : 5, shift = 3 * (texel % 8);
    const bits = index << shift;
    block[half] = bits & 255; block[half + 1] = bits >> 8 & 255; block[half + 2] = bits >> 16 & 255;
    return block;
  };
  assert.equal(hasVisibleTexel(dxt5(0, 0, 0), "dxt5"), false);
  // a0 <= a1 has fixed 0 (index 6) and 255 (index 7) entries.
  assert.equal(hasVisibleTexel(dxt5(0, 0, 6), "dxt5"), false);
  assert.equal(hasVisibleTexel(dxt5(0, 0, 7), "dxt5"), true);
  assert.equal(hasVisibleTexel(dxt5(0, 200, 1, 3), "dxt5"), true);
  assert.equal(hasVisibleTexel(dxt5(0, 200, 0, 3), "dxt5"), false);
});
