import assert from "node:assert/strict";
import test from "node:test";

import type { AccountSession, AccountSummary, InventoryItem } from "../account/account-session";
import {
  clearShopCatalogCache, SHOP_CATALOG_PATH, SHOP_FREE_COUPON_CLAIM_PATH, SHOP_FREE_COUPON_PATH, SHOP_PURCHASE_PATH,
} from "./shop-api";
import { DIALOG_INPUT_GUARD_MS } from "./shop-buy-dialog";
import { SHOP_TASKBAR_HEIGHT } from "../timeattack/ready-shop";
import { find } from "./shop-original";
import { parseSpendEventStatus, SHOP_SPEND_EVENT_PATH, SpendEventPanel } from "./shop-spend-event";
import { json, MALL_CATALOG_JSON, spendEventJson, summary } from "./shop-test-fixtures";
import { installShopTestDom, TestEvent, type TestDom, type TestElement } from "./shop-test-dom";
import {
  cardMark, discountMark, openShop, riderRect, SHOP_GRID, SHOP_RIDER_RECT, shopGridCell, shopStageLayout,
  type ShopOpenOptions, type ShopPreviewRequest, type ShopStage,
} from "./shop-view";

const PURCHASED = {
  wallet: { coupon: 880, lucci: 0, koin: 0 },
  item: { category: 3, itemId: 10, quantity: 1, expiresAt: 1_800_000_000_000, source: "shop" },
  purchaseId: 7,
};

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** An account session that serves the fixture catalog and answers purchases from a queue. */
function shopSession(purchases: Handler[] = [], inventory: InventoryItem[] = [], catalog: unknown = MALL_CATALOG_JSON,
  spendEvent: () => Response = () => json({ error: "NOT_FOUND" }, 404),
  freeCoupon: () => Response = () => json({ error: "NOT_FOUND" }, 404), claims: Handler[] = []) {
  const bodies: Record<string, unknown>[] = [];
  const claimBodies: Record<string, unknown>[] = [];
  const paths: string[] = [];
  let refreshes = 0;
  const account: AccountSummary = summary({ coupon: 1000, lucci: 0, koin: 0 });
  const session: AccountSession = {
    backendOrigin: `https://data.test/${Math.random()}`,
    summary: () => account,
    inventory: () => inventory,
    owns: () => false,
    refresh: async () => { refreshes++; },
    subscribe: () => () => {},
    authorizedFetch: async (path: string, init?: RequestInit) => {
      paths.push(path);
      if (path === SHOP_CATALOG_PATH) return json(catalog, 200, { ETag: '"v1"' });
      if (path === SHOP_SPEND_EVENT_PATH) return spendEvent();
      if (path === SHOP_FREE_COUPON_PATH) return freeCoupon();
      if (path === SHOP_FREE_COUPON_CLAIM_PATH) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        claimBodies.push(body);
        const handler = claims.shift();
        return handler ? handler(body) : json({ error: "SHOP_CLAIM_CLOSED" }, 403);
      }
      if (path === SHOP_PURCHASE_PATH) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const handler = purchases.shift();
        return handler ? handler(body) : json(PURCHASED);
      }
      return json({ error: "NOT_FOUND" }, 404);
    },
  };
  return { session, bodies, claimBodies, paths, refreshes: () => refreshes };
}

const settle = async () => { for (let round = 0; round < 6; round++) await new Promise(resolve => setImmediate(resolve)); };

/** A stage that records what the shop asks of it. */
function fakeStage(accept: (item: ShopPreviewRequest) => boolean = () => true) {
  const calls: string[] = [];
  let host: TestElement | undefined;
  const stage: ShopStage = {
    tryOn: item => { calls.push(`tryOn ${item.category}:${item.itemId}`); return accept(item); },
    takeOff: item => { calls.push(`takeOff ${item.category}:${item.itemId}`); },
    reset: () => { calls.push("reset"); },
    rotate: pixels => { calls.push(`rotate ${pixels}`); },
    dispose: () => { calls.push("dispose"); },
  };
  return {
    calls, stage, host: () => host,
    preview: { render() {}, stage: (target: HTMLElement) => { host = target as unknown as TestElement; return stage; } },
  };
}

