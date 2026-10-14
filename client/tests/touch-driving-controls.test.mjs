import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "@babel/parser";
import {
  TouchDrivingControls, savedAutoForward, savedNitroSeamlessMode, simMenuDefinition, menuEntryNode,
  registerTouchMenuSection, SIM_MENU,
} from "../src/input/touch-driving-controls.ts";
import { actionBindings, DEFAULT_KEY_MAP, keyboardActionsForCode } from "../src/input/action-bindings.ts";
import { DrivingAction } from "../src/input/driving-input.ts";

const release = readFileSync(new URL("../../recovered/formatted/index.js", import.meta.url), "utf8");
const declarations = parse(release, { sourceType: "module" }).program.body;
function sourceOf(name) {
  const node = declarations.find(item => item.id?.name === name ||
    item.declarations?.some(part => part.id.name === name));
  assert.ok(node, name);
  return release.slice(node.start, node.end);
}
const keyLabel = code => code === undefined ? "" : `K${code}`;
// The release controls with the release layout editor (it lived in the release <dialog>).
const OriginalLayout = new Function(`${["zT", "r60", "$T", "WT", "HT", "s60", "Ay", "o60", "a60", "_c"]
  .map(sourceOf).join("\n")}; return r60;`)();
const OriginalTouch = new Function("l2", "ut", "Br", "SP", "xl", "r60",
  `${["i60", "Mi", "BF", "l60", "u60", "h60"]
    .map(sourceOf).join("\n")}; return l60;`)(
  DrivingAction, actionBindings, DEFAULT_KEY_MAP, keyLabel,
  keyboardActionsForCode, OriginalLayout);
const originalSettings = new Function(`${["Mi", "BF", "u60", "h60"]
  .map(sourceOf).join("\n")}; return { auto: u60, nitro: h60 };`)();

test("stored touch driving preferences match release", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const [auto, nitro] of [["true", "auto"], ["false", "manual"],
      [null, "off"], ["TRUE", "unknown"]]) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true, value: { getItem: key =>
          key === "kartsim.auto-forward" ? auto : nitro },
      });
      assert.equal(savedAutoForward(), originalSettings.auto());
      assert.equal(savedNitroSeamlessMode(), originalSettings.nitro());
    }
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true, value: { getItem() { throw new Error("disabled"); } },
    });
    assert.equal(savedAutoForward(), originalSettings.auto());
    assert.equal(savedNitroSeamlessMode(), originalSettings.nitro());
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});

