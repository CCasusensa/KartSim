#!/usr/bin/env node
// End-to-end check of the global lobby (GLOBAL_LOBBY.md) against a running
// cluster: kart-data plus at least one game node (kart-game or kart-node).
// No npm dependencies; Node.js 22+.
//
//   node test/lobby-smoke.mjs
//   KART_DATA_ORIGIN=http://127.0.0.1:8787 node test/lobby-smoke.mjs
//
// Two accounts meet in the data service's lobby (/multiplayer/lobby/ws),
// make a room and start it. The lobby sends both the node it picked for the
// room (race-host) with a ticket; they race there with the same player IDs,
// a third player cannot join the room meanwhile, and once both are back in
// the room the node returns it: it reappears in the lobby, open, with a
// newer revision. The race settles on the data service as usual. Finally
// one player enters the 卡丁城 on the node the lobby assigns (city-host).
//
// Run the node with KART_ANTICHEAT=log: the script finishes at once.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ControlSocket, createPlayer, discoverCluster, expectSettlement, helloFields, httpOk, readSettings,
  websocketUrl,
} from "./lib/kart-client.mjs";

const settings = readSettings();
const { dataOrigin } = settings;
const suffix = randomBytes(4).toString("hex");
const cluster = await discoverCluster(settings);
const lobbyUrl = `${dataOrigin.replace(/^http/, "ws")}/multiplayer/lobby/ws`;
console.log(`Data service ${dataOrigin} (${cluster.dataNode}); game nodes: ` +
  cluster.servers.map(server => `${server.nodeId}@${server.connectOrigin}`).join(", "));

/** Enters the global lobby with a lobby ticket. */
async function enterLobby(player) {
  const ticket = await httpOk(dataOrigin, "/multiplayer/lobby/ticket", { method: "POST", body: {},
    token: player.token, headers: player.headers, timeoutMs: cluster.timeoutMs });
  assert.equal(ticket.nodeId, "lobby");
  const control = await ControlSocket.connect(lobbyUrl, { timeoutMs: cluster.timeoutMs, label: `${player.nickname}@lobby` });
  const welcome = await control.request(helloFields(player.nickname, ticket.ticket, player.equipment));
  assert.equal(welcome.type, "welcome");
  return { control, playerId: welcome.playerId, player };
}

/** Connects to the node a race-host or city-host names. */
async function enterNode(lobby, host) {
  const origin = host.origin ?? dataOrigin;
  const control = await ControlSocket.connect(websocketUrl(origin),
    { timeoutMs: cluster.timeoutMs, label: `${lobby.player.nickname}@${host.nodeId}` });
  const welcome = await control.request(helloFields(lobby.player.nickname, host.ticket, lobby.player.equipment));
  assert.equal(welcome.type, "welcome");
  assert.equal(welcome.playerId, lobby.playerId, "the node keeps the lobby's player ID");
  return control;
}

