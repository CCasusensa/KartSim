import assert from "node:assert/strict";
import test from "node:test";

import { attribute, node, nodeName, type Node } from "./bml-kit";
import { GarageSkillSelectionDialog, skillSelectionDefinition, type GarageSkillDialogDependencies,
  type GarageSkillLayout } from "./garage-skill-dialog";
import { GarageSkillSelectionState } from "./garage-progression-session";
import type { XunGarageProgression } from "./garage-progression-panel";
import type { GarageReleaseWindowOptions } from "./garage-release-window";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** The shape of dialog2_kart12SkillTuning kart12SkillTuning@zz / speedSkillTuningCard. */
function layout(): GarageSkillLayout {
  const line = (index: number, ids: number[]) => node("Container", { name: `skillLine${index}` }, [
    node("Panel", { windowSize: "76 76", adjust: "100 53", texture: `tuning_selectperform_mark${index}` }),
    ...ids.map(id => node("Container", { name: String(id), leftTopWH: "290 20 0 0" })),
    ...index > 1 ? [node("ImageBoard", { name: "skillLineLock", image: "tuning_selectperformPopup_lock1" }),
      node("ImageButton", { name: "unlockBtn", autoLoadImage: "tuning_selectperformLock_" }),
      node("Play1SPanel", { name: "unlockTuning", scene: "튜닝해금" })] : [],
  ]);
  const window = node("Panel", { name: "parent", leftTopWH: "0 0 746 708", align: "right;top", adjust: "630 0" }, [
    node("Container", { name: "container", leftTopWH: "0 0 746 708", align: "center", adjust: "0 0" }, [
      node("ImageBoard", { name: "skillTuning_bg", leftTopWH: "0 0 746 708", image: "tuning_selectperformPopupBg_i" }),
      node("ImageButton", { name: "closeButton", autoLoadImage: "tuningPopup_x_" }),
      node("ColorLabel", { name: "skillTuningCaption", text: "#sb(skillTuningCaption)" }),
      node("Panel", { windowSize: "34 34", adjust: "14 90", texture: "icon_ethisTuning_1" }),
      node("ImageButton", { name: "buyStudyDataBtn", autoLoadImage: "btn_plus_0" }),
      node("Label", { name: "haveStudyData", text: "100000" }),
      node("Panel", { windowSize: "34 34", adjust: "497 90", texture: "icon_ethisSpanner" }),
      node("Label", { name: "haveEthisSpannerData", text: "100000" }),
      node("Tab", { name: "skillTuning" }, [
        node("TabMenu", { name: "gameType" }, [
          node("ImageButton", { name: "speedPage", autoLoadNoDisable: "tuning_selectperformPopup_tab_",
            text: "#sb(speed)" }),
          node("ImageButton", { name: "itemPage", autoLoadNoDisable: "tuning_selectperformPopup_tab_",
            text: "#sb(item)" }),
        ]),
        node("TabPage", { name: "speedPage" }, [line(1, [1, 2, 3]), line(2, [4, 5, 6]), line(3, [7, 8, 9])]),
        node("TabPage", { name: "itemPage" }, [line(1, [10, 11, 12, 13])]),
      ]),
      node("Panel", { leftTopWH: "226 597 4 4", texture: "tuning_dot1" }),
      node("ColorLabel", { windowSize: "250 50", adjust: "-35 587", align: "hcenter", text: "#sb(helpDesc)" }),
      node("ImageButton", { name: "tuningChangeBtn", autoLoadImage: "tuningpopupBtn_spanner_" }),
      node("TextButton", { name: "okButton", leftTopWH: "225 655 146 42", text: "#sb(ok)" }),
      node("TextButton", { name: "cancelButton", windowSize: "146 42", adjust: "380 655", text: "#sb(cancel)" }),
    ]),
  ]);
  const card = node("Panel", { windowRect: "0 0 0 0" }, [
    node("Panel", { name: "noneSkill_1", texture: "tuning_selectperform_slotBg2_s", visible: "false" }),
    node("Panel", { windowSize: "116 116", texture: "tuning_selectperform_slotBg_s" }),
    node("Panel", { name: "selectPerform_1", texture: "tuning_selectperform_slotBg_c", visible: "false" }),
    node("Panel", { name: "skillIcon", windowSize: "70 70", adjust: "23 13", texture: "" }),
    node("Panel", { name: "noneSkill_2", texture: "tuning_selectperform_slotBg_dim", visible: "false" }),
    node("Panel", { name: "curSkillSlotTag", texture: "tuning_slotNum1_s", visible: "false" }),
    node("Panel", { name: "selectPerform_2", texture: "tuning_selectperform_slotBg_c_effect", visible: "false" }),
    node("Label", { name: "skillName", textRender: "outline14" }),
    node("Label", { name: "alreadyUse", text: "#sb(alreadyUse)", textRender: "outline14", visible: "false" }),
  ]);
  return { window, card };
}