function runTouch(Controls, readable) {
  const events = [];
  const storage = new Map([
    ["kartsim.auto-forward", "false"],
    ["kartsim.nitro-seamless", "off"],
  ]);
  class Element {
    classNames = new Set();
    classList = {
      add: name => this.classNames.add(name),
      remove: name => this.classNames.delete(name),
      contains: name => this.classNames.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classNames.has(name) : force;
        if (enabled) this.classNames.add(name);
        else this.classNames.delete(name);
      },
    };
    style = {
      values: {},
      setProperty: (key, value) => { this.style.values[key] = value; },
      removeProperty: key => { delete this.style.values[key]; },
    };
    dataset = {};
    attributes = {};
    children = [];
    captured = new Set();
    hidden = false;
    open = false;
    constructor(name) { this.name = name; }
    querySelector(selector) {
      if (!this.queries) this.queries = new Map();
      if (!this.queries.has(selector)) {
        const child = new Element(selector);
        child.parentElement = this;
        this.queries.set(selector, child);
      }
      return this.queries.get(selector);
    }
    querySelectorAll(selector) {
      if (selector !== "[data-drive]") return [];
      const pad = this.querySelector(".touch-pad");
      const specs = [["pause", "暂停"], [11, "复位"], [4, "漂移"],
        [5, "氮气"], [8, "释放超负荷"], [2, "前进"],
        [0, "左转"], [3, "后退"], [1, "右转"]];
      return specs.map(([id, name]) => {
        const button = new Element(`button:${id}`);
        button.dataset.drive = String(id);
        button.dataset.actionName = name;
        pad.append(button);
        return button;
      });
    }
    addEventListener(name, listener) {
      if (!this.listeners) this.listeners = new Map();
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    fire(name, event) {
      for (const listener of this.listeners?.get(name) ?? []) listener(event);
    }
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }
    insertBefore(child) { this.append(child); }
    contains(child) { return this.children.includes(child); }
    getBoundingClientRect() {
      return { left: 100, top: 100, width: 80, height: 80,
        right: 180, bottom: 180 };
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    focus() {}
    remove() { this.removed = true; }
    close() { this.open = false; }
    showModal() { this.open = true; }
    closest() { return null; }
  }
  const document = {
    createElement: name => new Element(name),
    body: new Element("body"),
    hidden: false,
    fullscreenElement: null,
    fullscreenEnabled: false,
    activeElement: null,
    addEventListener() {},
  };
  const window = {
    matchMedia: query => ({ matches: query === "(pointer: coarse)",
      addEventListener() {} }),
    addEventListener() {},
  };
  const root = new Element("root");
  root.ownerDocument = document;
  const globals = ["document", "window", "navigator", "localStorage", "HTMLElement"];
  const previous = Object.fromEntries(globals.map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({
    document, window, navigator: { maxTouchPoints: 2, standalone: false },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) },
    HTMLElement: Element,
  })) Object.defineProperty(globalThis, name,
    { configurable: true, writable: true, value });
  try {
    const controls = readable
      ? new Controls(root, (action, down) => events.push(["action", action, down]),
        () => events.push("pause"), allowed => events.push(["forward", allowed]),
        mode => events.push(["nitro", mode]), { keyLabel })
      : new Controls(root, (action, down) => events.push(["action", action, down]),
        () => events.push("pause"), allowed => events.push(["forward", allowed]),
        mode => events.push(["nitro", mode]));
    controls.setRaceState(true, false);
    const forward = controls.buttons.get(DrivingAction.Forward);
    const pointerEvent = pointerId => ({ button: 0, pointerId,
      pointerType: "touch", preventDefault() {} });
    forward.fire("pointerdown", pointerEvent(1));
    forward.fire("pointerdown", pointerEvent(2));
    forward.fire("pointerup", pointerEvent(1));
    controls.onTouchEnd({ touches: [] });
    controls.setKeyMap(DEFAULT_KEY_MAP);
    controls.onAutoForwardToggle();
    controls.resumeAutoForwardForGamepad();
    controls.setAutoForwardActive(true);
    controls.onNitroSeamlessToggle();
    controls.dispatchAction(DrivingAction.SteerLeft, true);
    controls.setRaceState(true, false, true);
    controls.dispatchAction(DrivingAction.SteerLeft, true);
    controls.pointers.set(8, DrivingAction.Forward);
    controls.buttons.get(DrivingAction.Forward).setPointerCapture(8);
    controls.releasePointer(8);
    controls.setRaceState(true, false, false);
    controls.onToggle();
    controls.showScreenHelp("测试提示。");
    const text = html => html.replace(/<[^>]+>/g, "");
    const snapshot = {
      events,
      autoForward: controls.autoForward,
      nitroSeamless: controls.nitroSeamless,
      available: controls.available,
      paused: controls.paused,
      lteDodge: controls.lteDodge,
      usingTouch: controls.usingTouch,
      usingGamepad: controls.usingGamepad,
      manualVisible: controls.manualVisible,
      autoForwardAllowed: controls.autoForwardAllowed,
      autoForwardSuspended: controls.autoForwardSuspended,
      padHidden: controls.pad.hidden,
      menuExpanded: controls.menuButton.attributes["aria-expanded"],
      forwardClasses: [...controls.buttons.get(DrivingAction.Forward).classNames],
      forwardAttributes: { ...controls.buttons.get(DrivingAction.Forward).attributes },
      buttonLabels: [...controls.buttons].map(([action, button]) =>
        [action, button.title, button.attributes["aria-label"], button.dataset.actionName]),
      storage: [...storage],
      // The release dialog's DOM buttons are now the menu window's TextButtons: same texts, same order.
      menuTexts: readable
        ? controls.menuEntries().map(entry => entry.text)
        : [controls.toggle, controls.autoForwardToggle, controls.nitroSeamlessToggle,
          controls.pause, controls.screen].filter(button => !button.hidden)
          .map(button => text(button.innerHTML ?? "") || button.textContent)
          .concat("调整按键"),
      screenHelp: readable ? controls.screenHelpMessage : controls.screenMessage.textContent,
    };
    controls.dispose();
    return { ...snapshot, disposed: controls.element.removed };
  } finally {
    for (const name of globals) {
      const descriptor = previous[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test("touch driving menu, key labels, LTE dodge and auto forward match release", () => {
  assert.deepEqual(runTouch(TouchDrivingControls, true), runTouch(OriginalTouch, false));
});

const attr = (entry, name) => entry.attributes.find(item => item.name === name)?.value;
function walk(entry, visit) {
  visit(entry);
  entry.children.forEach(child => walk(child, visit));
}

test("SIM menu is a release CaptionDialog with touch-sized TextButtons", () => {
  const groups = [
    { title: "驾驶设置", entries: ["toggle", "auto-forward", "nitro-seamless", "pause", "screen", "layout"]
      .map(name => ({ name })) },
    { title: "影子记录", entries: ["a", "b", "c", "d", "e"].map(name => ({ name })), hint: "提示" },
  ];
  const definition = simMenuDefinition(groups);
  // The release race menu's dim Panel (stage_/speedIndiGame retryPopup_*btn).
  assert.equal(definition.name, "Panel");
  assert.equal(attr(definition, "color"), "100 0 0 0");
  const dialog = definition.children[0];
  assert.equal(attr(dialog, "frame"), "CaptionDialog");
  assert.equal(attr(dialog, "caption"), "模拟器菜单");
  const [width, height] = attr(dialog, "windowRect").split(" ").slice(2).map(Number);
  assert.ok(width <= 1600 - 40 && height <= 900 - 40, `${width}×${height} fits the stage`);
  const nodes = [];
  walk(definition, entry => nodes.push(entry));
  const buttons = nodes.filter(entry => entry.name === "TextButton");
  assert.deepEqual(buttons.map(entry => attr(entry, "name")),
    [...groups.flatMap(group => group.entries.map(entry => menuEntryNode(entry.name))), "menuClose"]);
  for (const button of buttons) {
    const [, , w, h] = attr(button, "leftTopWH").split(" ").map(Number);
    assert.ok(w >= 220 && h >= 64, `${attr(button, "name")} is touch-sized`);
  }
  assert.equal(attr(buttons.at(-1), "frame"), "DefaultFocusedButton");
  assert.equal(nodes.filter(entry => attr(entry, "frame") === "CaptionWindowGrey").length, 2);
  assert.ok(nodes.some(entry => attr(entry, "name") === "menuGroupHint1"));
  assert.ok(!nodes.some(entry => attr(entry, "name") === "menuGroupHint0"));
  // Three buttons a row: the fourth sits under the first.
  const cell = name => attr(buttons.find(entry => attr(entry, "name") === menuEntryNode(name)), "leftTopWH")
    .split(" ").map(Number);
  assert.equal(cell("pause")[0], cell("toggle")[0]);
  assert.equal(cell("layout")[0], cell("nitro-seamless")[0]);
  assert.equal(cell("pause")[1] - cell("toggle")[1], SIM_MENU.button.height + SIM_MENU.button.gap);
});

test("SIM menu buttons run the menu actions and show registered sections", () => {
  class Element {
    hidden = false;
    dataset = {};
    attributes = {};
    children = [];
    style = { setProperty() {}, removeProperty() {} };
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    querySelector(selector) {
      this.queries ??= new Map();
      if (!this.queries.has(selector)) {
        const child = new Element();
        child.parentElement = this;
        this.queries.set(selector, child);
      }
      return this.queries.get(selector);
    }
    querySelectorAll() { return []; }
    addEventListener() {}
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    insertBefore(child) { this.append(child); }
    contains(child) { return this.children.includes(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    focus() {}
    remove() {}
  }
  const document = { createElement: () => new Element(), body: new Element(), hidden: false,
    fullscreenElement: null, fullscreenEnabled: false, activeElement: null, addEventListener() {},
    removeEventListener() {} };
  const globals = { document, window: { matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {} }, navigator: { maxTouchPoints: 2 }, localStorage: { getItem: () => null,
    setItem() {} } };
  const previous = Object.fromEntries(Object.keys(globals).map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try {
    const root = new Element();
    root.ownerDocument = document;
    const events = [];
    const controls = new TouchDrivingControls(root, () => {}, () => events.push("pause"), () => {},
      mode => events.push(["nitro", mode]), { keyLabel: () => "", library: () => undefined });
    controls.setRaceState(true, false);
    const ghost = new Element();
    registerTouchMenuSection(ghost, { title: "影子记录", hint: "提示",
      menuEntries: () => [{ name: "ghost-export", text: "导出 KSV", action: () => events.push("export") }] });
    controls.ghostMenuSlot.append(ghost);
    controls.openMenu();
    assert.equal(controls.menuOpen, true);
    assert.equal(controls.menuButton.attributes["aria-expanded"], "true");
    assert.equal(controls.pad.hidden, true);
    assert.deepEqual(controls.menuGroups.map(group => group.title), ["驾驶设置", "影子记录"]);
    const state = name => controls.menuNodeState({ name: "TextButton", attributes: [{ name: "name", value: name }],
      children: [] });
    assert.equal(state("simMenu").text, "模拟器菜单");
    assert.equal(state(menuEntryNode("auto-forward")).text, "自动前进：关");
    state(menuEntryNode("auto-forward")).action();
    assert.equal(state(menuEntryNode("auto-forward")).text, "自动前进：开");
    state(menuEntryNode("nitro-seamless")).action();
    assert.deepEqual(events.pop(), ["nitro", "auto"]);
    assert.equal(state(menuEntryNode("nitro-seamless")).text, "氮气无缝：自动");
    state(menuEntryNode("ghost-export")).action();
    assert.equal(events.pop(), "export");
    assert.equal(typeof state("menuGroupHint1").paint, "function");
    // 暂停 closes the menu first, as the release dialog did.
    state(menuEntryNode("pause")).action();
    assert.deepEqual(events, ["pause"]);
    assert.equal(controls.menuOpen, false);
    controls.openMenu();
    state("menuClose").action();
    assert.equal(controls.menuOpen, false);
    // Leaving the slot takes the section out of the menu.
    ghost.parentElement.children.splice(0);
    controls.openMenu();
    assert.deepEqual(controls.menuGroups.map(group => group.title), ["驾驶设置"]);
    assert.equal(state(menuEntryNode("ghost-export")).visible, false);
    controls.dispose();
    assert.equal(controls.menuOpen, false);
  } finally {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
