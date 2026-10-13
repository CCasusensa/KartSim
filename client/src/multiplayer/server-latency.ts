/** The part of a game-server client the latency probe uses. */
export interface LatencyClient {
  request(message: { type: string; clientTick?: number }): Promise<unknown>;
}

/** Game-server connections that finished `hello`, newest last. */
const connectedClients = new Set<LatencyClient>();

/** What the F10 readout calls each connection's server (节点 华东一区). */
const serverLabels = new WeakMap<object, string>();

/** Name the server a connection reaches, for the F10 readout. */
export function labelConnectedServer(client: object, label: string): void {
  serverLabels.set(client, label);
}

/** The label of the server the newest connection reaches, if it has one. */
export function connectedServerLabel(): string | undefined {
  const client = [...connectedClients].at(-1);
  return client && serverLabels.get(client);
}

export function rememberConnectedClient(client: LatencyClient): void {
  connectedClients.delete(client);
  connectedClients.add(client);
}

export function forgetConnectedClient(client: object): void {
  connectedClients.delete(client as LatencyClient);
}

/**
 * Time one `clock` round trip on the newest game-server connection, in
 * milliseconds; undefined when no game server is connected. The tick comes
 * from the same performance clock as the connection's heartbeat, so the reply
 * also feeds its clock synchronizer.
 */
export async function measureGameServerLatency(
  now: () => number = () => performance.now(),
): Promise<number | undefined> {
  const client = [...connectedClients].at(-1);
  if (!client) return undefined;
  const sentAt = now();
  await client.request({ type: "clock", clientTick: sentAt });
  return now() - sentAt;
}
