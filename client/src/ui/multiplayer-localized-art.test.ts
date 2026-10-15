import assert from "node:assert/strict";
import test from "node:test";
import { multiplayerImageCaption, paintMultiplayerModeCaption } from "./multiplayer-localized-art";
import { drawMultiplayerWindowNode, type MultiplayerWindowDrawHost, type MultiplayerWindowDrawDependencies } from "./multiplayer-window-draw";
import { tr } from "../i18n/locale";

test("known image-only room buttons render localized text; previews and custom images keep their artwork", () => {
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
      assert.deepEqual(calls.map(call => call[0]), locale === "zh-CN" ? ["original-image"] : ["text"]);
      if (locale !== "zh-CN") assert.equal(calls[0]![1], tr("准备"));
      assert.equal(multiplayerImageCaption("트랙", "玩家的赛道"), undefined);
      assert.equal(multiplayerImageCaption("customArtwork", "上传图片"), undefined);
      calls.length = 0;
      paintMultiplayerModeCaption(context, { x: 0, y: 0, width: 272, height: 134 }, "普通竞速");
      assert.deepEqual(calls.map(call => call[1]), locale === "zh-CN" ? [] : [tr("普通竞速")]);
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
