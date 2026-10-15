import assert from "node:assert/strict";
import test from "node:test";
import { cityDialogueTranslations } from "../i18n/catalogs/city-dialogue";
import type { GameLocale } from "../i18n/locale";
import { cityDialogueText } from "./city-dialogue";
import { QUESTS, QUEST_NPCS, offerPages, thanksPages } from "./city-quest-data";
import { CityQuests } from "./city-quests";

const sources = [...new Set([...Object.values(QUEST_NPCS).map(npc => npc.story),
  ...QUESTS.flatMap(quest => [...quest.offer.map(line => line.text), quest.thanks])])];
const numericTokens = (value: string): string[] => value.match(/\d+(?:\.\d+)?/g)?.sort() ?? [];

async function eachLocale(run: (locale: GameLocale, stored: Map<string, string>) => void | Promise<void>): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      const stored = new Map([["kartsim.language", locale as string]]);
      Object.defineProperty(globalThis, "localStorage", { configurable: true,
        value: { getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value) } });
      await run(locale, stored);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("every city NPC story, offer line and completion reply has complete English and Korean", () => {
  assert.equal(Object.keys(QUEST_NPCS).length, 65);
  assert.equal(QUESTS.length, 425);
  assert.equal(sources.length, 834);
  for (const source of sources) {
    const pair = cityDialogueTranslations[source];
    assert.ok(pair, source);
    assert.equal(cityDialogueText(source, "zh-CN"), source);
    for (const [index, locale] of (["en", "ko"] as const).entries()) {
      const text = cityDialogueText(source, locale);
      assert.equal(text, pair[index]);
      assert.ok(text.trim(), source);
      assert.doesNotMatch(text, /\p{Script=Han}/u, source);
      assert.doesNotMatch(text, /\{(?:from|to|toRole|where|area|\d+)\}/u, source);
      // Authored numeric speed limits remain exact. Spelled-out Chinese counts
      // may naturally use digits in English/Korean (e.g. 十斤 becomes 5 kg).
      if (numericTokens(source).length) assert.deepEqual(numericTokens(text), numericTokens(source), source);
      assert.equal(text.split("\n").length, source.split("\n").length, source);
    }
  }
});

test("reviewed task dialogue preserves timing, destinations, named recipients and collision limits", () => {
  const inTime = "来得及！彩带准备好了，嘘——甜甜快回来了！";
  assert.match(cityDialogueText(inTime, "en"), /made it in time/i);
  assert.match(cityDialogueText(inTime, "ko"), /시간에 맞췄/);
  const north = "我的订婚戒指掉在华盛顿海滩北部了，今晚就要求婚！";
  assert.match(cityDialogueText(north, "en"), /northern Washington Beach/);
  assert.match(cityDialogueText(north, "ko"), /워싱턴 비치 북부/);
  assert.match(cityDialogueText("有人捡到一个钱包，里面的证件是皮蛋的。", "en"), /Dao/);
  assert.match(cityDialogueText("零件很精密，捡回来的路上碰撞别超过三次。", "ko"), /충돌 횟수가 세 번을 넘으면 안/);
  const transmitter = "戒指盒里有个小信号器，规定时间内帮我找回来！";
  assert.match(cityDialogueText(transmitter, "en"), /signal transmitter/);
  assert.doesNotMatch(cityDialogueText(transmitter, "en"), /Xiaoxin/);
  assert.doesNotMatch(cityDialogueText(transmitter, "ko"), /샤오신/);
});

test("offer and thanks pages localize authored dialogue while retaining NPC identity, player names and canonical quests", async () => {
  const before = JSON.stringify([QUESTS, QUEST_NPCS]);
  const playerName = QUEST_NPCS["guide-beach"]!.story;
  await eachLocale(locale => {
    for (const quest of QUESTS) {
      const npc = QUEST_NPCS[quest.giver]!;
      const pages = offerPages(quest, { withStory: true, playerName, playerSprite: "dao" });
      assert.equal(pages.length, quest.offer.length + 1);
      assert.equal(pages[0]!.text, cityDialogueText(npc.story));
      assert.equal(pages[0]!.background, npc.background);
      assert.equal(pages[0]!.characters[0]!.id, npc.sprite);
      for (const [index, line] of quest.offer.entries()) {
        const page = pages[index + 1]!;
        assert.equal(page.text, cityDialogueText(line.text));
        if (line.who === "me") {
          assert.equal(page.speaker, playerName, "a nickname equal to a catalog key remains player text");
          assert.deepEqual(page.characters.map(character => character.id), [npc.sprite, "dao"]);
        }
      }
      assert.equal(offerPages(quest, { withStory: false, playerName }).length, quest.offer.length);
      const receiver = QUEST_NPCS[quest.type === "passenger" ? quest.giver : quest.receiver]!;
      const [thanks] = thanksPages(quest);
      assert.equal(thanks!.text, cityDialogueText(quest.thanks));
      assert.equal(thanks!.background, receiver.background);
      assert.equal(thanks!.characters[0]!.id, receiver.sprite);
      if (locale !== "zh-CN") for (const page of [...pages, thanks!])
        assert.doesNotMatch(page.text, /\p{Script=Han}/u, quest.id);
    }
    assert.equal(cityDialogueText("用户自己的对话"), "用户自己的对话");
    assert.equal(JSON.stringify([QUESTS, QUEST_NPCS]), before);
  });
});

test("the completion speech balloon translates while delivery records keep canonical quest and NPC IDs", async () => {
  const quest = QUESTS.find(quest => quest.type === "delivery")!;
  await eachLocale(async (_locale, stored) => {
    const balloons: Array<[string, string]> = [];
    let deliveries = 0;
    const view = Object.create(CityQuests.prototype) as CityQuests;
    Object.assign(view, {
      host: { network: () => ({ deliverQuest: async () => { deliveries++; return {}; } }),
        say: (npc: string, text: string) => balloons.push([npc, text]),
        notice: (text: string) => assert.fail(text) },
      active: { quest, delivering: false, triedAt: 0 },
      clear: () => { view.active = undefined; }, showResult: () => {}, celebrate: async () => {},
    });
    await (view as unknown as { deliver(): Promise<void> }).deliver();
    assert.equal(deliveries, 1);
    assert.deepEqual(balloons, [[quest.receiver, cityDialogueText(quest.thanks)]]);
    assert.deepEqual(JSON.parse(stored.get("kartsim.city.questsDone")!), { [quest.id]: 1 });
  });
});
