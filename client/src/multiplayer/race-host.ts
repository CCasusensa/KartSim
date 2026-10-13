/**
 * The global lobby (server-go/GLOBAL_LOBBY.md): the lobby connection goes to
 * the data service, where every region's rooms are listed. When the host
 * starts, the lobby sends each member `race-host` (the game node chosen for
 * the room and a one-time ticket); the player connects to that node, and
 * while the room races there the room and race commands go to the node
 * connection. When everyone is back in the room the node returns it to the
 * lobby, which sends the room again: the node connection ends and the
 * commands go back to the lobby. The 卡丁城 works the same way (`city-host`).
 */
import { activeCitySession, enterCity, type CityLobbyHost } from "../city/city-session";
import { beginCityLoading } from "../city/city-loading";
import { cheatKickMessage, cheatKickOf, type CheatKick } from "./cheat-kick";
import { formatMultiplayerError } from "./errors";
import { gameServerOfferUrl, parseGameServerList } from "./game-servers";
import { labelConnectedServer } from "./server-latency";

/** The connection API this module needs (the release LT client). */
export interface NodeClient {
  connect(url: string, nickname: string, version: string, equipment: unknown,
    initial: string, raceRuntime: boolean, ticket: string | undefined):
    Promise<{ type: string; playerId?: string }>;
  subscribe(listener: (event: any) => void): () => void;
  onClose(listener: () => void): () => void;
  request(command: Record<string, unknown>): Promise<any>;
  dispose(): void;
}

/** What the lobby-open dependencies give this module. */
export interface NodeHostDependencies {
  createClient(): NodeClient;
  pageUrl(): string;
  endpoint(path: string, pageUrl: string): string;
  /** fetch for the node list and the latency probes (tests replace it). */
  fetch?: typeof fetch;
}

/** A node the lobby sends the player to (race-host, city-host). */
export interface NodeAssignment {
  roomId?: string;
  nodeId: string;
  name: string;
  origin: string | null;
  ticket: string;
}

export interface RaceHostLobby {
  client: NodeClient;
  /** The data service lobby connection, set once it said welcome. */
  lobbyClient?: NodeClient;
  /** The game node connection of the race under way. */
  raceClient?: NodeClient;
  raceRoomId?: string;
  /** The node said its room went home; its close is expected. */
  raceHomeComing?: boolean;
  /** The game node connection of the 卡丁城. */
  cityClient?: NodeClient;
  /** Called when the city session ends (city-session.ts cleanup). */
  onCityClosed?: () => void;
  nodeDependencies?: NodeHostDependencies;
  latencyTimer?: ReturnType<typeof setInterval>;
  /** The latency round under way (reportNodeLatency). */
  latencyRound?: Promise<void>;
  /** The last latency report the lobby got (node ID → ms). */
  nodeLatency?: Record<string, number>;
  /** The lobby room this player last measured for (measureForRoom). */
  measuredRoomId?: string;
  cheatKick?: CheatKick;
  playerId: string;
  accountNickname?: string;
  disposed: boolean;
  accountAbort?: AbortController;
  state: { room?: { roomId: string } };
  startCoordinator?: { reset(): void };
  options: {
    version: string;
    initial: string;
    initialEquipment: unknown;
    currentEquipment?(): unknown;
    raceLoader?: unknown;
    status(message: string, error?: boolean): void;
    [key: string]: unknown;
  };
  receive(event: unknown): void;
  render(): void;
}

/** How often the lobby player measures its round trip to the nodes. */
export const LATENCY_INTERVAL_MS = 180_000;

function backendOrigin(deps: NodeHostDependencies): string {
  return new URL(deps.endpoint("healthz", deps.pageUrl())).origin;
}

function nodeOfferUrl(deps: NodeHostDependencies, origin: string | null): string {
  return gameServerOfferUrl(origin, backendOrigin(deps), deps.pageUrl());
}

/** Connect a new client to a node with the lobby's ticket for it. */
async function connectNode(host: RaceHostLobby, client: NodeClient, assignment: NodeAssignment): Promise<void> {
  const deps = host.nodeDependencies!;
  labelConnectedServer(client, `节点 ${assignment.name || assignment.nodeId}`);
  const welcome = await client.connect(nodeOfferUrl(deps, assignment.origin), host.accountNickname ?? "",
    host.options.version, host.options.currentEquipment?.() ?? host.options.initialEquipment,
    host.options.initial, !!host.options.raceLoader, assignment.ticket);
  if (welcome.type !== "welcome" || welcome.playerId !== host.playerId) {
    throw new Error("比赛服务器身份未确认");
  }
}

