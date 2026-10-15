import assert from "node:assert/strict";
import test from "node:test";
import { TouchDrivingControls, simMenuDefinition, savedAutoForward, savedNitroSeamlessMode } from "./touch-driving-controls";
import { TouchLayoutEditor, layoutPanelDefinition, parseTouchLayout } from "./touch-layout-editor";
import { DEFAULT_KEY_MAP } from "./action-bindings";
import { DrivingAction } from "./driving-input";
import { attribute, node, type Node } from "../ui/bml-kit";
import type { GameLocale } from "../i18n/locale";

function withLocale(locale: GameLocale, run: () => void): void {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values: Record<string, string> = { "kartsim.language": locale, "kartsim.auto-forward": "true", "kartsim.nitro-seamless": "manual" };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values[key] ?? null } });
  try { run(); } finally {
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
const locales = ["zh-CN", "en", "ko"] as const;
const captions = (entry: Node): string[] => [...entry.attributes.filter(row => row.name === "caption")
  .map(row => row.value), ...entry.children.flatMap(captions)];

test("touch SIM menus translate all three languages without changing action IDs or saved modes", () => {
  for (const locale of locales) withLocale(locale, () => {
    const called: string[] = [];
    const controls = Object.assign(Object.create(TouchDrivingControls.prototype) as TouchDrivingControls, {
      available: true, manualVisible: true, usingTouch: true, autoForward: true, nitroSeamless: "manual", paused: false,
      onToggle: () => called.push("toggle"), onAutoForwardToggle: () => called.push("auto-forward"),
      onNitroSeamlessToggle: () => called.push("nitro-seamless"), onPauseClick: () => called.push("pause"),
      screenEntryVisible: () => false, layout: { start: () => called.push("layout") },
    });
    const entries = controls.menuEntries();
    assert.deepEqual(entries.map(entry => entry.name), ["toggle", "auto-forward", "nitro-seamless", "pause", "layout"]);
    entries.forEach(entry => entry.action());
    assert.deepEqual(called, entries.map(entry => entry.name));
    const definition = simMenuDefinition([{ title: "SIM", entries }]);
    assert.equal(captions(definition)[0], locale === "zh-CN" ? "模拟器菜单" : locale === "en" ? "Simulator Menu" : "시뮬레이터 메뉴");
    if (locale !== "zh-CN") assert.ok(entries.every(entry => !/\p{Script=Han}/u.test(entry.text)));
    assert.equal(savedAutoForward(), true);
    assert.equal(savedNitroSeamlessMode(), "manual");
  });
});

test("touch steering labels switch language while key bindings and dodge actions stay intact", () => {
  for (const locale of locales) withLocale(locale, () => {
    const buttons = new Map([DrivingAction.SteerLeft, DrivingAction.SteerRight].map(action => [action, {
      dataset: {}, title: "", setAttribute() {}, querySelector: () => ({ hidden: true }),
    } as unknown as HTMLButtonElement]));
    const controls = Object.assign(Object.create(TouchDrivingControls.prototype) as TouchDrivingControls, {
      buttons, lteDodge: true, options: { keyLabel: () => "A" },
    });
    controls.setKeyMap(DEFAULT_KEY_MAP);
    assert.equal(controls.keyMap, DEFAULT_KEY_MAP);
    assert.ok(buttons.get(DrivingAction.SteerLeft)!.title.includes("Z"));
    assert.ok(buttons.get(DrivingAction.SteerRight)!.title.includes("X"));
    if (locale !== "zh-CN") for (const button of buttons.values()) assert.doesNotMatch(button.title, /\p{Script=Han}/u);
  });
});

test("touch layout editor translates controls and preserves stored button placement keys", () => {
  for (const locale of locales) withLocale(locale, () => {
    const editor = Object.create(TouchLayoutEditor.prototype) as TouchLayoutEditor;
    const buttons = ["layoutSave", "layoutCancel", "layoutReset"].map(name => editor.panelState(node("TextButton", { name })));
    if (locale !== "zh-CN") for (const button of buttons) assert.doesNotMatch(String(button.text), /\p{Script=Han}/u);
    const panel = layoutPanelDefinition().children[0]!;
    assert.equal(attribute(panel, "caption"), locale === "zh-CN" ? "调整按键" : locale === "en" ? "Edit Controls" : "버튼 배치");
    const placement = { x: .2, y: .8, width: 60, height: 70 };
    assert.deepEqual(parseTouchLayout(JSON.stringify({ menu: placement, 2: placement }), ["menu", 2]),
      { menu: placement, 2: placement });
  });
});
