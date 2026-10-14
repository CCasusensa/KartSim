import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  QUESTS, QUEST_BY_ID, QUEST_NPCS, QUEST_RULES, compass, failureResult, failureText, formatDuration, limitShort,
  limitText, offerPages, progressText, questGoal, questLabel, questMarks, questMissionImage, questMultiplier, questReady,
  questsOf, shortName, signalBars, successResult, thanksPages,
} from "./city-quest-data";
import { boundKey, cityHelpDefinition, cityHelpPages } from "./city-help-window";
import { fitView, toScreen } from "./city-map-window";
import { parseCityEvent, parseCityQuestDone, parseCityQuestRun } from "./city-protocol";
import { questResultDefinition } from "./city-quest-result";

const root = new URL("../../../", import.meta.url);

test("the three copies of city-quests.json are the same file", () => {
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  const client = read("client/src/city/city-quests.json");
  assert.equal(read("design/open-world/vice-city/city-quests.json"), client);
  assert.equal(read("server-go/internal/game/city/city-quests.json"), client);
});

test("every quest runs between task-point NPCs and pays by distance, type and limit", () => {
  const ids = new Set<string>();
  const types = new Set<string>();
  for (const quest of QUESTS) {
    assert.ok(!ids.has(quest.id), quest.id);
    ids.add(quest.id);
    types.add(quest.type);
    assert.ok(QUEST_NPCS[quest.giver] && QUEST_NPCS[quest.receiver], quest.id);
    if (quest.type === "delivery" || quest.type === "passenger") assert.notEqual(quest.giver, quest.receiver, quest.id);
    if (quest.type === "collect") assert.ok(quest.stops!.length >= 2 && quest.stops!.every(stop => stop.name), quest.id);
    if (quest.type === "search") {
      const area = quest.area!;
      assert.equal(area.spots.length, QUEST_RULES.search.spots, quest.id);
      for (const spot of area.spots) assert.ok(Math.hypot(spot.x - area.x, spot.z - area.z) <= area.radius, quest.id);
    }
    const km = quest.distanceM / 1000;
    const rules = QUEST_RULES as typeof QUEST_RULES & { lucciBase: number; lucciPerKm: number; expBase: number; expPerKm: number };
    const multiplier = QUEST_RULES.types[quest.type].multiplier * QUEST_RULES.kinds[quest.kind].multiplier;
    assert.equal(quest.lucci, Math.round((rules.lucciBase + rules.lucciPerKm * km) * multiplier / 10) * 10, quest.id);
    assert.equal(quest.exp, Math.round((rules.expBase + rules.expPerKm * km) * multiplier), quest.id);
    if (quest.kind === "speed") assert.ok(quest.maxKmh! > 0, quest.id);
    if (quest.kind === "collision") assert.ok(quest.maxCollisions! >= 0, quest.id);
    if (quest.kind === "time") assert.ok(quest.timeLimitMs! > 0, quest.id);
    assert.ok(quest.offer.length > 0 && quest.thanks && quest.synopsis, quest.id);
  }
  // Every type and limit pays more than a plain delivery, and every NPC has something to give.
  assert.deepEqual([...types].sort(), ["collect", "delivery", "passenger", "search"]);
  for (const kind of ["speed", "collision", "time"] as const) assert.ok(QUEST_RULES.kinds[kind].multiplier > 1);
  for (const type of ["passenger", "collect", "search"] as const) assert.ok(QUEST_RULES.types[type].multiplier > 1);
  assert.ok(Object.keys(QUEST_NPCS).length >= 13);
  for (const id of Object.keys(QUEST_NPCS)) assert.ok(questsOf(id).length > 0, id);
});

test("quest texts describe each limit and failure", () => {
  const speed = QUESTS.find(quest => quest.kind === "speed" && quest.type === "delivery")!;
  const collision = QUESTS.find(quest => quest.kind === "collision" && quest.type === "delivery")!;
  const time = QUESTS.find(quest => quest.kind === "time" && quest.type === "delivery")!;
  assert.equal(limitShort(speed), `限速 ${speed.maxKmh} km/h`);
  assert.match(limitText(speed), /超速超过 1 秒即失败/);
  assert.equal(limitShort(collision), `碰撞不超过 ${collision.maxCollisions} 次`);
  assert.equal(limitShort(time), `限时 ${formatDuration(time.timeLimitMs!)}`);
  assert.equal(formatDuration(125_000), "2 分 05 秒");
  assert.equal(formatDuration(9_200), "10 秒");
  assert.match(failureText(speed, "SPEED"), new RegExp(`${speed.maxKmh} km/h`));
  assert.match(failureText(collision, "COLLISION"), /摔坏/);
  assert.match(failureText(time, "TIMEOUT"), /规定时间/);
  assert.match(failureText(time, "TELEPORT"), /传送/);
  assert.equal(shortName(QUEST_NPCS["guide-beach"]), "皮蛋");
  assert.equal(compass(0, 0, 0, -10), "北");
  assert.equal(compass(0, 0, 10, 10), "东南");
});