async function openTestShop(purchases: Handler[] = [], inventory: InventoryItem[] = [],
  extra: { stage?: ReturnType<typeof fakeStage>; catalog?: unknown; taskbarHeight?: number;
    spendEvent?: () => Response; freeCoupon?: () => Response; claims?: Handler[];
    options?: Partial<ShopOpenOptions>; viewport?: [number, number] } = {}) {
  clearShopCatalogCache();
  const dom: TestDom = installShopTestDom();
  if (extra.viewport) [dom.window.innerWidth, dom.window.innerHeight] = extra.viewport;
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  // The game's own keyboard handler (application-construction: window keydown).
  const pageKeys: string[] = [];
  dom.window.addEventListener("keydown", event => pageKeys.push(String(event.key)));
  const fixture = shopSession(purchases, inventory, extra.catalog, extra.spendEvent, extra.freeCoupon, extra.claims);
  let closes = 0;
  const handle = await openShop({
    root: root as unknown as HTMLElement, library: {}, session: fixture.session,
    onClose: () => { closes++; },
    ...(extra.stage ? { preview: extra.stage.preview } : {}),
    ...(extra.taskbarHeight ? { taskbarHeight: extra.taskbarHeight } : {}),
    ...extra.options,
  });
  await settle();
  const card = (key: string) => root.querySelector(`.ks-shop-card[data-key="${key}"]`)!;
  const named = (name: string) => root.querySelector(`[data-name="${name}"]`)!;
  const modal = () => root.querySelector(".ks-shop-modal");
  const dialogButtons = () => modal()!.querySelectorAll(".ks-shop-button");
  return {
    ...fixture, dom, root, pageKeys, handle, card, named, modal,
    face: (key: string) => card(key).querySelector(".ks-shop-card-face")!,
    buy: (key: string) => card(key).querySelector("[data-name=buy]")!,
    keys: () => root.querySelectorAll(".ks-shop-card").map(node => node.dataset.key),
    tabs: () => root.querySelector("[data-name=itemCatTab]")!.querySelectorAll("[role=tab]"),
    subTabs: () => root.querySelector("[data-name=itemSubCatTab]")!.querySelectorAll("[role=tab]"),
    toast: () => root.querySelector(".ks-shop-toast")!.text(),
    ok: () => dialogButtons()[0]!,
    cancel: () => dialogButtons()[1]!,
    note: () => modal()!.querySelector(".ks-shop-dialog-note")!.dataset.text,
    closes: () => closes,
    /** A keyboard key at the focused element: keydown then keyup. */
    press(key: string, init: Record<string, unknown> = {}) {
      const event = dom.key("keydown", key, init);
      dom.key("keyup", key);
      return event;
    },
    close() {
      handle.close();
      dom.restore();
    },
  };
}

const px = (node: TestElement, property: string) => Number.parseFloat(node.style[property] ?? "");

test("原版 stage_window@cn：1080 高的屏幕上按原版锚点摆放，没有关闭按钮也没有自己的货币栏", async () => {
  const shop = await openTestShop();
  try {
    // A 16:9 viewport is the 1920×1080 screen of the PC client: the windows land where 2.jpg shows them.
    const window = shop.named("shopItems");
    assert.deepEqual(["left", "top", "width", "height"].map(key => px(window, key)), [874, 200, 752, 694]);
    assert.deepEqual([px(shop.named("shopGCoinCharge"), "left"), px(shop.named("shopGCoinCharge"), "top")], [0, 0]);
    assert.deepEqual(["left", "top"].map(key => px(shop.named("shopGCoinCharge").parentElement!, key)), [290, 200]);
    assert.deepEqual(["left", "top"].map(key => px(shop.named("reset"), key)), [120, 0]);
    assert.deepEqual(["left", "top"].map(key => px(shop.named("reset").parentElement!, key)), [384, 844]);
    const stage = shop.root.querySelector(".ks-shop-stage")!;
    assert.equal(stage.parentElement!.style.getPropertyValue("--ks-shop-w"), "1920px");
    assert.equal(stage.parentElement!.style.getPropertyValue("--ks-shop-scale"), String(900 / 1080));
    // The lobby top bar shows the wallet and Esc or the taskbar leave: no curCash panel, no close button.
    assert.equal(shop.root.querySelector("[data-name=curCash]"), null);
    assert.equal(shop.root.querySelector(".ks-shop-close"), null);
    // itemCatTab: the six original tabs; 礼包 and 使用 have nothing to sell.
    const tabs = shop.tabs();
    assert.deepEqual(tabs.map(tab => tab.text()), ["推荐", "卡丁车", "角色", "礼包", "装备", "使用"]);
    assert.deepEqual(tabs.map(tab => tab.getAttribute("aria-disabled")), [null, null, null, "true", null, "true"]);
    assert.deepEqual(tabs.map(tab => px(tab, "left")), [-8, 75, 158, 241, 324, 407]);
    assert.equal(tabs[0]!.getAttribute("aria-selected"), "true");
    // 推荐: its SubCats without 全部, opening on 新商品 (shopTabs defaultSubTab).
    const subTabs = () => shop.subTabs().map(tab => tab.text());
    assert.deepEqual(subTabs(), ["新商品", "热门商品", "活动"]);
    assert.equal(shop.subTabs()[0]!.getAttribute("aria-selected"), "true");
    assert.deepEqual(shop.keys(), ["3:10", "16:364", "26:2"], "the 新商品 cards in card order");
    assert.deepEqual(shopGridCell(0), { x: 3, y: 3 });
    assert.deepEqual(shopGridCell(4), { x: 237, y: 201 });
    const kart = shop.card("3:10");
    assert.deepEqual([px(kart, "left"), px(kart, "top")], [shopGridCell(0).x, shopGridCell(0).y]);
    assert.equal(kart.dataset.currency, "coupon");
    assert.equal(shop.face("3:10").text(), "尖锋6.5");
    // The original card's one price (displayOfferId: 永久 216), no 起 and no ownership text on the face.
    assert.equal(kart.querySelector("[data-name=price]")!.text(), "216");
    assert.equal(kart.querySelector("[data-name=preprice]")!.hidden, true);
    assert.equal(kart.querySelector(".ks-shop-owned-label"), null);
    assert.equal(shop.buy("3:10").text(), "兑换");
    assert.equal(kart.querySelector("[data-name=giveGift]")!.text(), "赠送");
    // The title bar's "i" on 点券 kart cards.
    assert.equal(kart.querySelector("[data-name=detailBtn]")!.hidden, false);
    assert.equal(shop.card("26:2").querySelector("[data-name=detailBtn]")!.hidden, true);
    // 人气 and 新品 marks; the discounted card: struck 400 → 360 with the blue 9折 flag.
    assert.equal(kart.querySelector(".ks-shop-mark")!.dataset.mark, "hot");
    assert.equal(shop.card("26:2").querySelector(".ks-shop-mark")!.dataset.mark, "new");
    const svip = shop.card("16:364");
    assert.equal(svip.querySelector(".ks-shop-mark")!.dataset.mark, "discount");
    assert.equal(svip.querySelector("[data-name=discountVal]")!.text(), "9折");
    assert.equal(svip.querySelector("[data-name=discountVal]")!.hidden, false);
    assert.equal(svip.querySelector("[data-name=price]")!.hidden, true);
    assert.equal(svip.querySelector("[data-name=preprice]")!.text(), "400");
    assert.equal(svip.querySelector("[data-name=discprice]")!.text(), "360");
    assert.equal(svip.querySelector("[data-name=discount]")!.hidden, false);
    // 热门商品.
    shop.subTabs()[1]!.click();
    assert.deepEqual(shop.keys(), ["16:364", "3:10"]);
    // 卡丁车: 全部 then the engine SubCats; empty ones are shown but disabled.
    tabs[1]!.click();
    assert.deepEqual(subTabs(), ["全部", "迅 引擎", "V1 引擎", "其他引擎", "改装部件", "强化材料"]);
    assert.deepEqual(shop.subTabs().map(tab => tab.getAttribute("aria-disabled")),
      [null, null, "true", null, "true", "true"]);
    assert.deepEqual(shop.subTabs().map(tab => px(tab, "left")), [-7, 75, 159, 243, 327, 411]);
    // 全部: the SubCats' cards first (迅 引擎's 爆烈 E2), then the rest of the tab.
    assert.deepEqual(shop.keys(), ["3:20", "3:10", "3:5"]);
    assert.equal(shop.card("3:20").dataset.currency, "lucci");
    assert.equal(shop.card("3:20").querySelector("[data-name=detailBtn]")!.hidden, true);
    shop.subTabs()[2]!.click();
    assert.deepEqual(shop.keys(), ["3:20", "3:10", "3:5"], "an empty SubCat cannot be chosen");
    shop.subTabs()[3]!.click();
    assert.deepEqual(shop.keys(), ["3:10", "3:5"]);
    // 角色 has no SubCats: an empty row.
    tabs[2]!.click();
    assert.deepEqual(subTabs(), []);
    assert.deepEqual(shop.keys(), ["1:2"]);
    tabs[3]!.click();
    assert.equal(shop.toast(), "礼包暂未开放");
    assert.equal(tabs[2]!.getAttribute("aria-selected"), "true");
    // The scrollbar stays beside the grid like the original's.
    assert.equal(shop.named("itemListBar").hidden, false);
  } finally {
    shop.close();
  }
});

