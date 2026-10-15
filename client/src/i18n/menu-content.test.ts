import assert from "node:assert/strict";
import test from "node:test";
import { type GameLocale, tr } from "./locale";
import { paintMainMenuCaption, paintStoryCardCaption } from "../ui/main-menu-caption";
import { ItemInventoryView } from "../ui/item-inventory-view";
import { defaultLocalProfile } from "../ui/local-profile";
import { installShopTestDom } from "../shop/shop-test-dom";
import { localizeImageCaption } from "../shop/shop-widgets";
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

test("baked mode captions are replaced in English and Korean without changing the artwork in Chinese", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const labels: string[] = [];
    const bands: number[][] = [];
    const context = { save() {}, restore() {}, fillRect: (...rect: number[]) => bands.push(rect),
      measureText: (value: string) => ({ width: value.length * 8 }),
      fillText: (label: string) => labels.push(label) } as unknown as CanvasRenderingContext2D;
    const rect = { x: 10, y: 20, width: 272, height: 134 };
    paintMainMenuCaption(context, rect, "timeAttack_train", "练习计时赛", false);
    paintMainMenuCaption(context, rect, "unknown", undefined, false);
    assert.deepEqual(labels, locale === "zh-CN" ? [] : [tr("练习计时赛")]);
    for (const [x, y, width, height] of bands) {
      assert.ok(x! >= rect.x && y! >= rect.y);
      assert.ok(x! + width! <= rect.x + rect.width && y! + height! <= rect.y + rect.height);
    }
  });
});

test("story cards replace baked titles inside their artwork while Chinese stays unchanged", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const labels: Array<{ text: string; x: number; y: number }> = [];
    const bands: number[][] = [];
    const context = { save() {}, restore() {}, fillRect: (...rect: number[]) => bands.push(rect),
      measureText: (value: string) => ({ width: Array.from(value).length * 8 }),
      fillText: (text: string, x: number, y: number) => labels.push({ text, x, y }),
    } as unknown as CanvasRenderingContext2D;
    const rect = { x: 10, y: 20, width: 272, height: 134 };
    const title = locale === "en" ? "The Birth of a Rider" : locale === "ko" ? "라이더의 탄생" : "车手的诞生";
    paintStoryCardCaption(context, rect, title, true);
    assert.equal(labels.map(entry => entry.text).join(" "), locale === "zh-CN" ? "" : title);
    assert.equal(bands.length, locale === "zh-CN" ? 0 : 1);
    if (bands.length) {
      const [x, y, width, height] = bands[0]!;
      assert.ok(x! >= rect.x && y! >= rect.y && x! + width! <= rect.x + rect.width && y! + height! <= rect.y + rect.height);
      for (const label of labels) assert.ok(label.x >= x! && label.x <= x! + width! && label.y >= y! && label.y <= y! + height!);
    }
    if (locale !== "zh-CN") {
      paintStoryCardCaption(context, rect, title, false, "chapter_1920y");
      assert.equal(bands[1]![0], rect.x + 48, "long baked titles need a wider cover");
      assert.equal(bands[1]![2], 217);
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
      localizeImageCaption(button as unknown as HTMLElement, tr("兑换"));
      button.click();
      assert.equal(clicks, 1);
      if (locale !== "zh-CN") assert.equal(button.textContent, tr("兑换"));
    } finally { dom.restore(); }
  });
});
