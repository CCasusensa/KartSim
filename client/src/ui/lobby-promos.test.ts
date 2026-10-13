import assert from "node:assert/strict";
import test from "node:test";

import { LobbyHomeView } from "./lobby-home-view";
import { fetchLobbyPromos, parseLobbyPromos, safeLobbyLink } from "./lobby-promos";

const picture = (id: string) => `/api/lobby/promo-images/${id.repeat(32)}`;

test("大厅宣传链接只接受 http(s) 网址和本站路径", () => {
  const origin = "https://kart.example.com";
  assert.equal(safeLobbyLink("https://example.com/活动", origin), "https://example.com/%E6%B4%BB%E5%8A%A8");
  assert.equal(safeLobbyLink(" http://a.example ", origin), "http://a.example/");
  assert.equal(safeLobbyLink("/editor.html?x=1", origin), "https://kart.example.com/editor.html?x=1");
  for (const link of [undefined, "", "javascript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example",
    "ftp://example.com", "example.com", "https://u:p@example.com", "https://a b.example", "https://e.com/\"x"])
    assert.equal(safeLobbyLink(link, origin), undefined, String(link));
  assert.equal(safeLobbyLink("/editor.html"), undefined, "a path needs the page's origin");
});

test("大厅宣传设置：无效项去掉，间隔限制在 2–60 秒", () => {
  const parsed = parseLobbyPromos({
    interval: 600,
    carousel: [
      { url: picture("a"), width: 1040, height: 600, link: "https://example.com", title: " 新车 " },
      { url: "https://evil.example/x.png", width: 1, height: 1 },
      { url: "", link: "https://example.com" },
      "junk",
    ],
    boards: [{ url: picture("b"), width: 1050, height: 234, link: "/editor.html", title: "" }, { title: "敬请期待" }],
  });
  assert.equal(parsed.interval, 60);
  assert.deepEqual(parsed.carousel, [{ url: picture("a"), width: 1040, height: 600, link: "https://example.com",
    title: "新车" }]);
  assert.deepEqual(parsed.boards, [{ url: picture("b"), width: 1050, height: 234, link: "/editor.html" },
    { url: "", width: 0, height: 0, title: "敬请期待" }]);
  assert.deepEqual(parseLobbyPromos(null), { interval: 5, carousel: [], boards: [undefined, undefined] });
  assert.equal(parseLobbyPromos({ interval: 0 }).interval, 2);
});

test("大厅宣传读取：图片载入失败的轮播项去掉，宣传板保留链接和文字", async () => {
  const requested: string[] = [];
  const session = {
    backendOrigin: "https://data.example",
    requestJson: async (path: string) => {
      requested.push(path);
      return {
        interval: 8,
        carousel: [{ url: picture("a"), link: "https://example.com", title: "一" }, { url: picture("c") }],
        boards: [{ url: picture("c"), link: "/editor.html", title: "板" }, { title: "敬请期待" }],
      };
    },
  };
  const loaded: string[] = [];
  const promos = await fetchLobbyPromos(session, async url => {
    loaded.push(url);
    return url.endsWith("c".repeat(32)) ? undefined : { image: {} as CanvasImageSource, width: 10, height: 5 };
  });
  assert.deepEqual(requested, ["/api/lobby/promos"]);
  assert.deepEqual(loaded.sort(), [`https://data.example${picture("a")}`, `https://data.example${picture("c")}`,
    `https://data.example${picture("c")}`]);
  assert.equal(promos?.intervalMs, 8000);
  assert.equal(promos?.banners.length, 1);
  assert.equal(promos?.banners[0]?.link, "https://example.com");
  assert.equal(promos?.banners[0]?.title, "一");
  assert.deepEqual(promos?.boards, [{ link: "/editor.html", title: "板" }, { title: "敬请期待" }]);

  const failing = { backendOrigin: "", requestJson: async () => { throw new Error("NOT_FOUND"); } };
  assert.equal(await fetchLobbyPromos(failing), undefined);
});

test("大厅首页：后台配置的轮播图和宣传板可点击跳转，没有链接时提示敬请期待", async () => {
  const { installFakeDom } = await import("./fake-dom");
  const dom = installFakeDom();
  const opened: string[] = [];
  const fakeWindow = globalThis.window as unknown as Record<string, unknown>;
  fakeWindow.location = { origin: "https://kart.example.com" };
  fakeWindow.open = (url: string) => { opened.push(url); return null; };
  try {
    type FakeElement = import("./fake-dom").FakeElement;
    const root = dom.document.createElement("div");
    const image = (width: number) => ({ image: {} as CanvasImageSource, width, height: 100 });
    const view = new LobbyHomeView(root as unknown as HTMLElement,
      { riderName: "车手", banners: [image(1), image(2), image(3), image(4)], onEntry: () => {} });
    const element = view.element as unknown as FakeElement;
    const carousel = element.querySelector(".ks-lobby-carousel")!.children[0]!;
    const boards = element.querySelectorAll(".ks-lobby-board");
    assert.equal(element.querySelectorAll(".ks-lobby-dot").length, 4);
    assert.equal(carousel.getAttribute("role"), "img");
    carousel.click();
    boards[0]!.click();
    assert.deepEqual(opened, []);
    assert.equal(element.querySelector(".ks-lobby-notice")!.text(), "敬请期待");
    assert.deepEqual(boards.map(board => board.querySelector("span")!.text()), ["COMING SOON", "COMING SOON"]);

    view.setPromos({
      intervalMs: 8000,
      banners: [{ ...image(5), link: "https://example.com/a", title: "新车" }, image(6)],
      boards: [{ image: image(7), link: "/editor.html" }, { title: "敬请期待" }],
    });
    assert.equal(element.querySelectorAll(".ks-lobby-dot").length, 2);
    assert.equal(carousel.getAttribute("role"), "link");
    assert.equal(carousel.title, "新车");
    carousel.click();
    assert.deepEqual(opened, ["https://example.com/a"]);
    element.querySelectorAll(".ks-lobby-dot")[1]!.click();
    assert.equal(carousel.getAttribute("role"), "img");
    carousel.click();
    assert.equal(opened.length, 1, "a picture without a link opens nothing");

    assert.equal(boards[0]!.classList.contains("ks-picture"), true);
    boards[0]!.click();
    assert.deepEqual(opened, ["https://example.com/a", "https://kart.example.com/editor.html"]);
    assert.equal(boards[1]!.classList.contains("ks-picture"), false);
    assert.equal(boards[1]!.querySelector("span")!.text(), "敬请期待");

    // No carousel set: the built-in pictures stay.
    view.setPromos({ intervalMs: 5000, banners: [], boards: [{}, {}] });
    assert.equal(element.querySelectorAll(".ks-lobby-dot").length, 2);
    assert.equal(boards[0]!.classList.contains("ks-picture"), false);
    assert.equal(boards[0]!.querySelector("span")!.text(), "COMING SOON");
    view.dispose();
  } finally {
    dom.restore();
  }
});
