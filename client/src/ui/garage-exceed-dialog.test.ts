import assert from "node:assert/strict";
import test from "node:test";

import { attribute, node, nodeName, type Node } from "./bml-kit";
import { GarageExceedTypeDialog, type GarageExceedChoice,
  type GarageExceedDialogDependencies } from "./garage-exceed-dialog";
import type { GarageReleaseWindowOptions } from "./garage-release-window";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function find(definition: Node, name: string): Node {
  // The release close button is added by the window loader (setCloseButton).
  if (name === "closeButton") return node("ImageButton", { name });
  const walk = (entry: Node): Node | undefined => nodeName(entry) === name ? entry
    : entry.children.map(walk).find(Boolean);
  const found = walk(definition);
  assert.ok(found, name);
  return found;
}

function fixture(options: { failOpen?: boolean; current?: number } = {}) {
  const events: unknown[] = [];
  let opened: GarageReleaseWindowOptions | undefined;
  let deliver: (() => void) | undefined;
  let answer: ((value: boolean) => void) | undefined;
  let signal: AbortSignal | undefined;
  const window = {
    element: {} as HTMLElement,
    hovered: undefined as unknown,
    disposed: false,
    render() { events.push("render"); },
    focus(name?: string) { events.push(["focus", name]); },
    dispose() { this.disposed = true; events.push("window-dispose"); },
  };
  const dependencies: GarageExceedDialogDependencies = {
    styleAction() { events.push("styled"); },
    loadStyles: async () => { events.push("styles"); },
    resolveChoice: (choice: GarageExceedChoice) => {
      events.push(["resolve", choice]);
      return choice === "random" ? 3 : choice;
    },
    openWindow: async windowOptions => {
      opened = windowOptions;
      if (options.failOpen) throw new Error("missing texture");
      await new Promise<void>(resolve => { deliver = resolve; });
      return window;
    },
    confirm: (title, message, confirmOptions) => {
      events.push(["confirm", title, message]);
      signal = confirmOptions.signal;
      return new Promise(resolve => { answer = resolve; });
    },
  };
  const assets = {
    exceedTypes: new Map([
      [2, { textureType: 2, accelLevel: 3, timeLevel: 1 }],
      [3, { textureType: 3, accelLevel: 2, timeLevel: 2 }],
      [4, { textureType: 4, accelLevel: 1, timeLevel: 3 }],
      [8, { textureType: 8, accelLevel: 3, timeLevel: 2 }],
    ]),
    urls: new Map<string, string>(),
  };
  const dialog = new GarageExceedTypeDialog({} as HTMLElement, assets, "library",
    { title: "棉花糖 迅", type: options.current ?? 4 }, choice => events.push(["close", choice]), dependencies);
  const state = (name: string) => opened!.state(find(opened!.definition, name));
  const ready = async () => {
    await flush();
    deliver?.();
    await flush();
  };
  return { dialog, events, window, state, ready, opened: () => opened!,
    answer: (value: boolean) => answer!(value), signal: () => signal };
}

test("the chooser is the release exceedTypeChange board with the four type cards", async () => {
  const f = fixture({ current: 8 });
  await f.ready();
  const options = f.opened();
  assert.deepEqual(options.roots, ["dialog2_/exceedTypeChange", "dialog2_/kart12SkillTuning", "stage_/common"]);
  assert.equal(options.closeButtonFolder, "dialog2_/exceedTypeChange");
  const caption = find(options.definition, "exceedTypeChoice");
  assert.equal(attribute(caption, "frame"), "CaptionDialog");
  assert.equal(attribute(caption, "windowRect"), "0 0 564 535");
  assert.equal(attribute(caption, "setCloseButton"), "closeButton");
  assert.equal(attribute(caption.children[0]!, "image"), "tuning_changeExceedPopupBg2");
  assert.deepEqual([0, 1, 2, 3].map(index => attribute(find(options.definition, `choiceIcon${index}`), "texture")),
    ["icon_exceedB_2", "icon_exceedB_3", "icon_exceedB_4", "icon_exceedB_5"]);
  assert.equal(attribute(find(options.definition, "choice0"), "texture"), "tuning_selectperform_slotBg_s");
  assert.equal(attribute(find(options.definition, "okButton"), "name"), "okButton");
  // The current type's icon (a special type) is in the layout too.
  assert.equal(attribute(find(options.definition, "currentType8"), "texture"), "icon_exceedB_8");
  assert.deepEqual(f.state("kartName"), { text: "棉花糖 迅" });
  assert.deepEqual(f.state("choiceName3"), { text: "随机" });
  assert.deepEqual(f.state("currentType8"), { visible: true });
  assert.deepEqual(f.state("accelCurrent3"), { visible: true });
  assert.deepEqual(f.state("timeCurrent2"), { visible: true });
  assert.deepEqual(f.state("accelNew0"), { visible: true });
  assert.equal(f.state("okButton").disabled, true);
  assert.deepEqual(f.state("choosePrompt"), { visible: true });
  assert.deepEqual(f.state("compare"), { visible: false });
  assert.deepEqual(f.events.slice(-2), ["render", ["focus", "cancelButton"]]);
  assert.equal(f.events.includes("styles"), false);
});

