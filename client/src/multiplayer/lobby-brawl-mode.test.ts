import assert from "node:assert/strict";
import test from "node:test";

import { BRAWL_TRACK_IDS } from "./brawl-tracks";
import { BRAWL_SLOTS, brawlAiIds, brawlGridForward, isBrawlRaceRules, roomSlotCount } from "./lobby-brawl-mode";
import { lobbyRiderSlots } from "./lobby-room-helpers";
import { RacePeerCadence } from "./race-peer-cadence";
import { bindRaceScope, type RaceSessionHost } from "./race-session";
import { isValidRoomSnapshot } from "./room-validation";
import { raceStartPosition, validateRaceStartGrid } from "../vehicle/race-start-slots";
import { resultRows } from "../ui/multiplayer-result-view";

type Fixture = Record<string, any>;
const equipment = (character = 1): Fixture => ({
  itemIds: Object.fromEntries([
    1, 2, 3, 4, 8, 9, 10, 11, 12, 16, 17, 18, 20, 21, 52, 26, 27, 30, 31,
    32, 36, 43, 45, 44, 46, 58, 59, 61, 70, 68, 69, 71, 76, 77, 78,
  ].map(slot => [slot, slot === 1 ? character : slot === 3 ? 1 : 0])),
  kartSerial: 0, valueAt3E: 0, exceedType: 0,
});
const member = (id: string, slot: number): Fixture => ({
  playerId: id, name: `Player ${id}`, slot, team: null, ready: true, equipment: equipment(),
});
const ai = (slot: number): Fixture => ({
  playerId: `ai${String(slot).padStart(2, "0")}-race0001`, name: `AI·${slot}`, slot, team: null,
  ready: true, equipment: { ...equipment(2), itemIds: { ...equipment(2).itemIds, 3: 0 }, systemKart: "practiceKart" },
  ai: true,
});

/** A 50人乱斗 room: players in seats 0.., AI in every other seat once racing. */
function brawlRoom(phase = "open", players = 2): Fixture {
  const members = Array.from({ length: players }, (_, index) => member(`p${index + 1}`, index));
  const value: Fixture = {
    roomId: "room-1", revision: 1, name: "乱斗", mode: "individual", capacity: BRAWL_SLOTS,
    speedVersion: "国服", channelName: "speedIndiCombine", speed: 7, gameplay: "brawl",
    resourceVersion: "p3553", hostId: "p1", phase, members, trackId: "village_R01",
  };
  if (phase !== "open") {
    const bots = Array.from({ length: BRAWL_SLOTS - players }, (_, index) => ai(players + index));
    value.race = {
      raceId: "race-1", channelName: "speedIndiCombine", gameplay: "brawl", trackId: "village_R01",
      loadingDeadline: 100, roster: [...structuredClone(members), ...bots],
      startSlots: Object.fromEntries([...members, ...bots].map(entry => [entry.playerId, entry.slot])),
      loadedIds: [...members.map(entry => entry.playerId), ...bots.map(entry => entry.playerId)],
      brawl: { ruleset: "web-brawl-v1", aiIds: bots.map(entry => entry.playerId) },
    };
    if (phase !== "loading") value.race.startAt = 200;
  }
  return value;
}

test("brawl rooms seat up to 50 and only they do", () => {
  assert.equal(roomSlotCount("brawl"), 50);
  assert.equal(roomSlotCount("ordinary"), 8);
  const open = brawlRoom();
  assert.ok(isValidRoomSnapshot(open));
  const seat49 = brawlRoom();
  seat49.members[1].slot = 49;
  seat49.closedSlots = [48, 30];
  assert.ok(isValidRoomSnapshot(seat49));
  const full = brawlRoom("open", 50);
  assert.ok(isValidRoomSnapshot(full));
  assert.equal(isValidRoomSnapshot({ ...brawlRoom(), capacity: 51 }), false);
  // Another gameplay keeps the release's eight seats.
  assert.equal(isValidRoomSnapshot({ ...brawlRoom(), gameplay: "ordinary", capacity: 50 }), false);
  const ordinary: Fixture = { ...brawlRoom(), gameplay: "ordinary", capacity: 8 };
  ordinary.members[1].slot = 8;
  assert.equal(isValidRoomSnapshot(ordinary), false);
  // A brawl room races on its track pool and on speedIndiCombine only.
  assert.equal(isValidRoomSnapshot({ ...brawlRoom(), trackId: "ice_I05" }), false);
  assert.equal(isValidRoomSnapshot({ ...brawlRoom(), channelName: "speedTeamCombine", mode: "team" }), false);
});

