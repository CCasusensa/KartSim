import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { itemDisplayName, itemNameSources, translateItemName, raceItemDisplayName } from "./item-names";
import { itemNameTranslations, itemChineseNameOverrides } from "./catalogs/item-names";
import { raceItemNames } from "./catalogs/race-item-names";
import { type GameLocale } from "./locale";
import { parseShopCatalog } from "../shop/shop-catalog";
import { ShopIndex } from "../shop/shop-model";
import { loadTimeAttackGarageCatalog, type GarageCatalogLibrary } from "../resources/garage-catalog";
import type { GarageResource } from "../resources/timeattack-items";
import { itemInventoryEntries } from "../ui/item-inventory";
import { boxRewardText } from "../ui/box-dialogs";
import { rewardTitle } from "../menus/reward-box-screen";
import { itemLine } from "../lottery/lottery-model";
import { promoteRaceRecord, type RecordService } from "../timeattack/record-service";
import { featuredEntries } from "../timeattack/ready-replays";

async function locale<T>(value: GameLocale, run: () => T | Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => value } });
  try { return await run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const rawShop = JSON.parse(readFileSync(new URL("../../../server-go/internal/data/economy/catalog.json", import.meta.url), "utf8"));

test("all 6,651 original item identities have complete EN/KO names and preserve model/format tokens", async () => {
  assert.equal(Object.keys(itemNameSources).length, 6651);
  assert.equal(new Set(Object.values(itemNameSources)).size, 6587);
  for (const [key, source] of Object.entries(itemNameSources)) {
    const pair = itemNameTranslations[source];
    assert.ok(pair, `${key}: ${source}`);
    for (const value of pair) {
      assert.ok(value.trim(), source);
      assert.doesNotMatch(value, /\p{Script=Han}/u, source);
      for (const token of source.match(/%[sd]|(?<![A-Za-z0-9])(?:C1|E2|G3|R4|PRO|SRX|SR|Z7|HT|V1|X)(?:\+)?(?![A-Za-z0-9])/g) ?? [])
        assert.ok(value.includes(token), `${source}: ${token} in ${value}`);
    }
    assert.doesNotMatch(pair[0], /\p{Script=Hangul}/u, source);
  }
  for (const lang of ["zh-CN", "en", "ko"] as const) await locale(lang, () => {
    for (const [key, source] of Object.entries(itemNameSources)) {
      const [category, id] = key.split(":").map(Number);
      const expected = lang === "zh-CN" ? itemChineseNameOverrides[source] ?? source
        : itemNameTranslations[source]![lang === "en" ? 0 : 1];
      assert.equal(itemDisplayName(category!, id!), expected, key);
    }
  });
});

test("shop index translates all server names while API data, resource IDs and offers stay unchanged", async () => {
  const catalog = parseShopCatalog(rawShop);
  const original = structuredClone(catalog);
  for (const lang of ["zh-CN", "en", "ko"] as const) await locale(lang, () => {
    const index = new ShopIndex(catalog);
    assert.equal(index.entries.length, 6035);
    for (const entry of index.entries) {
      const source = catalog.items[entry.order]!;
      assert.equal(entry.item.name, itemDisplayName(source.category, source.itemId, source.name));
      assert.equal(entry.key, `${source.category}:${source.itemId}`);
      assert.equal(entry.item.internalId, source.internalId);
      assert.deepEqual(entry.item.offers, source.offers);
      if (lang !== "zh-CN") assert.doesNotMatch(entry.item.name, /\p{Script=Han}/u);
      assert.ok(entry.search.includes(source.name.toLowerCase()));
      assert.ok(entry.search.includes(entry.item.name.toLowerCase()));
    }
    assert.deepEqual(catalog, original);
  });
});

function resource(path: string, sourceName = "test.rho"): GarageResource {
  const name = path.split("/").at(-1)!;
  return { name, extension: name.split(".").at(-1)!, virtualPath: path, canonicalPath: path,
    sourceName, sourceKind: "rho", containerId: sourceName,
    bytes: async () => new Uint8Array(), text: async () => "shop" };
}

test("garage, inventory and reward labels share translations without changing equipment identity", async () => {
  for (const lang of ["zh-CN", "en", "ko"] as const) await locale(lang, async () => {
    const files = [resource("zeta_/cn/shop/data/item.kml"), resource("kart_/burst/model.1s"),
      resource("character_Bazzi/model.1s", "character_Bazzi.rho"), resource("stuff/balloon/heart/balloon.1s")];
    const definitions = [
      { kind: "kart", itemId: 1, internalId: "burst" },
      { kind: "character", itemId: 1, internalId: "Bazzi" },
      { kind: "balloon", itemId: 1, internalId: "heart" },
    ];
    const library = { files, itemTableGarageDefinitions: async () => definitions,
      exactCanonicalCandidates: (path: string) => files.filter(file => file.canonicalPath === path),
    } as unknown as GarageCatalogLibrary;
    const rows = [[3, 1], [1, 1], [9, 1]];
    const catalog = await loadTimeAttackGarageCatalog(library, {
      parseShopXml: () => ({ getElementsByTagName: () => rows.map(([category, id]) => ({
        getAttribute: (name: string) => ({ itemCatId: String(category), itemId: String(id),
          itemName: itemNameSources[`${category}:${id}`] } as Record<string, string>)[name] ?? null,
      })) }) as unknown as Document,
      resolveModel: async () => ({ find: () => undefined }), legacyFamilies: [],
    });
    const entries = itemInventoryEntries(catalog);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(item => [item.category, item.itemId, item.internalId]),
      [[3, 1, "burst"], [1, 1, "Bazzi"], [9, 1, "heart"]]);
    for (const item of entries) assert.equal(item.title, itemDisplayName(item.category, item.itemId));
    const source = itemNameSources["9:1"]!;
    const name = itemDisplayName(9, 1);
    assert.equal(boxRewardText({ category: 9, itemId: 1, name: source, count: 2, days: 0 }), `${name} ×2`);
    assert.equal(rewardTitle({ name: source, count: 2 }), `${name} ×2`);
    assert.equal(itemLine({ name: source, count: 2, days: 0 }), `${name} ×2`);
    assert.deepEqual(definitions.map(item => item.internalId), ["burst", "Bazzi", "heart"]);
    for (const unknown of ["活动", "玩家自己的名称", "Custom item", "custom_internal_id (99999)", "constructor", "__proto__"])
      assert.equal(translateItemName(unknown), unknown);
  });
});

