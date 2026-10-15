import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeBinaryXml } from "../codecs/binary-xml";
import { localizedPngPath } from "../resources/localized-png";
import { decodePngRgba } from "../resources/png-decoder";
import { loadGarageAssetBundle, type GarageAssetDependencies, type GarageAssetNode } from "./garage-asset-bundle";
import { garageNativeStatePath } from "./garage-remaining-primitives";

const root = new URL("../../assets/locale-ui/garage/", import.meta.url);
const spec = JSON.parse(readFileSync(new URL("spec.json", root), "utf8")) as {
  entries: Array<{ canonicalPath: string; locale: string; file: string; width: number; height: number }>;
};
const source = (name: string) => readFileSync(new URL(`source/native/${name}`, root));

test("all 44 garage translations decode at the exact original dimensions", async () => {
  assert.equal(spec.entries.length, 44);
  for (const locale of ["en", "ko"]) {
    const rows = spec.entries.filter(row => row.locale === locale);
    assert.equal(rows.length, 22);
    assert.equal(new Set(rows.map(row => row.canonicalPath)).size, 22);
    for (const row of rows) {
      const image = await decodePngRgba(readFileSync(new URL(row.file, root)));
      const native = await decodePngRgba(source(row.canonicalPath.split("/").at(-1)!));
      assert.deepEqual([image.width, image.height], [native.width, native.height], row.canonicalPath);
      assert.deepEqual([image.width, image.height], [row.width, row.height]);
      assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 128));
    }
  }
});

test("performance labels occupy native rows with transparent gaps and no collision with values", async () => {
  for (const locale of ["en", "ko"]) for (const [name, rows] of [
    ["garage_img_textPerformList", [0, 33, 65, 97, 129, 161, 204]],
    ["garage_img_textPerformList_2", [0, 33, 65, 97, 129, 161, 192, 285]],
  ] as const) {
    const image = await decodePngRgba(readFileSync(new URL(`${locale}/${name}.png`, root)));
    assert.equal(image.width, 94);
    for (let y = 0; y < image.height; y++) {
      const hasInk = Array.from({ length: image.width }, (_, x) => image.pixels[(y * image.width + x) * 4 + 3]!)
        .some(alpha => alpha > 0);
      if (!rows.some(top => y >= top && y < top + 18))
        assert.equal(hasInk, false, `${locale}/${name}: stray pixels between native rows at ${y}`);
    }
    for (const top of rows) {
      let count = 0;
      for (let y = top; y < top + 18; y++) for (let x = 8; x < image.width; x++)
        if (image.pixels[(y * image.width + x) * 4 + 3]! > 128) count++;
      assert.ok(count > 50, `${locale}/${name}: missing label at ${top}`);
    }
  }
});

const node = (name: string, values: Record<string, string> = {}, children: GarageAssetNode[] = []): GarageAssetNode => ({
  name, children, attributes: Object.entries(values).map(([name, value]) => ({ name, value })),
});
const attribute = (node: GarageAssetNode, name: string) => node.attributes.find(value => value.name === name)?.value;

test("the real Garage asset bundle selects full locale PNGs without changing native texture keys or layouts", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const directory = "stage_/garageX/";
  const definition = decodeBinaryXml(source("stage_1600.bml")) as unknown as GarageAssetNode;
  const nativeImages = [...new Set(spec.entries.map(row => row.canonicalPath))];
  const resources = new Map<string, unknown>([
    [directory + "stage_1600.bml", definition], [directory + "stage_stringBag.bml", node("root")],
    ["etc_/baseStringBag.xml", { root: node("root") }], ["etc_/itemTable.kml", { root: node("root") }],
    ["etc_/itemTable@cn.xml", { root: node("root") }], ["zeta_/cn/shop/data/item.kml", { root: node("root") }],
    ["gui_/windowTemplate/itemPanels.bml", node("root", {}, [node("Kart", { name: "default", zoom: "1" })])],
    ["gui_/windowTemplate/garageXKartCard.bml", node("root", { windowRect: "0 0 240 160" })],
    ["gui_/windowTemplate/mqPartsCard.bml", node("root")], ["gui_/windowTemplate/mqParts12Card.bml", node("root")],
    ["gui_/monocoque/frame.bml", node("root")],
    [directory + "garage_img_baseBG_1600.png", source("garage_img_textCarType1.png")],
  ]);
  for (const canonical of nativeImages) resources.set(canonical, source(canonical.split("/").at(-1)!));
  for (const row of spec.entries) resources.set(localizedPngPath(row.canonicalPath, row.locale as "en" | "ko"),
    readFileSync(new URL(row.file, root)));
  const lookup = (path: string) => resources.has(path) ? [{ sourceName: path,
    bytes: async () => resources.get(path) as Uint8Array }] : [];
  const dependencies: GarageAssetDependencies = {
    normalizeStage: width => ({ width, height: 900 }), stageDirectory: directory,
    parseBml: bytes => bytes as unknown as GarageAssetNode,
    parseXml: bytes => bytes as unknown as { root: GarageAssetNode },
    attribute, xmlAttribute: attribute, alignPair: text => (text ?? "0 0").split(/\s+/).map(Number),
    partCardLayout: () => ({}), partScrollbar: () => ({ areaFrame: { texture: "unused" }, buttonFrames: [] }),
    loadCosmetics: async () => [], cosmeticLookup: async () => undefined, loadCoatings: async () => [],
    partSlots: [], collectParts: () => [], partIconKey: () => "", builtInTextures: [],
    nativeStatePath: (base, state) => garageNativeStatePath(base, String(state)),
    lampTexture: "unused", fontResourcePrefix: "font", fontResourceName: "font", fontFamily: "test",
    canLoadFont: () => false, loadFont: async () => undefined, unloadFont: () => {},
    bitmapMeta: async bitmap => bitmap,
    createBitmap: async blob => ({ data: new Uint8Array(await blob.arrayBuffer()), close() {} }),
    createObjectUrl: () => "blob:test", revokeObjectUrl: () => {}, childRect: (_node, parent) => parent,
  };
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
      const bundle = await loadGarageAssetBundle({ exactCanonicalCandidates: lookup, canonicalCandidates: lookup }, 1600, dependencies);
      assert.equal(bundle.definition, definition);
      for (const canonical of nativeImages) {
        const key = canonical.slice(directory.length, -4).replace(/@cn$/, "@zz");
        const bitmap = bundle.textures.get(key) as unknown as { data: Uint8Array };
        assert.ok(bitmap, `${locale}: original texture key ${key}`);
        const expected = resources.get(locale === "zh-CN" ? canonical : localizedPngPath(canonical, locale)) as Uint8Array;
        assert.deepEqual(bitmap.data, new Uint8Array(expected), `${locale}: ${key}`);
      }
      bundle.dispose();
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
