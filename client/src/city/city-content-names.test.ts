import assert from "node:assert/strict";
import test from "node:test";
import { cityContentName, cityContentNames } from "../i18n/catalogs/city-content-names";
import { QUESTS, QUEST_NPCS, QUEST_BY_ID, questTitle, npcName, shortName, questsOf,
  offerPages, questMarks, questGoal, questSynopsis, progressText, failureText, successResult, failureResult } from "./city-quest-data";
import { CityNpcs } from "./city-npcs";
import { CityQuests, type CityQuestHost } from "./city-quests";

function withLocale(locale: string, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("every authored city quest title and NPC menu name has English and Korean while IDs remain unchanged", () => {
  const dataBefore = JSON.stringify([QUESTS, QUEST_NPCS]);
  assert.equal(new Set(QUESTS.map(quest => quest.title)).size, 128);
  assert.equal(Object.keys(QUEST_NPCS).length, 65);
  for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
    for (const quest of QUESTS) {
      const displayed = questTitle(quest);
      assert.ok(cityContentNames[quest.title], quest.id);
      assert.equal(QUEST_BY_ID.get(quest.id), quest);
      assert.ok(questsOf(quest.giver).includes(quest));
      if (locale === "zh-CN") assert.equal(displayed, quest.title);
      else assert.doesNotMatch(displayed, /\p{Script=Han}/u, quest.id);
    }
    for (const [id, npc] of Object.entries(QUEST_NPCS)) {
      assert.ok(cityContentNames[npc.name], id);
      if (locale === "zh-CN") assert.equal(npcName(npc), npc.name);
      else assert.doesNotMatch(npcName(npc), /\p{Script=Han}/u, id);
    }
    assert.equal(cityContentName("Future custom quest"), "Future custom quest");
  });
  assert.equal(JSON.stringify([QUESTS, QUEST_NPCS]), dataBefore);
});

test("quest screens, map labels, NPC head tags and result titles use display names without translating player names", () => {
  const quest = QUESTS.find(entry => entry.giver === "guide-beach" && entry.type === "delivery")!;
  const npc = QUEST_NPCS[quest.giver]!;
  const playerName = npc.name;
  for (const [locale, short, full] of [["zh-CN", "皮蛋", "导游 · 皮蛋"],
    ["en", "Dao", "Guide · Dao"], ["ko", "다오", "가이드 · 다오"]] as const) withLocale(locale, () => {
    assert.equal(shortName(npc), short);
    assert.equal(npcName(npc), full);
    const pages = offerPages({ ...quest, offer: [{ who: "npc", text: "原文" }, { who: "me", text: "用户台词" }] },
      { withStory: false, playerName });
    assert.equal(pages[0]?.speaker, short);
    assert.equal(pages[1]?.speaker, playerName, "rider nicknames are never looked up in the city catalog");
    assert.deepEqual(pages.map(page => page.text), ["原文", "用户台词"]);
    assert.ok(questMarks(quest, {})[0]?.label.includes(npcName(QUEST_NPCS[quest.receiver])));
    const success = successResult(quest, { elapsedMs: 1000, collisions: 0, exp: 5, lucci: 10,
      capped: false, walletLucci: 100, level: 1, levelUps: [] });
    assert.ok(success.heading.includes(questTitle(quest)));
    assert.equal(success.rows[0]?.value, npcName(QUEST_NPCS[quest.receiver]));
    assert.ok(failureResult(quest, "TIMEOUT", 0).heading.includes(questTitle(quest)));
    const npcs = new CityNpcs({} as never);
    const target = npcs.tasks.find(task => task.definition.id === "guide-beach")!;
    target.figure = { avatar: {}, root: { visible: true } } as never;
    assert.equal(npcs.heads()[0]?.name, full);
    assert.equal(npcs.heads()[0]?.id, "npc-task:guide-beach");
  });
});