test("race item names retain native Korean and internal engine keys", async () => {
  assert.equal(Object.keys(raceItemNames).length, 118);
  for (const lang of ["zh-CN", "en", "ko"] as const) await locale(lang, () => {
    assert.equal(raceItemDisplayName("waterFly", "水苍蝇"),
      lang === "zh-CN" ? "水苍蝇" : lang === "en" ? "Water Wisp" : "물파리");
    assert.equal(raceItemDisplayName("foxTailRocket", "狐尾导弹"),
      lang === "zh-CN" ? "狐尾导弹" : lang === "en" ? "Fox-Tail Missile" : "여우꼬리 미사일");
    assert.equal(raceItemDisplayName("custom", "Custom"), "Custom");
  });
});

test("records save the canonical kart name and replays translate it without changing rider names", async () => {
  const source = itemNameSources["3:1"]!;
  for (const recordedLocale of ["en", "ko"] as const) {
    let recordedName = "";
    await locale(recordedLocale, async () => {
      let captured = "";
      const service = {
        host: { getSelection: () => ({ vehicleItemId: 1, trackId: "villageR01" }),
          getVehicleTitle: () => itemDisplayName(3, 1), getReadyOptions: () => ({ booster: 1 }),
          getTrackId: () => "villageR01", library: { promote: (_key: string, _replay: unknown, _track: string,
            summary: { kartName: string }) => { recordedName = summary.kartName; } } },
        captureReplay: (_elapsed: number, _counts: unknown, name: string) => { captured = name; return undefined; },
      } as unknown as RecordService;
      await promoteRaceRecord(service, 1000, { crashCount: 0, boosterCount: 2 }, {
        recordKey: () => "track:settings", resolveSpeed: () => 7, validateSpeed: () => undefined,
      });
      assert.equal(recordedName, source);
      assert.equal(captured, source);
    });
    for (const displayLocale of ["zh-CN", "en", "ko"] as const) await locale(displayLocale, () => {
      const replay = featuredEntries([{ id: 1, title: "Player title", note: "User note", trackId: "villageR01", trackName: "", speed: 7,
        booster: 1, accountId: "player", nickname: "皮蛋", kartName: recordedName,
        bestMs: 1000, createdAt: 100 }])[0]!;
      assert.equal(replay.kartName, itemDisplayName(3, 1));
      assert.equal(replay.riderName, "皮蛋");
      // Also support older replays whose summary used a localized display name.
      const old = itemNameTranslations[source]![recordedLocale === "en" ? 0 : 1];
      assert.equal(translateItemName(old), itemDisplayName(3, 1));
    });
  }
});
