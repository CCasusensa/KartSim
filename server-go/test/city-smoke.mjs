#!/usr/bin/env node
// End-to-end check of 卡丁城 (CITY.md) against an already running cluster
// (kart-data plus at least one kart-game node with KART_CITY on), e.g.
// started by ../run-full-local.sh. No npm dependencies; Node.js 22+.
//
//   node test/city-smoke.mjs
//   KART_DATA_ORIGIN=http://127.0.0.1:8787 KART_GAME_NODE=game-8788 node test/city-smoke.mjs
//
// Two accounts enter one node with Bearer tickets (registered like
// smoke.mjs, or taken from KART_SMOKE_ACCOUNTS), join the same city line,
// and the script checks: the snapshot, city-joined, rooms refused with
// IN_CITY, a respawn, near chat, an emote, a 0xC1 motion frame relayed
// with the sender's id, the 0xC2 radar packet, city-leave and city-left,
// and that a room can be created afterwards. Other settings as smoke.mjs
// (KART_SMOKE_TIMEOUT_MS, KART_SMOKE_FORWARDED_FOR=0).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createPlayer, discoverCluster, enterGame, readSettings } from "./lib/kart-client.mjs";

const settings = readSettings();
const suffix = randomBytes(4).toString("hex");
const cluster = await discoverCluster(settings);
const [node] = cluster.servers;
console.log(`Data service ${settings.dataOrigin} (${cluster.dataNode}); city smoke on ${node.nodeId}`);

const CITY_MOTION = 0xc1;
const CITY_RADAR = 0xc2;

/** Collects the binary frames a socket receives (CITY.md 3). */
class BinaryInbox {
  constructor(control) {
    this.frames = [];
    this.waiters = new Set();
    this.label = control.label;
    this.timeoutMs = control.timeoutMs;
    control.socket.binaryType = "arraybuffer";
    control.socket.addEventListener("message", event => {
      if (typeof event.data === "string") return;
      const frame = new Uint8Array(event.data);
      const waiter = [...this.waiters].find(entry => entry.predicate(frame));
      if (waiter) waiter.resolve(frame);
      else this.frames.push(frame);
    });
  }

  waitFor(predicate, description) {
    const found = this.frames.findIndex(predicate);
    if (found >= 0) return Promise.resolve(this.frames.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: frame => { clearTimeout(timer); this.waiters.delete(waiter); resolve(frame); },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`${this.label}: timed out waiting for ${description}`));
      }, this.timeoutMs);
      this.waiters.add(waiter);
    });
  }
}

/**
 * A city motion frame of kind 2 (an 80-byte kinematic payload) at world
 * x/y/z: the wire position is (x, -z, y) of the browser's y-up world and
 * the quaternion is w, x, y, z (identity here: facing south).
 */
function cityMotionFrame(sequence, { x, y, z }) {
  const frame = new Uint8Array(8 + 80);
  const view = new DataView(frame.buffer);
  frame[0] = CITY_MOTION;
  frame[1] = 2;
  view.setUint16(2, 0, true);
  view.setUint32(4, sequence >>> 0, true);
  view.setUint32(8, Date.now() % 0xffff_ffff, true);
  view.setFloat32(8 + 4, x, true);
  view.setFloat32(8 + 8, -z, true);
  view.setFloat32(8 + 12, y, true);
  view.setFloat32(8 + 16, 1, true);
  return frame;
}

function assertClock(clock) {
  assert.ok(Number.isFinite(clock.serverTick) && clock.serverTick >= 0, "clock.serverTick");
  assert.ok(clock.timeOfDay >= 0 && clock.timeOfDay < 1, "clock.timeOfDay");
  assert.ok(Number.isSafeInteger(clock.dayLengthMs) && clock.dayLengthMs > 0, "clock.dayLengthMs");
  assert.ok(["clear", "rain", "snow"].includes(clock.weather), `clock.weather ${clock.weather}`);
  assert.ok(Number.isFinite(clock.weatherUntilTick), "clock.weatherUntilTick");
}

function assertMember(member) {
  assert.ok(Number.isInteger(member.id) && member.id >= 1 && member.id <= 65535, "member.id");
  assert.ok(typeof member.playerId === "string" && member.playerId.length > 0, "member.playerId");
  assert.ok(typeof member.name === "string" && member.name.length > 0, "member.name");
  assert.ok(member.equipment && typeof member.equipment.itemIds === "object", "member.equipment");
  assert.ok(["driving", "parked", "afk"].includes(member.state), `member.state ${member.state}`);
  for (const key of ["x", "y", "z", "heading"]) assert.ok(Number.isFinite(member.pose[key]), `member.pose.${key}`);
}