/** Commands go back to the lobby connection; the node connection ends. */
export function restoreLobbyClient(host: RaceHostLobby): void {
  const race = host.raceClient;
  host.raceClient = undefined;
  host.raceRoomId = undefined;
  host.raceHomeComing = false;
  if (host.lobbyClient && !host.cityClient) host.client = host.lobbyClient;
  race?.dispose();
}

/** The lobby sent the room's node: race there. */
export async function enterRaceHost(host: RaceHostLobby, assignment: NodeAssignment): Promise<void> {
  if (host.disposed || !host.lobbyClient || !host.nodeDependencies ||
      host.state.room?.roomId !== assignment.roomId) return;
  restoreLobbyClient(host);
  const client = host.nodeDependencies.createClient();
  host.raceClient = client;
  host.raceRoomId = assignment.roomId;
  client.subscribe(event => {
    if (host.raceClient !== client || host.disposed) return;
    const kick = cheatKickOf(event);
    if (kick) host.cheatKick = kick;
    if (event?.type === "room-home") {
      host.raceHomeComing = true;
      return;
    }
    // The room is open again on the node only on its way home: the lobby's
    // snapshot of it follows.
    if (event?.type === "room" && event.room?.phase === "open") return;
    host.receive(event);
    if (event?.type === "left" && event.roomId === assignment.roomId) leftRace(host, assignment.roomId!);
  });
  client.onClose(() => {
    if (host.raceClient !== client || host.disposed) return;
    if (host.raceHomeComing) restoreLobbyClient(host);
    else raceLost(host, assignment.roomId!);
  });
  // The room and race commands go to the node from here on.
  host.client = client;
  host.options.status(`正在连接比赛服务器「${assignment.name}」…`);
  try {
    await connectNode(host, client, assignment);
    if (host.raceClient === client) host.options.status(`比赛服务器：${assignment.name}`);
  } catch (error) {
    if (host.raceClient !== client || host.disposed) return;
    restoreLobbyClient(host);
    host.options.status(`无法连接比赛服务器「${assignment.name}」：${formatMultiplayerError(error)}。` +
      "本局无法参加，其他玩家比赛结束后房间会恢复。", true);
  }
}

/** The lobby sent the room back: the race connection is no longer needed. */
export function roomCameHome(host: RaceHostLobby, roomId: string | undefined): void {
  if (host.raceClient && roomId === host.raceRoomId) restoreLobbyClient(host);
}

/** The player left the race room on the node; leave it in the lobby too. */
function leftRace(host: RaceHostLobby, roomId: string): void {
  restoreLobbyClient(host);
  void host.lobbyClient?.request({ type: "leave", roomId }).catch(() => {});
}

/** The node connection dropped mid-race: out of the race and the room. */
function raceLost(host: RaceHostLobby, roomId: string): void {
  const kick = host.cheatKick;
  host.cheatKick = undefined;
  restoreLobbyClient(host);
  host.startCoordinator?.reset();
  void host.lobbyClient?.request({ type: "leave", roomId }).catch(() => {});
  host.receive({ type: "left", roomId, requestId: "race-lost" });
  host.options.status(kick ? cheatKickMessage(kick)
    : "与比赛服务器的连接已断开，已退出本局比赛并回到多人大厅。", true);
}

/** The lobby connection closed: end the race and city connections too. */
export function dropNodeClients(host: RaceHostLobby): void {
  clearInterval(host.latencyTimer);
  host.latencyTimer = undefined;
  const race = host.raceClient;
  const city = host.cityClient;
  host.raceClient = host.cityClient = undefined;
  host.raceRoomId = undefined;
  if (host.lobbyClient) host.client = host.lobbyClient;
  race?.dispose();
  city?.dispose();
}

/** Close every node connection with the lobby. */
export function disposeNodeClients(host: RaceHostLobby): void {
  clearInterval(host.latencyTimer);
  host.latencyTimer = undefined;
  for (const client of new Set([host.client, host.lobbyClient, host.raceClient, host.cityClient])) {
    client?.dispose();
  }
}

// ---- latency ----

/**
 * Measure the round trip to every game node (the best of two healthz
 * fetches) and tell the lobby, which races each room on the node that suits
 * all its players best. Each node is reported as soon as it is measured, so a
 * slow or unreachable one holds nothing up; a node not reached this time is
 * dropped from the report. One round runs at a time.
 */
export function reportNodeLatency(host: RaceHostLobby): Promise<void> {
  if (host.latencyRound) return host.latencyRound;
  const round = measureNodes(host).finally(() => {
    if (host.latencyRound === round) host.latencyRound = undefined;
  });
  host.latencyRound = round;
  return round;
}

