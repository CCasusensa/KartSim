import assert from "node:assert/strict";
import test from "node:test";
import { cityAmbientDialogueTranslations } from "../i18n/catalogs/city-ambient-dialogue";
import { cityDialogueText } from "./city-dialogue";
import npcData from "./city-npcs.json";
import { CityNpcs } from "./city-npcs";
import { NPC_PRESETS } from "./city-traffic";

test("all NPC greetings and honk lines have English and Korean without changing hotkeys or source data", () => {
  const sources = [...new Set(npcData.npcs.flatMap(npc => npc.lines))];
  assert.equal(sources.length, 137);
  assert.equal(Object.keys(cityAmbientDialogueTranslations).length, 140);
  for (const source of [...sources, ...Object.keys(cityAmbientDialogueTranslations)]) {
    const translations = cityAmbientDialogueTranslations[source];
    assert.ok(translations, source);
    assert.equal(cityDialogueText(source, "zh-CN"), source);
    for (const locale of ["en", "ko"] as const) {
      const translated = cityDialogueText(source, locale);
      assert.equal(translated, translations[locale === "en" ? 0 : 1]);
      assert.doesNotMatch(translated, /\p{Script=Han}/u, source);
      assert.ok(translated.trim(), source);
      for (const hotkey of source.match(/\b[GMR]\b/g) ?? []) assert.ok(translated.includes(hotkey), source);
    }
  }
  assert.equal(cityDialogueText("玩家自己写的聊天", "en"), "玩家自己写的聊天");
});

test("known traffic drivers use translated NPC names without changing traffic IDs or presets", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const before = JSON.stringify(NPC_PRESETS);
  const view = new CityNpcs({} as never);
  view.traffic = { honking: () => NPC_PRESETS.map((preset, id) => ({ id, driver: preset.driver,
    honks: 1, position: { x: id, y: 0, z: 0 } })) } as never;
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
      const heads = view.heads();
      assert.equal(heads.length, NPC_PRESETS.length);
      for (const [index, head] of heads.entries()) {
        assert.equal(head.id, `npc-car:${index}`);
        assert.equal(head.position.x, index);
        if (locale === "zh-CN") assert.equal(head.name, NPC_PRESETS[index]!.driver);
        else assert.doesNotMatch(head.name, /\p{Script=Han}/u);
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
  assert.equal(JSON.stringify(NPC_PRESETS), before);
});

test("actual NPC updates select the current language for all greetings and traffic while IDs and canonical lines stay unchanged", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const before = JSON.stringify(npcData);
  const spoken: Array<{ id: string; text: string }> = [];
  let localPosition = { x: 0, y: 0, z: 0 };
  let currentHonk = 0;
  const view = new CityNpcs({
    stage: { scene: {} }, library: {}, serverNow: () => 0,
    view: () => localPosition,
    local: () => ({ position: localPosition, speed: 0 }),
    say: (id, text) => spoken.push({ id, text }),
    onError: error => assert.fail(String(error)),
  });
  for (const npc of view.tasks) {
    npc.failed = true;
    npc.grounded = true;
    // A lightweight visible figure lets the actual update choose and speak its line.
    // Omit avatar until its turn so no other NPC can greet or request assets.
    npc.figure = { update: () => {} } as never;
  }
  view.traffic = {
    update: () => {},
    honking: () => [{ id: 42, honks: currentHonk }],
  } as never;
  try {
    for (const locale of ["zh-CN", "en", "ko"] as const) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true,
        value: { getItem: () => locale } });
      for (let honk = 0; honk < 3; honk++) {
        currentHonk++;
        spoken.length = 0;
        view.update(0);
        const line = ["嘀嘀～请让一让", "嘀嘀！前面的车手借过一下～", "嘀嘀～我从旁边绕过去啦"][currentHonk % 3]!;
        assert.deepEqual(spoken, [{ id: "npc-car:42", text: cityDialogueText(line, locale) }]);
      }
      for (const npc of view.tasks) {
        localPosition = npc.world;
        npc.figure = { avatar: {}, update: () => {} } as never;
        for (const [index, source] of npc.definition.lines.entries()) {
          npc.line = index;
          npc.greetedAt = -Infinity;
          spoken.length = 0;
          view.update(0);
          assert.deepEqual(spoken, [{ id: `npc-task:${npc.definition.id}`, text: cityDialogueText(source, locale) }]);
        }
        npc.figure = { update: () => {} } as never;
      }
    }
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
  assert.equal(JSON.stringify(npcData), before);
});
