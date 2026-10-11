import assert from "node:assert/strict";
import test from "node:test";

import type { LobbyRoom } from "./lobby-actions";
import { kickVoteDialogFactory, kickVoteStatus, type KickVoteDialog } from "./lobby-kick-vote";

function room(): LobbyRoom {
  return { roomId: "room-1", revision: 4, name: "Room", phase: "open", speed: 7, hostId: "host",
    mode: "individual", members: [
      { playerId: "host", name: "Host", slot: 0, ready: false, team: null },
      { playerId: "me", name: "Me", slot: 1, ready: false, team: null },
      { playerId: "target", name: "工头", slot: 2, ready: false, team: null },
    ], kickVote: { voteId: "vote-1", targetId: "target", eligibleIds: ["host", "me"],
      yesIds: ["host"], noIds: [], deadline: 50_000 } } as unknown as LobbyRoom;
}

test("the status names the target, counts the votes and maps the deadline to the local clock", () => {
  const clock = { offsetMs: 40_000, roundTripMs: 20, sampledAt: 900 };
  assert.deepEqual(kickVoteStatus(room(), "vote-1", 1000, clock),
    { targetName: "工头", yes: 1, no: 0, eligible: 2, openedAt: 1000, deadlineAt: 10_000 });
  // No clock sample yet: the window falls back to the vote's default length.
  assert.equal(kickVoteStatus(room(), "vote-1", 1000, undefined)?.deadlineAt, undefined);
  // Another vote, no vote, or a target that left: the window has nothing to show.
  assert.equal(kickVoteStatus(room(), "vote-2", 1000, clock), undefined);
  assert.equal(kickVoteStatus({ ...room(), kickVote: undefined }, "vote-1", 1000, clock), undefined);
  const gone = room();
  gone.members = gone.members.filter(member => member.playerId !== "target");
  assert.equal(kickVoteStatus(gone, "vote-1", 1000, clock), undefined);
  assert.equal(kickVoteStatus(undefined, "vote-1", 1000, clock), undefined);
});

test("the factory opens the window on the current vote and answers through the confirm box's callbacks", async () => {
  const events: unknown[] = [];
  const host = { state: { room: room() }, client: { captureClock: () => ({ offsetMs: 40_000 }) } };
  let status!: () => unknown;
  let vote!: (approve: boolean) => void;
  const dialog: KickVoteDialog = { dispose: () => events.push("dispose"), setBusy: () => {} };
  const factory = kickVoteDialogFactory(host, (options, read, answer) => {
    events.push(["open", options.library]);
    status = read;
    vote = answer;
    return dialog;
  }, () => 1000);
  const opened = await factory({ library: "lib", cancel: () => events.push("cancel") }, "踢人投票", "msg",
    () => events.push("confirm"), { yes: "同意", no: "反对" });
  assert.equal(opened, dialog);
  assert.deepEqual(status(), { targetName: "工头", yes: 1, no: 0, eligible: 2, openedAt: 1000, deadlineAt: 10_000 });
  host.state.room!.kickVote!.noIds = ["me"];
  assert.equal((status() as { no: number }).no, 1);
  vote(true);
  vote(false);
  assert.deepEqual(events, [["open", "lib"], "confirm", "cancel"]);
});