async function measureNodes(host: RaceHostLobby): Promise<void> {
  const deps = host.nodeDependencies;
  const lobby = host.lobbyClient;
  if (!deps || !lobby || host.disposed) return;
  const fetchImpl = deps.fetch ?? fetch;
  const page = deps.pageUrl();
  let servers: { nodeId: string; origin: string | null }[];
  try {
    const response = await fetchImpl(deps.endpoint("game-servers", page),
      { cache: "no-store", credentials: "same-origin" });
    servers = parseGameServerList(await response.json()).servers.slice(0, 64);
  } catch {
    return;
  }
  const origin = backendOrigin(deps);
  // The listed nodes keep their last round trip until measured again.
  const latency: Record<string, number> = {};
  for (const server of servers) {
    const last = host.nodeLatency?.[server.nodeId];
    if (last !== undefined) latency[server.nodeId] = last;
  }
  const report = async () => {
    if (host.disposed || host.lobbyClient !== lobby) return;
    const current = { ...latency };
    if (host.nodeLatency && sameLatency(host.nodeLatency, current)) return;
    host.nodeLatency = current;
    await lobby.request({ type: "node-latency", latency: current }).catch(() => {});
  };
  await Promise.all(servers.map(async server => {
    let best = Infinity;
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = performance.now();
      try {
        const response = await fetchImpl(`${server.origin ?? origin}/multiplayer/healthz`,
          { cache: "no-store", signal: AbortSignal.timeout(3_000) });
        if (response.ok) best = Math.min(best, performance.now() - started);
      } catch { /* unreachable: not measured */ }
    }
    if (Number.isFinite(best)) latency[server.nodeId] = Math.min(Math.round(best), 60_000);
    else delete latency[server.nodeId];
    await report();
  }));
}

function sameLatency(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/**
 * The player is in lobby room roomId (undefined: in none): entering a room
 * measures again, so the room starts on fresh round trips.
 */
export function measureForRoom(host: RaceHostLobby, roomId: string | undefined): void {
  if (roomId === host.measuredRoomId) return;
  host.measuredRoomId = roomId;
  if (roomId) void reportNodeLatency(host);
}

/** Start the periodic latency reports of a lobby that just connected. */
export function startLatencyReports(host: RaceHostLobby): void {
  clearInterval(host.latencyTimer);
  void reportNodeLatency(host);
  host.latencyTimer = setInterval(() => { void reportNodeLatency(host); }, LATENCY_INTERVAL_MS);
}

// ---- 卡丁城 ----
const enteringCity = new WeakSet<RaceHostLobby>();

/** Enter the city on the node the lobby picks for this player. */
export async function enterCityOnNode(host: RaceHostLobby & Omit<CityLobbyHost, "client">): Promise<void> {
  if (host.disposed || host.accountAbort?.signal.aborted || host.cityClient || enteringCity.has(host)) return;
  enteringCity.add(host);
  const city = host as unknown as CityLobbyHost;
  const lobby = host.lobbyClient;
  const deps = host.nodeDependencies;
  const loading = beginCityLoading(city, host.accountAbort?.signal);
  let client: NodeClient | undefined;
  try {
    await loading.ready;
    if (host.disposed || host.accountAbort?.signal.aborted) return;
    if (!lobby || !deps) {
      // Older services keep the city on the lobby's own node.
      await enterCity(city);
      return;
    }
    loading.stage("正在分配卡丁城服务器…");
    host.options.status("正在分配卡丁城服务器…");
    const assignment = await lobby.request({ type: "city-host" }) as NodeAssignment;
    if (host.disposed || host.accountAbort?.signal.aborted) return;
    client = deps.createClient();
    host.cityClient = client;
    const node = client;
    client.onClose(() => {
      if (host.cityClient !== node || host.disposed) return;
      leaveCityClient(host);
      const session = activeCitySession();
      if (session?.host === city) void session.cleanup();
      host.options.status("与卡丁城服务器的连接已断开。", true);
    });
    loading.stage(`正在连接卡丁城服务器「${assignment.name}」…`);
    await connectNode(host, client, assignment);
    if (host.disposed || host.accountAbort?.signal.aborted || host.cityClient !== client) return;
    host.client = client;
    host.onCityClosed = () => leaveCityClient(host);
    await enterCity(city);
  } catch (error) {
    if (host.cityClient === client) leaveCityClient(host);
    if (!host.disposed && !host.accountAbort?.signal.aborted)
      host.options.status(`进入卡丁城失败：${formatMultiplayerError(error)}`, true);
  } finally {
    if ((host.disposed || host.accountAbort?.signal.aborted) && client && host.cityClient === client)
      leaveCityClient(host);
    enteringCity.delete(host);
    loading.dispose();
  }
}

function leaveCityClient(host: RaceHostLobby): void {
  const city = host.cityClient;
  host.cityClient = undefined;
  host.onCityClosed = undefined;
  if (host.lobbyClient) host.client = host.lobbyClient;
  city?.dispose();
}