test("the dialogue shows the NPC's story first, then the request; thanks come from the receiver", () => {
  const quest = QUEST_BY_ID.get("beach-brochures")!;
  const npc = QUEST_NPCS[quest.giver]!;
  const pages = offerPages(quest, { withStory: true, playerName: "车手", playerSprite: "bazzi" });
  assert.equal(pages.length, quest.offer.length + 1);
  assert.equal(pages[0]!.text, npc.story);
  assert.equal(pages[0]!.background, npc.background);
  const mine = pages.slice(1).find((_, i) => quest.offer[i]!.who === "me");
  if (mine) {
    assert.equal(mine.speaker, "车手");
    assert.deepEqual(mine.characters.map(c => c.id), [npc.sprite, "bazzi"]);
  }
  assert.equal(offerPages(quest, { withStory: false, playerName: "车手" }).length, quest.offer.length);
  const thanks = thanksPages(quest);
  assert.equal(thanks[0]!.characters[0]!.id, QUEST_NPCS[quest.receiver]!.sprite);
  assert.equal(thanks[0]!.text, quest.thanks);
});

test("result rows list the reward, level-ups and why a delivery failed", () => {
  const quest = QUESTS.find(q => q.kind === "time")!;
  const success = successResult(quest, { elapsedMs: 61_000, collisions: 0, exp: quest.exp, lucci: quest.lucci,
    capped: false, walletLucci: 9_999, level: 3, levelUps: [{ level: 3, lucci: 300, koin: 0, coupon: 5 }] });
  const rows = new Map(success.rows.map(row => [row.label, row.value]));
  assert.equal(rows.get("获得金币"), `+${quest.lucci}`);
  assert.equal(rows.get("获得经验"), `+${quest.exp}`);
  assert.equal(rows.get("升到 3 级"), "奖励 金币 300、点券 5");
  assert.equal(rows.get("用时"), "1 分 01 秒");
  assert.match(rows.get("报酬倍率")!, /×1\.6/);
  assert.equal(success.note, undefined);
  const capped = successResult(quest, { elapsedMs: 1, collisions: 0, exp: 0, lucci: 0, capped: true, walletLucci: 0,
    level: 1, levelUps: [] });
  assert.match(capped.note!, /领满/);
  const collision = QUESTS.find(q => q.kind === "collision")!;
  const failed = failureResult(collision, "COLLISION", collision.maxCollisions! + 1);
  assert.equal(failed.success, false);
  assert.equal(failed.rows[0]!.value, "碰撞过多");
  assert.ok(failed.rows.some(row => row.value === `${collision.maxCollisions! + 1} / ${collision.maxCollisions} 次`));
  assert.match(failed.note!, new RegExp(shortName(QUEST_NPCS[collision.giver])));
  const definition = questResultDefinition(failed);
  const caption = definition.children[0]!.attributes.find(a => a.name === "caption")!.value;
  assert.equal(caption, "任务失败");
});

test("quest replies and events parse, and bad ones are refused", () => {
  assert.deepEqual(parseCityQuestRun({ quest: "q", runId: "r", startedAt: 5, deadline: 0, collisions: 2 }),
    { quest: "q", questType: "delivery", runId: "r", startedAt: 5, deadline: 0, collisions: 2 });
  assert.deepEqual(parseCityQuestRun({ quest: "q", questType: "collect", runId: "r", startedAt: 5, deadline: 0,
    collisions: 0, collected: [true, false] }),
  { quest: "q", questType: "collect", runId: "r", startedAt: 5, deadline: 0, collisions: 0, collected: [true, false] });
  assert.throws(() => parseCityQuestRun({ quest: "q", startedAt: 5, deadline: 0 }));
  const done = parseCityQuestDone({ quest: "q", elapsedMs: 1, collisions: 0, exp: 2, lucci: 3, capped: false,
    walletLucci: 4, totalExp: 5, level: 6, levelUps: [{ level: 6, lucci: 100 }] });
  assert.deepEqual(done.levelUps, [{ level: 6, lucci: 100, koin: 0, coupon: 0 }]);
  assert.throws(() => parseCityQuestDone({ quest: "q", elapsedMs: 1 }));
  const failed = parseCityEvent({ type: "city-quest-failed", instanceId: "i", quest: "q",
    reason: "TELEPORT", collisions: 1 });
  assert.deepEqual(failed, { type: "city-quest-failed", instanceId: "i", quest: "q", reason: "TELEPORT", collisions: 1 });
  assert.throws(() => parseCityEvent({ type: "city-quest-progress", instanceId: "i", quest: "q" }));
  assert.deepEqual(parseCityEvent({ type: "city-quest-progress", instanceId: "i", quest: "q", collisions: 1,
    satisfaction: 85 }), { type: "city-quest-progress", instanceId: "i", quest: "q", collisions: 1, satisfaction: 85 });
  assert.deepEqual(parseCityEvent({ type: "city-quest-progress", instanceId: "i", quest: "q", collisions: 0,
    found: false, signal: 3 }), { type: "city-quest-progress", instanceId: "i", quest: "q", collisions: 0, found: false, signal: 3 });
  const tipped = parseCityQuestDone({ quest: "q", elapsedMs: 1, collisions: 0, exp: 2, lucci: 3, capped: false,
    walletLucci: 4, totalExp: 5, level: 6, levelUps: [], satisfaction: 77, tip: 40 });
  assert.equal(tipped.tip, 40);
  assert.equal(tipped.satisfaction, 77);
});

