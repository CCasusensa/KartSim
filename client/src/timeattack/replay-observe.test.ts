import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustObserveView, createObserveState, recordedMove, ReplayClock, selectObserveRank, setObserveCamera,
  stepObserveRank, updateObserveRanking, watchedRank,
} from "./replay-observe";

const riders = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `r${index}`, kartName: "" }));

test("the replay clock stops at the end and play starts it over", () => {
  const clock = new ReplayClock(10_000);
  assert.equal(clock.advance(0), 0);
  assert.equal(clock.advance(4_000), 4_000);
  clock.play(4_000, 0.5);
  assert.equal(clock.advance(6_000), 5_000);
  assert.equal(clock.advance(30_000), 10_000);
  assert.equal(clock.paused, true);
  assert.equal(clock.advance(31_000), 10_000);
  clock.play(31_000, 1);
  assert.equal(clock.advance(32_000), 1_000);
  clock.seek(32_000, 7_500);
  assert.equal(clock.advance(32_000), 7_500);
});

test("1–8 follow a rank until 锁定车手 holds the rider", () => {
  const observe = createObserveState(riders(3), 60_000, 70_000);
  updateObserveRanking(observe, [2, 0, 1]);
  assert.equal(observe.watched, 2);
  selectObserveRank(observe, 2);
  assert.equal(observe.watched, 0);
  // Unlocked: whoever holds rank 2 is watched.
  updateObserveRanking(observe, [0, 1, 2]);
  assert.equal(observe.watched, 1);
  observe.rankLock = true;
  updateObserveRanking(observe, [1, 2, 0]);
  assert.equal(observe.watched, 1);
  assert.equal(watchedRank(observe), 1);
  selectObserveRank(observe, 8);
  assert.equal(observe.watched, 1, "an empty rank changes nothing");
  stepObserveRank(observe, -1);
  assert.equal(observe.watched, 0, "- wraps to the last rank");
  stepObserveRank(observe, 1);
  assert.equal(observe.watched, 1);
});

test("the arrows adjust only the cameras the 帮助 board names", () => {
  const observe = createObserveState(riders(1), 0, 1);
  const up = { up: true, down: false, left: false, right: false };
  adjustObserveView(observe, up, 1);
  assert.ok(observe.view.zoom < 1, "↑ brings the chase camera closer");
  setObserveCamera(observe, "Q");
  assert.deepEqual(observe.view, { zoom: 1, turn: 0, lift: 0 });
  adjustObserveView(observe, up, 1);
  assert.deepEqual(observe.view, { zoom: 1, turn: 0, lift: 0 });
  setObserveCamera(observe, "H");
  adjustObserveView(observe, up, 1);
  assert.ok(observe.view.lift > 0 && observe.view.zoom === 1, "H: ↑↓ raise, ←→ zoom");
  setObserveCamera(observe, "E");
  adjustObserveView(observe, { up: false, down: false, left: false, right: false }, 1);
  assert.ok(observe.view.turn > 0, "E keeps turning");
});

test("recorded moves read .ksv stamps as 0.1 m over 0.1 s, wire → world", () => {
  const record = { stamps: [
    { time: 0, x: 0, y: 0, z: -29500 },
    { time: 10, x: 100, y: 50, z: -29480 },
    { time: 20, x: 300, y: 50, z: -29480 },
  ] };
  assert.deepEqual(recordedMove(record, 1_000, 2_000), { x: 20, y: 0, z: -0 });
  assert.deepEqual(recordedMove(record, 0, 1_000), { x: 10, y: 2, z: -5 });
  assert.equal(recordedMove({}, 0, 1_000), undefined);
});
