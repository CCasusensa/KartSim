import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { Vector3 } from "three";

import { s2, y9 } from "../generated/formats.js";
import { canonicalFolder, openMirrorLibrary } from "../ui/item-hud-test-support";
import {
  inheritToonTextureNames, panelCamera, pictureFrames, shopItemModel, shopModelTextures, shopPetModel,
  unlitToonMaterials, type ShopModelEntry, type ShopModelLibrary,
} from "./shop-item-models";
import { brightness, unmatte } from "./shop-preview-garage";

interface CatalogItem { category: number; itemId: number; internalId: string; kind: string; name: string }

const catalog = (JSON.parse(readFileSync(new URL("../../../server-go/internal/data/economy/catalog.json",
  import.meta.url), "utf8")) as { items: CatalogItem[] }).items;

/** A library of path-only entries: every p3553 Rho file under its canonical path, from the archive index. */
function indexLibrary(): ShopModelLibrary {
  const index = JSON.parse(inflateSync(readFileSync(new URL("../../../mirror/__p3553/archive-index",
    import.meta.url))).toString("utf8")) as { rho: Array<{ name: string; files: Array<{ path: string }> }> };
  const byPath = new Map<string, ShopModelEntry[]>();
  for (const archive of index.rho) {
    const folder = canonicalFolder(archive.name);
    for (const file of archive.files) {
      const path = `${folder}${file.path}`;
      const key = path.toLowerCase();
      byPath.set(key, [...byPath.get(key) ?? [],
        { canonicalPath: path, virtualPath: path, bytes: () => Promise.reject(new Error("path only")) }]);
    }
  }
  return { exactCanonicalCandidates: path => byPath.get(path.toLowerCase()) ?? [] };
}

function fakeLibrary(paths: readonly string[]): ShopModelLibrary {
  return {
    exactCanonicalCandidates: path => paths.filter(candidate => candidate.toLowerCase() === path.toLowerCase())
      .map(candidate => ({ canonicalPath: candidate, virtualPath: candidate, bytes: async () => new Uint8Array() })),
  };
}

const request = (category: number, internalId: string) => ({ category, internalId });

