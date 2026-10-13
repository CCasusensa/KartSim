import assert from "node:assert/strict";
import test from "node:test";
import { websocketUrlForOffer } from "./client-websocket";
import { enterRaceHost, reportNodeLatency, roomCameHome, type NodeClient,
  type RaceHostLobby } from "./race-host";
import { parseServerEvent } from "./server-events";

class FakeClient implements NodeClient {
  listeners: ((event: any) => void)[] = [];
  closers: (() => void)[] = [];
  requests: Record<string, unknown>[] = [];
  connected?: { url: string; ticket?: string };
  disposed = false;
  constructor(private readonly welcome: () => Promise<{ type: string; playerId?: string }>) {}
  connect(url: string, _name: string, _version: string, _equipment: unknown, _initial: string,
    _raceRuntime: boolean, ticket: string | undefined) {
    this.connected = { url, ticket };
    return this.welcome();
  }
  subscribe(listener: (event: any) => void) { this.listeners.push(listener); return () => {}; }
  onClose(listener: () => void) { this.closers.push(listener); return () => {}; }
  request(command: Record<string, unknown>) { this.requests.push(command); return Promise.resolve({ type: "ok" }); }
  dispose() { this.disposed = true; for (const close of this.closers) close(); }
  push(event: unknown) { for (const listener of this.listeners) listener(event); }
}

function lobbyHost(welcome = () => Promise.resolve({ type: "welcome", playerId: "p-1" })) {
  const lobby = new FakeClient(welcome);
  const created: FakeClient[] = [];
  const received: unknown[] = [];
  const statuses: [string, boolean | undefined][] = [];
  let resets = 0;
  const host: RaceHostLobby = {
    client: lobby, lobbyClient: lobby, playerId: "p-1", accountNickname: "Alice", disposed: false,
    state: { room: { roomId: "room-1" } },
    startCoordinator: { reset: () => { resets++; } },
    options: { version: "p3553", initial: "", initialEquipment: { kart: 1 }, raceLoader: {},
      status: (message, error) => statuses.push([message, error]) },
    nodeDependencies: {
      createClient: () => { const client = new FakeClient(welcome); created.push(client); return client; },
      pageUrl: () => "https://kart.example/",
      endpoint: (path, page) => new URL(`/multiplayer/${path}`, page).href,
    },
    receive: event => { received.push(event); },
    render: () => {},
  };
  return { host, lobby, created, received, statuses, resets: () => resets };
}

const assignment = { roomId: "room-1", nodeId: "node-a", name: "华东一区",
  origin: "https://game1.example", ticket: "kt1.abc.def" };

test("a race moves the room commands to the node and back home", async () => {
  const { host, lobby, created, received } = lobbyHost();
  await enterRaceHost(host, assignment);
  const node = created[0]!;
  assert.equal(host.client, node);
  assert.deepEqual(node.connected, { url: "https://game1.example/multiplayer/offer", ticket: "kt1.abc.def" });

  const loading = { type: "room", room: { roomId: "room-1", phase: "loading" } };
  node.push(loading);
  // The node's own open snapshot is skipped: the lobby's comes instead.
  node.push({ type: "room", room: { roomId: "room-1", phase: "open" } });
  node.push({ type: "room-home", roomId: "room-1" });
  assert.deepEqual(received, [loading]);
  node.dispose(); // the node closes the session: expected
  assert.equal(host.client, lobby);
  assert.equal(host.raceClient, undefined);

  // A second race, ended by the lobby's snapshot of the room.
  await enterRaceHost(host, assignment);
  const second = created[1]!;
  roomCameHome(host, "room-1");
  assert.equal(host.client, lobby);
  assert.equal(second.disposed, true);
});

