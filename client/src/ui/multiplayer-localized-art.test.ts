import assert from "node:assert/strict";
import test from "node:test";
import { drawMultiplayerWindowNode, type MultiplayerWindowDrawHost, type MultiplayerWindowDrawDependencies } from "./multiplayer-window-draw";
import { tr } from "../i18n/locale";

test("image-only room buttons paint complete bitmaps in all locales without caption overlays", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
      const calls: unknown[][] = [];
      const context = { save() {}, restore() {}, fillRect() {}, strokeRect() {},
        fillText: (...args: unknown[]) => calls.push(["text", ...args]) } as unknown as CanvasRenderingContext2D;
      const node = { name: "ImageButton", children: [] };
      const host = { options: { state: () => ({ action() {}, label: tr("准备") }) },
        textures: new Map([[node, [{ image: {} as HTMLCanvasElement, width: 100, height: 40 }]]]),
        styles: new Map(), frames: new Map(), images: new Map(), context,
        paintingOnly: true, text: () => "", draw() {} } as unknown as MultiplayerWindowDrawHost;
      const dependencies = { attribute: (_node: unknown, key: string) => key === "name" ? "ready" : undefined,
        rectangle: () => ({ x: 0, y: 0, width: 100, height: 40 }),
        paintImageButton: () => calls.push(["original-image"]) } as unknown as MultiplayerWindowDrawDependencies;
      drawMultiplayerWindowNode(host, node, { x: 0, y: 0, width: 100, height: 40 }, new Set(), dependencies);
      assert.deepEqual(calls.map(call => call[0]), ["original-image"]);
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
