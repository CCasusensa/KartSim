/**
 * The city session's network layer over the lobby's live game connection:
 * JSON requests/events (city-* messages), 0xC1 motion frames out and in,
 * 0xC2 radar packets, 0xC3 NPC traffic packets, and the "race connection"
 * surface the multiplayer race loader expects (chat, motion, leave).
 */
import { GameMotionDecoder, GameMotionEncoder } from "../multiplayer/payload";
import { MOTION_HEADER_BYTES, motionRaceTag } from "../multiplayer/motion";
import type { RaceChatChannel, RaceChatMessage } from "../multiplayer/race-chat-overlay";
import {
  CITY_MOTION_HEADER_BYTES, CITY_MOTION_MARKER, CITY_RADAR_MARKER,
  decodeCityMotionFrame, decodeCityRadar, parseCityEvent, parseCityRefuelReply, parseCityRescueReply, parseCitySeatReply, parseCitySnapshot, parseCityVehicle,
  type CityEvent, type CityRadarEntry, type CityRefuelReply, type CityRescueReply, type CitySeatReply, type CitySnapshot, type CityVehicle,
  parseCityQuestDone, parseCityQuestRun, type CityQuestDone, type CityQuestRun,
} from "./city-protocol";
import { CITY_TRAFFIC_MARKER, decodeTrafficPacket, type TrafficPacket } from "./city-traffic-protocol";

export interface CityClient {
  playerId?: string;
  motion?: { readyState: string; bufferedAmount: number; send(data: Uint8Array): void };
  binaryInterceptor?: (bytes: Uint8Array) => boolean;
  request(message: Record<string, unknown>): Promise<unknown>;
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
  captureClock(): Record<string, unknown> | undefined;
}

export interface CityNetworkHandlers {
  onEvent(event: CityEvent): void;
  onMotion(id: number, sequence: number, kind: number, sample: any): void;
  onRadar(entries: CityRadarEntry[]): void;
  /** 0xC3: the NPC cars near us (CITY-NPC.md). */
  onTraffic?(packet: TrafficPacket): void;
}

export class CityNetwork {
  private readonly decoder = new GameMotionDecoder();
  private encoder?: GameMotionEncoder;
  private sequence = 0;
  private unsubscribe?: () => void;
  private previousInterceptor?: (bytes: Uint8Array) => boolean;
  disposed = false;
  /** The race tag byte the encoder stamps (used to re-frame incoming city frames). */
  readonly raceTag: number;

  constructor(readonly client: CityClient, readonly raceId: string, readonly handlers: CityNetworkHandlers) {
    this.encoder = new GameMotionEncoder({ raceId, slot: 0 });
    this.raceTag = motionRaceTag(raceId);
    this.previousInterceptor = client.binaryInterceptor;
    client.binaryInterceptor = bytes => this.intercept(bytes);
    this.unsubscribe = client.subscribe(message => {
      if (message.requestId !== undefined) return; // replies resolve their own requests
      try {
        const event = parseCityEvent(message);
        if (event) handlers.onEvent(event);
      } catch (error) { console.warn("城市事件无效", error); }
    });
  }

  async join(line?: number): Promise<CitySnapshot> {
    const reply = await this.client.request(line === undefined ? { type: "city-join" } : { type: "city-join", line }) as Record<string, unknown>;
    return parseCitySnapshot(reply.city ?? reply);
  }

  leave(): Promise<unknown> { return this.client.request({ type: "city-leave" }); }
  chat(text: string, channel: "near" | "district" | "city" = "near"): Promise<unknown> {
    return this.client.request({ type: "city-chat", text, channel });
  }
  emote(emote: number): Promise<unknown> { return this.client.request({ type: "city-emote", emote }); }
  state(state: "driving" | "parked"): Promise<unknown> { return this.client.request({ type: "city-state", state }); }
  respawn(pose: { x: number; y: number; z: number; heading: number }): Promise<unknown> {
    return this.client.request({ type: "city-respawn", pose });
  }
  /** A garage change: the node checks ownership, then tells the line. */
  async equip(equipment: unknown): Promise<unknown> {
    const reply = await this.client.request({ type: "city-equipment", equipment }) as Record<string, unknown>;
    return reply?.equipment ?? equipment;
  }
  /** Gets out of the kart (pose: where to stand, near it). */
  async exit(pose?: { x: number; y: number; z: number; heading: number }): Promise<CitySeatReply> {
    return parseCitySeatReply(await this.client.request(pose ? { type: "city-exit", pose } : { type: "city-exit" }));
  }
  /** Gets into a kart nearby: its driver's seat when empty, else its back seat. */
  async enter(vehicle: number): Promise<CitySeatReply> {
    return parseCitySeatReply(await this.client.request({ type: "city-enter", vehicle }));
  }
  /** Locks or unlocks the member's own kart. */
  async lock(locked: boolean): Promise<CityVehicle> {
    const reply = await this.client.request({ type: "city-lock", locked }) as Record<string, unknown>;
    return parseCityVehicle(reply.vehicle);
  }
  /** Buys addMl at the gas station the kart stands at (0 fills the tank). */
  async refuel(requestId: string, addMl = 0): Promise<CityRefuelReply> {
    return parseCityRefuelReply(await this.client.request({ type: "city-refuel", requestId, addMl }));
  }
  /** Pays the tow of a stalled kart to the nearest gas station. */
  /** 送货任务：接、放弃、交付（server-go/CITY-QUESTS.md）。 */
  async acceptQuest(quest: string): Promise<CityQuestRun> {
    return parseCityQuestRun(await this.client.request({ type: "city-quest-accept", quest }));
  }
  abandonQuest(): Promise<unknown> { return this.client.request({ type: "city-quest-abandon" }); }
  async deliverQuest(): Promise<CityQuestDone> {
    return parseCityQuestDone(await this.client.request({ type: "city-quest-deliver" }));
  }