function find(definition: Node, name: string): Node {
  const walk = (entry: Node): Node | undefined => nodeName(entry) === name ? entry
    : entry.children.map(walk).find(Boolean);
  const found = walk(definition);
  assert.ok(found, name);
  return found;
}

const names = (definition: Node): string[] =>
  [nodeName(definition), ...definition.children.flatMap(names)].filter(Boolean);

const skills = Array.from({ length: 9 }, (_, index) => ({ id: index + 1, label: `技能${index + 1}` }));

function progression(): XunGarageProgression {
  return { kind: "xun", level: 5, skills: [
    { id: 1, points: 2 }, { id: 4, points: 3 }, { id: 7, points: 1 },
  ] };
}

function fixture(options: { failLoad?: boolean; row?: number } = {}) {
  const events: unknown[] = [];
  let opened: GarageReleaseWindowOptions | undefined;
  let deliver: (() => void) | undefined;
  const window = {
    element: {} as HTMLElement,
    hovered: undefined as unknown,
    disposed: false,
    render() { events.push("render"); },
    focus(name?: string) { events.push(["focus", name]); },
    dispose() { this.disposed = true; events.push("window-dispose"); },
  };
  const select = (value: XunGarageProgression, row: number, id: number) => {
    const next = { ...value, skills: value.skills.map(skill => ({ ...skill })) };
    if (next.skills[row]!.id !== id) next.skills[row] = { id, points: 0 };
    return next;
  };
  const availablePoints = (value: XunGarageProgression) =>
    20 - value.skills.reduce((total, skill) => total + skill.points, 0);
  const dependencies: GarageSkillDialogDependencies = {
    createState: (value, row) => new GarageSkillSelectionState(value, row,
      { validate: () => {}, select, availablePoints }),
    availablePoints, skills,
    loadAssets: async () => { events.push("assets"); },
    styleAction: () => { events.push("styled"); },
    loadLayout: async () => {
      if (options.failLoad) throw new Error("missing bml");
      return layout();
    },
    openWindow: async windowOptions => {
      opened = windowOptions;
      await new Promise<void>(resolve => { deliver = resolve; });
      return window;
    },
  };
  const dialog = new GarageSkillSelectionDialog({} as HTMLElement, "library", progression(), options.row ?? 0,
    value => events.push(["close", value]), dependencies);
  const state = (name: string) => opened!.state(find(opened!.definition, name));
  const ready = async () => {
    await flush();
    deliver?.();
    await flush();
  };
  return { dialog, events, window, state, ready, opened: () => opened! };
}

test("the release layout loses the material parts and gains the nine cards and the rules", () => {
  const definition = skillSelectionDefinition(layout(), id => [1, 4, 7].indexOf(id) + 1 || undefined);
  assert.equal(attribute(definition, "windowRect"), "fullscreen");
  const container = definition.children[0]!;
  assert.equal(nodeName(container), "container");
  assert.equal(attribute(container, "adjust"), "0 -33");
  assert.equal(attribute(find(definition, "skillTuning_bg"), "image"), "tuning_selectperformPopupBg_s");
  const all = names(definition);
  for (const gone of ["buyStudyDataBtn", "haveStudyData", "haveEthisSpannerData", "tuningChangeBtn",
    "skillLineLock", "unlockBtn", "unlockTuning", "itemPage", "10"])
    assert.equal(all.includes(gone), false, gone);
  assert.equal(JSON.stringify(definition).includes("icon_ethisTuning_1"), false);
  assert.equal(attribute(find(definition, "speedTab"), "texture"), "tuning_selectperformPopup_tab_3");
  assert.equal(attribute(find(definition, "itemTab"), "texture"), "tuning_selectperformPopup_tab_1");
  assert.equal(attribute(find(definition, "speedTab"), "autoLoadNoDisable"), undefined);
  assert.equal(attribute(find(definition, "speedPage"), "name"), "speedPage");
  for (let id = 1; id <= 9; id++) {
    assert.equal(attribute(find(definition, `card${id}`), "texture"), "tuning_selectperform_slotBg_s");
    assert.equal(attribute(find(definition, `card${id}:skillIcon`), "texture"), `tuning_icon_${id}`);
  }
  assert.equal(attribute(find(definition, "card4:curSkillSlotTag"), "texture"), "tuning_slotNum_02");
  assert.equal(attribute(find(definition, "card7:alreadyUse"), "textRender"), "outline12");
  assert.equal(attribute(find(definition, "helpDesc"), "leftTopWH"), "236 589 490 44");
  assert.deepEqual(["guide1", "guide2", "guide3"].map(name => attribute(find(definition, name), "leftTopWH")),
    ["16 93 233 28", "257 93 232 28", "497 93 233 28"]);
  assert.equal(attribute(find(definition, "okButton"), "name"), "okButton");
});