test("a chosen type shows its icon, gauges and the hover / selected card looks", async () => {
  const f = fixture();
  await f.ready();
  const card = find(f.opened().definition, "choice0");
  (f.opened().state(card).action as () => void)();
  assert.equal(f.dialog.selected, 2);
  assert.equal(f.opened().state(card).checked, true);
  assert.deepEqual(f.state("choiceEffect0"), { visible: true });
  assert.deepEqual(f.state("choiceHover0"), { visible: true });
  assert.deepEqual(f.state("choiceHover1"), { visible: false });
  f.opened().state(find(f.opened().definition, "choice1"));
  f.window.hovered = find(f.opened().definition, "choice1");
  assert.deepEqual(f.state("choiceHover1"), { visible: true });
  assert.deepEqual(f.state("newType2"), { visible: true });
  assert.deepEqual(f.state("newType4"), { visible: false });
  assert.deepEqual(f.state("currentType4"), { visible: true });
  assert.deepEqual(f.state("accelNew3"), { visible: true });
  assert.deepEqual(f.state("timeNew1"), { visible: true });
  assert.deepEqual(f.state("accelRandom"), { visible: false });
  assert.equal(f.state("okButton").disabled, false);
  assert.deepEqual(f.state("compare"), { visible: true });
});

test("确定 asks in the message box; 取消 returns to the choices, 确定 changes the type", async () => {
  const f = fixture();
  await f.ready();
  (f.state("choice1").action as () => void)();
  (f.state("okButton").action as () => void)();
  assert.deepEqual(f.events.at(-1), ["confirm", "变更超负荷类型", "确定将当前车辆的超负荷类型变更为 B 吗？"]);
  assert.equal(f.dialog.confirming, true);
  assert.equal(f.state("okButton").disabled, true);
  assert.equal(f.state("cancelButton").disabled, true);
  // Escape belongs to the question while it is up.
  f.opened().onCancel();
  assert.equal(f.dialog.disposed, false);
  f.answer(false);
  await flush();
  assert.equal(f.dialog.confirming, false);
  assert.deepEqual(f.events.at(-1), ["focus", "cancelButton"]);
  (f.state("okButton").action as () => void)();
  f.answer(true);
  await flush();
  assert.deepEqual(f.events.slice(-3), [["resolve", 3], "window-dispose", ["close", 3]]);
  assert.equal(f.dialog.disposed, true);
});

test("随机 asks with its own text and resolves the choice only when confirmed", async () => {
  const f = fixture();
  await f.ready();
  (f.state("choice3").action as () => void)();
  assert.deepEqual(f.state("accelRandom"), { visible: true });
  assert.deepEqual(f.state("timeNew0"), { visible: true });
  assert.deepEqual(f.state("newType5"), { visible: true });
  (f.state("okButton").action as () => void)();
  assert.deepEqual(f.events.at(-1), ["confirm", "变更超负荷类型", "将随机变更超负荷类型。|确定继续吗？"]);
  f.answer(true);
  await flush();
  assert.deepEqual(f.events.slice(-3), [["resolve", "random"], "window-dispose", ["close", 3]]);
});

test("取消, the close button and Escape close without a type; disposal is idempotent", async () => {
  for (const close of ["cancelButton", "closeButton", "escape"]) {
    const f = fixture();
    await f.ready();
    if (close === "escape") f.opened().onCancel();
    else (f.state(close).action as () => void)();
    f.dialog.dispose();
    assert.deepEqual(f.events.filter(event => Array.isArray(event) && event[0] === "close"), [["close", undefined]]);
    assert.equal(f.window.disposed, true, close);
  }
});

test("closing during the question aborts it; closing before the window loads disposes it", async () => {
  const asking = fixture();
  await asking.ready();
  (asking.state("choice0").action as () => void)();
  (asking.state("okButton").action as () => void)();
  asking.dialog.dispose();
  assert.equal(asking.signal()?.aborted, true);
  asking.answer(true);
  await flush();
  assert.equal(asking.events.some(event => Array.isArray(event) && event[0] === "resolve"), false);

  const early = fixture();
  early.dialog.dispose();
  await early.ready();
  assert.equal(early.window.disposed, true);
  assert.equal(early.dialog.window, undefined);
  assert.deepEqual(early.events.filter(event => Array.isArray(event) && event[0] === "close"),
    [["close", undefined]]);
});

test("a window that cannot open closes the dialog so the garage is usable again", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const f = fixture({ failOpen: true });
    await flush();
    await flush();
    assert.equal(f.dialog.disposed, true);
    assert.deepEqual(f.events, [["close", undefined]]);
  } finally { console.error = error; }
});
