/**
 * 卡丁城 wire formats (server-go/CITY.md): the JSON snapshot and events the
 * game node sends, and the two binary frames that share the motion channel
 * with race frames: 0xC1 city motion (8-byte header + race payload) and
 * 0xC2 radar (positions of every member once per second).
 */

export const CITY_MOTION_MARKER = 0xc1;
export const CITY_RADAR_MARKER = 0xc2;
export const CITY_MOTION_HEADER_BYTES = 8;
const RADAR_HEADER_BYTES = 4;
const RADAR_ENTRY_BYTES = 7;

export interface CityPose { x: number; y: number; z: number; heading: number }
export type CityMemberState = "driving" | "parked" | "afk";
export type CityWeather = "clear" | "rain" | "snow";

export interface CityMember {
  id: number;
  playerId: string;
  name: string;
  equipment: unknown;
  state: CityMemberState;
  pose?: CityPose;
}

export interface CityClock {
  serverTick: number;
  timeOfDay: number;
  dayLengthMs: number;
  weather: CityWeather;
  weatherUntilTick: number;
}

export interface CitySnapshot {
  instanceId: string;
  line: number;
  name: string;
  capacity: number;
  clock: CityClock;
  you: { id: number; spawn: CityPose & { id?: string } };
  members: CityMember[];
}

export type CityEvent =
  | { type: "city-joined"; instanceId: string; member: CityMember }
  | { type: "city-left"; instanceId: string; id: number; playerId: string }
  | { type: "city-chat"; instanceId: string; sequence: number; id: number; playerId: string; name: string; channel: string; text: string }
  | { type: "city-emote"; instanceId: string; id: number; emote: number }
  | { type: "city-state"; instanceId: string; id: number; state: CityMemberState }
  | { type: "city-respawn"; instanceId: string; id: number; pose: CityPose }
  | { type: "city-equipment"; instanceId: string; id: number; playerId: string; equipment: unknown }
  | { type: "city-clock"; instanceId: string; clock: CityClock }
  | { type: "city-kicked"; instanceId: string; reason: string };

export const CITY_EVENT_TYPES = new Set([
  "city-joined", "city-left", "city-chat", "city-emote", "city-state", "city-respawn", "city-equipment",
  "city-clock", "city-kicked",
]);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === "string";

export function parseCityPose(value: unknown): CityPose | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pose = value as Record<string, unknown>;
  if (!finite(pose.x) || !finite(pose.y) || !finite(pose.z) || !finite(pose.heading)) return undefined;
  return { x: pose.x, y: pose.y, z: pose.z, heading: pose.heading };
}

export function parseCityMember(value: unknown): CityMember {
  const member = value as Record<string, unknown>;
  if (!member || typeof member !== "object" || !Number.isInteger(member.id) || (member.id as number) < 1 ||
      !text(member.playerId) || !text(member.name))
    throw new Error("城市成员数据无效。");
  const state = member.state === "parked" || member.state === "afk" ? member.state : "driving";
  return {
    id: member.id as number, playerId: member.playerId, name: member.name,
    equipment: member.equipment, state, pose: parseCityPose(member.pose),
  };
}

export function parseCityClock(value: unknown): CityClock {
  const clock = value as Record<string, unknown>;
  if (!clock || typeof clock !== "object" || !finite(clock.serverTick) || !finite(clock.timeOfDay) ||
      !finite(clock.dayLengthMs) || (clock.dayLengthMs as number) <= 0)
    throw new Error("城市时钟数据无效。");
  const weather = clock.weather === "rain" || clock.weather === "snow" ? clock.weather : "clear";
  return {
    serverTick: clock.serverTick, timeOfDay: ((clock.timeOfDay as number) % 1 + 1) % 1,
    dayLengthMs: clock.dayLengthMs, weather,
    weatherUntilTick: finite(clock.weatherUntilTick) ? clock.weatherUntilTick : clock.serverTick,
  };
}

export function parseCitySnapshot(value: unknown): CitySnapshot {
  const city = value as Record<string, unknown>;
  if (!city || typeof city !== "object" || !text(city.instanceId) || !Number.isInteger(city.line) ||
      !text(city.name) || !Number.isInteger(city.capacity) || !Array.isArray(city.members))
    throw new Error("城市快照无效。");
  const you = city.you as Record<string, unknown> | undefined;
  const spawn = you ? parseCityPose(you.spawn) : undefined;
  if (!you || !Number.isInteger(you.id) || !spawn) throw new Error("城市快照缺少本人信息。");
  const spawnId = (you.spawn as Record<string, unknown>).id;
  return {
    instanceId: city.instanceId, line: city.line as number, name: city.name, capacity: city.capacity as number,
    clock: parseCityClock(city.clock),
    you: { id: you.id as number, spawn: { ...spawn, ...(text(spawnId) ? { id: spawnId } : {}) } },
    members: city.members.map(parseCityMember),
  };
}