test("cards show the slot's skill, the other slots' skills and the change", async () => {
  const f = fixture({ row: 1 });
  await f.ready();
  assert.deepEqual(f.opened().roots, ["dialog2_/kart12SkillTuning", "stage_/common"]);
  assert.deepEqual(f.events.slice(-2), ["render", ["focus", "card4"]]);
  const current = f.state("card4");
  assert.equal(current.checked, true);
  assert.equal(current.disabled, false);
  assert.deepEqual(f.state("card4:selectPerform_2"), { visible: true });
  assert.deepEqual(f.state("card4:selectPerform_1"), { visible: true });
  assert.deepEqual(f.state("card4:skillName"), { visible: true, text: "技能4" });
  const taken = f.state("card1");
  assert.equal(taken.disabled, true);
  assert.equal(taken.label, "技能1（已装至其他性能槽中）");
  assert.deepEqual(f.state("card1:noneSkill_2"), { visible: true });
  assert.deepEqual(f.state("card1:alreadyUse"), { visible: true, text: "已装至其他性能槽中" });
  assert.deepEqual(f.state("card1:skillName"), { visible: false, text: "技能1" });
  assert.deepEqual(f.state("card1:curSkillSlotTag"), { visible: true });
  assert.deepEqual(f.state("card5:curSkillSlotTag"), { visible: false });
  assert.deepEqual(f.state("card5:selectPerform_1"), { visible: false });
  f.window.hovered = find(f.opened().definition, "card5");
  f.state("card5");
  assert.deepEqual(f.state("card5:selectPerform_1"), { visible: true });
  assert.deepEqual(f.state("guide1"), { text: "竞速：九选三，不可重复" });
  assert.equal(f.state("speedTab").text, "竞速");
  assert.equal(f.state("itemTab").action, undefined);
  assert.equal(f.state("okButton").disabled, true);
  assert.equal(f.dialog.statusText(), "本次返还 [color:255 62 255 14]0[/color] 点强化点数，确认后可用 " +
    "[color:255 62 255 14]14[/color] 点强化点数。|关闭或取消不修改。");
  (f.state("card1").action as () => void)();
  assert.equal(f.dialog.state.id, 4);
  (f.state("card5").action as () => void)();
  assert.equal(f.dialog.state.id, 5);
  assert.equal(f.state("okButton").disabled, false);
  assert.equal(f.dialog.statusText(), "本次返还 [color:255 62 255 14]3[/color] 点强化点数，确认后可用 " +
    "[color:255 62 255 14]17[/color] 点强化点数。|关闭或取消不修改。");
  (f.state("okButton").action as () => void)();
  assert.deepEqual(f.events.slice(-2), ["window-dispose", ["close", { kind: "xun", level: 5, skills: [
    { id: 1, points: 2 }, { id: 5, points: 0 }, { id: 7, points: 1 }] }]]);
  assert.equal(f.dialog.disposed, true);
  assert.equal(f.events.includes("assets") || f.events.includes("styled"), false);
});

test("取消, the close button and Escape keep the slot", async () => {
  for (const close of ["cancelButton", "closeButton", "escape"]) {
    const f = fixture();
    await f.ready();
    (f.state("card2").action as () => void)();
    if (close === "escape") f.opened().onCancel();
    else (f.state(close).action as () => void)();
    f.dialog.dispose();
    assert.deepEqual(f.events.filter(event => Array.isArray(event) && event[0] === "close"),
      [["close", undefined]], close);
    assert.equal(f.window.disposed, true);
    assert.equal(f.dialog.state.settled, true);
  }
});

test("disposal before the window loads, a missing layout and a bad slot", async () => {
  const loading = fixture();
  loading.dialog.dispose();
  await flush();
  assert.throws(() => loading.opened().label);
  const early = fixture();
  await flush();
  early.dialog.dispose();
  await early.ready();
  assert.equal(early.window.disposed, true);
  assert.equal(early.dialog.window, undefined);
  assert.deepEqual(early.events.filter(event => Array.isArray(event)), []);

  const error = console.error;
  console.error = () => {};
  try {
    const failed = fixture({ failLoad: true });
    await flush();
    assert.equal(failed.dialog.disposed, true);
    assert.deepEqual(failed.events, [["close", undefined]]);
  } finally { console.error = error; }

  assert.throws(() => fixture({ row: 3 }), /无效的技能栏/);
});