test("losing the node mid-race leaves the room and says so", async () => {
  const { host, lobby, created, received, statuses, resets } = lobbyHost();
  await enterRaceHost(host, assignment);
  const node = created[0]!;
  node.push({ type: "error", code: "CHEAT_DETECTED", check: "SPEED" });
  node.dispose();
  assert.equal(host.client, lobby);
  assert.equal(resets(), 1);
  assert.deepEqual(lobby.requests, [{ type: "leave", roomId: "room-1" }]);
  assert.deepEqual(received.at(-1), { type: "left", roomId: "room-1", requestId: "race-lost" });
  assert.match(statuses.at(-1)![0], /移动速度异常/);
});

test("leaving the race on the node leaves the lobby room too", async () => {
  const { host, lobby, created } = lobbyHost();
  await enterRaceHost(host, assignment);
  created[0]!.push({ type: "left", roomId: "room-1", requestId: "r9" });
  assert.equal(host.client, lobby);
  assert.deepEqual(lobby.requests, [{ type: "leave", roomId: "room-1" }]);
});

test("a node that cannot be reached leaves the player in the lobby room", async () => {
  const { host, lobby, statuses } = lobbyHost(() => Promise.reject(new Error("WebSocket connection failed")));
  host.lobbyClient = lobby;
  await enterRaceHost(host, assignment);
  assert.equal(host.client, lobby);
  assert.equal(host.raceClient, undefined);
  assert.match(statuses.at(-1)![0], /无法连接比赛服务器「华东一区」/);
  assert.equal(statuses.at(-1)![1], true);
});

test("race-host for another room is ignored", async () => {
  const { host, created } = lobbyHost();
  await enterRaceHost(host, { ...assignment, roomId: "room-2" });
  assert.equal(created.length, 0);
});

test("the lobby learns the round trip to each node", async () => {
  const { host, lobby } = lobbyHost();
  const fetched: string[] = [];
  host.nodeDependencies!.fetch = (async (url: string) => {
    fetched.push(url);
    if (url.endsWith("/multiplayer/game-servers")) {
      return new Response(JSON.stringify({ dataNode: "data-1", servers: [
        { nodeId: "node-a", name: "A", origin: "https://a.example", players: 0, rooms: 0, capacity: 10, full: false },
        { nodeId: "node-b", name: "B", origin: null, players: 0, rooms: 0, capacity: 10, full: false },
        { nodeId: "node-c", name: "C", origin: "https://down.example", players: 0, rooms: 0, capacity: 10, full: false },
      ] }));
    }
    if (url.startsWith("https://down.example")) throw new TypeError("unreachable");
    return new Response("{}");
  }) as typeof fetch;
  await reportNodeLatency(host);
  const report = lobby.requests[0] as { type: string; latency: Record<string, number> };
  assert.equal(report.type, "node-latency");
  assert.deepEqual(Object.keys(report.latency).sort(), ["node-a", "node-b"]);
  assert.ok(fetched.includes("https://kart.example/multiplayer/healthz"));
});

test("the lobby socket and its events", () => {
  assert.equal(websocketUrlForOffer("https://kart.example/multiplayer/lobby/offer"),
    "wss://kart.example/multiplayer/lobby/ws");
  assert.equal(websocketUrlForOffer("http://10.0.0.1:8788/multiplayer/offer"), "ws://10.0.0.1:8788/multiplayer/ws");
  const validation = { validRoom: () => true, validChannel: () => true, validGameplay: () => true,
    validRandomTrackCode: () => true };
  assert.ok(parseServerEvent({ type: "race-host", ...assignment }, validation));
  assert.ok(parseServerEvent({ type: "race-host", ...assignment, origin: null }, validation));
  assert.equal(parseServerEvent({ type: "race-host", ...assignment, ticket: "nope" }, validation), undefined);
  assert.equal(parseServerEvent({ type: "race-host", ...assignment, roomId: undefined }, validation), undefined);
  assert.ok(parseServerEvent({ type: "city-host", nodeId: "node-a", name: "A", origin: null, ticket: "kt1.a.b",
    requestId: "r1" }, validation));
  assert.ok(parseServerEvent({ type: "room-home", roomId: "room-1" }, validation));
});
