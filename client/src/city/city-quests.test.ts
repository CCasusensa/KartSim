import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  QUESTS, QUEST_BY_ID, QUEST_NPCS, QUEST_RULES, compass, failureResult, failureText, formatDuration, limitShort,
  limitText, offerPages, questsOf, shortName, successResult, thanksPages,
} from "./city-quest-data";
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

test("every quest runs between two task-point NPCs and pays by distance and limit", () => {
  const ids = new Set<string>();
  for (const quest of QUESTS) {
    assert.ok(!ids.has(quest.id), quest.id);
    ids.add(quest.id);
    assert.ok(QUEST_NPCS[quest.giver] && QUEST_NPCS[quest.receiver] && quest.giver !== quest.receiver, quest.id);
    const km = quest.distanceM / 1000;
    const rules = QUEST_RULES as typeof QUEST_RULES & { lucciBase: number; lucciPerKm: number; expBase: number; expPerKm: number };
    const multiplier = QUEST_RULES.kinds[quest.kind].multiplier;
    assert.equal(quest.lucci, Math.round((rules.lucciBase + rules.lucciPerKm * km) * multiplier / 10) * 10, quest.id);
    assert.equal(quest.exp, Math.round((rules.expBase + rules.expPerKm * km) * multiplier), quest.id);
    if (quest.kind === "speed") assert.ok(quest.maxKmh! > 0, quest.id);
    if (quest.kind === "collision") assert.ok(quest.maxCollisions! >= 0, quest.id);
    if (quest.kind === "time") assert.ok(quest.timeLimitMs! > 0, quest.id);
    assert.ok(quest.offer.length > 0 && quest.thanks && quest.synopsis, quest.id);
  }
  // Every limit pays more than a plain delivery, and every NPC has something to give.
  for (const kind of ["speed", "collision", "time"] as const) assert.ok(QUEST_RULES.kinds[kind].multiplier > 1);
  for (const id of Object.keys(QUEST_NPCS)) assert.ok(questsOf(id).length > 0, id);
});

test("quest texts describe each limit and failure", () => {
  const speed = QUESTS.find(quest => quest.kind === "speed")!;
  const collision = QUESTS.find(quest => quest.kind === "collision")!;
  const time = QUESTS.find(quest => quest.kind === "time")!;
  assert.equal(limitShort(speed), `限速 ${speed.maxKmh} km/h`);
  assert.match(limitText(speed), /超速超过 1 秒即失败/);
  assert.equal(limitShort(collision), `碰撞不超过 ${collision.maxCollisions} 次`);
  assert.equal(limitShort(time), `限时 ${formatDuration(time.timeLimitMs!)}`);
  assert.equal(formatDuration(125_000), "2 分 05 秒");
  assert.equal(formatDuration(9_200), "10 秒");
  assert.match(failureText(speed, "SPEED"), new RegExp(`${speed.maxKmh} km/h`));
  assert.match(failureText(collision, "COLLISION"), /摔坏/);
  assert.match(failureText(time, "TIMEOUT"), /送晚/);
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
    { quest: "q", runId: "r", startedAt: 5, deadline: 0, collisions: 2 });
  assert.throws(() => parseCityQuestRun({ quest: "q", startedAt: 5, deadline: 0 }));
  const done = parseCityQuestDone({ quest: "q", elapsedMs: 1, collisions: 0, exp: 2, lucci: 3, capped: false,
    walletLucci: 4, totalExp: 5, level: 6, levelUps: [{ level: 6, lucci: 100 }] });
  assert.deepEqual(done.levelUps, [{ level: 6, lucci: 100, koin: 0, coupon: 0 }]);
  assert.throws(() => parseCityQuestDone({ quest: "q", elapsedMs: 1 }));
  const failed = parseCityEvent({ type: "city-quest-failed", instanceId: "i", quest: "q",
    reason: "TELEPORT", collisions: 1 });
  assert.deepEqual(failed, { type: "city-quest-failed", instanceId: "i", quest: "q", reason: "TELEPORT", collisions: 1 });
  assert.throws(() => parseCityEvent({ type: "city-quest-progress", instanceId: "i", quest: "q" }));
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