test("each quest type has its card, goal, progress and map marks", () => {
  const byType = (type: string) => QUESTS.find(quest => quest.type === type)!;
  const ride = byType("passenger"), collect = byType("collect"), search = byType("search"), delivery = byType("delivery");
  assert.equal(questMissionImage(delivery), "mq_배달@zz");
  assert.equal(questMissionImage(ride), "mq_멀티@zz");
  assert.equal(questMissionImage(collect), "mq_주행거리@zz");
  assert.equal(questMissionImage(search), "mq_추격@zz");
  assert.equal(questLabel(QUEST_BY_ID.get("tutu-ride")!), "载客 · 限时");
  assert.equal(questLabel(QUEST_BY_ID.get("wenwen-ride")!), "载客");
  assert.equal(questMultiplier(QUEST_BY_ID.get("tutu-ride")!), 1.76);
  assert.match(questGoal(ride), new RegExp(`载${shortName(QUEST_NPCS[ride.giver])}去找`));
  assert.match(questGoal(collect), new RegExp(`收集 ${collect.stops!.length} 处`));
  assert.match(questGoal(search), /找到/);
  // A passenger thanks you itself.
  assert.equal(thanksPages(ride)[0]!.characters[0]!.id, QUEST_NPCS[ride.giver]!.sprite);
  assert.equal(progressText(ride, { satisfaction: 62 }), "乘客满意度 62%");
  assert.equal(signalBars(3), "▮▮▮▯▯");
  assert.equal(progressText(search, { found: false, signal: 2 }), "信号 ▮▮▯▯▯");
  // A collection: a "★" per stop still to reach; the receiver's "?" once all are in.
  const none = collect.stops!.map(() => false);
  assert.equal(questReady(collect, { collected: none }), false);
  assert.deepEqual(questMarks(collect, { collected: none }).map(mark => mark.mark), none.map(() => "★"));
  const some = none.map((_, i) => i === 0);
  assert.equal(questMarks(collect, { collected: some }).length, none.length - 1);
  const all = none.map(() => true);
  assert.deepEqual(questMarks(collect, { collected: all }).map(mark => mark.mark), ["?"]);
  assert.equal(questReady(search, { found: false }), false);
  assert.deepEqual(questMarks(search, { found: false }), []);
  assert.equal(questMarks(search, { found: true })[0]!.npc, search.receiver);
  assert.equal(questMarks(ride, {})[0]!.label, `目的地 · ${QUEST_NPCS[ride.receiver]!.name}`);
  // A ride's result shows the passenger's satisfaction and tip; a failure says why.
  const result = successResult(ride, { elapsedMs: 1000, collisions: 0, exp: 1, lucci: 2, capped: false, walletLucci: 3,
    level: 1, levelUps: [], satisfaction: 90, tip: 40 });
  const rows = new Map(result.rows.map(row => [row.label, row.value]));
  assert.equal(rows.get("乘客满意度"), "90%");
  assert.match(rows.get("小费")!, /\+40/);
  assert.equal(failureResult(ride, "UNHAPPY", 0).rows[0]!.value, "乘客不满意");
  assert.match(failureText(ride, "EXITED"), /下了车/);
});

