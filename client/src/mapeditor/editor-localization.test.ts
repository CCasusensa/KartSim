import assert from "node:assert/strict";
import test from "node:test";
import { EditorApp } from "./editor/app";
import { friendlyIssues, openMapSettings } from "./editor/hud";
import { installFakeDom, FakeElement } from "../ui/fake-dom";
import { tr, type GameLocale } from "../i18n/locale";
import { editorTranslations } from "../i18n/catalogs/editor";
import { newDesign, validateDesign, type RoadDesign } from "./design";
import { TRACK_TEMPLATES } from "./templates";

function withEditorDom(locale: GameLocale, run: (document: ReturnType<typeof installFakeDom>["document"]) => void): void {
  const dom = installFakeDom();
  const saved = ["Node", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "Node", { configurable: true, value: FakeElement });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(dom.document); } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.restore();
  }
}

test("editor toolbar and more menu switch language without changing a user's map name or actions", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withEditorDom(locale, document => {
    const calls: string[] = [];
    const app = Object.assign(Object.create(EditorApp.prototype) as EditorApp, {
      bar: document.createElement("div"), advanced: false,
      state: { design: { name: "我的中文地图", roads: [{}], pieces: [] }, dirty: false,
        canUndo: true, canRedo: false, undo() {}, redo() {} },
      actions: { newMap() { calls.push("new"); }, openDialog() {}, testDrive() {}, publish() {},
        help() {}, saveAs() {}, importFile() {}, exportDialog() {}, check() {} },
    });
    const render = app as unknown as { renderBar(): void; bar: FakeElement };
    render.renderBar();
    const buttons = render.bar.querySelectorAll("button");
    assert.ok(buttons.some(button => button.text() === tr("新地图")));
    assert.ok(buttons.some(button => button.text() === tr("▶ 开车试玩")));
    assert.equal(render.bar.querySelector(".ed-mapname")!.text(), "「我的中文地图」 ✎");
    buttons.find(button => button.text() === tr("新地图"))!.click();
    assert.deepEqual(calls, ["new"]);
    buttons.find(button => button.text() === tr("更多 ▾"))!.click();
    const menu = document.body.querySelector(".ed-menu")!;
    assert.ok(menu.text().includes(tr("高级模式（专业编辑）")));
    if (locale !== "zh-CN") {
      assert.ok(!/\p{Script=Han}/u.test(menu.text()));
      assert.ok(!/\p{Script=Han}/u.test(buttons.filter(button => !button.classList.contains("ed-mapname")).map(button => button.text()).join("")));
    }
  });
});

test("localized map settings keep user text editable and commit only the entered values", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withEditorDom(locale, document => {
    const design = { name: "用户起的名字", laps: 3, difficulty: 2 };
    const app = { state: { design, commit: (change: (value: typeof design) => void) => change(design) } } as unknown as EditorApp;
    openMapSettings(app);
    const dialog = document.body.querySelector(".ed-modal")!;
    assert.equal(dialog.querySelector(".k-caption")!.text(), tr("地图设置"));
    const name = dialog.querySelector("input")!;
    assert.equal(name.value, "用户起的名字");
    name.value = "新的中文名称";
    const buttons = dialog.querySelectorAll("button");
    buttons.find(button => button.text() === "＋")!.click();
    buttons.find(button => button.text() === tr("好了"))!.click();
    assert.deepEqual(design, { name: "新的中文名称", laps: 4, difficulty: 2 });
    assert.equal(document.body.querySelector(".ed-modal"), null);
  });
});

test("changing track shape translates the built-in template title while preserving the user route name", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withEditorDom(locale, document => {
    const template = TRACK_TEMPLATES[0]!;
    const app = Object.assign(Object.create(EditorApp.prototype) as EditorApp, {
      state: { design: { roads: [{ name: "用户路线", route: true, points: [{}, {}, {}] }] } },
    });
    app.applyTemplate(template);
    const dialog = document.body.querySelector(".ed-modal")!;
    assert.ok(dialog.text().includes("用户路线"));
    assert.ok(dialog.text().includes(tr(template.title)));
    if (locale !== "zh-CN") assert.ok(!dialog.text().includes(template.title));
  });
});

test("editor translations retain every numbered interpolation and contain no untranslated Chinese", () => {
  const placeholders = (value: string) => [...value.matchAll(/\{value\d*\}/g)].map(match => match[0]).sort();
  for (const [source, translations] of Object.entries(editorTranslations)) {
    for (const value of translations) {
      assert.deepEqual(placeholders(value), placeholders(source), source);
      assert.ok(!/\p{Script=Han}/u.test(value), source);
    }
  }
});


test("map validation localizes diagnostics while retaining user road names", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withEditorDom(locale, () => {
    const design = newDesign("自定义地图");
    design.difficulty = 7;
    design.roads = [{ id: "road", name: "用户道路", points: [], route: true,
      closed: false, width: 0, surface: {}, walls: {} } as unknown as RoadDesign];
    const problems = validateDesign(design);
    assert.ok(problems.includes(tr("难度需要 1–5。")));
    assert.ok(problems.some(problem => problem.includes("用户道路")));
    if (locale !== "zh-CN") assert.ok(!/\p{Script=Han}/u.test(problems.join(" ").replaceAll("用户道路", "")));
    assert.equal(design.name, "自定义地图");
    assert.equal(design.roads[0]!.name, "用户道路");
  });
});

test("friendly editor validation replaces technical messages in every language without duplicates", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withEditorDom(locale, () => {
    const design = newDesign("temporary");
    design.name = "";
    assert.deepEqual(friendlyIssues(design), [
      tr("还没有赛道：点下面素材栏的“赛道”，选一种形状；或者用左边的“画赛道”自己画。"),
      tr("给地图起个名字：点左上角任务卡里的地图名。"),
    ]);
  });
});
