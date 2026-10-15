import assert from "node:assert/strict";
import test from "node:test";
import { BmlCanvas } from "./bml-canvas";
import { localizedPngPath } from "../resources/localized-png";

test("shared BML canvas loads the complete locale PNG before the original image", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
      const source = "stage_/common/btn_exit_1@cn.png";
      const localized = localizedPngPath(source, locale);
      const paths = locale === "zh-CN" ? [source] : [source, localized];
      const requested: string[] = [];
      const image = {} as HTMLCanvasElement;
      const canvas = Object.create(BmlCanvas.prototype) as BmlCanvas;
      Object.assign(canvas, {
        options: { folders: ["stage_/common"], shared: {
          library: { canonicalCandidates: (path: string) => paths.includes(path) ? [{}] : [] },
        } }, textures: new Map(),
        images: { get: (path: string) => { requested.push(path); return image; } },
      });
      assert.equal(canvas.texture("btn_exit_1@zz"), image);
      assert.deepEqual(requested, [locale === "zh-CN" ? source : localized]);
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
