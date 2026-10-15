import assert from "node:assert/strict";
import test from "node:test";
import { cityHelpPages, cityHelpDefinition, paintHelpPage } from "./city-help-window";
import { cityMapWindowDefinition } from "./city-map-window";
import { radioWindowDefinition, paintNowPlaying } from "./city-radio-window";
import { fuelErrorText, fuelPrompt, tankClassName } from "./city-fuel";
import { paintRefuelGauge } from "./city-fuel-window";
import { compass, formatDuration, questLabel, QUESTS } from "./city-quest-data";
import type { CityFuel } from "./city-protocol";
import type { GameLocale } from "../i18n/locale";
import type { Node } from "../ui/bml-kit";

function withLocale(locale: GameLocale, run: () => void): void {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function texts(node: Node): string[] {
  return [...node.attributes.filter(attribute => ["caption", "text"].includes(attribute.name))
    .map(attribute => attribute.value), ...node.children.flatMap(texts)];
}
const locales = ["zh-CN", "en", "ko"] as const;

test("all city help tabs and map/radio menu labels follow the selected language", () => {
  locales.forEach((locale, index) => withLocale(locale, () => {
    const pages = cityHelpPages();
    assert.deepEqual(pages.map(page => page.title), [["驾驶", "城市", "任务"],
      ["Driving", "City", "Quests"], ["주행", "도시", "퀘스트"]][index]);
    const content = [...texts(cityHelpDefinition(pages)), ...texts(cityMapWindowDefinition()),
      ...texts(radioWindowDefinition(22)), ...pages.flatMap(page => [page.note!, ...page.rows.map(row => row.text)])];
    if (locale !== "zh-CN") assert.ok(content.every(text => !/\p{Script=Han}/u.test(text)), content.join("\n"));
  }));
});

test("city fuel warnings and quest counters translate without changing calculation results", () => {
  const fuel: CityFuel = { kartName: "测试车", sizeClass: "medium", capacityMl: 40000, fuelMl: 0,
    useMlPerKm: 2800, pricePerLiter: 5, rescueFee: 300, lucci: 1000, empty: true };
  const quest = QUESTS.find(entry => entry.type === "delivery" && entry.kind === "speed")!;
  locales.forEach((locale, index) => withLocale(locale, () => {
    assert.equal(tankClassName("medium"), ["中型", "Medium", "중형"][index]);
    assert.equal(fuelErrorText(new Error("TANK_FULL")),
      ["油箱已经加满了。", "The tank is already full.", "이미 연료가 가득 찼습니다."][index]);
    const prompt = fuelPrompt(fuel, 0, 0, 0, []);
    assert.equal(prompt.kind, "rescue");
    assert.ok("text" in prompt && prompt.text.includes("300"));
    if ("text" in prompt && locale !== "zh-CN") assert.doesNotMatch(prompt.text, /\p{Script=Han}/u);
    assert.equal(formatDuration(65000), ["1 分 05 秒", "1 min 05 sec", "1분 05초"][index]);
    assert.equal(compass(0, 0, 0, -1), ["北", "N", "북"][index]);
    if (locale !== "zh-CN") assert.doesNotMatch(questLabel(quest), /\p{Script=Han}/u);
  }));
});

test("city refueling translates vehicle labels while preserving server fuel state and custom names", () => {
  const fuel: CityFuel = { kartName: "爆烈 C1", sizeClass: "medium", capacityMl: 40000, fuelMl: 10000,
    useMlPerKm: 2800, pricePerLiter: 5, rescueFee: 300, lucci: 1000, empty: false };
  const source = JSON.stringify(fuel);
  locales.forEach((locale, index) => withLocale(locale, () => {
    const painted: string[] = [];
    const context = new Proxy({ fillText: (text: string) => painted.push(text),
      createLinearGradient: () => ({ addColorStop() {} }) }, {
      get: (target, key) => key in target ? Reflect.get(target, key) : () => {},
      set: (target, key, value) => Reflect.set(target, key, value),
    }) as unknown as CanvasRenderingContext2D;
    const rect = { x: 0, y: 0, width: 470, height: 110 };
    paintRefuelGauge(context, rect, fuel, 5000);
    assert.ok(painted.includes(["爆烈 C1", "Burst C1", "버스트 C1"][index]!));
    assert.equal(JSON.stringify(fuel), source);
    paintRefuelGauge(context, rect, { ...fuel, kartName: "我的自定义赛车" }, 5000);
    assert.ok(painted.includes("我的自定义赛车"));
  }));
});

test("translated city help content fits the existing panel height", () => {
  for (const locale of locales) withLocale(locale, () => {
    for (const page of cityHelpPages()) {
      const positions: number[] = [];
      const context = new Proxy({ font: "15px sans-serif", createLinearGradient: () => ({ addColorStop() {} }), measureText(text: string) {
        const size = Number.parseFloat(this.font.replace(/^bold /, ""));
        return { width: [...text].reduce((sum, char) => sum + (/\p{Script=Han}|\p{Script=Hangul}/u.test(char) ? size : size * .55), 0) };
      }, fillText(_text: string, _x: number, y: number) { positions.push(y); } }, {
        get: (target, key) => key in target ? Reflect.get(target, key) : () => {},
        set: (target, key, value) => Reflect.set(target, key, value),
      }) as unknown as CanvasRenderingContext2D;
      paintHelpPage(context, { x: 0, y: 0, width: 736, height: 480 }, page);
      assert.ok(Math.max(...positions) <= 480, `${locale} ${page.title}: ${Math.max(...positions)}`);
    }
  });
});

test("radio translates playback state and preserves original song titles and singers", () => {
  for (const locale of locales) withLocale(locale, () => {
    const painted: string[] = [];
    const context = new Proxy({ measureText: (text: string) => ({ width: text.length * 4 }),
      fillText: (text: string) => painted.push(text), createLinearGradient: () => ({ addColorStop() {} }) }, {
      get: (target, key) => key in target ? Reflect.get(target, key) : () => {},
      set: (target, key, value) => Reflect.set(target, key, value),
    }) as unknown as CanvasRenderingContext2D;
    paintNowPlaying(context, { x: 0, y: 0, width: 720, height: 100 }, {
      on: true, loading: false, shuffle: true, index: 0, songs: [{ file: "song", title: "原曲名", singer: "原歌手" }],
    });
    assert.ok(painted.includes("原曲名"));
    assert.ok(painted.includes("原歌手"));
    if (locale !== "zh-CN") assert.ok(painted.filter(text => !["原曲名", "原歌手"].includes(text))
      .every(text => !/\p{Script=Han}/u.test(text)), painted.join("\n"));
  });
});
