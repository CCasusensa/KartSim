import assert from "node:assert/strict";
import test from "node:test";

import { RANDOM_TEAM_NOTICE_MS, RandomTeamNotice, randomTeamNoticeDefinition,
  randomTeamNoticeProgress } from "./random-team-notice";
import type { Node } from "./bml-kit";

test("the banner is one full-stage band and runs for its fixed life", () => {
  const definition = randomTeamNoticeDefinition();
  const band = definition.children[0]!;
  assert.equal(band.name, "Panel");
  assert.deepEqual(band.attributes, [{ name: "name", value: "randomTeamBand" },
    { name: "leftTopWH", value: "0 330 1600 180" }]);
  assert.equal(randomTeamNoticeProgress(0), 0);
  assert.equal(randomTeamNoticeProgress(RANDOM_TEAM_NOTICE_MS / 2), 0.5);
  assert.equal(randomTeamNoticeProgress(RANDOM_TEAM_NOTICE_MS), undefined);
  assert.equal(randomTeamNoticeProgress(-5), 0);
});

function fixture(randomTeam: boolean) {
  const events: unknown[] = [];
  let now = 1000;
  let frame: ((timestamp: number) => void) | undefined;
  const view = {
    element: { dataset: {} as Record<string, string>, style: { pointerEvents: "" } },
    render: () => events.push("render"), show: () => events.push("show"), hide: () => events.push("hide"),
    focus: () => {}, dispose: () => events.push("dispose"),
  };
  const dependencies = {
    nowMs: () => now,
    requestFrame: (callback: (timestamp: number) => void) => { frame = callback; events.push("frame"); return 7; },
    cancelFrame: (id: number) => events.push(["cancel", id]),
  };
  const load = RandomTeamNotice.load({} as never, {} as never, { randomTeam }, "me", dependencies,
    async () => { events.push("load"); return view; });
  return { events, view, load, advance: (ms: number) => { now += ms; frame?.(now); } };
}

test("a race without the deal has no banner", async () => {
  await assert.rejects(fixture(false).load, /没有队伍随机分配/);
});

test("the banner shows, redraws every frame, hides when its life is over and resolves", async () => {
  const { events, view, load, advance } = fixture(true);
  const notice = await load;
  assert.deepEqual([view.element.dataset.uiLayer, view.element.style.pointerEvents], ["notice", "none"]);
  const shown = notice.present(new AbortController().signal);
  assert.deepEqual(events, ["load", "show", "frame"]);
  advance(500);
  assert.deepEqual(events.slice(-2), ["render", "frame"]);
  advance(RANDOM_TEAM_NOTICE_MS);
  await shown;
  assert.deepEqual(events.slice(-1), ["hide"]);
  assert.throws(() => notice.present(new AbortController().signal), /不能重复开始/);
  notice.dispose();
  assert.deepEqual(events.slice(-2), ["hide", "dispose"]);
});

test("aborting the start cuts the banner short", async () => {
  const { events, load, advance } = fixture(true);
  const notice = await load;
  const abort = new AbortController();
  const shown = notice.present(abort.signal);
  advance(100);
  abort.abort();
  await assert.rejects(shown, /已取消/);
  assert.deepEqual(events.slice(-2), [["cancel", 7], "hide"]);
  assert.throws(() => notice.present(new AbortController().signal), /不能重复开始/);
});
