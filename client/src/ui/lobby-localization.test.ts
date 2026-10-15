import assert from "node:assert/strict";
import test from "node:test";
import { tr, type GameLocale } from "../i18n/locale";
import { LobbyHomeView, QUICK_ENTRIES } from "./lobby-home-view";
import { localizedLobbyPromoPath } from "./lobby-promos";
import { lobbyRoomModeLabel } from "./lobby-list-layout";
import { lobbyRoomStatus } from "./lobby-list-draw";
import { installFakeDom, type FakeElement } from "./fake-dom";

function withLocale(locale: GameLocale, run: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === "kartsim.language" ? locale : null,
  } });
  try { run(); } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("home content follows all three languages while rider names and entry identifiers stay intact", () => {
  for (const [locale, quick, city, speed, event, coin] of [
    ["zh-CN", "快速进入", "卡丁城", "竞速个人赛", "寻宝活动", "点券 5"],
    ["en", "Quick entry", "Kart City", "Solo Speed", "Treasure hunt", "Coupons 5"],
    ["ko", "빠른 입장", "카트 시티", "스피드 개인전", "보물찾기 이벤트", "포인트 5"],
  ] as const) withLocale(locale, () => {
    const dom = installFakeDom();
    try {
      let selected: string | undefined;
      const view = new LobbyHomeView(dom.document.body as unknown as HTMLElement, {
        riderName: "玩家自己的中文昵称", banners: [], wallet: { coupon: 5 },
        events: [{ id: "treasure", label: "寻宝活动", states: [] }, { id: "items", label: "精品道具", states: [] }],
        onEntry: entry => { selected = entry.id; },
      });
      const element = view.element as unknown as FakeElement;
      assert.equal(element.querySelector(".ks-lobby-quick-head")!.text(), quick);
      const entries = element.querySelectorAll(".ks-lobby-entry");
      assert.equal(entries[0]!.text(), `${city}»`);
      assert.equal(entries[1]!.text(), `${speed}»`);
      assert.equal(element.querySelector(".ks-lobby-event")!.getAttribute("aria-label"), event);
      assert.equal(element.querySelector(".ks-lobby-name")!.text(), "玩家自己的中文昵称");
      assert.equal(element.querySelector(".ks-lobby-coin")!.getAttribute("aria-label"), coin);
      entries[1]!.click();
      assert.equal(selected, "speedIndi");
      if (locale !== "zh-CN") {
        assert.ok(!/\p{Script=Han}/u.test(element.querySelector(".ks-lobby-quick")!.text()));
        assert.ok(!/\p{Script=Han}/u.test(element.querySelector(".ks-lobby-events")!.text()));
        for (const entry of QUICK_ENTRIES) assert.notEqual(tr(entry.title), entry.title, entry.title);
      }
      view.dispose();
    } finally { dom.restore(); }
  });
});

test("promo images remain complete images in every locale without text overlays or changed links", () => {
  for (const [locale, group] of [
    ["zh-CN", "加入QQ 群"],
    ["en", "Join our QQ group"],
    ["ko", "QQ 그룹 참여"],
  ] as const) withLocale(locale, () => {
    const dom = installFakeDom();
    const opened: string[] = [];
    const fakeWindow = window as unknown as Record<string, unknown>;
    fakeWindow.location = { origin: "https://kart.example" };
    fakeWindow.open = (url: string) => opened.push(url);
    try {
      const picture = { image: {} as CanvasImageSource, width: 400, height: 200 };
      const view = new LobbyHomeView(dom.document.body as unknown as HTMLElement, {
        riderName: "Racer", banners: [], onEntry() {},
      });
      view.setPromos({ intervalMs: 5000, banners: [{ ...picture, link: "https://ccraft.app/play" }],
        boards: [{ image: picture, link: "https://qm.qq.com/q/community", title: "加入QQ 群" },
          { image: picture, link: "https://custom.example", title: "玩家自制宣传" }] });
      const element = view.element as unknown as FakeElement;
      const boards = element.querySelectorAll(".ks-lobby-board");
      assert.equal(boards[0]!.querySelector("span")!.text(), group);
      assert.equal(boards[0]!.classList.contains("ks-picture"), true);
      assert.equal(boards[0]!.querySelector("canvas")!.hidden, false);
      assert.equal(boards[1]!.classList.contains("ks-picture"), true);
      assert.equal(boards[1]!.getAttribute("aria-label"), "玩家自制宣传");
      assert.equal(element.querySelector(".ks-lobby-promo-copy"), null);
      element.querySelector(".ks-lobby-carousel")!.children[0]!.click();
      boards[0]!.click();
      assert.deepEqual(opened, ["https://ccraft.app/play", "https://qm.qq.com/q/community"]);
      assert.equal(localizedLobbyPromoPath({ link: "https://ccraft.app.evil.example" }), undefined);
      view.dispose();
    } finally { dom.restore(); }
  });
});

test("multiplayer status and combined mode names have complete English and Korean grammar", () => {
  for (const [locale, waiting, racing, mode] of [
    ["zh-CN", "准备中", "游戏中", "组队幽灵无限"],
    ["en", "Waiting", "Racing", "Infinite Team Ghost"],
    ["ko", "대기 중", "경기 중", "무한 고스트 팀"],
  ] as const) withLocale(locale, () => {
    assert.equal(lobbyRoomStatus({ count: 1, capacity: 8 }).text, waiting);
    assert.equal(lobbyRoomStatus({ gaming: true, count: 1, capacity: 8 }).text, racing);
    assert.equal(lobbyRoomModeLabel({ mode: "team", speed: 4, gameplay: "shadow", count: 1, capacity: 8 }), mode);
  });
});
