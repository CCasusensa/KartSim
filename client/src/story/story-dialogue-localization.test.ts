import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { storySpeakers } from "../i18n/catalogs/story-speakers";
import { storyChineseCorrectionChapters, storyDialogueLoaders } from "../i18n/catalogs/story-dialogue";
import { loadStoryDialogueCatalog, localizeStoryScene, storyDialogueText, storySpeakerText, type StoryDialogueCatalog } from "./story-dialogue-text";
import { storyPrizeText } from "./story-prize-text";
import { StoryResources } from "./story-resources";
import { readStoryMission, readStoryScene, storyScenePages, type StoryNode } from "./story-data";
import { paintStoryLabel, storyDialogueSegments } from "../ui/story-windows";

const node = (name: string, attributes: Record<string, string> = {}, children: StoryNode[] = []): StoryNode => ({
  name, attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })), children,
});

function withLocale(locale: string, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("all 54 source chapter groups have complete dialogue translations", async () => {
  const entries = Object.entries(storyDialogueLoaders);
  assert.equal(entries.length, 54);
  const texts = new Map<string, readonly [string, string, string?]>();
  let chapterEntries = 0;
  let chineseRepairs = 0;
  for (const [chapter, load] of entries) {
    const catalog = await load();
    assert.ok(Object.keys(catalog).length > 0, chapter);
    for (const [source, translations] of Object.entries(catalog)) {
      chapterEntries++;
      const previous = texts.get(source);
      if (previous) assert.deepEqual(translations, previous, source);
      else {
        texts.set(source, translations);
        if (translations[2]) chineseRepairs++;
      }
      for (const locale of ["en", "ko"] as const) {
        const translated = storyDialogueText(source, catalog, locale);
        assert.ok(translated.trim(), `${chapter}: ${source}`);
        assert.doesNotMatch(translated, /\p{Script=Han}/u, `${chapter}: ${translated}`);
        if (/[\p{Script=Han}\p{Script=Hangul}]/u.test(source)) {
          assert.match(translated, /[\p{L}\p{N}]/u, `${chapter}: ${source}`);
        }
      }
      // Isolated Korean jamo such as ㅠ_ㅠ are source emoticons, not dialogue words.
      assert.doesNotMatch(storyDialogueText(source, catalog, "zh-CN"), /[가-힣]/u, source);
      if (translations[2]) assert.ok(storyChineseCorrectionChapters.has(chapter), chapter);
    }
  }
  assert.equal(chapterEntries, 12690);
  assert.equal(texts.size, 12131);
  assert.equal(chineseRepairs, 17);
  assert.deepEqual([...storyChineseCorrectionChapters].sort(), ["chapter1", "chapter_maple"]);
  assert.equal(createHash("sha256").update(JSON.stringify([...texts.keys()].sort())).digest("hex"),
    "1a0d5807a6252e4321ca090894c742bfb9aa155cadcf31de02a7bae9511d7bf5");
});

test("all 445 built-in speakers and rivals have names in three languages", () => {
  assert.equal(Object.keys(storySpeakers).length, 445);
  for (const source of Object.keys(storySpeakers)) {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      const translated = storySpeakerText(source, locale);
      assert.ok(translated.trim(), source);
      if (locale === "zh-CN") assert.doesNotMatch(translated, /\p{Script=Hangul}/u, source);
      else assert.doesNotMatch(translated, /\p{Script=Han}/u, source);
    }
  }
  assert.equal(storySpeakerText("Unknown player name", "en"), "Unknown player name");
  assert.equal(storySpeakerText("小强", "en"), "Mos");
  assert.equal(storySpeakerText("蓝蓝", "ko"), "마리드");
  assert.equal(storySpeakerText("吉米", "en"), "Mobi");
  assert.equal(storySpeakerText("다오", "zh-CN"), "皮蛋");
  assert.equal(storySpeakerText("투투", "zh-CN"), "嘟嘟");
});

test("dialogue translation preserves scene commands and supports Korean-origin Chinese repairs", () => {
  const raw = node("Scene", {}, [
    node("BackGround", { texture: "村庄_背景" }),
    node("Bgm", { theme: "village", file: "原声.ogg" }),
    node("Char", { id: "mos", emotion: "happy", pos: "11 0", flip: "true" }),
    node("Msg", { name: "小强", string: "你好！|出发吧。" }),
    node("Shake", { time: "700" }), node("fxSound", { file: "原声音效.wav" }),
    node("Enter"), node("Char", { id: "mos", remove: "true" }),
  ]);
  const before = JSON.stringify(raw);
  const commands = readStoryScene(raw);
  const catalog = { "你好！\n出发吧。": ["Hi!\nLet's go.", "안녕!\n출발하자."] as const,
    "안녕하세요!": ["Hello!", "안녕하세요!", "你好！"] as const };
  for (const [locale, speaker, text] of [["zh-CN", "小强", "你好！\n出发吧。"],
    ["en", "Mos", "Hi!\nLet's go."], ["ko", "모스", "안녕!\n출발하자."]] as const) {
    const translated = localizeStoryScene(commands, catalog, locale);
    assert.equal(translated.length, commands.length);
    for (let i = 0; i < commands.length; i++) {
      if (commands[i]!.type !== "message") assert.strictEqual(translated[i], commands[i]);
      else assert.deepEqual(translated[i], { type: "message", name: speaker, text });
    }
    const page = storyScenePages(translated)[0]!;
    assert.equal(page.speaker, speaker);
    assert.equal(page.text, text);
    assert.equal(page.background, "村庄_背景");
    assert.equal(page.shakeMs, 700);
    assert.equal(page.sound, "原声音效.wav");
    assert.deepEqual(page.characters, [{ id: "mos", x: 11, flip: true, emotion: "happy" }]);
  }
  assert.equal(storyDialogueText("안녕하세요!", catalog, "zh-CN"), "你好！");
  assert.equal(storyDialogueText("Unknown mod dialogue", catalog, "ko"), "Unknown mod dialogue");
  assert.equal(storyDialogueText("constructor", catalog, "en"), "constructor");
  assert.equal(JSON.stringify(raw), before);
});