test("锚点随屏幕宽度：中心对齐的窗口在更宽的屏幕上仍居中，缩放只看高度", async () => {
  const wide = shopStageLayout(2560);
  const rect = (name: string) => wide.rect(find(wide.root, name));
  assert.equal(rect("shopItems").x, (2560 - 752) / 2 + 290);
  assert.equal(rect("tcCashWndPos").x, (2560 - 550) / 2 - 395);
  assert.deepEqual([rect("tcCashWndPos").y, rect("tcCashWndPos").width, rect("tcCashWndPos").height], [278, 550, 184]);
  assert.equal(rect("reset").x, (2560 - 162) / 2 - 495 + 120);
  assert.deepEqual(riderRect({ width: 2560 }), { ...SHOP_RIDER_RECT, x: SHOP_RIDER_RECT.x + 320 });
  // A 21:9 viewport: the screen is 1080 high and wider; resizing moves the anchored windows.
  const shop = await openTestShop([], [], { viewport: [2520, 1080] });
  try {
    const element = shop.root.querySelector(".ks-shop")!;
    assert.equal(element.style.getPropertyValue("--ks-shop-w"), "2520px");
    assert.equal(element.style.getPropertyValue("--ks-shop-scale"), "1");
    assert.equal(px(shop.named("shopItems"), "left"), (2520 - 752) / 2 + 290);
    shop.dom.window.innerWidth = 1280;
    shop.dom.window.innerHeight = 720;
    shop.dom.window.dispatchEvent(new TestEvent("resize"));
    assert.equal(element.style.getPropertyValue("--ks-shop-w"), "1920px");
    assert.equal(element.style.getPropertyValue("--ks-shop-scale"), String(720 / 1080));
    assert.equal(px(shop.named("shopItems"), "left"), 874);
  } finally {
    shop.close();
  }
});

