import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePngRgba } from "../resources/png-decoder";
import { localizedPngPath, localizedPngSourcePath, resolveLocalizedPngPath } from "../resources/localized-png";
import { imageVar, loadLayoutArt, loadShopArt } from "./shop-assets";
import { SpendEventPanel, parseSpendEventStatus } from "./shop-spend-event";
import { spendEventJson } from "./shop-test-fixtures";
import { installShopTestDom } from "./shop-test-dom";
import { tr } from "../i18n/locale";

interface Entry { canonicalPath: string; locale: "en" | "ko"; file: string; width: number; height: number }
const directory = new URL("../../assets/locale-ui/commerce/", import.meta.url);
const spec = JSON.parse(readFileSync(new URL("spec.json", directory), "utf8")) as { entries: Entry[] };

function replaceGlobals(values: Record<string, unknown>): () => void {
  const previous = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => { for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  } };
}

test("shop and lottery load complete PNGs per locale without reusing another language's cache", async () => {
  let locale = "zh-CN";
  class Canvas {
    width = 0; height = 0; pixels: Uint8ClampedArray = new Uint8ClampedArray();
    getContext() { return { putImageData: (image: { data: Uint8ClampedArray }) => { this.pixels = image.data; } }; }
    toBlob(done: (value: null) => void) { done(null); }
    toDataURL() { return `data:image/png;${createHash("sha256").update(this.pixels).digest("hex")}`; }
  }
  const restore = replaceGlobals({ localStorage: { getItem: () => locale },
    document: { createElement: () => new Canvas() },
    ImageData: class { constructor(readonly data: Uint8ClampedArray) {} } });
  const requests: string[] = [];
  const name = "newgacha_Use1_01@zz", canonical = `stage_/treasureHunt/${name}.png`;
  const original = canonical.replace("@zz", "@cn");
  const entries = new Map(spec.entries.map(entry => [localizedPngPath(entry.canonicalPath, entry.locale),
    new Uint8Array(readFileSync(new URL(entry.file, directory)))]));
  const cnBytes = new Uint8Array(readFileSync(new URL("source/native-ko/new@zz.png", directory)));
  const library = { canonicalCandidates(path: string) {
    const bytes = path === original || path === "stage_/mqShop/new@cn.png" ? cnBytes : entries.get(path);
    return bytes ? [{ async bytes() { requests.push(path); return bytes; } }] : [];
  } };
  try {
    const values: string[] = [];
    const shopPromises: Promise<unknown>[] = [];
    for (locale of ["zh-CN", "en", "ko"]) {
      const first = loadLayoutArt(library, ["stage_/treasureHunt"], [name]);
      assert.equal(loadLayoutArt(library, ["stage_/treasureHunt"], [name]), first);
      const art = await first;
      assert.equal(art.properties.size, 1);
      values.push(art.properties.get(imageVar(name))!);
      const shop = loadShopArt(library); shopPromises.push(shop);
      assert.equal(loadShopArt(library), shop); await shop;
    }
    assert.equal(new Set(values).size, 3);
    assert.equal(new Set(shopPromises).size, 3);
    assert.ok(requests.includes(original));
    assert.ok(requests.includes(localizedPngPath(canonical, "en")));
    assert.ok(requests.includes(localizedPngPath(canonical, "ko")));
  } finally { restore(); }
});

test("commerce pack preserves all button states, dictionary geometry and complete image dimensions", async () => {
  assert.equal(spec.entries.length, 190);
  const dictionarySpec = JSON.parse(readFileSync(new URL("../dictionary-ko/spec.json", directory), "utf8")) as { entries: Entry[] };
  const all = [...spec.entries, ...dictionarySpec.entries];
  const keys = new Set(all.map(entry => `${entry.locale}:${localizedPngSourcePath(entry.canonicalPath)}`));
  assert.equal(keys.size, all.length);
  for (const locale of ["en", "ko"] as const) {
    for (const stem of ["newgacha_Use1_0", "newgacha_Use10_0", "newgacha_Use10con_0", "newgacha_buy", "newgacha_stop_", "newgacha_ok_"])
      for (let state = 1; state <= 4; state++) assert.ok(keys.has(`${locale}:stage_/treasureHunt/${stem}${state}.png`));
    for (let group = 1; group <= 4; group++) {
      for (let state = 1; state <= 4; state++) {
        assert.ok(keys.has(`${locale}:dialog/itemDictionary/collect_btn_1depthMenu${group}_${state}.png`));
        for (let sub = 1; sub <= 3; sub++) assert.ok(keys.has(`${locale}:dialog/itemDictionary/collect_btn_2depthMenu${group}${sub}_${state}.png`));
      }
      for (let state = 1; state <= 3; state++) assert.ok(keys.has(`${locale}:dialog/itemDictionary/collect_btn_card${group}_${state}.png`));
    }
  }
  for (const entry of spec.entries) {
    const image = await decodePngRgba(new Uint8Array(readFileSync(new URL(entry.file, directory))));
    assert.deepEqual([image.width, image.height], [entry.width, entry.height], entry.file);
    assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 0), entry.file);
    const canonical = entry.canonicalPath.replace("@cn", "@zz");
    const expected = localizedPngPath(canonical, entry.locale);
    const library = { canonicalCandidates: (path: string) => path === expected ? [{}] : [] };
    assert.equal(resolveLocalizedPngPath(library, canonical, entry.locale), expected);
  }
});

test("spending event headings and completion marks keep image textures in every language", () => {
  for (const locale of ["zh-CN", "en", "ko"]) {
    const dom = installShopTestDom();
    const restore = replaceGlobals({ localStorage: { getItem: () => locale } });
    try {
      const panel = new SpendEventPanel();
      panel.render(parseSpendEventStatus(spendEventJson(1500)));
      const title = panel.element.querySelector<HTMLElement>('[data-name="title"]')!;
      assert.match(title.style.getPropertyValue("--i0"), /tcCashEventTitle1/);
      assert.equal(title.textContent, "");
      for (const name of ["complete", "close"]) {
        const mark = panel.element.querySelector<HTMLElement>(`[data-name="${name}"]`)!;
        assert.match(mark.style.getPropertyValue("--i0"), /shop_chargePoint_slot/);
        assert.equal(mark.textContent, "");
        assert.equal(mark.getAttribute("aria-label"), tr(name === "complete" ? "已达成" : "活动结束"));
      }
      panel.dispose();
    } finally { restore(); dom.restore(); }
  }
});
