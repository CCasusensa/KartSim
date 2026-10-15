import assert from "node:assert/strict";
import test from "node:test";
import { storyMenuTitles } from "../i18n/catalogs/story-menu-titles";
import { storyMenuObjectives } from "../i18n/catalogs/story-menu-objectives";
import { storyMenuSummaries } from "../i18n/catalogs/story-menu-summaries";
import { storyMenuTranslations } from "../i18n/catalogs/story-menu";
import { storyMenuText } from "./story-menu-text";
import { readStoryChapters, readStorySteps, readStoryScene, type StoryNode } from "./story-data";
import { paintStoryLabel, storyMissionText } from "../ui/story-windows";

function withLocale(locale: string, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const node = (name: string, attributes: Record<string, string> = {}, children: StoryNode[] = []): StoryNode => ({
  name, attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })), children,
});
const numericTokens = (text: string): string[] => text.match(/%(?:\.\d+)?[df]|\d+/g) ?? [];

test("all 52 chapters and 831 steps have complete menu dictionaries in English and Korean", () => {
  assert.equal(Object.keys(storyMenuTitles).length, 832);
  assert.equal(Object.keys(storyMenuObjectives).length, 554);
  assert.equal(Object.keys(storyMenuSummaries).length, 801);
  assert.equal(Object.keys(storyMenuTranslations).length, 2187);
  for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
    for (const [source, translations] of Object.entries(storyMenuTranslations)) {
      assert.equal(translations.length, 2);
      const text = storyMenuText(source);
      assert.ok(text.trim(), source);
      if (locale === "zh-CN") assert.equal(text, source);
      else assert.doesNotMatch(text, /\p{Script=Han}/u, source);
    }
    assert.equal(storyMenuText("A future custom chapter"), "A future custom chapter");
  });
});

test("story clear conditions preserve distances, collision limits and counter placeholders", () => {
  for (const [source, pair] of Object.entries(storyMenuObjectives)) {
    for (const translated of pair) {
      // Chinese 第一 is written as 1위 in Korean; it is a rank, not a changed limit.
      assert.deepEqual(numericTokens(translated.replaceAll("1위", "first")), numericTokens(source), source);
      assert.deepEqual(translated.match(/%(?:\.\d+)?[df]/g), source.match(/%(?:\.\d+)?[df]/g), source);
    }
  }
  for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
    const mission = storyMenuText("赛道完成 %d回/%d回");
    assert.match(storyMissionText(mission, false), /0.*1/);
    assert.match(storyMissionText(mission, true), /1.*1/);
  });
});

test("story readers translate display fields while preserving progress keys, rewards and scene commands", () => {
  const synopsis = "为了出战繁荣山丘赛车大会，皮蛋今天开始了练习。\n在陌生的赛道上，皮蛋能够安然无事的完成吗？";
  const description = "菜鸟车手皮蛋的梦想是，\n成为繁荣山丘最强的车手。\n为了参加赛车大会二苦练的皮蛋，\n遇到了许多充满个性的车手，并产生了友谊。";
  const chapterSource = node("ScenarioList", {}, [node("Chapter", {
    id: "37", name: "chapter1", title: "车手的诞生", subTitle: "第一章", desc: description,
    regularChapter: "true", preClearChapterId: "36", showNewIcon: "true",
  })]);
  const stepSource = node("StepList", {}, [node("Step", {
    id: "1", readyStage: "1-1", title: "初来乍到", synopsis: synopsis.replaceAll("\n", "|"),
    howToClear: "请完成比赛。", missionText: "赛道完成 %d回/%d回", preConditionId: "9|10",
    otherWayLockId: "12", visualScene: "scene1", extraScene: "end1", stepTitleId: "03A",
    type: "30", mode: "single", isFinalStep: "true",
  }, [node("Level", { prize: "气球(30个)" })])]);
  const scene = node("Scene", {}, [node("Msg", { name: "车手的诞生", string: "初来乍到|玩家原文" }), node("Enter")]);
  const before = JSON.stringify([chapterSource, stepSource, scene]);
  for (const [locale, title, stepTitle] of [["zh-CN", "车手的诞生", "初来乍到"],
    ["en", "Birth of a Racer", "New Arrival"], ["ko", "라이더의 탄생", "첫 방문"]] as const) withLocale(locale, () => {
    const chapter = readStoryChapters(chapterSource)[0]!;
    const step = readStorySteps(stepSource)[0]!;
    assert.equal(chapter.title, title);
    assert.equal(step.title, stepTitle);
    assert.equal(chapter.name, "chapter1");
    assert.equal(chapter.id, 37);
    assert.equal(chapter.preClearChapterId, 36);
    assert.equal(step.readyStage, "1-1");
    assert.equal(step.id, 1);
    assert.equal(step.visualScene, "scene1");
    assert.equal(step.extraScene, "end1");
    assert.equal(step.stepTitleId, "03A");
    assert.equal(step.prize, "气球(30个)");
    assert.deepEqual(step.preConditionIds, [9, 10]);
    assert.deepEqual(step.otherWayLockIds, [12]);
    assert.equal(step.isFinalStep, true);
    assert.equal(step.mode, "single");
    assert.equal(step.type, 30);
    if (locale !== "zh-CN") for (const text of [chapter.subTitle!, chapter.desc,
      step.synopsis, step.howToClear, step.missionText]) assert.doesNotMatch(text, /\p{Script=Han}/u);
    assert.deepEqual(readStoryScene(scene), [{ type: "message", name: "车手的诞生", text: "初来乍到\n玩家原文" }, { type: "enter" }]);
  });
  assert.equal(JSON.stringify([chapterSource, stepSource, scene]), before);
});

function drawText(text: string, width: number, height: number, render: string): string {
  let font = "16px sans-serif";
  const drawn: string[] = [];
  const context = {
    get font() { return font; }, set font(value: string) { font = value; },
    save() {}, restore() {}, strokeText() {},
    measureText(value: string) {
      const size = Number(/\d+/.exec(font)?.[0] ?? 16);
      return { width: Array.from(value).reduce((sum, char) =>
        sum + size * (/[^\x00-\x7f]/.test(char) ? 1 : 0.65), 0) };
    },
    fillText(character: string) { drawn.push(character); },
  } as unknown as CanvasRenderingContext2D;
  paintStoryLabel(context, node("Label", { textRender: render }), text,
    { x: 0, y: 0, width, height }, true);
  return drawn.join("");
}

test("translated story menu copy fits the native title, objective and summary rectangles", () => {
  for (const locale of ["en", "ko"]) withLocale(locale, () => {
    for (const [catalog, width, height, render] of [
      [storyMenuTitles, 300, 28, "bold20"],
      [storyMenuObjectives, 348, 44, "bold16"],
      [storyMenuSummaries, 338, 240, "outline14"],
    ] as const) {
      for (const source of Object.keys(catalog)) {
        const text = storyMenuText(source);
        assert.equal(drawText(text, width, height, render), text.replaceAll("\n", ""), `${locale}: ${source}`);
      }
    }
  });
});