test("卡片角标：折扣三种颜色与长标签，否则新品、人气、限购", () => {
  const offer = (price: number, originalPrice?: number, discountPercent?: number, discountLabel?: string) =>
    ({ offerId: "s", currency: "coupon" as const, price, days: 0, count: 1, source: "original",
      ...(originalPrice ? { originalPrice } : {}), ...(discountPercent ? { discountPercent } : {}),
      ...(discountLabel ? { discountLabel } : {}) });
  assert.deepEqual(discountMark(offer(360, 400, 10, "9折")),
    { mark: "discount", image: "discount10@cn", width: 67, height: 32, label: "9折" });
  assert.equal(discountMark(offer(799, 1330, 40, "6折"))!.image, "discount30@cn");
  assert.deepEqual(discountMark(offer(1999, 3593, 44, "5.6折")),
    { mark: "discount", image: "discount30_long@cn", width: 85, height: 32, label: "5.6折" });
  assert.equal(discountMark(offer(30, 100, 70))!.image, "discount60@cn");
  assert.equal(discountMark(offer(30, 100, 70))!.label, "3折");
  assert.equal(discountMark(offer(30)), undefined);
  const shown = offer(10);
  assert.equal(cardMark({ marks: ["new", "limited"], offers: [shown] }, shown)!.image, "new@cn");
  assert.equal(cardMark({ marks: ["hot"], offers: [shown] }, shown)!.image, "hot@cn");
  assert.equal(cardMark({ marks: ["limited"], offers: [shown] }, shown)!.image, "eventbuycount@cn");
  const discounted = offer(360, 400, 10, "9折");
  assert.equal(cardMark({ marks: ["discount", "limited"], offers: [shown, discounted] }, shown)!.mark, "discount");
  assert.equal(cardMark({ offers: [shown] }, shown), undefined);
});

test("双击兑换：第一下打开对话框，第二下（detail 2）既不再打开也不购买", async () => {
  const shop = await openTestShop();
  try {
    const buy = shop.buy("3:10");
    assert.ok(buy, "the recommended kart is on the first page");
    buy.focus();
    buy.click({ detail: 1 });
    assert.ok(shop.modal(), "the first click opens the dialog");
    shop.dom.advance(120);
    // The second click lands on whatever the dialog put under the pointer.
    shop.ok().click({ detail: 2 });
    shop.modal()!.fire("pointerdown");
    shop.modal()!.click({ detail: 2 });
    await settle();
    assert.deepEqual(shop.bodies, [], "no purchase without a deliberate confirmation");
    assert.ok(shop.modal(), "the dialog stays open");
    // A 兑换 click that is itself the second click of a double-click opens nothing.
    shop.dom.advance(DIALOG_INPUT_GUARD_MS);
    shop.cancel().click();
    assert.equal(shop.modal(), null);
    shop.buy("3:10").click({ detail: 2 });
    assert.equal(shop.modal(), null);
    // A deliberate purchase after the guard works.
    shop.buy("3:10").click({ detail: 1 });
    shop.dom.advance(DIALOG_INPUT_GUARD_MS);
    shop.ok().click();
    await settle();
    assert.equal(shop.bodies.length, 1);
  } finally {
    shop.close();
  }
});

test("Enter 打开对话框后一直按住：自动重复不会购买，松开后再按 Enter 才购买", async () => {
  const shop = await openTestShop();
  try {
    const buy = shop.buy("3:10");
    buy.focus();
    // Enter on the focused 兑换 button: keydown, then the button's click (detail 0).
    shop.dom.key("keydown", "Enter");
    buy.click({ detail: 0 });
    assert.ok(shop.modal());
    for (let repeat = 0; repeat < 5; repeat++) shop.dom.key("keydown", "Enter", { repeat: true });
    await settle();
    assert.deepEqual(shop.bodies, []);
    shop.dom.key("keyup", "Enter");
    shop.dom.key("keydown", "Enter");
    await settle();
    assert.equal(shop.bodies.length, 1);
  } finally {
    shop.close();
  }
  // Opened with the mouse, the first Enter confirms.
  const mouse = await openTestShop();
  try {
    mouse.buy("3:10").click({ detail: 1 });
    mouse.press("Enter");
    await settle();
    assert.equal(mouse.bodies.length, 1);
  } finally {
    mouse.close();
  }
});

test("商店打开时按键不会传到后面的页面（F5 开始比赛、P 自动准备、F6–F8 声音开关）", async () => {
  const shop = await openTestShop();
  try {
    shop.face("3:10").focus();
    for (const key of ["F5", "p", "F6", "F7", "F8", "ArrowUp", "Enter"]) shop.dom.key("keydown", key);
    shop.dom.key("keyup", "Enter");
    // Focus outside the shop (e.g. body after a click on nothing focusable).
    shop.dom.document.body.focus();
    const f5 = shop.dom.key("keydown", "F5");
    shop.dom.key("keydown", "p");
    // With the buy dialog open.
    shop.buy("3:10").click({ detail: 1 });
    shop.dom.key("keydown", "F7");
    assert.deepEqual(shop.pageKeys, []);
    // F5 must not reload the game from the shop either; ordinary keys keep their defaults.
    assert.equal(f5.defaultPrevented, true);
    assert.equal(shop.dom.key("keydown", "q").defaultPrevented, false);
    assert.equal(shop.dom.key("keydown", "F5", { ctrlKey: true }).defaultPrevented, false);
  } finally {
    shop.handle.close();
  }
  try {
    // Closed: keys reach the page again and the shop left no listeners behind.
    shop.dom.key("keydown", "F5");
    assert.deepEqual(shop.pageKeys, ["F5"]);
    assert.equal(shop.dom.document.listenerCount("keydown"), 0);
    assert.equal(shop.dom.document.listenerCount("keyup"), 0);
  } finally {
    shop.dom.restore();
  }
});

