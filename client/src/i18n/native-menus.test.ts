import assert from "node:assert/strict";
import test from "node:test";
import { nativeMenusTranslations, nativeKoreanOverrides } from "./catalogs/native-menus";
import { resourceText, type GameLocale } from "./locale";

function withLocale(locale: GameLocale, run: () => void): void {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const tokens = (text: string) => text.match(/%\d+![sd]!|%[sd]|\[:[^\]]+\]/g) ?? [];

test("native menu fallbacks preserve all positional and item formatting tokens", () => {
  for (const [source, translations] of Object.entries(nativeMenusTranslations)) {
    for (const translation of translations) {
      assert.ok(translation.trim(), source);
      assert.doesNotMatch(translation, /\p{Script=Han}/u, source);
      assert.deepEqual(tokens(translation), tokens(source), source);
      assert.equal((translation.match(/\[color:/g) ?? []).length,
        (translation.match(/\[\/color\]/g) ?? []).length, source);
    }
  }
});

test("native garage, shop and draw rows fall back to the selected language", () => {
  const examples = [
    ["车辆改装", "Vehicle Tuning", "팩토리"],
    ["赛季通行证", "Season Pass", "시즌 패스"],
    ["选择改装部件", "Select Tuning Part", "파츠 선택"],
    ["保底奖励", "Guaranteed Rewards", "확정획득 아이템"],
    ["道具不存在或不足", "Item missing or insufficient", "아이템이 없거나 부족합니다."],
  ] as const;
  (["zh-CN", "en", "ko"] as const).forEach((locale, index) => withLocale(locale, () => {
    for (const [cn, en, ko] of examples) {
      const entries = [{ c: "cn", v: cn }];
      const actual = resourceText(entries, (row, key) => row[key as keyof typeof row]);
      assert.equal(actual, [cn, en, ko][index]);
      if (index > 0) assert.doesNotMatch(actual!, /\p{Script=Han}/u);
    }
  }));
});


test("Korean corrections retain the CN release costs and exact formatting placeholders", () => {
  for (const [source, translated] of Object.entries(nativeKoreanOverrides)) {
    assert.deepEqual(tokens(translated), tokens(source), source);
    assert.equal(translated, nativeMenusTranslations[source]?.[1]);
  }
  assert.equal(nativeKoreanOverrides["继续挑战将消耗1个[color:red][:main][/color]。"],
    "재도전 시 [color:red][:main][/color] 1개가 소모됩니다.");
  assert.equal(nativeKoreanOverrides["获得%1!d!幸运币，幸运币数量由%2!d!变为%3!d!"],
    "행운 코인 %1!d!개를 획득했습니다.|보유량이 %2!d!개에서 %3!d!개로 증가했습니다.");
});


test("Korean regional mechanics overrides take precedence over incompatible native copy", () => {
  withLocale("ko", () => {
    const source = "继续挑战将消耗1个[color:red][:main][/color]。";
    const rows = [{ c: "cn", v: source }, { c: "kr", v: "다른 비용을 설명하는 지역별 문구" }];
    assert.equal(resourceText(rows, (row, key) => row[key as keyof typeof row]), nativeKoreanOverrides[source]);
  });
});