const aliceAccount = await createPlayer(cluster, `CityA${suffix}`, { starter: { character: 2, paint: 6, dye: 4 } });
const bobAccount = await createPlayer(cluster, `CityB${suffix}`, { starter: { character: 3, paint: 5, dye: 7 } });
console.log(`✓ accounts ${aliceAccount.nickname}, ${bobAccount.nickname} ready with their starter kits`);

const alice = await enterGame(cluster, node, aliceAccount);
const bob = await enterGame(cluster, node, bobAccount);
try {
  const aliceFrames = new BinaryInbox(alice.control);
  const bobFrames = new BinaryInbox(bob.control);

  const city = await alice.control.request({ type: "city-join" });
  assert.equal(city.type, "city");
  assert.match(city.instanceId, /^city-\d+$/);
  assert.ok(Number.isInteger(city.line) && city.line >= 1);
  assert.equal(city.instanceId, `city-${city.line}`);
  assert.ok(typeof city.name === "string" && city.name.length > 0);
  assert.ok(Number.isInteger(city.capacity) && city.capacity >= 2);
  assertClock(city.clock);
  assert.ok(Number.isInteger(city.you.id) && city.you.id >= 1);
  assert.equal(typeof city.you.spawn.id, "string");
  for (const key of ["x", "y", "z", "heading"]) assert.ok(Number.isFinite(city.you.spawn[key]), `spawn.${key}`);
  assert.ok(Array.isArray(city.members) && city.members.length >= 1);
  city.members.forEach(assertMember);
  const me = city.members.find(member => member.playerId === alice.welcome.playerId);
  assert.ok(me && me.id === city.you.id, "the snapshot lists the newcomer");
  assert.deepEqual({ x: me.pose.x, y: me.pose.y, z: me.pose.z, heading: me.pose.heading },
    { x: city.you.spawn.x, y: city.you.spawn.y, z: city.you.spawn.z, heading: city.you.spawn.heading });
  console.log(`✓ ${aliceAccount.nickname} entered ${city.name} (${city.instanceId}) as member ${city.you.id} ` +
    `at ${city.you.spawn.id}; ${city.clock.weather}, timeOfDay ${city.clock.timeOfDay.toFixed(3)}`);

  // The same line for Bob; Alice hears him come in.
  const joined = await bob.control.request({ type: "city-join", line: city.line });
  assert.equal(joined.instanceId, city.instanceId);
  assert.notEqual(joined.you.id, city.you.id);
  assert.ok(joined.members.some(member => member.id === city.you.id), "Bob's snapshot lists Alice");
  const arrival = await alice.control.waitFor(message => message.type === "city-joined" &&
    message.member?.playerId === bob.welcome.playerId, "city-joined");
  assert.equal(arrival.instanceId, city.instanceId);
  assertMember(arrival.member);
  assert.equal(arrival.member.id, joined.you.id);

  // Rooms and the city exclude each other.
  await alice.control.expectError({
    type: "create", name: `City${suffix}`, capacity: 2, password: "", channelName: "speedIndiCombine",
    gameplay: "ordinary", mode: "individual", speed: 7, speedVersion: "国服", equipment: aliceAccount.equipment,
  }, "IN_CITY");
  await alice.control.expectError({ type: "city-join", line: 0 }, "INVALID_LINE");
  console.log("✓ city-joined broadcast; create refused with IN_CITY");

  // Bob respawns beside Alice; she sees the respawn (he is in range).
  const spawnPose = { x: city.you.spawn.x, y: city.you.spawn.y, z: city.you.spawn.z, heading: 90 };
  const respawned = await bob.control.request({ type: "city-respawn", pose: spawnPose });
  assert.equal(respawned.type, "ok");
  const reset = await alice.control.waitFor(message => message.type === "city-respawn" &&
    message.id === joined.you.id, "city-respawn");
  assert.deepEqual(reset.pose, spawnPose);
  await bob.control.expectError({ type: "city-respawn", spawn: "spawn-nowhere" }, "INVALID_SPAWN");

  // Near chat and an emote reach the neighbour.
  const sent = await alice.control.request({ type: "city-chat", text: "你好，卡丁城", channel: "near" });
  assert.equal(sent.type, "ok");
  const line = await bob.control.waitFor(message => message.type === "city-chat" &&
    message.playerId === alice.welcome.playerId, "city-chat");
  assert.equal(line.instanceId, city.instanceId);
  assert.equal(line.id, city.you.id);
  assert.equal(line.name, aliceAccount.nickname);
  assert.equal(line.channel, "near");
  assert.equal(line.text, "你好，卡丁城");
  assert.ok(Number.isInteger(line.sequence) && line.sequence >= 1);
  await alice.control.expectError({ type: "city-chat", text: "", channel: "near" }, "INVALID_TEXT");
  await alice.control.expectError({ type: "city-chat", text: "hi", channel: "club" }, "INVALID_CHANNEL");
  await alice.control.request({ type: "city-emote", emote: 2 });
  const emote = await bob.control.waitFor(message => message.type === "city-emote" &&
    message.id === city.you.id, "city-emote");
  assert.equal(emote.emote, 2);
  await alice.control.expectError({ type: "city-emote", emote: 17 }, "INVALID_EMOTE");
  await bob.control.request({ type: "city-state", state: "parked" });
  const parked = await alice.control.waitFor(message => message.type === "city-state" &&
    message.id === joined.you.id, "city-state");
  assert.equal(parked.state, "parked");
  console.log("✓ respawn, near chat, emote and state events");

  // A motion frame from Alice at her spawn reaches Bob (next to her) with
  // her member id stamped; the radar packet lists both.
  const frame = cityMotionFrame(2, city.you.spawn);
  alice.control.socket.send(frame);
  const relayed = await bobFrames.waitFor(received => received[0] === CITY_MOTION, "a relayed city motion frame");
  const relayedView = new DataView(relayed.buffer, relayed.byteOffset, relayed.byteLength);
  assert.equal(relayed.length, frame.length);
  assert.equal(relayed[1], 2);
  assert.equal(relayedView.getUint16(2, true), city.you.id, "the node stamps the sender's id");
  assert.equal(relayedView.getUint32(4, true), 2);
  assert.deepEqual([...relayed.subarray(8)], [...frame.subarray(8)], "the payload is relayed untouched");
  const radar = await bobFrames.waitFor(received => received[0] === CITY_RADAR && received.length >= 4 + 7 * 2,
    "a radar packet with both members");
  const radarView = new DataView(radar.buffer, radar.byteOffset, radar.byteLength);
  const count = radarView.getUint16(2, true);
  assert.equal(radar.length, 4 + 7 * count);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const at = 4 + 7 * i;
    entries.set(radarView.getUint16(at, true), {
      x: radarView.getInt16(at + 2, true) / 4, z: radarView.getInt16(at + 4, true) / 4,
      heading: radar[at + 6] / 256 * 360,
    });
  }
  assert.ok(entries.has(city.you.id) && entries.has(joined.you.id), `radar lists ${[...entries.keys()]}`);
  const aliceOnRadar = entries.get(city.you.id);
  assert.ok(Math.abs(aliceOnRadar.x - city.you.spawn.x) <= 0.25 && Math.abs(aliceOnRadar.z - city.you.spawn.z) <= 0.25,
    `radar position ${JSON.stringify(aliceOnRadar)} vs spawn ${JSON.stringify(city.you.spawn)}`);
  assert.ok(Math.abs(entries.get(joined.you.id).heading - 90) < 2, "Bob's radar heading");
  // Alice sent a frame but received none: her own frame is not echoed.
  assert.equal(aliceFrames.frames.filter(received => received[0] === CITY_MOTION).length, 0);
  console.log(`✓ motion frame relayed with id ${city.you.id}; radar packet lists ${count} members`);

  // Leaving: Bob hears it, Alice can open a room, and Bob's disconnect
  // leaves too.
  const left = await alice.control.request({ type: "city-leave" });
  assert.equal(left.type, "city-left");
  const departure = await bob.control.waitFor(message => message.type === "city-left" &&
    message.playerId === alice.welcome.playerId, "city-left");
  assert.equal(departure.id, city.you.id);
  await alice.control.expectError({ type: "city-leave" }, "NOT_IN_CITY");
  const created = await alice.control.request({
    type: "create", name: `City${suffix}`, capacity: 2, password: "", channelName: "speedIndiCombine",
    gameplay: "ordinary", mode: "individual", speed: 7, speedVersion: "国服", equipment: aliceAccount.equipment,
  });
  assert.equal(created.type, "room");
  await alice.control.expectError({ type: "city-join" }, "IN_ROOM");
  await alice.control.request({ type: "leave", roomId: created.room.roomId, revision: created.room.revision });
  console.log("✓ city-leave, city-left, a room after leaving, IN_ROOM from a room");

  await alice.control.drain();
  await bob.control.drain();
  console.log("PASS: 卡丁城 join, chat, motion relay, radar and leave");
} finally {
  alice.control.close();
  bob.control.close();
}