test("every CN aura, slot background, card and named uniform has an item-panel model; every pet a param", () => {
  const library = indexLibrary();
  const byKind = new Map<string, CatalogItem[]>();
  for (const item of catalog) byKind.set(item.kind, [...byKind.get(item.kind) ?? [], item]);
  const resolved = (kind: string) => byKind.get(kind)!.map(item => [item, shopItemModel(library, item)] as const);
  // Auras: the 상점 build (all 146), not the worn _1/_2 slots.
  const auras = resolved("aura");
  assert.equal(auras.length, 146);
  for (const [item, model] of auras) assert.match(model?.key ?? "", /^stuff\/aura\/.+상점\.1s$/, item.name);
  assert.equal(shopItemModel(library, { category: 26, internalId: "마하의날개" })?.key, "stuff/aura/마하의날개상점.1s");
  for (const [item, model] of resolved("slotBg"))
    assert.match(model?.key ?? "", /^stuff2_\/slotbg\/.+상점\.1s$/, item.name);
  for (const kind of ["decal", "headPhone", "ridColor", "rpLucciBonus", "tachometer", "goItemSkinCard", "slotChanger"])
    for (const [item, model] of resolved(kind)) assert.ok(model, `${kind} ${item.name}`);
  assert.equal(shopItemModel(library, { category: 61, internalId: "택시타코미터카드@cn" })?.key,
    "stuff/card/택시타코미터카드@cn.1s");
  // Uniforms: every one the CN shop names; the unnamed ones ("uru (15)") have none and keep the icon.
  const uniforms = resolved("uniform");
  assert.equal(uniforms.filter(([, model]) => model).length, 99);
  for (const [item, model] of uniforms) {
    if (/[一-鿿]/.test(item.name)) assert.match(model?.key ?? "", /^stuff\/uniform\//, item.name);
    else if (!model) assert.doesNotMatch(item.name, /[一-鿿]/);
  }
  const pets = byKind.get("pet")!;
  assert.equal(pets.length, 203);
  for (const item of pets) assert.equal(shopPetModel(library, item)?.pet, item.internalId, item.name);
  assert.equal(shopItemModel(library, { category: 9, internalId: "x" }), undefined, "balloons are garage cards");
});

test("item-panel models are found by name order under exactly one decoration root", () => {
  const library = fakeLibrary(["stuff/aura/a_상점.1s", "stuff/aura/a_2.1s", "stuff/aura/b_2.1s",
    "stuff/uniform/u.1s", "stuff2_/uniform/u.1s", "stuff2_/slotBG/s.1s", "pet_/p/param.bml"]);
  assert.equal(shopItemModel(library, request(26, "a"))?.key, "stuff/aura/a_상점.1s");
  assert.equal(shopItemModel(library, request(26, "b"))?.key, "stuff/aura/b_2.1s", "the worn loop at last");
  const slot = shopItemModel(library, request(71, "s"))!;
  assert.equal(slot.folder, "stuff2_/slotBG");
  assert.equal(typeof slot.panel, "object", "slot backgrounds have no itemPanels2 record");
  assert.equal(shopItemModel(library, request(18, "u")), undefined, "two roots: ambiguous");
  for (const name of ["", "..", "a/b", "a\\b"]) assert.equal(shopItemModel(library, request(26, name)), undefined);
  assert.equal(shopPetModel(library, request(21, "p"))?.key, "pet_/p/param.bml");
  assert.equal(shopPetModel(library, request(21, "q")), undefined);
  assert.equal(shopPetModel(library, request(21, "p q")), undefined, "the flying pet loader's folder rule");
  assert.equal(shopPetModel(library, request(52, "p")), undefined);
});

test("model textures come from the model's folder, @zz names trying @cn first", () => {
  const resolve = shopModelTextures(fakeLibrary(["stuff/card/x@cn.png", "stuff/card/x@zz.png",
    "stuff/card/y@zz.tga", "stuff/card/z.png", "stuff/card/Z.png"]), "stuff/card");
  const found = (name: string) => {
    const result = resolve({ kind: "texture", name });
    return result.status === "found" ? result.entry.virtualPath : result.status;
  };
  assert.equal(found("x@zz"), "stuff/card/x@cn.png");
  assert.equal(found("y@zz"), "stuff/card/y@zz.tga");
  assert.equal(found("missing"), "missing");
  assert.equal(found("z"), "unresolved");
  assert.equal(resolve({ kind: "texture" }).status, "missing");
  assert.equal(resolve({ kind: "alpha", name: "x@zz" }).status, "missing");
});

test("panel cameras follow the itemPanels2 records like the garage cards (ui.js tf)", async () => {
  const library = openMirrorLibrary(["gui_windowTemplate.rho"]);
  const layout = s2(await library.exactCanonicalCandidates("gui_/windowTemplate/itemPanels2.bml")[0]!.bytes());
  // <Aura defaultCameraPos="1.0 -5.0 4.0" defaultSpotPos="0.0 0.0 1.0" zoom="1.3"/>: z-up → y-up.
  const aura = panelCamera(layout, "Aura");
  assert.equal(aura.zoom, Math.fround(1.3));
  assert.deepEqual(aura.camera.position.toArray(), [1, 4, 5]);
  const forward = aura.camera.getWorldDirection(new Vector3());
  const expected = new Vector3(-1, -3, -5).normalize();
  assert.ok(forward.distanceTo(expected) < 1e-6);
  assert.equal(aura.camera.aspect, 140 / 95);
  assert.equal(panelCamera(layout, "Pet").zoom, Math.fround(1.3));
  const slot = panelCamera(layout, { defaultCameraPos: "0 -2.5 0", defaultSpotPos: "0 0 0", zoom: "1.5",
    viewSize: "140 95" });
  assert.deepEqual(slot.camera.position.toArray(), [0, 0, 2.5]);
});

test("a toon node without a texture name takes the toon texture before it (中秋节 slot background)", async () => {
  const library = openMirrorLibrary(["stuff2_slotBG.rho"]);
  const parsed = y9(await library.exactCanonicalCandidates("stuff2_/slotBG/중추절슬롯상점.1s")[0]!.bytes()) as {
    root: Parameters<typeof inheritToonTextureNames>[0] };
  const texture = (name: string) => {
    const find = (node: typeof parsed.root): typeof parsed.root | undefined =>
      (node as { name?: string }).name === name ? node : node.children?.map(find).find(Boolean);
    return find(parsed.root)?.slots?.find(slot => slot?.kind === "texture");
  };
  assert.equal(texture("Object003_Geom")?.name, undefined);
  inheritToonTextureNames(parsed.root);
  assert.equal(texture("Object003_Geom")?.name, "slot", "the frame's texture, as 천등's icon names it");
  assert.equal(texture("Plane032_Geom")?.name, "slot");
});

test("toon nodes lit by a plain white mode-2 material draw as mode 0", () => {
  const material = (mode: number, diffuse: number, controllers: unknown[] = []) =>
    ({ kind: "material", mode, diffuse, controllers });
  const wing = material(2, 0xffffffff);
  const tinted = material(2, 0xff808080);
  const animated = material(2, 0xffffffff, [{}]);
  const list = material(2, 0xffffffff);
  unlitToonMaterials({ children: [
    { className: "ReToonRigid", slots: [wing] },
    { className: "ReToonRigid", slots: [tinted] },
    { className: "Relement", children: [{ className: "ReToonRigid", slots: [animated] }] },
    { className: "ReTriList", slots: [list] },
  ] });
  assert.deepEqual([wing.mode, tinted.mode, animated.mode, list.mode], [0, 2, 2, 2]);
});

test("a still is chosen from eighths of the model's longest controller", () => {
  const controller = (stop: number, start = 0, frequency = 1) =>
    ({ value: { base: { startTimeWord: start, stopTimeWord: stop, frequency } } });
  assert.deepEqual(pictureFrames({ children: [{ slotOccurrences: [undefined] }] }), [0]);
  assert.deepEqual(pictureFrames({ children: [{ slotOccurrences: [undefined, controller(3000)] }] }),
    [0, 375, 750, 1125, 1500, 1875, 2250, 2625]);
  // Texture alpha controllers sit inside the texture slot (巨兽炫光 fades in from transparent).
  const texture = { value: { kind: "texture", alphaController: controller(1600).value } };
  assert.deepEqual(pictureFrames({ slotOccurrences: [texture], children: [] }),
    [0, 200, 400, 600, 800, 1000, 1200, 1400]);
  assert.equal(pictureFrames({ slotOccurrences: [controller(60_000)] }).at(-1), 8750, "long animations are capped");
});

test("coverage comes back from a picture over black and over white", () => {
  const black = new Uint8ClampedArray([
    0, 0, 0, 255, // nothing
    200, 100, 50, 255, // opaque
    80, 40, 20, 255, // 40 % covered: 0.4·(200, 100, 50)
    90, 90, 90, 255, // additive glow of 90
  ]);
  const white = [255, 255, 255, 255, 200, 100, 50, 255, 233, 193, 173, 255, 255, 255, 255, 255];
  assert.equal(brightness(black), 0 + 200 + 80 + 90);
  unmatte(black, white);
  assert.deepEqual([...black], [
    0, 0, 0, 0,
    200, 100, 50, 255,
    200, 100, 50, 102,
    255, 255, 255, 90,
  ]);
});
