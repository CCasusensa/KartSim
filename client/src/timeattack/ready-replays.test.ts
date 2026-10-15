import assert from "node:assert/strict";
import { test } from "node:test";
import { featuredEntries, rankedEntries, replayDateText, replayEntries, replaySettingsLabel, runRecordKey } from "./ready-replays";

test("self labels never alter replay nicknames that already end in a translated marker", () => {
  const state = { track: { id: "village_R01", path: "p", title: "Track" }, speed: 7, booster: 0 };
  for (const nickname of ["Alex (Me)", "Alex (나)", "开始（我）"]) {
    for (const self of [false, true]) {
      const [entry] = rankedEntries([{ rank: 1, accountId: "a", nickname, kartName: "Kart",
        bestMs: 1000, updatedAt: 1, hasReplay: true, self }], state);
      assert.equal(entry!.riderName, nickname);
      assert.equal(entry!.displayRiderName, self ? `${nickname}（我）` : undefined);
    }
  }
});

test("replay cards come from records with a Ghost, newest first, titled by track and time", () => {
  const records: Array<[string, Record<string, unknown>]> = [
    ["village_r01\u00007\u00000", { hasGhost: true, elapsedMs: 95_120, kartName: "棉花糖", speed: 7, booster: 0 }],
    ["forest_i01\u00004\u00001", { hasGhost: true, elapsedMs: 121_000, kartName: "黑妞", speed: 4, booster: 1 }],
    ["tomb_r05\u00007\u00000", { elapsedMs: 80_000, kartName: "无影子" }],
  ];
  const dates: Record<string, number> = { "village_r01\u00007\u00000": 1_760_000_000_000 };
  const entries = replayEntries(records, "F10测试", id => id === "village_r01" ? "城镇 高速公路" : undefined,
    key => dates[key]);
  assert.deepEqual(entries.map(entry => entry.trackId), ["village_r01", "forest_i01"]);
  assert.equal(entries[0]?.title, "城镇 高速公路　01:35:12");
  assert.equal(entries[0]?.settings, "标准速度 / 个人赛");
  assert.equal(entries[0]?.dateText, "2025-10-09 16:53");
  assert.equal(entries[1]?.trackTitle, "forest_i01");
  assert.equal(entries[1]?.settings, "无限 / 组队赛");
  assert.equal(entries[1]?.dateText, "—");
  assert.equal(entries[1]?.riderName, "F10测试");
  assert.equal(entries[0]?.source, "local");
  assert.equal(entries[0]?.deletable, true);
});

test("联赛回放 and 其他回放 cards carry their sources and titles", () => {
  const [league] = featuredEntries([{ id: 5, title: "第1届决赛", note: "城镇", trackId: "village_R01", trackName: "城镇 高速公路",
    speed: 7, booster: 0, accountId: "a1", nickname: "小乖", kartName: "棉花糖", bestMs: 95_000, createdAt: 1_760_000_000_000 }]);
  assert.equal(league?.key, "featured:5");
  assert.equal(league?.source, "featured");
  assert.equal(league?.title, "第1届决赛");
  assert.equal(league?.note, "城镇");
  assert.equal(league?.trackTitle, "城镇 高速公路");
  assert.equal(league?.deletable, false);
  assert.equal(league?.featuredId, 5);
  const state = { track: { id: "forest_I01", path: "p", title: "森林" }, speed: 4, booster: 1 };
  const ranked = rankedEntries([
    { rank: 1, accountId: "a1", nickname: "小乖", kartName: "棉花糖", bestMs: 90_000, updatedAt: 1, hasReplay: true, self: false },
    { rank: 2, accountId: "a2", nickname: "我自己", kartName: "黑妞", bestMs: 91_000, updatedAt: 2, hasReplay: true, self: true },
    { rank: 3, accountId: "a3", nickname: "无录像", kartName: "x", bestMs: 92_000, updatedAt: 3, hasReplay: false, self: false },
  ], state);
  assert.deepEqual(ranked.map(entry => entry.accountId), ["a1", "a2"]);
  assert.equal(ranked[0]?.title, "第1名　小乖　01:30:00");
  assert.equal(ranked[0]?.settings, "无限 / 组队赛");
  assert.equal(ranked[1]?.riderName, "我自己");
  assert.equal(ranked[1]?.displayRiderName, "我自己（我）");
  assert.equal(ranked[0]?.key, "ranked:forest_I01:4:1:a1");
});

test("settings labels and record keys follow the Ready options", () => {
  assert.equal(replaySettingsLabel({}, "x\u00007\u00001"), "标准速度 / 组队赛");
  assert.equal(replaySettingsLabel({ speed: 5, booster: 0 }, "x\u00005\u00000\u0000retro"), "复古 S5 / 个人赛");
  assert.equal(runRecordKey("Village_R01", { speed: 7, booster: 0 }), "village_r01\u00007\u00000");
  assert.equal(runRecordKey("village_R01", { speed: 7, booster: 1, version: "国服", settingSpeed: 7 }),
    "village_r01\u00007\u00001");
  assert.equal(runRecordKey("village_R01", { speed: 7, booster: 0, version: "复古", settingSpeed: 5 }),
    "village_r01\u00005\u00000\u0000retro");
  assert.equal(replayDateText(undefined), "—");
});