test("结果未知的购买：对话框内重试沿用 requestId，关闭后再次购买使用新的 requestId", async () => {
  // 200 with an unreadable body: the purchase may have gone through.
  const unknown: Handler = () => new Response("{", { status: 200 });
  const shop = await openTestShop([unknown, unknown]);
  try {
    const buy = shop.buy("3:10");
    buy.click({ detail: 1 });
    shop.dom.advance(DIALOG_INPUT_GUARD_MS);
    shop.ok().click();
    await settle();
    assert.equal(shop.ok().text(), "重试");
    shop.ok().click();
    await settle();
    assert.equal(shop.bodies.length, 2);
    assert.equal(shop.bodies[1]!.requestId, shop.bodies[0]!.requestId, "重试 repeats the same purchase");
    const refreshes = shop.refreshes();
    shop.cancel().click();
    assert.equal(shop.modal(), null);
    assert.ok(shop.refreshes() > refreshes, "leaving an unknown outcome re-reads the account");
    // Minutes later the player deliberately buys the same term again.
    shop.buy("3:10").click({ detail: 1 });
    shop.dom.advance(DIALOG_INPUT_GUARD_MS);
    shop.ok().click();
    await settle();
    assert.equal(shop.bodies.length, 3);
    assert.notEqual(shop.bodies[2]!.requestId, shop.bodies[0]!.requestId,
      "a new dialog never replays an earlier requestId");
    assert.deepEqual({ ...shop.bodies[2], requestId: undefined },
      { offerId: "s1", requestId: undefined, expectedPrice: 120, expectedCurrency: "coupon" });
    assert.equal(shop.modal()!.querySelector(".ks-shop-dialog-message")!.text(), "兑换成功，已放入车库");
  } finally {
    shop.close();
  }
});

test("价格已变化：提示刷新，关闭对话框后重新加载商店目录", async () => {
  const shop = await openTestShop([() => json({ error: "PRICE_CHANGED" }, 409)]);
  try {
    shop.buy("3:10").click({ detail: 1 });
    shop.dom.advance(DIALOG_INPUT_GUARD_MS);
    shop.ok().click();
    await settle();
    assert.equal(shop.modal()!.querySelector(".ks-shop-dialog-message")!.text(),
      "价格已变化，请刷新商店后重试。");
    assert.equal(shop.ok().disabled, true);
    const catalogs = shop.paths.filter(path => path === SHOP_CATALOG_PATH).length;
    shop.cancel().click();
    await settle();
    assert.equal(shop.paths.filter(path => path === SHOP_CATALOG_PATH).length, catalogs + 1);
  } finally {
    shop.close();
  }
});

test("卡片与提示框显示的剩余期限与车库一致", async () => {
  // Just under two days left: the garage says 剩余 1 天, so does the shop.
  const shop = await openTestShop([], [{ category: 3, itemId: 10, quantity: 1,
    expiresAt: Date.now() + 2 * 86_400_000 - 60_000, source: "shop" }]);
  try {
    const card = shop.card("3:10");
    // The card face says nothing about ownership (the original card has no such text).
    assert.equal(card.querySelector(".ks-shop-owned-label"), null);
    assert.equal(card.dataset.owned, "yes");
    // Hovering (or focusing) the card shows the shopCardTip tooltip with its terms and the rental.
    card.fire("pointerenter");
    const tip = shop.root.querySelector(".ks-shop-tooltip")!;
    assert.equal(tip.hidden, false);
    assert.equal(tip.querySelector(".ks-shop-tip-owned")!.text(), "剩余 1 天");
    assert.equal(tip.querySelector("[data-name=stocks]")!.text(), "30天 120点券\n永久 216点券\n30天 2,500金币");
    assert.equal(card.dataset.active, "true");
    card.fire("pointerleave");
    assert.equal(tip.hidden, true);
    // Buying it again says what happens to the rental.
    shop.buy("3:10").click({ detail: 1 });
    assert.match(shop.note()!, /^\* 当前剩余 1 天，兑换后到期 \d{4}-\d{2}-\d{2} \d{2}:\d{2}。适当娱乐，理性消费。$/);
  } finally {
    shop.close();
  }
});

