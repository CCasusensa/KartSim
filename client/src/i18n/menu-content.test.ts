import assert from "node:assert/strict";
import test from "node:test";
import { type GameLocale, tr } from "./locale";
import { ItemInventoryView } from "../ui/item-inventory-view";
import { defaultLocalProfile } from "../ui/local-profile";
import { installShopTestDom } from "../shop/shop-test-dom";
import { setImageButtonLabel } from "../shop/shop-widgets";
import { discountMark } from "../shop/shop-view";
import { mallTabEntries, shopTabEntries } from "../shop/shop-model";
import { rR } from "../generated/formats.js";
import { parseQuest } from "../menus/menus-api";
import { questProgressText } from "../menus/quest-screen";
import { kickVoteTextLines } from "../ui/kick-vote-window";

function withLocale(locale: GameLocale, run: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("legacy room captions translate every mode while preserving a Chinese room name", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    for (const gameplay of ["ordinary", "grip", "shadow", "roadblock", "giant", "rp", "lte", "item", "brawl"]) {
      for (const channelName of ["speedIndiCombine", "speedTeamCombine", "speedIndiInfinit", "speedTeamInfinit"]) {
        const caption = rR({ name: "玩家的房间", gameplay, channelName });
        assert.ok(caption.startsWith("玩家的房间（"));
        if (locale !== "zh-CN") assert.doesNotMatch(caption.slice("玩家的房间".length), /\p{Script=Han}/u);
      }
    }
  });
});

test("quest menus translate service copy and kick votes keep player names intact", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const quest = parseQuest({ id: 9006, reset: "daily", kind: 3, target: 100, value: 34,
      channels: ["speedIndiCombine"], title: "累计行驶距离", desc: "在多人游戏中累计行驶10KM吧！",
      mission: "多人游戏累计完成10KM", rewards: [], periodStart: 1, periodEnd: 2 });
    assert.equal(quest.title, tr("累计行驶距离"));
    assert.deepEqual(quest.channels, ["speedIndiCombine"]);
    assert.equal(quest.id, 9006);
    assert.match(questProgressText(quest, new Map()), /3\.4/);
    const vote = kickVoteTextLines("开始");
    assert.ok(vote[0].includes("开始"));
    if (locale !== "zh-CN") {
      assert.doesNotMatch([quest.title, quest.desc, quest.mission, vote[1], vote[2]].join(" "), /\p{Script=Han}/u);
    }
  });
});

test("inventory menus translate while item identity and user text stay intact", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const dom = installShopTestDom();
    try {
      const view = new ItemInventoryView({ root: dom.document.body as unknown as HTMLElement,
        catalog: { karts: [{ kind: "kart", itemId: 387, title: "玩家自己的中文名称", internalId: "kart_a",
          path: "kart_/kart_a/model.1s", identityClass: "catalog-vehicle" }], characters: [], equipment: [] },
        profile: defaultLocalProfile(), onClose() {}, onProfileChange() {}, onEquip() {} });
      view.show();
      assert.equal(view.window.getAttribute("aria-label"), tr("我的物品"));
      assert.equal(view.search.placeholder, tr("请输入道具名称"));
      assert.match(view.grid.textContent!, /玩家自己的中文名称/);
      if (locale !== "zh-CN") {
        assert.doesNotMatch(view.tabs.textContent!, /\p{Script=Han}/u);
        assert.doesNotMatch(view.count.textContent!, /\p{Script=Han}/u);
      }
      view.dispose();
    } finally { dom.restore(); }
  });
});

test("shop category labels and discount badges follow the language, preserving catalog IDs", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const entries = shopTabEntries({ tabs: [{ id: "kartBody", name: "卡丁车", subTabs: [] }], items: [] });
    assert.equal(entries.find(entry => entry.id === "kartBody")!.name, tr("卡丁车"));
    const mall = mallTabEntries([{ id: "kartBody", name: "卡丁车", allSubTab: "全部",
      subTabs: [{ id: "itemKart", name: "道具车", cardItems: [] }] }]);
    assert.deepEqual(mall[0]!.subTabs, [{ id: "all", name: tr("全部") },
      { id: "itemKart", name: tr("道具车") }]);
    assert.equal(discountMark({ price: 40, originalPrice: 100 })!.label,
      locale === "zh-CN" ? "4折" : locale === "en" ? "60% off" : "60% 할인");
    const dom = installShopTestDom();
    try {
      const button = dom.document.createElement("button");
      let clicks = 0;
      button.addEventListener("click", () => clicks++);
      setImageButtonLabel(button as unknown as HTMLElement, tr("兑换"));
      button.click();
      assert.equal(clicks, 1);
      assert.equal(button.getAttribute("aria-label"), tr("兑换"));
      assert.equal(button.textContent, "");
    } finally { dom.restore(); }
  });
});
