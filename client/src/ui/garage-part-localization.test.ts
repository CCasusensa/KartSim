import assert from "node:assert/strict";
import test from "node:test";
import { tr, type GameLocale } from "../i18n/locale";
import { garagePartDisplayName, type GaragePartListing,
  type GaragePartLabelDependencies } from "./garage-part-presentation";

function withLocale(locale: GameLocale, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const dependencies: GaragePartLabelDependencies = {
  slotKey: { engine: "engine", wheels: "wheels" },
  slotLabel: slot => slot === "engine" ? tr("引擎") : tr("车轮"),
  localize: (_strings, _key, fallback) => fallback,
  engineName: (_strings, grade) => tr(grade === 13 ? "迅引擎" : grade === 12 ? "V1引擎" : "X引擎"),
  gradeName: () => tr("稀有"),
  defaultParts: () => [],
};

test("translated garage part names name the engine generation and component once", () => {
  const part: GaragePartListing = { family: "xun", slot: "engine", grade: 2, value: 10, itemId: 8001 };
  for (const [locale, expected] of [["zh-CN", "迅引擎 稀有 引擎 1"],
    ["en", "XUN Rare Engine 1"], ["ko", "XUN 레어 엔진 1"]] as const) withLocale(locale, () => {
    assert.equal(garagePartDisplayName(part, new Map(), [part], dependencies), expected);
  });
  assert.deepEqual(part, { family: "xun", slot: "engine", grade: 2, value: 10, itemId: 8001 });
});

test("built-in and V1 labels retain quality, slot and ordinal without duplicate engine wording", () => {
  const part: GaragePartListing = { family: "v1", slot: "engine", grade: 2, value: 600, itemId: 9001 };
  withLocale("en", () => {
    assert.equal(garagePartDisplayName(part, new Map(), [part], dependencies), "V1 Rare Engine 1");
    assert.equal(garagePartDisplayName({ ...part, builtIn: true, engineGrade: 8 },
      new Map(), [part], dependencies), "V1 Rare Basic Engine");
    assert.equal(garagePartDisplayName({ ...part, family: "legacy", legacyTitle: "Custom Engine" },
      new Map(), [], dependencies), "Custom Engine");
  });
});