test("试穿：点卡片在 3D 车手上试穿并打勾，再点取消，初始状态全部还原；关闭商店时释放", async () => {
  const stage = fakeStage(item => item.category !== 26);
  const shop = await openTestShop([], [], { stage });
  try {
    const host = stage.host()!;
    assert.ok(host, "the stage draws into the left of the stage");
    const rider = host.parentElement!;
    assert.deepEqual(["left", "top", "width", "height"].map(key => px(rider, key)),
      [SHOP_RIDER_RECT.x, SHOP_RIDER_RECT.y, SHOP_RIDER_RECT.width, SHOP_RIDER_RECT.height]);
    const selected = () => shop.root.querySelectorAll(".ks-shop-card").map(card =>
      card.querySelector("[data-name=selected]")!.hidden ? "" : card.dataset.key);
    shop.face("3:10").click();
    assert.deepEqual(stage.calls, ["tryOn 3:10"]);
    assert.deepEqual(selected(), ["3:10", "", ""]);
    assert.equal(shop.face("3:10").getAttribute("aria-pressed"), "true");
    // The aura cannot be worn by this stage: nothing changes.
    shop.face("26:2").click();
    assert.equal(shop.toast(), "该道具暂时无法试穿预览");
    assert.deepEqual(selected(), ["3:10", "", ""]);
    shop.face("3:10").click();
    assert.deepEqual(stage.calls.slice(-1), ["takeOff 3:10"]);
    assert.deepEqual(selected(), ["", "", ""]);
    shop.face("3:10").click();
    shop.named("reset").click();
    assert.deepEqual(stage.calls.slice(-1), ["reset"]);
    assert.deepEqual(selected(), ["", "", ""]);
  } finally {
    shop.close();
  }
  assert.deepEqual(stage.calls.slice(-1), ["dispose"]);
});

test("滚轮按行翻页（linePaging）：一次一行，滚动条随之移动", async () => {
  // Twenty balloons: seven rows, five scroll positions.
  const catalog = structuredClone(MALL_CATALOG_JSON) as typeof MALL_CATALOG_JSON;
  catalog.items.push(...Array.from({ length: 20 }, (_, index) => ({
    category: 9, itemId: 100 + index, kind: "balloon", name: `气球${index}`, internalId: `b${index}`,
    tab: "equip", subTab: "balloon", shopCategory: "equip", shopSubCategory: "balloon",
    offers: [{ offerId: `b${index}`, currency: "coupon", price: 10, days: 0, count: 1, source: "original" }],
  })) as never[]);
  const shop = await openTestShop([], [], { catalog });
  try {
    shop.named("itemCatTab").querySelectorAll("[role=tab]")[4]!.click();
    const first = shop.keys();
    assert.equal(first.length, 9);
    const scroll = shop.named("itemListBar");
    assert.equal(scroll.hidden, false);
    const wheel = (deltaY: number) => shop.named("shopItems").dispatchEvent(
      new TestEvent("wheel", { deltaY, deltaMode: 0 }));
    wheel(100);
    assert.deepEqual(shop.keys().slice(0, 6), first.slice(3, 9), "one row up");
    wheel(-100);
    assert.deepEqual(shop.keys(), first);
    wheel(-100);
    assert.deepEqual(shop.keys(), first, "nothing above the first row");
    // PageDown scrolls by the three visible rows and focuses the first card.
    shop.face(first[0]!).focus();
    shop.press("PageDown");
    const paged = shop.keys();
    assert.notEqual(paged[0], first[0]);
    assert.equal(shop.dom.document.activeElement, shop.face(paged[0]!));
    for (let line = 0; line < 3; line++) wheel(-100);
    assert.deepEqual(shop.keys(), first, "three rows back up");
  } finally {
    shop.close();
  }
});

test("搜索：搜索按钮打开输入框（最多 10 个字），回车查找全部道具，Esc 清除", async () => {
  const shop = await openTestShop();
  try {
    const button = shop.named("searchBtn");
    const box = shop.named("searchEdit");
    assert.equal(box.hidden, true);
    button.click();
    assert.equal(box.hidden, false);
    const input = box.querySelector(".ks-edit-input")!;
    assert.equal(input.maxLength, 10);
    assert.equal(shop.dom.document.activeElement, input);
    assert.equal(shop.named("searchEditTooltip").hidden, false, "the talk balloon asks for a name");
    input.value = "炫光";
    input.fire("input");
    assert.equal(shop.named("searchEditTooltip").hidden, true);
    shop.press("Enter");
    assert.deepEqual(shop.keys(), ["26:2"]);
    const subTabs = shop.named("itemSubCatTab").querySelectorAll("[role=tab]");
    assert.deepEqual(subTabs.map(tab => tab.text()), ["搜索结果 1"]);
    assert.equal(shop.named("itemCatTab").querySelector("[aria-selected=true]"), null);
    shop.press("Escape");
    assert.equal(input.value, "");
    assert.deepEqual(shop.keys(), ["3:10", "16:364", "26:2"]);
    assert.equal(shop.closes(), 0, "Esc in the search box does not close the shop");
  } finally {
    shop.close();
  }
});

