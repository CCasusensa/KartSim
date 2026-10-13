import assert from "node:assert/strict";
import test from "node:test";

import { fetchRaceLevelUps, parseRaceLevelUps, RACE_LEVEL_UP_ATTEMPTS,
  RACE_LEVEL_UP_RETRY_MS } from "./race-level-ups";

test("升级名单解析跳过格式不对的条目", () => {
  assert.deepEqual(parseRaceLevelUps({ stored: true, levelUps: [
    { playerId: "p1", level: 4 }, { playerId: 2, level: 3 }, { playerId: "p3", level: 1.5 }, null,
  ] }), { stored: true, levelUps: [{ playerId: "p1", level: 4 }] });
  assert.deepEqual(parseRaceLevelUps([]), { stored: false, levelUps: [] });
  assert.deepEqual(parseRaceLevelUps({ stored: "yes" }), { stored: false, levelUps: [] });
});

test("结算未到时每秒再问，问够次数后放弃", async () => {
  const paths: string[] = [];
  const waits: number[] = [];
  const answers: unknown[] = [{ stored: false, levelUps: [] }, new Error("offline"),
    { stored: true, levelUps: [{ playerId: "p2", level: 7 }] }];
  const session = { requestJson: async (path: string) => {
    paths.push(path);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  } };
  const wait = async (ms: number) => { waits.push(ms); };
  assert.deepEqual(await fetchRaceLevelUps(session, "race/1", wait), [{ playerId: "p2", level: 7 }]);
  assert.deepEqual(paths, Array(3).fill("/api/races/race%2F1/level-ups"));
  assert.deepEqual(waits, [RACE_LEVEL_UP_RETRY_MS, RACE_LEVEL_UP_RETRY_MS]);

  let asked = 0;
  const never = { requestJson: async () => { asked++; return { stored: false, levelUps: [] }; } };
  assert.deepEqual(await fetchRaceLevelUps(never, "r", async () => {}), []);
  assert.equal(asked, RACE_LEVEL_UP_ATTEMPTS);
});