const aliceAccount = await createPlayer(cluster, `LobA${suffix}`, { starter: { character: 2, paint: 6, dye: 4 } });
const bobAccount = await createPlayer(cluster, `LobB${suffix}`, { starter: { character: 3, paint: 5, dye: 7 } });
const carolAccount = await createPlayer(cluster, `LobC${suffix}`);
const alice = await enterLobby(aliceAccount);
const bob = await enterLobby(bobAccount);
const carol = await enterLobby(carolAccount);
const sockets = [alice.control, bob.control, carol.control];
try {
  console.log("✓ three accounts in the global lobby");
  const latency = Object.fromEntries(cluster.servers.map((server, index) => [server.nodeId, 20 + index * 50]));
  for (const lobby of [alice, bob]) await lobby.control.request({ type: "node-latency", latency });

  const roomName = `Lobby${suffix}`;
  const created = await alice.control.request({ type: "create", name: roomName, capacity: 4, password: "",
    channelName: "speedIndiCombine", gameplay: "ordinary", mode: "individual", speed: 7, speedVersion: "国服",
    equipment: aliceAccount.equipment });
  const roomId = created.room.roomId;
  const listed = await carol.control.request({ type: "list-ordinary", page: 0 });
  assert.ok(listed.rooms.some(room => room.roomId === roomId), "the room is listed to every lobby player");
  const joined = await bob.control.request({ type: "join", roomId, password: "", equipment: bobAccount.equipment });
  const ready = await bob.control.request({ type: "ready", roomId, revision: joined.room.revision, ready: true });
  const started = await alice.control.request({ type: "start", roomId, revision: ready.room.revision });
  assert.equal(started.room.phase, "open", "the lobby does not race itself");

  const aliceHost = await alice.control.waitFor(message => message.type === "race-host", "race-host");
  const bobHost = await bob.control.waitFor(message => message.type === "race-host", "race-host");
  assert.equal(aliceHost.roomId, roomId);
  assert.equal(aliceHost.nodeId, bobHost.nodeId, "one node for the whole room");
  assert.equal(aliceHost.nodeId, cluster.servers[0].nodeId, "the node with the lowest latency");
  console.log(`✓ start handed the room to ${aliceHost.nodeId} (${aliceHost.name})`);

  const away = await carol.control.send({ type: "join", roomId, password: "", equipment: carolAccount.equipment });
  assert.equal(away.code, "ROOM_RACING");
  const gaming = await carol.control.request({ type: "list-ordinary", page: 0 });
  assert.equal(gaming.rooms.find(room => room.roomId === roomId).gaming, true);

  const aliceNode = await enterNode(alice, aliceHost);
  sockets.push(aliceNode);
  const firstRoom = await aliceNode.waitFor(message => message.type === "room", "room on the node");
  assert.equal(firstRoom.room.phase, "loading");
  assert.ok(firstRoom.room.revision > started.room.revision, "the node's revision goes on from the lobby's");
  const bobNode = await enterNode(bob, bobHost);
  sockets.push(bobNode);
  const raceId = firstRoom.room.race.raceId;
  await aliceNode.request({ type: "loaded", roomId, raceId });
  await bobNode.request({ type: "loaded", roomId, raceId });
  await aliceNode.waitFor(message => message.type === "room" && message.room?.phase === "racing", "racing phase");
  await aliceNode.request({ type: "finish", roomId, raceId, elapsedMs: 61_000 });
  const finished = await bobNode.request({ type: "finish", roomId, raceId, elapsedMs: 62_000 });
  assert.equal(finished.room.phase, "finished");
  await aliceNode.request({ type: "return-room", roomId, raceId });
  await bobNode.request({ type: "return-room", roomId, raceId });
  await bobNode.waitFor(message => message.type === "room-home", "room-home from the node");
  console.log(`✓ raced on ${aliceHost.nodeId} and returned to the room`);

  // (Earlier pushes of the room, from before the start, are still queued.)
  const back = await alice.control.waitFor(message => message.type === "room" && message.room?.roomId === roomId &&
    message.room?.phase === "open" && message.room.revision > started.room.revision, "the room back in the lobby");
  assert.equal(back.room.members.length, 2);
  assert.ok(back.room.revision > finished.room.revision);
  const listedAgain = await carol.control.request({ type: "list-ordinary", page: 0 });
  assert.equal(listedAgain.rooms.find(room => room.roomId === roomId).gaming, false);
  await bob.control.request({ type: "ready", roomId, revision: back.room.revision, ready: true });
  console.log("✓ the room came back to the lobby; the players can ready again");

  await expectSettlement(cluster, { raceId, roomId, gameplay: "ordinary", timeoutMs: settings.settleMs,
    racers: [
      { name: aliceAccount.nickname, playerId: alice.playerId, rank: 1, elapsedMs: 61_000, points: 10 },
      { name: bobAccount.nickname, playerId: bob.playerId, rank: 2, elapsedMs: 62_000, points: 8 },
    ] });
  console.log("✓ the node settled the race with the data service");

  const cityHost = await carol.control.request({ type: "city-host" });
  assert.equal(cityHost.type, "city-host");
  const cityNode = await enterNode(carol, cityHost);
  sockets.push(cityNode);
  const city = await cityNode.request({ type: "city-join" });
  assert.equal(city.type, "city");
  await cityNode.request({ type: "city-leave" });
  console.log(`✓ the city on ${cityHost.nodeId}`);

  for (const socket of [alice.control, bob.control, carol.control]) await socket.drain();
  console.log("PASS: global lobby smoke test");
} finally {
  for (const socket of sockets) socket.close();
}