test("赠送、兑奖券与精品记录照原版显示并提示暂未开放，充值按钮隐藏", async () => {
  const shop = await openTestShop([], [], { taskbarHeight: SHOP_TASKBAR_HEIGHT });
  try {
    assert.equal(shop.root.querySelector(".ks-shop")!.style.getPropertyValue("--ks-shop-taskbar"), "79px");
    shop.card("3:10").querySelector("[data-name=giveGift]")!.click();
    assert.equal(shop.toast(), "赠送暂未开放");
    assert.equal(shop.root.querySelectorAll("[data-name=shopGCoinCharge]").length, 1, "only the big 充值 button");
    assert.equal(shop.root.querySelectorAll("[data-name=shopGCoinCharge]")[0]!.hidden, true,
      "充值 is not offered, and the data service has no 点击获取点券 button");
    shop.named("shopCoupon").click();
    assert.equal(shop.toast(), "兑奖券暂未开放");
    shop.named("gachaOpenResult").click();
    assert.equal(shop.toast(), "精品道具全服记录暂未开放");
    assert.equal(shop.named("buyAll").hidden, true, "兑换预览道具 stays hidden as in stage_window@cn");
    // Esc closes the shop once.
    shop.press("Escape");
    shop.press("Escape");
    assert.equal(shop.closes(), 1);
  } finally {
    shop.close();
  }
});

test("任务栏那一条留给任务栏：商品列表不伸进去，车库、商店、小屋按钮点得到", async () => {
  // The tray is 7.333% of the screen: 79 of the shop screen's 1080 rows (src/ui/taskbar.ts,
  // ready-shop.ts SHOP_TASKBAR_HEIGHT); the shop sits above it (z-index 3 over 2), so
  // nothing of its own may reach into that strip.
  const taskbar = SHOP_TASKBAR_HEIGHT;
  const shop = await openTestShop([], [], { taskbarHeight: taskbar });
  try {
    const stage = shop.root.querySelector(".ks-shop-stage")!;
    const desktop = shop.root.querySelector(".ks-shop-desktop")!;
    const list = shop.named("itemList");
    assert.equal(list.hidden, false, "the loaded item list is shown");
    assert.equal(list.classList.contains("ks-shop-grid"), true, "the list takes the pointer");
    const reaching: string[] = [];
    const visit = (node: TestElement, x: number, y: number) => {
      if (node.hidden) return;
      const left = x + (px(node, "left") || 0);
      const top = y + (px(node, "top") || 0);
      const height = px(node, "height");
      // The BML root is the whole 1080-high screen and ignores the pointer.
      if (node !== desktop && Number.isFinite(height) && top + height > 1080 - taskbar)
        reaching.push(`${node.dataset.name ?? node.className}: ${left},${top} +${height}`);
      for (const child of node.children) visit(child, left, top);
    };
    for (const child of stage.children) visit(child, 0, 0);
    // itemList's windowSize (766×800 at y 288) ran to y 1088 over 商店, 车库 and part of 小屋.
    assert.deepEqual(reaching, []);
    // In place, and still holding the three visible rows of cards.
    assert.deepEqual([px(list, "left"), px(list, "top")], [20, 8]);
    const bottom = shopGridCell(SHOP_GRID.rows * SHOP_GRID.columns - 1).y + SHOP_GRID.card.height;
    assert.ok(px(list, "height") >= bottom, `${px(list, "height")} >= ${bottom}`);
  } finally {
    shop.close();
  }
});

test("累计消费活动已隐藏：商城不请求 /api/shop/spend-event，窗口不显示，买东西后也不显示", async () => {
  const shop = await openTestShop([], [], { spendEvent: () => json(spendEventJson(2500)) });
  try {
    assert.equal(shop.root.querySelector(".ks-shop-spend")!.hidden, true);
    assert.ok(!shop.paths.includes(SHOP_SPEND_EVENT_PATH), "the event is not even asked for");
    shop.buy("3:10").click({ detail: 1 });
    shop.dom.advance(DIALOG_INPUT_GUARD_MS);
    shop.ok().click();
    await settle();
    assert.equal(shop.bodies.length, 1, "the purchase went through");
    assert.ok(!shop.paths.includes(SHOP_SPEND_EVENT_PATH));
    assert.equal(shop.root.querySelector(".ks-shop-spend")!.hidden, true);
  } finally {
    shop.close();
  }
});

test("累计消费活动窗口本身仍按原版显示进度与奖励（供日后重新开放）", () => {
  const dom = installShopTestDom();
  const panel = new SpendEventPanel();
  dom.document.body.append(panel.element as unknown as TestElement);
  const text = (name: string) => (panel.element.querySelector(`[data-name=${name}]`) as unknown as TestElement).text();
  panel.render(parseSpendEventStatus(spendEventJson(2500)));
  assert.equal(panel.element.hidden, false);
  assert.equal(text("period"), "活动期间 : 2026-9-17 6:00 ~ 2026-10-15 5:59");
  assert.equal(text("tcCashPoint"), "2500");
  assert.equal(text("tcCashPointStr"), "累计消费电池数");
  assert.equal(text("help"), "活动期间消费一定电池，即可获得相应奖励！");
  const steps = () => (panel.element.querySelectorAll(".ks-shop-spend-step") as unknown as TestElement[]);
  assert.deepEqual(steps().map(step => step.querySelector("[data-name=rewardCount]")!.text()),
    ["10 个", "200 个", "40 个", "无限制"]);
  assert.deepEqual(steps().map(step => step.querySelector("[data-name=point]")!.text()), ["1000", "2000", "5000", "8000"]);
  // Slots end at each quarter of the 440 px bar; the first two are reached (display only).
  assert.deepEqual(steps().map(step => px(step, "left")), [30, 140, 250, 360]);
  assert.deepEqual(steps().map(step => step.dataset.reached), ["true", "true", "false", "false"]);
  // No event, or a malformed answer: no window.
  panel.render(parseSpendEventStatus(spendEventJson(0, { event: null })));
  assert.equal(panel.element.hidden, true);
  panel.render(undefined);
  assert.equal(panel.element.hidden, true);
  // After the event period, during the reward period: spending no longer counts.
  panel.render(parseSpendEventStatus(spendEventJson(1200,
    { active: false, serverTime: Date.parse("2026-10-18T12:00:00+08:00") })));
  assert.equal(panel.element.hidden, false);
  assert.equal(text("help"), "累计消费活动已结束。");
  assert.deepEqual(steps().map(step => step.querySelector("[data-name=close]")!.hidden), [true, false, false, false]);
  panel.dispose();
});