test("the 操作说明 has three pages and shows the player's own driving keys", () => {
  const pages = cityHelpPages();
  assert.deepEqual(pages.map(page => page.title), ["驾驶", "城市", "任务"]);
  assert.deepEqual(pages[0]!.rows[0]!.keys, ["↑", "↓"]);
  assert.deepEqual(pages[0]!.rows[2]!.keys, ["Shift"]);
  assert.equal(boundKey(undefined, 9), "R");
  // A remapped drift key (slot 4) shows as remapped.
  assert.deepEqual(cityHelpPages({ 4: 44 })[0]!.rows[2]!.keys, ["Z"]);
  const keys = pages.flatMap(page => page.rows.flatMap(row => row.keys));
  for (const key of ["E", "L", "M", "G", "F", "T", "H"]) assert.ok(keys.includes(key), key);
  const definition = cityHelpDefinition(pages);
  const window = definition.children[0]!;
  assert.equal(window.attributes.find(a => a.name === "caption")!.value, "卡丁城操作说明");
  const names = window.children.map(child => child.attributes.find(a => a.name === "name")?.value);
  for (const name of ["helpTab0", "helpTab1", "helpTab2", "helpPage"]) assert.ok(names.includes(name), name);
});

test("the M map opens on the rider and the delivery's target together", () => {
  const rect = { x: 0, y: 0, width: 600, height: 760 };
  const me = { x: -343, z: -407 }, target = { x: -1637.6, z: -1509.07 };
  const view = fitView([me, target], rect, 2);
  for (const point of [me, target]) {
    const p = toScreen(view, rect, point.x, point.z);
    assert.ok(p.x > 20 && p.x < rect.width - 20 && p.y > 20 && p.y < rect.height - 20, JSON.stringify(p));
  }
  // Two points close together zoom in no further than the plain open.
  assert.equal(fitView([me, { x: me.x + 5, z: me.z }], rect, 2).zoom, 2);
});

test("65 task-point NPCs (5 × the first 13) each give template quests of every type", async () => {
  const npcs = JSON.parse(readFileSync(new URL("client/src/city/city-npcs.json", root), "utf8")).npcs as
    Array<{ id: string; name: string; x: number; z: number }>;
  assert.equal(npcs.length, 65);
  assert.deepEqual(new Set(npcs.map(npc => npc.id)).size, 65);
  for (const npc of npcs) {
    const profile = QUEST_NPCS[npc.id]!;
    assert.ok(profile && profile.sprite && profile.background && profile.story, npc.id);
    // Nobody stands on anyone else's spot.
    for (const other of npcs)
      if (other !== npc) assert.ok(Math.hypot(other.x - npc.x, other.z - npc.z) > 30, `${npc.id} / ${other.id}`);
  }
  const { DELIVERY_TEMPLATES } = await import("../../tools/city/quests/city-quests.templates.mjs");
  assert.ok(DELIVERY_TEMPLATES.length >= 40);
  const generated = QUESTS.filter(quest => quest.id.includes("~"));
  const keys = new Set(generated.filter(quest => quest.type === "delivery").map(quest => quest.id.slice(quest.id.indexOf("~") + 1)));
  assert.ok(keys.size >= 40, `${keys.size} delivery templates used`);
  for (const npc of npcs) {
    const mine = generated.filter(quest => quest.giver === npc.id);
    assert.ok(mine.filter(quest => quest.type === "delivery").length >= 3, npc.id);
    // One ride, one collection and one search from templates for everyone.
    for (const type of ["passenger", "collect", "search"]) assert.equal(mine.filter(quest => quest.type === type).length, 1, `${npc.id} ${type}`);
  }
  const { PASSENGER_TEMPLATES, COLLECT_TEMPLATES, SEARCH_TEMPLATES } = await import("../../tools/city/quests/city-quests.templates.mjs");
  assert.ok(PASSENGER_TEMPLATES.length >= 12 && COLLECT_TEMPLATES.length >= 12 && SEARCH_TEMPLATES.length >= 12);
  for (const quest of generated) {
    if (quest.type === "delivery" || quest.type === "passenger") assert.notEqual(quest.giver, quest.receiver);
    if (quest.type === "passenger") assert.equal(quest.item, shortName(QUEST_NPCS[quest.giver]));
    if (quest.type === "collect") {
      // Stops spread out near the giver.
      const stops = quest.stops!;
      for (const stop of stops) for (const other of stops)
        if (other !== stop) assert.ok(Math.hypot(other.x - stop.x, other.z - stop.z) >= 100, quest.id);
    }
    if (quest.type === "search") assert.equal(quest.receiver, quest.giver);
    const text = [quest.title, quest.synopsis, quest.thanks, ...quest.offer.map(line => line.text)].join("");
    assert.doesNotMatch(text, /[{}]/, quest.id);
  }
});
