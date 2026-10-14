import assert from "node:assert/strict";
import test from "node:test";

import { closeReadyHomeWhenCovered, type ReadyHomeController } from "./ready-home";

/** Frames run by hand; the clock moves only when a test says so. */
function frames() {
  let now = 0;
  let queue: FrameRequestCallback[] = [];
  const raf = globalThis.requestAnimationFrame;
  const clock = Object.getOwnPropertyDescriptor(performance, "now");
  globalThis.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  return {
    advance(ms: number) {
      now += ms;
      const due = queue;
      queue = [];
      for (const callback of due) callback(now);
    },
    get pending() { return queue.length; },
    restore() {
      globalThis.requestAnimationFrame = raf;
      if (clock) Object.defineProperty(performance, "now", clock);
      else delete (performance as { now?: unknown }).now;
    },
  };
}

function homeOverReady() {
  let disposed = 0;
  const shell = { current: "Ready" as string, modal: undefined };
  const controller = {
    activeHome: { dispose() { disposed++; } },
    host: { shell, root: { querySelector: () => null } },
    readyModalBusy: () => false,
  } as unknown as ReadyHomeController & { multiplayerOpening?: boolean; multiplayer?: unknown };
  return { controller, shell, closed: () => disposed > 0 };
}

test("首页卡丁城：首次进入先下载联机资源（超过 400ms），首页仍等到城市画出来才关", () => {
  const clock = frames();
  try {
    const { controller, shell, closed } = homeOverReady();
    // openReadyMultiplayer marks the opening before its first await.
    controller.multiplayerOpening = true;
    closeReadyHomeWhenCovered(controller);
    // The lobby's resources take 30 s on the first visit, longer than both waits.
    for (let ms = 0; ms < 30_000; ms += 100) clock.advance(100);
    assert.equal(closed(), false);
    assert.equal(clock.pending, 1, "首页仍在等待目标页面");
    // The lobby is created (hidden for the city) and the city loads.
    controller.multiplayerOpening = false;
    controller.multiplayer = {};
    shell.current = "MultiplayerLobby";
    for (let ms = 0; ms < 5_000; ms += 100) clock.advance(100);
    assert.equal(closed(), false);
    // The city race is published over everything.
    shell.current = "MultiplayerRacing";
    clock.advance(16);
    assert.equal(closed(), true);
  } finally {
    clock.restore();
  }
});

test("首页卡丁城：大厅一直没画出来时，资源下完后 15 秒首页让开", () => {
  const clock = frames();
  try {
    const { controller, shell, closed } = homeOverReady();
    controller.multiplayerOpening = true;
    closeReadyHomeWhenCovered(controller);
    for (let ms = 0; ms < 20_000; ms += 100) clock.advance(100);
    controller.multiplayerOpening = false;
    controller.multiplayer = {};
    shell.current = "MultiplayerLobby";
    for (let ms = 0; ms < 14_000; ms += 100) clock.advance(100);
    assert.equal(closed(), false);
    for (let ms = 0; ms < 2_000; ms += 100) clock.advance(100);
    assert.equal(closed(), true);
  } finally {
    clock.restore();
  }
});

test("首页：点了却什么都没打开时首页留着", () => {
  const clock = frames();
  try {
    const { controller, closed } = homeOverReady();
    closeReadyHomeWhenCovered(controller);
    for (let ms = 0; ms < 20_000; ms += 100) clock.advance(100);
    assert.equal(closed(), false);
    assert.equal(clock.pending, 0);
  } finally {
    clock.restore();
  }
});