test("在大厅上打开：透明露出大厅的三维场景和顶栏；在别处打开：大厅静帧（不模糊）和同样的顶栏", async () => {
  const lobby = await openTestShop([], [], { options: { overLobby: true,
    topBar: () => { throw new Error("the lobby's own top bar is in view"); },
    backdrop: { image: {} as CanvasImageSource, width: 960, height: 500 } } });
  try {
    const scene = lobby.root.querySelector(".ks-shop-scene")!;
    assert.equal(scene.dataset.backdrop, "lobby");
    assert.equal(lobby.root.querySelector(".ks-shop-backdrop"), null);
    assert.equal(lobby.root.querySelector(".ks-shop-topbar")!.hidden, true);
  } finally {
    lobby.close();
  }
  const hosts: TestElement[] = [];
  let disposed = 0;
  let notice: ((message: string) => void) | undefined;
  const away = await openTestShop([], [], { options: {
    topBar: (host, actions) => {
      hosts.push(host as unknown as TestElement);
      notice = actions.notice;
      host.append(host.ownerDocument.createElement("header"));
      return { dispose: () => { disposed++; } };
    } } });
  try {
    assert.equal(hosts.length, 1);
    const host = away.root.querySelector(".ks-shop-topbar")!;
    assert.equal(hosts[0], host);
    assert.equal(host.hidden, false);
    // Inside the stage, the size of the lobby area (the screen above the tray).
    assert.equal(host.style.height, "1000.8px");
    assert.equal(away.root.querySelector(".ks-shop-scene")!.dataset.backdrop, "sky");
    notice!("商城充值暂未开放");
    assert.equal(away.toast(), "商城充值暂未开放");
  } finally {
    away.close();
  }
  assert.equal(disposed, 1, "the top bar goes with the shop");
});

// 商城“点击获取点券”按钮 (ECONOMY.md 2.5): the original 充值 button shows with
// the admin's amounts while the data service says the button is on; a click
// sends one requestId, tells what arrived and refreshes the wallet; the
// button hides when the admin switches it off.
test("点击获取点券按钮：后台开启时显示，点击入账并刷新钱包，关闭后隐藏", async () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const status = (enabled: boolean) => () => json({ enabled, coupon: 10_000, lucci: 0, koin: 25, serverTime: 1 });
  const shop = await openTestShop([], [], { freeCoupon: status(true), claims: [
    () => json({ wallet: { coupon: 11_000, lucci: 0, koin: 25 }, granted: { coupon: 10_000, lucci: 0, koin: 25 }, duplicate: false }),
    () => json({ wallet: { coupon: 11_000, lucci: 0, koin: 25 }, granted: { coupon: 0, lucci: 0, koin: 0 }, duplicate: true }),
  ] });
  try {
    const button = shop.named("shopGCoinCharge") as TestElement & { disabled?: boolean; title?: string };
    assert.equal(button.hidden, false, "the button shows while the admin keeps it on");
    assert.equal(button.text(), "点击获取点券");
    assert.equal(button.title, "每次 10,000 点券、25 K币");
    button.click();
    await settle();
    assert.equal(shop.claimBodies.length, 1);
    assert.match(String(shop.claimBodies[0]!.requestId), UUID);
    assert.equal(shop.toast(), "已获得 10,000 点券、25 K币");
    assert.equal(shop.refreshes(), 1, "the wallet is re-read after a claim");
    assert.equal(button.disabled, false);
    button.click();
    await settle();
    assert.notEqual(shop.claimBodies[1]!.requestId, shop.claimBodies[0]!.requestId, "every click is its own request");
    assert.equal(shop.toast(), "本次领取已经到账。");
    // The admin switched it off meanwhile: the click is refused and the button goes.
    button.click();
    await settle();
    assert.equal(shop.claimBodies.length, 3);
    assert.equal(shop.toast(), "领取已关闭。");
    assert.equal(button.hidden, true);
  } finally {
    shop.close();
  }
  const off = await openTestShop([], [], { freeCoupon: status(false) });
  try {
    assert.equal(off.named("shopGCoinCharge").hidden, true, "hidden while the admin keeps it off");
    assert.equal(off.claimBodies.length, 0);
  } finally {
    off.close();
  }
});
