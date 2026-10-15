import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePngRgba } from "../resources/png-decoder";
import { lobbyPromoArtLoader } from "./lobby-promo-art";

const source = new URL("../../assets/locale-ui/lobby/", import.meta.url);

test("lobby manifest supplies four complete decoded PNGs at the original slot dimensions", async () => {
  const spec = JSON.parse(readFileSync(new URL("manifest.json", source), "utf8")) as {
    entries: Array<{ canonicalPath: string; locale: "en" | "ko"; file: string; width: number; height: number }>;
  };
  assert.deepEqual(spec.entries.map(row => `${row.locale}/${row.canonicalPath}`).sort(), [
    "en/lobby/ccraft.png", "en/lobby/qq-group.png", "ko/lobby/ccraft.png", "ko/lobby/qq-group.png",
  ]);
  for (const row of spec.entries) {
    const png = await decodePngRgba(readFileSync(new URL(row.file, source)));
    assert.deepEqual([png.width, png.height], [row.width, row.height]);
    assert.ok(png.pixels.some(value => value > 0));
  }
  for (const name of ["ccraft", "qq-group"])
    assert.notDeepEqual(readFileSync(new URL(`en/${name}.png`, source)),
      readFileSync(new URL(`ko/${name}.png`, source)));
});

test("lobby artwork loader decodes the selected archive PNG with no text painting", async () => {
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const savedImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
  const paths: string[] = [], canvases: unknown[] = [], images: unknown[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: (tag: string) => {
      assert.equal(tag, "canvas");
      const canvas = { width: 0, height: 0,
        getContext: () => ({ putImageData: (pixels: unknown) => images.push(pixels) }) };
      canvases.push(canvas); return canvas;
    },
  } });
  Object.defineProperty(globalThis, "ImageData", { configurable: true, value: class {
    constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
  } });
  try {
    const library = { canonicalCandidates: (path: string) => {
      paths.push(path);
      return path === "locale_ui/ko/lobby/qq-group.png" ? [{
        bytes: async () => readFileSync(new URL("ko/qq-group.png", source)),
      }] : [];
    } };
    const load = lobbyPromoArtLoader(library);
    assert.equal(load, lobbyPromoArtLoader(library), "stable loader shares the home cache");
    const image = await load("lobby/qq-group.png", "ko");
    assert.deepEqual([image?.width, image?.height], [1050, 234]);
    assert.equal(image?.image, canvases[0]);
    assert.equal(images.length, 1);
    assert.equal(await load("lobby/qq-group.png", "en"), undefined);
    assert.deepEqual(paths, ["locale_ui/ko/lobby/qq-group.png", "locale_ui/en/lobby/qq-group.png"]);
  } finally {
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (savedImageData) Object.defineProperty(globalThis, "ImageData", savedImageData);
    else Reflect.deleteProperty(globalThis, "ImageData");
  }
});
