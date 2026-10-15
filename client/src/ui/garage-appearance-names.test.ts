import assert from "node:assert/strict";
import test from "node:test";
import { itemDisplayName, itemNameSources } from "../i18n/item-names";
import { localizeGarageAppearance } from "./garage-appearance-names";

test("garage lamps, booster effects and coatings localize official and generated names in all three languages", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const language of ["zh-CN", "en", "ko"]) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true, value: { getItem: () => language },
      });
      for (const [key, source] of Object.entries(itemNameSources)) {
        const [category, id] = key.split(":").map(Number);
        if (![68, 69, 76, 77, 78].includes(category!)) continue;
        const coating = category === 68 || category === 76;
        const family = category! >= 76 ? "xun" : "classic";
        const slot = category === 78 ? "boosterEffect" : coating ? undefined : "tailLamp";
        const item = { id: id!, family, slot, title: source, color: "255 0 255 0",
          effect: "greenBoost", previewModel: "stuff2_/boosterEffect/greenBoost/boosterShop.1s",
          textureIndex: 5, resourceIndex: 261, icon: "parts.png" };
        const original = { ...item };
        const localized = localizeGarageAppearance(item, coating);
        assert.deepEqual(localized, { ...item, title: itemDisplayName(category!, id!) });
        assert.deepEqual(item, original);
        const fallback = coating ? `${family === "xun" ? "迅 " : ""}车膜 ${id}`
          : slot === "boosterEffect" ? `喷焰 ${id} · greenBoost` : `车灯 ${id}`;
        assert.equal(localizeGarageAppearance({ ...item, title: fallback }, coating).title,
          itemDisplayName(category!, id!));
        assert.equal(localizeGarageAppearance({ ...item, title: "我的专属外观" }, coating).title,
          "我的专属外观");
        if (language !== "zh-CN") assert.doesNotMatch(localized.title, /\p{Script=Han}/u);
      }
      const unknown = { id: 999999, family: "xun", slot: "boosterEffect", effect: "future_model",
        title: "喷焰 999999 · future_model" };
      const localized = localizeGarageAppearance(unknown);
      assert.equal(localized.effect, "future_model");
      assert.equal(localized.title, language === "zh-CN" ? unknown.title
        : language === "en" ? "Booster Effect 999999" : "부스터 효과 999999");
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