/** Validates a server event; returns undefined for messages that are not city events. */
export function parseCityEvent(message: Record<string, unknown>): CityEvent | undefined {
  const type = message.type;
  if (!text(type) || !CITY_EVENT_TYPES.has(type)) return undefined;
  const instanceId = text(message.instanceId) ? message.instanceId : "";
  switch (type) {
    case "city-joined": return { type, instanceId, member: parseCityMember(message.member) };
    case "city-left":
      if (!Number.isInteger(message.id)) throw new Error("city-left 缺少成员编号。");
      return { type, instanceId, id: message.id as number, playerId: text(message.playerId) ? message.playerId : "" };
    case "city-chat":
      if (!Number.isInteger(message.id) || !text(message.text) || !text(message.name)) throw new Error("city-chat 数据无效。");
      return {
        type, instanceId, id: message.id as number, sequence: finite(message.sequence) ? message.sequence : 0,
        playerId: text(message.playerId) ? message.playerId : "", name: message.name,
        channel: text(message.channel) ? message.channel : "near", text: message.text,
      };
    case "city-emote":
      if (!Number.isInteger(message.id) || !Number.isInteger(message.emote)) throw new Error("city-emote 数据无效。");
      return { type, instanceId, id: message.id as number, emote: message.emote as number };
    case "city-state": {
      if (!Number.isInteger(message.id)) throw new Error("city-state 数据无效。");
      const state = message.state === "parked" || message.state === "afk" ? message.state : "driving";
      return { type, instanceId, id: message.id as number, state };
    }
    case "city-respawn": {
      const pose = parseCityPose(message.pose);
      if (!Number.isInteger(message.id) || !pose) throw new Error("city-respawn 数据无效。");
      return { type, instanceId, id: message.id as number, pose };
    }
    case "city-equipment":
      if (!Number.isInteger(message.id) || !message.equipment || typeof message.equipment !== "object")
        throw new Error("city-equipment 数据无效。");
      return { type, instanceId, id: message.id as number,
        playerId: text(message.playerId) ? message.playerId : "", equipment: message.equipment };
    case "city-clock": return { type, instanceId, clock: parseCityClock(message.clock) };
    case "city-kicked": return { type, instanceId, reason: text(message.reason) ? message.reason : "UNKNOWN" };
    default: return undefined;
  }
}

/** Wraps a race motion payload in the city frame header (sender id is stamped by the node). */
export function encodeCityMotionFrame(kind: number, sequence: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(kind) || kind < 1 || kind > 255) throw new Error("城市运动帧种类无效。");
  const frame = new Uint8Array(CITY_MOTION_HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  frame[0] = CITY_MOTION_MARKER;
  frame[1] = kind;
  view.setUint16(2, 0, true);
  view.setUint32(4, sequence >>> 0, true);
  frame.set(payload, CITY_MOTION_HEADER_BYTES);
  return frame;
}

export interface CityMotionFrame { kind: number; id: number; sequence: number; payload: Uint8Array }

export function decodeCityMotionFrame(frame: Uint8Array): CityMotionFrame | undefined {
  if (frame.length < CITY_MOTION_HEADER_BYTES || frame[0] !== CITY_MOTION_MARKER) return undefined;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    kind: frame[1]!, id: view.getUint16(2, true), sequence: view.getUint32(4, true),
    payload: frame.subarray(CITY_MOTION_HEADER_BYTES),
  };
}

export interface CityRadarEntry { id: number; x: number; z: number; heading: number }

export function decodeCityRadar(frame: Uint8Array): CityRadarEntry[] | undefined {
  if (frame.length < RADAR_HEADER_BYTES || frame[0] !== CITY_RADAR_MARKER) return undefined;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const count = view.getUint16(2, true);
  if (frame.length < RADAR_HEADER_BYTES + count * RADAR_ENTRY_BYTES) return undefined;
  const entries: CityRadarEntry[] = [];
  for (let i = 0; i < count; i++) {
    const offset = RADAR_HEADER_BYTES + i * RADAR_ENTRY_BYTES;
    entries.push({
      id: view.getUint16(offset, true),
      x: view.getInt16(offset + 2, true) / 4,
      z: view.getInt16(offset + 4, true) / 4,
      heading: (frame[offset + 6]! / 256) * 360,
    });
  }
  return entries;
}

/** Encodes a radar frame (used by tests and bots). */
export function encodeCityRadar(entries: readonly CityRadarEntry[]): Uint8Array {
  const frame = new Uint8Array(RADAR_HEADER_BYTES + entries.length * RADAR_ENTRY_BYTES);
  const view = new DataView(frame.buffer);
  frame[0] = CITY_RADAR_MARKER;
  view.setUint16(2, entries.length, true);
  entries.forEach((entry, i) => {
    const offset = RADAR_HEADER_BYTES + i * RADAR_ENTRY_BYTES;
    view.setUint16(offset, entry.id, true);
    view.setInt16(offset + 2, Math.round(entry.x * 4), true);
    view.setInt16(offset + 4, Math.round(entry.z * 4), true);
    frame[offset + 6] = Math.round((((entry.heading % 360) + 360) % 360) / 360 * 256) & 255;
  });
  return frame;
}