test("a brawl race roster carries its AI racers, never the room's members", () => {
  for (const phase of ["loading", "countdown", "racing"]) assert.ok(isValidRoomSnapshot(brawlRoom(phase)), phase);
  const withoutRules = brawlRoom("racing");
  delete withoutRules.race.brawl;
  assert.equal(isValidRoomSnapshot(withoutRules), false);
  const wrongIds = brawlRoom("racing");
  wrongIds.race.brawl.aiIds.pop();
  assert.equal(isValidRoomSnapshot(wrongIds), false);
  const aiMember = brawlRoom();
  aiMember.members.push(ai(2));
  assert.equal(isValidRoomSnapshot(aiMember), false);
  const ordinary = brawlRoom("racing");
  Object.assign(ordinary, { gameplay: "ordinary", capacity: 8 });
  assert.equal(isValidRoomSnapshot(ordinary), false);
  assert.deepEqual([...brawlAiIds(brawlRoom("racing").race)].length, 48);
  assert.ok(isBrawlRaceRules(brawlRoom("racing").race.brawl, brawlRoom("racing").race.roster));
});

test("brawl seats stay in seat order", () => {
  const room = brawlRoom();
  room.members[0].slot = 7;
  room.closedSlots = [3];
  room.capacity = 20;
  const slots = lobbyRiderSlots(room as never, "p1");
  assert.equal(slots.length, 50);
  assert.deepEqual(slots.slice(0, 8).map(slot => slot!.slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(slots[3]!.open, false);
  assert.equal(slots[19]!.open, true);
  assert.equal(slots[20]!.open, false);
  assert.equal(slots[7]!.member?.playerId, "p1");
});

test("the start grid repeats the release row 5 m back for each eight slots", () => {
  const origin = { x: 10, y: 1, z: -20 };
  const right = { x: 1, y: 0, z: 0 };
  const forward = brawlGridForward({ x: 0, y: 0.2, z: -2 });
  assert.deepEqual(forward, { x: 0, y: 0, z: -1 });
  const none = () => undefined;
  // Slots 0–7 are the release's whatever the forward.
  for (let slot = 0; slot < 8; slot++) {
    assert.deepEqual(raceStartPosition(origin, right, slot, none, forward),
      raceStartPosition(origin, right, slot, none));
  }
  assert.deepEqual(raceStartPosition(origin, right, 8, none, forward), { x: 10, y: 1, z: -15 });
  assert.deepEqual(raceStartPosition(origin, right, 49, none, forward), { x: 8, y: 1, z: 10 });
  assert.throws(() => raceStartPosition(origin, right, 8, none), /0至7/);
  assert.throws(() => raceStartPosition(origin, right, 50, none, forward), /0至49/);
  const grid = { roster: [{ playerId: "a" }, { playerId: "b" }], startSlots: { a: 0, b: 49 } };
  assert.throws(() => validateRaceStartGrid(grid), /越界/);
  validateRaceStartGrid(grid, 50);
});

test("result pages show the leaders and the local racer", () => {
  const results = Array.from({ length: 50 }, (_, index) => ({ playerId: `r${index}`, rank: index + 1 }));
  assert.deepEqual(resultRows(results, "r3").map(row => row.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(resultRows(results, "r40").map(row => row.rank), [1, 2, 3, 4, 5, 6, 7, 41]);
  assert.equal(resultRows(results.slice(0, 6), "r5").length, 6);
});

test("brawl motion goes to the node every beat, AI racers are senders only", () => {
  const room = brawlRoom("racing", 1);
  const cadence = new RacePeerCadence({ raceId: "race-1", gameplay: "brawl", roster: room.race.roster }, "p1", true);
  assert.equal(cadence.peers.size, 0);
  assert.equal(cadence.select(64, 0, false, { x: 0, y: 0, z: 0 }, () => undefined, () => false), 0xff);
  assert.equal(cadence.select(100, 0, false, { x: 0, y: 0, z: 0 }, () => undefined, () => false), 0);

  const host = { playerId: "p1", raceLatencies: new Map() } as unknown as RaceSessionHost;
  bindRaceScope(host, room as never);
  const scope = host.motionScope!;
  assert.equal(scope.recipientMask, 0xff);
  assert.equal(scope.players.get(49), room.race.roster[49].playerId);
  assert.ok(scope.members.has(room.race.roster[30].playerId));
});

test("the exported track pool is the validator's", () => {
  assert.ok(BRAWL_TRACK_IDS.length >= 20 && BRAWL_TRACK_IDS.includes("village_R01"));
});
