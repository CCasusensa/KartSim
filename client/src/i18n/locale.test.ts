import assert from "node:assert/strict";
import test from "node:test";
import { gameLocale, resourceLocale, tr } from "./locale";
import { readMainMenuStrings, type MainMenuNode } from "../ui/main-menu-view";
import { readStringBag } from "../ui/item-hud-assets";
import { formatDownloadTitle } from "../ui/startup-loading-skin";

function withSavedLocale(value: string | null, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true, value: { getItem: () => value },
  });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const node = (name: string, attributes: Record<string, string> = {},
  children: MainMenuNode[] = []): MainMenuNode => ({ name, children,
  attributes: Object.entries(attributes).map(([key, value]) => ({ name: key, value })) });

test("saved language selects the matching resource string and falls back to Chinese", () => {
  const bag = node("StringBag", {}, [
    node("k", { n: "greeting" }, [node("m", { c: "cn", v: "你好" }),
      node("m", { c: "en", v: "Hello" }), node("m", { c: "kr", v: "안녕하세요" })]),
    node("k", { n: "onlyChinese" }, [node("m", { c: "cn", v: "仅中文" })]),
  ]);
  for (const [locale, expected] of [["zh-CN", "你好"], ["en", "Hello"], ["ko", "안녕하세요"]] as const) {
    withSavedLocale(locale, () => {
      assert.equal(gameLocale(), locale);
      assert.equal(readMainMenuStrings(bag).get("greeting"), expected);
      assert.equal(readMainMenuStrings(bag).get("onlyChinese"), "仅中文");
    });
  }
  withSavedLocale("invalid", () => assert.equal(resourceLocale(), "cn"));
});

test("interface translations preserve unknown text", () => {
  withSavedLocale("en", () => {
    assert.equal(tr("登录"), "Sign in");
    assert.equal(tr("玩家昵称"), "玩家昵称");
  });
  withSavedLocale("ko", () => assert.equal(tr("登录"), "로그인"));
});

test("XML bags fall back to Chinese and download labels follow the language", () => {
  const xml = `<StringBag><k n="all"><m c="cn" v="中文"/><m c="en" v="English"/><m c="kr" v="한국어"/></k><k n="fallback"><m c="cn" v="仅中文"/></k></StringBag>`;
  for (const [locale, expected, prefix] of [
    ["en", "English", "Current download: "],
    ["ko", "한국어", "현재 다운로드: "],
  ] as const) withSavedLocale(locale, () => {
    assert.equal(readStringBag(xml).get("all"), expected);
    assert.equal(readStringBag(xml).get("fallback"), "仅中文");
    assert.equal(formatDownloadTitle("asset.rho"), `${prefix}asset.rho`);
  });
});
