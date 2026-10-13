#!/usr/bin/env node
// A practice racer for the global lobby (GLOBAL_LOBBY.md), for trying the
// browser client with a second player. It registers an account, enters the
// data service's lobby, joins the first open room it finds (or the one named
// with --room), readies, and when the host starts it follows the room to its
// game node: it loads, "finishes" after --seconds, returns to the room and
// readies again once the room is back in the lobby. Ctrl-C stops it.
//
//   KART_DATA_ORIGIN=http://127.0.0.1:8787 node test/lobby-bot.mjs [--room 名字] [--seconds 40]
//
// It sends no motion frames: its kart stays on the start line. Run the node
// with KART_ANTICHEAT=log, or the anti-cheat removes it at the finish.
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  ControlSocket, createPlayer, discoverCluster, helloFields, httpOk, readSettings, websocketUrl,
} from "./lib/kart-client.mjs";

const { values: args } = parseArgs({ options: {
  room: { type: "string" }, seconds: { type: "string", default: "40" }, name: { type: "string" },
} });
const settings = readSettings();
const cluster = await discoverCluster(settings);
const player = await createPlayer(cluster, args.name ?? `陪练${randomBytes(2).toString("hex")}`);
const ticket = await httpOk(settings.dataOrigin, "/multiplayer/lobby/ticket", { method: "POST", body: {},
  token: player.token, headers: player.headers });
const lobby = await ControlSocket.connect(`${settings.dataOrigin.replace(/^http/, "ws")}/multiplayer/lobby/ws`,
  { timeoutMs: 600_000, label: "lobby" });
const welcome = await lobby.request(helloFields(player.nickname, ticket.ticket, player.equipment));
const playerId = welcome.playerId;
console.log(`${player.nickname} is in the lobby (${playerId})`);

// Join a room.
let room;
while (!room) {
  for (const channel of ["list-ordinary", "list-gameplay"]) {
    const gameplays = channel === "list-ordinary" ? [undefined] : ["item", "brawl"];
    for (const gameplay of gameplays) {
      const list = await lobby.request({ type: channel, page: 0, ...(gameplay ? { gameplay } : {}) });
      const candidate = list.rooms.find(entry => !entry.gaming && !entry.locked && entry.count < entry.capacity &&
        (!args.room || entry.name.includes(args.room)));
      if (!candidate) continue;
      const joined = await lobby.send({ type: "join", roomId: candidate.roomId, password: "", equipment: player.equipment });
      if (joined.type === "room") room = joined.room;
      if (room) break;
    }
    if (room) break;
  }
  if (!room) await delay(2000);
}
console.log(`joined ${room.name}`);

async function ready(current) {
  const reply = await lobby.send({ type: "ready", roomId: current.roomId, revision: current.revision, ready: true });
  if (reply.type === "room") console.log("ready");
  else console.log(`ready refused: ${reply.code}`);
}
await ready(room);

for (;;) {
  const host = await lobby.waitFor(message => message.type === "race-host" ||
    (message.type === "left" && message.roomId === room.roomId), "race-host");
  if (host.type === "left") {
    console.log("removed from the room");
    process.exit(0);
  }
  console.log(`racing on ${host.nodeId} (${host.name})`);
  const node = await ControlSocket.connect(websocketUrl(host.origin ?? settings.dataOrigin),
    { timeoutMs: 600_000, label: host.nodeId });
  try {
    await node.request(helloFields(player.nickname, host.ticket, player.equipment));
    const loading = await node.waitFor(message => message.type === "room" && message.room?.race, "race");
    const { roomId } = loading.room;
    const { raceId } = loading.room.race;
    await node.request({ type: "loaded", roomId, raceId });
    await node.waitFor(message => message.type === "room" && message.room?.phase === "racing", "racing");
    await delay(Number(args.seconds) * 1000);
    await node.send({ type: "finish", roomId, raceId, elapsedMs: Number(args.seconds) * 1000 });
    await node.waitFor(message => message.type === "room" && message.room?.phase === "finished", "results");
    await delay(8000);
    await node.send({ type: "return-room", roomId, raceId });
    // Like the browser, keep the node connection until the room went home.
    await node.waitFor(message => message.type === "room-home", "room-home");
  } catch (error) {
    console.log(`race: ${error.message}`);
  } finally {
    node.close();
  }
  const back = await lobby.waitFor(message => message.type === "room" && message.room?.roomId === room.roomId &&
    message.room?.phase === "open" && !lobby.events.some(later => later.type === "room" &&
      later.room?.revision > message.room.revision), "the room back in the lobby");
  room = back.room;
  console.log("back in the lobby room");
  await ready(room);
}
