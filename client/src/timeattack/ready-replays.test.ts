import assert from "node:assert/strict";
import { test } from "node:test";
import { replayDateText, replayEntries, replaySettingsLabel, runRecordKey } from "./ready-replays";

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