test("all authored quest items, search areas, stops and menu synopses translate without altering canonical data", () => {
  const dataBefore = JSON.stringify(QUESTS);
  const items = new Set(QUESTS.map(quest => quest.item));
  const areas = new Set(QUESTS.flatMap(quest => quest.area ? [quest.area.name] : []));
  const stops = new Set(QUESTS.flatMap(quest => quest.stops?.map(stop => stop.name) ?? []));
  const objectives = new Set([...items, ...areas, ...stops]);
  const synopses = new Set(QUESTS.map(quest => quest.synopsis));
  assert.deepEqual([items.size, areas.size, stops.size, objectives.size, synopses.size], [173, 22, 57, 252, 421]);
  for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
    for (const source of [...objectives, ...synopses]) {
      assert.ok(cityContentNames[source], source);
      const translated = cityContentName(source);
      if (locale === "zh-CN") assert.equal(translated, source);
      else {
        assert.doesNotMatch(translated, /\p{Script=Han}/u, source);
        assert.doesNotMatch(translated, /\{\d+\}/u, source);
      }
    }
    for (const quest of QUESTS) {
      assert.equal(questSynopsis(quest), cityContentName(quest.synopsis));
      const ready = { found: true, collected: quest.stops?.map(() => true) };
      const texts = [questGoal(quest), progressText(quest, ready), failureText(quest, "TIMEOUT"),
        ...questMarks(quest, {}).map(mark => mark.label)];
      if (locale !== "zh-CN") for (const text of texts) assert.doesNotMatch(text, /\p{Script=Han}/u, quest.id);
      else assert.ok(questGoal(quest).includes(quest.item), quest.id);
      if (quest.type === "collect") assert.deepEqual(questMarks(quest, {}).map(mark => mark.label),
        quest.stops!.map(stop => cityContentName(stop.name)));
    }
  });
  assert.equal(JSON.stringify(QUESTS), dataBefore);
});

test("quest HUD, map areas and progress notices render localized objectives in all three languages", () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const elements: Array<{ className?: string; textContent?: string; style: Record<string, string> }> = [];
  const context = new Proxy({}, { get: () => () => {} });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() {
      const element = { style: {}, width: 0, height: 0, setAttribute() {}, remove() {}, getContext: () => context };
      elements.push(element);
      return element;
    },
  } });
  try {
    for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
      const notices: string[] = [];
      const host = { root: { append() {}, clientWidth: 0, clientHeight: 0 }, library: {},
        local: () => undefined, camera: () => ({}), npcFeet: () => undefined, serverNow: () => 0,
        notice: (text: string) => notices.push(text) } as unknown as CityQuestHost;
      const view = new CityQuests(host);
      const hud = [...elements].reverse().find(element => element.className === "kartcity-quest")!;
      try {
        for (const quest of QUESTS) {
          view.active = { quest, run: { deadline: 60000 } as never, collisions: 0,
            progress: { collected: quest.stops?.map(() => false), found: false, satisfaction: 100 },
            delivering: false, triedAt: 0 };
          view.update(0);
          assert.ok(hud.textContent?.includes(cityContentName(quest.item)), quest.id);
          const map = view.mapMarks()!;
          if (quest.area) {
            assert.ok(map.area?.label.includes(cityContentName(quest.area.name)), quest.id);
            assert.deepEqual([map.area?.x, map.area?.z, map.area?.radius],
              [quest.area.x, quest.area.z, quest.area.radius]);
          }
          const collected = quest.stops?.map((_, index) => index === 0);
          view.onEvent({ type: "city-quest-progress", quest: quest.id, collisions: 1,
            satisfaction: 70, found: true, collected } as never);
          if (quest.type === "collect") assert.ok(notices.at(-1)?.includes(cityContentName(quest.stops![0]!.name)), quest.id);
          if (quest.type === "search") assert.ok(notices.at(-1)?.includes(cityContentName(quest.item)), quest.id);
          if (locale !== "zh-CN") for (const text of [hud.textContent!, ...notices,
            ...map.marks.map(mark => mark.label), map.area?.label ?? ""])
            assert.doesNotMatch(text, /\p{Script=Han}/u, quest.id);
          notices.length = 0;
        }
      } finally { view.dispose(); }
    });
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
