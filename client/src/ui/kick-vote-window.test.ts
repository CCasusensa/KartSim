import assert from "node:assert/strict";
import test from "node:test";

import type { KickVoteStatus } from "../multiplayer/lobby-kick-vote";
import { KICK_VOTE_DEFAULT_MS, kickVoteBarFraction, kickVoteRemainingMs, kickVoteRemainingText,
  kickVoteTextLines, kickVoteWindowDefinition, showKickVoteWindow } from "./kick-vote-window";
import type { Node } from "./bml-kit";

const status = (over: Partial<KickVoteStatus> = {}): KickVoteStatus =>
  ({ targetName: "工头", yes: 3, no: 2, eligible: 7, openedAt: 1000, deadlineAt: 11000, ...over });

test("the time left counts down from the deadline and the bar from when the window opened", () => {
  assert.equal(kickVoteRemainingMs(status(), 1000), 10000);
  assert.equal(kickVoteRemainingMs(status(), 6000), 5000);
  assert.equal(kickVoteRemainingMs(status(), 20000), 0);
  assert.equal(kickVoteRemainingText(status(), 5500), "剩余时间 6秒");
  assert.equal(kickVoteRemainingText(status(), 11000), "剩余时间 0秒");
  assert.equal(kickVoteBarFraction(status(), 1000), 1);
  assert.equal(kickVoteBarFraction(status(), 6000), 0.5);
  assert.equal(kickVoteBarFraction(status(), 12000), 0);
  // Without a clock sample the game node's 20 s stand in.
  const unknown = status({ deadlineAt: undefined });
  assert.equal(kickVoteRemainingMs(unknown, 1000), KICK_VOTE_DEFAULT_MS);
  assert.equal(kickVoteBarFraction(unknown, 11000), 0.5);
  assert.deepEqual(kickVoteTextLines("工头"), ["即将把 工头 踢出等待室。", "是否踢出将依投票结果决定。", "您是否同意？"]);
});

test("the window is a CaptionDialog with the board, 同意 as the focused ok button and 反对", () => {
  const names: string[] = [];
  const walk = (entry: Node): void => {
    for (const attribute of entry.attributes) if (attribute.name === "name") names.push(attribute.value);
    entry.children.forEach(walk);
  };
  const definition = kickVoteWindowDefinition();
  walk(definition);
  assert.deepEqual(names, ["voteWnd", "voteIcon", "voteText", "voteBoard", "okButton", "cancelButton",
    "okKey", "cancelKey"]);
  const dialog = definition.children[0]!;
  assert.equal(dialog.name, "CaptionWindow");
  assert.deepEqual(dialog.attributes.filter(entry => ["frame", "caption"].includes(entry.name)),
    [{ name: "frame", value: "CaptionDialog" }, { name: "caption", value: "踢出投票" }]);
  const buttons = dialog.children.filter(child => child.name === "Container").at(-1)!.children
    .filter(child => child.name === "TextButton");
  assert.deepEqual(buttons.map(button => button.attributes.find(entry => entry.name === "text")?.value),
    ["同意", "反对"]);
});

test("the window answers through the buttons and keys, redraws on a timer and stops it when disposed", async () => {
  const events: unknown[] = [];
  let state!: (entry: Node) => Record<string, unknown>;
  let options!: Record<string, unknown>;
  const view = {
    element: {}, render: () => events.push("render"), show: () => events.push("show"),
    focus: (name?: string) => events.push(["focus", name]), dispose: () => events.push("dispose"),
  };
  let tick: (() => void) | undefined;
  const window = await showKickVoteWindow(
    { library: {} as never, root: {} as never },
    () => status(), approve => events.push(["vote", approve]), () => 6000,
    async loaded => { options = loaded; state = loaded.state as typeof state; return view; },
    (callback, ms) => { tick = callback; events.push(["timer", ms]); return "timer"; },
    timer => events.push(["clear", timer]));
  assert.deepEqual(events, [["timer", 200], "show", ["focus", "okButton"]]);
  assert.equal(options.modal, true);
  assert.equal(options.label, "踢出投票");
  tick!();
  assert.equal(events.at(-1), "render");
  const ok = state({ name: "TextButton", attributes: [{ name: "name", value: "okButton" }], children: [] });
  const cancel = state({ name: "TextButton", attributes: [{ name: "name", value: "cancelButton" }], children: [] });
  assert.deepEqual([ok.disabled, ok.label, cancel.label], [false, "同意（Enter）", "反对（Esc）"]);
  (ok.action as () => void)();
  (options.onCancel as () => void)();
  assert.deepEqual(events.slice(-2), [["vote", true], ["vote", false]]);
  // Busy (the command is in flight): the buttons and keys wait.
  window.setBusy(true);
  (options.onConfirm as () => void)();
  (cancel.action as () => void)();
  assert.equal(state({ name: "TextButton", attributes: [{ name: "name", value: "okButton" }], children: [] }).disabled, true);
  assert.deepEqual(events.slice(-1), ["render"]);
  window.dispose();
  assert.deepEqual(events.slice(-2), [["clear", "timer"], "dispose"]);
});