test("race rival translation keeps kart/character IDs, race values and ghost paths intact", () => {
  const source = node("Root", {}, [node("BaseParam", { gameSpeed: "7" }), node("Shadow", {}, [
    node("LevelContent", { level: "0", ksv: "小强_ghost", track: "village_I03", laps: "2", timeLimit: "73000",
      kartId: "273", characterId: "4", characterName: "小强" }),
  ])]);
  for (const [locale, name] of [["zh-CN", "小强"], ["en", "Mos"], ["ko", "모스"]]) withLocale(locale!, () => {
    const mission = readStoryMission(source);
    assert.deepEqual(mission.rival, { ksv: "小强_ghost", kartId: 273, characterId: 4, name });
    assert.equal(mission.track, "village_I03");
    assert.equal(mission.laps, 2);
    assert.equal(mission.timeLimitMs, 73000);
    assert.equal(mission.speed, 7);
  });
});

test("translation download failure keeps valid scene dialogue and retries on the next open", async () => {
  const raw = node("Scene", {}, [node("Char", { id: "mos", pos: "7.5 0" }),
    node("Msg", { name: "小强", string: "你好！" }), node("Enter")]);
  const buffers: Buffer[] = [];
  const number = (value: number): void => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); buffers.push(bytes); };
  const string = (value: string): void => { number(value.length); buffers.push(Buffer.from(value, "utf16le")); };
  const encode = (value: StoryNode): void => {
    string(value.name); string(""); number(value.attributes.length);
    for (const attribute of value.attributes) { string(attribute.name); string(attribute.value); }
    number(value.children.length); value.children.forEach(encode);
  };
  encode(raw);
  const source = Buffer.concat(buffers);
  const resources = new StoryResources({ canonicalCandidates: () => [{ bytes: async () => source }] });
  const loaders = storyDialogueLoaders as Record<string, () => Promise<StoryDialogueCatalog>>;
  const chapter = "test-retry-dialogue";
  let requests = 0;
  loaders[chapter] = () => ++requests === 1 ? Promise.reject(new Error("Offline"))
    : Promise.resolve({ "你好！": ["Hello!", "안녕!"] });
  let locale = "en";
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try {
    assert.deepEqual(await loadStoryDialogueCatalog("constructor"), {});
    assert.deepEqual(await loadStoryDialogueCatalog("__proto__"), {});
    const offline = await resources.loadScene(chapter, "scene1");
    assert.equal(storyScenePages(offline)[0]?.text, "你好！");
    assert.equal(offline.length, 3);
    const retried = await resources.loadScene(chapter, "scene1");
    assert.equal(storyScenePages(retried)[0]?.text, "Hello!");
    assert.equal(requests, 2);
    locale = "zh-CN";
    loaders["test-chinese-no-download"] = () => { throw new Error("Chinese must not download this chapter"); };
    assert.equal(storyScenePages(await resources.loadScene("test-chinese-no-download", "scene1"))[0]?.text, "你好！");
  } finally {
    delete loaders[chapter]; delete loaders["test-chinese-no-download"];
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

function drawingContext(): { context: CanvasRenderingContext2D; drawn: string[] } {
  const drawn: string[] = [];
  let font = "16px sans-serif";
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
  return { context, drawn };
}

test("long dialogue paginates without dropping characters at the native font size", () => {
  const texts = ["这段很长的剧情需要完整阅读。\n请继续下一页。".repeat(7),
    "This long story must remain fully readable.\nContinue to the next page. ".repeat(7),
    "이 긴 이야기는 빠짐없이 읽을 수 있어야 합니다.\n다음 페이지로 계속하세요. ".repeat(7)];
  for (const render of ["normal16", "outline18"]) for (const text of texts) {
    const { context, drawn } = drawingContext();
    const label = node("Label", { textRender: render, lineGap: "3" });
    const rect = { x: 0, y: 0, width: 250, height: 78 };
    const parts = storyDialogueSegments(context, label, text, rect);
    assert.ok(parts.length > 1);
    assert.equal(parts.join("").replaceAll("\n", ""), text.replaceAll("\n", ""));
    for (const part of parts) paintStoryLabel(context, label, part, rect);
    assert.equal(drawn.join(""), text.replaceAll("\n", ""));
    assert.match(context.font, new RegExp(render.match(/\d+/)![0] + "px"));
  }
});

test("reward text keeps counts/durations and uses the item catalog for names", () => {
  const translate = (source: string): string => source === "皮蛋气球" ? "Catalog Dao Balloon" : source;
  assert.equal(storyPrizeText("皮蛋气球(30个)", translate, "en"), "Catalog Dao Balloon (30)");
  assert.equal(storyPrizeText("皮蛋气球(30个)", translate, "zh-CN"), "皮蛋气球(30个)");
  assert.equal(storyPrizeText("빌리지 테마 번호판 (30일)", source => source, "zh-CN"), "城镇主题车牌 (30天)");
  assert.equal(storyPrizeText("金币  1000", source => source, "ko"), "루찌 1000");
  assert.equal(storyPrizeText("经验 500", source => source, "en"), "500 XP");
});