  async rescue(requestId: string): Promise<CityRescueReply> {
    return parseCityRescueReply(await this.client.request({ type: "city-rescue", requestId }));
  }

  /** Encodes a race motion sample as a city frame and sends it. */
  sendMotion(sample: unknown): boolean {
    const channel = this.client.motion;
    if (this.disposed || !this.encoder || !channel || channel.readyState !== "open" || channel.bufferedAmount > 8192) return false;
    const sequence = (this.sequence + 1) >>> 0;
    let raceFrame: Uint8Array;
    try { raceFrame = this.encoder.encode(sample as any, sequence); }
    catch (error) { console.warn("城市运动帧编码失败", error); return false; }
    const payload = raceFrame.subarray(MOTION_HEADER_BYTES);
    const frame = new Uint8Array(CITY_MOTION_HEADER_BYTES + payload.length);
    const view = new DataView(frame.buffer);
    frame[0] = CITY_MOTION_MARKER;
    frame[1] = raceFrame[0]!;
    view.setUint16(2, 0, true);
    view.setUint32(4, sequence, true);
    frame.set(payload, CITY_MOTION_HEADER_BYTES);
    try { channel.send(frame); } catch { return false; }
    this.sequence = sequence;
    return true;
  }

  private intercept(bytes: Uint8Array): boolean {
    if (this.disposed) return false;
    if (bytes[0] === CITY_RADAR_MARKER) {
      const entries = decodeCityRadar(bytes);
      if (entries) this.handlers.onRadar(entries);
      return true;
    }
    if (bytes[0] === CITY_TRAFFIC_MARKER) {
      const packet = decodeTrafficPacket(bytes);
      if (packet) this.handlers.onTraffic?.(packet);
      return true;
    }
    if (bytes[0] !== CITY_MOTION_MARKER) return false;
    const frame = decodeCityMotionFrame(bytes);
    if (!frame) return true;
    // Re-frame as a race frame (kind, mask, slot, tag, sequence) for the race decoder.
    const raceFrame = new Uint8Array(MOTION_HEADER_BYTES + frame.payload.length);
    raceFrame[0] = frame.kind;
    raceFrame[1] = 0;
    raceFrame[2] = 0;
    raceFrame[3] = this.raceTag;
    new DataView(raceFrame.buffer).setUint32(4, frame.sequence, true);
    raceFrame.set(frame.payload, MOTION_HEADER_BYTES);
    const motion = this.decoder.decode(raceFrame);
    if (motion) this.handlers.onMotion(frame.id, frame.sequence, frame.kind, motion.payload);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.client.binaryInterceptor = this.previousInterceptor;
  }
}

/** The connection object the multiplayer race loader and its session expect. */
export function createCityRaceConnection(network: CityNetwork, playerId: string, roomId: string,
  raceId: string, hooks: { leave(): Promise<unknown>; onChat(listener: (message: RaceChatMessage) => void): () => void;
    /** False while the rider walks or rides: the race sender's kart frames stay home. */
    allowMotion?(): boolean }) {
  const resolved = () => Promise.resolve(undefined);
  const noSubscription = () => () => {};
  return {
    playerId, roomId, raceId,
    get hasMotionRecipients() { return true; },
    get motionRoundTripMs() { return undefined; },
    resetMotionRtt: () => {},
    directMotionAvailable: () => false,
    latencyMs: () => undefined,
    sendTeamCharge: resolved,
    sendGiantState: resolved,
    subscribeGiantState: noSubscription,
    subscribeTeamGauge: noSubscription,
    sendItem: () => Promise.reject(new Error("卡丁城没有道具。")),
    subscribeItem: noSubscription,
    sendAwardMotion: resolved,
    subscribeAwardMotion: noSubscription,
    chatChannels: [
      { id: "city", label: "全城", description: "发给当前线路的所有玩家" },
      { id: "near", label: "附近", description: "发给周围的玩家" },
    ] satisfies RaceChatChannel[],
    sendRaceChat: (text: string, channel = "city") => channel === "city" || channel === "near"
      ? network.chat(text, channel) : Promise.reject(new Error("无效的聊天频道。")),
    subscribeRaceChat: (listener: (message: RaceChatMessage) => void) => hooks.onChat(listener),
    returnToRoom: resolved,
    reportFinish: resolved,
    sendMotion: (sample: unknown) => (hooks.allowMotion?.() ?? true) && network.sendMotion(sample),
    subscribeMotion: noSubscription,
    leaveRace: () => hooks.leave(),
    presentationClosed: () => {},
  };
}
