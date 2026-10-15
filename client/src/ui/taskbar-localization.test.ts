import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTaskbarAssets, type TaskbarAssetEntry, type TaskbarFormatOperations } from "./taskbar-assets";
import { localizedPngPath } from "../resources/localized-png";
import { decodePngRgba } from "../resources/png-decoder";

const buttons = [
  ["multiplay", "btn_mainMulti_"], ["singleplay", "btn_mainSingle_"],
  ["마이룸", "btn_mainMyroom_"], ["상점", "btn_mainShop_"],
  ["파츠", "튜닝_0"], ["club", "클럽_0"],
] as const;

function u32(value: number): Buffer { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function string(value: string): Buffer { return Buffer.concat([u32(value.length), Buffer.from(value, "utf16le")]); }
function node(name: string, attrs: Record<string, string>, children: Buffer[] = []): Buffer {
  return Buffer.concat([string(name), string(""), u32(Object.keys(attrs).length),
    ...Object.entries(attrs).flatMap(([key, value]) => [string(key), string(value)]),
    u32(children.length), ...children]);
}

test("taskbar loads all four original CN/Korean frames and complete English pack sprites", async () => {
  const previous = ["document", "DOMParser", "ImageData", "localStorage"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  class Canvas {
    width = 0; height = 0; marker = 0;
    getContext() { return { putImageData: (data: { data: Uint8ClampedArray }) => { this.marker = data.data[0]!; } }; }
  }
  Object.defineProperty(globalThis, "document", { configurable: true,
    value: { createElement: () => new Canvas() } });
  Object.defineProperty(globalThis, "DOMParser", { configurable: true,
    value: class { parseFromString() { return { querySelectorAll: () => [] }; } } });
  Object.defineProperty(globalThis, "ImageData", { configurable: true,
    value: class { constructor(readonly data: Uint8ClampedArray) {} } });
  const formats: TaskbarFormatOperations = {
    decodePng: async bytes => ({ width: 104, height: 66,
      pixels: new Uint8Array(104 * 66 * 4).fill(bytes[0]!) }),
    layout: (node, viewport) => ({ x: viewport.x + Number(node.attributes.find(item => item.name === "x")?.value ?? 0),
      y: 0, width: 104, height: 66 }),
  };
  const files = new Map<string, TaskbarAssetEntry>();
  const add = (path: string, bytes: Uint8Array, sourceName = "gui_window.rho") =>
    files.set(path.toLowerCase(), { sourceKind: "rho", sourceName, virtualPath: path,
      bytes: async () => bytes, text: async () => "<StringBag/>" });
  add("gui_/window/menu/tray@cn.bml", node("Tray", { image: "background", windowSize: "fullwidth 66" },
    buttons.map(([name, stem], index) => node("ImageButton", {
      name, autoLoadImage: `${stem}@zz`, x: String(index * 104),
    }))));
  add("etc_/baseStringBag.xml", new Uint8Array(), "etc.rho");
  add("gui_/window/menu/background.png", new Uint8Array([1]));
  for (const [index, [, stem]] of buttons.entries()) for (let frame = 1; frame <= 4; frame++) {
    const path = `gui_/window/menu/${stem}${frame}`;
    add(`${path}@cn.png`, new Uint8Array([10 + index * 4 + frame]));
    add(`${path}@zz.png`, new Uint8Array([50 + index * 4 + frame]));
    add(localizedPngPath(`${path}@zz.png`, "en"), new Uint8Array([90 + index * 4 + frame]), "locale_ui.rho");
  }
  const requested: string[] = [];
  const library = { canonicalCandidates: (path: string) => {
    requested.push(path); const entry = files.get(path.toLowerCase()); return entry ? [entry] : [];
  } };
  try {
    for (const [locale, offset] of [["zh-CN", 10], ["ko", 50], ["en", 90]] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
      const assets = await loadTaskbarAssets(library, formats);
      assert.deepEqual(assets.buttons.map(button => button.name), buttons.map(([name]) => name));
      for (const [index, button] of assets.buttons.entries()) {
        assert.deepEqual(button.rect, { x: index * 104, y: 0, width: 104, height: 66 });
        assert.deepEqual(assets.images.get(button.node)!.map(frame => (frame.image as unknown as Canvas).marker),
          [1, 2, 3, 4].map(frame => offset + index * 4 + frame));
      }
    }
    assert.ok(requested.some(path => path.startsWith("locale_ui/en/")));
    const badPath = localizedPngPath("gui_/window/menu/btn_mainMulti_1@zz.png", "en");
    files.get(badPath.toLowerCase())!.sourceName = "unrelated.rho";
    await assert.rejects(loadTaskbarAssets(library, formats), /locale_ui\.rho/);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("English taskbar pack contains 24 complete PNGs at the original 104 by 66 dimensions", async () => {
  const directory = new URL("../../assets/locale-ui/taskbar/", import.meta.url);
  const spec = JSON.parse(readFileSync(new URL("spec.json", directory), "utf8")) as {
    entries: Array<{ canonicalPath: string; locale: string; file: string; width: number; height: number }>;
  };
  assert.equal(spec.entries.length, 24);
  assert.equal(new Set(spec.entries.map(entry => entry.canonicalPath)).size, 24);
  for (const entry of spec.entries) {
    assert.equal(entry.locale, "en");
    const image = await decodePngRgba(new Uint8Array(readFileSync(new URL(entry.file, directory))));
    assert.deepEqual([image.width, image.height], [104, 66]);
    assert.ok(image.pixels.some(value => value !== 0), entry.file);
  }
});
