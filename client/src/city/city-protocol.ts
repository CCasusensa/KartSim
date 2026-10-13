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

/** Where a member sits (server-go/CITY.md 7): its kart's driver seat, someone's back seat, or on foot. */
export type CitySeat = "driver" | "passenger" | "foot";

export interface CityMember {
  id: number;
  playerId: string;
  name: string;
  equipment: unknown;
  state: CityMemberState;
  pose?: CityPose;
  /** Absent from older nodes and fixtures: driving. */
  seat?: CitySeat;
  /** The kart the member sits in (0 on foot). */
  vehicle?: number;
}

/** A member's kart in the city: parked where its driver got out, or driven. */
export interface CityVehicle {
  /** Its owner's member id. */
  id: number;
  owner: number;
  playerId: string;
  ownerName: string;
  equipment: unknown;
  pose: CityPose;
  locked: boolean;
  /** Member ids of who sits in it (0: empty seat). */
  driver: number;
  passenger: number;
}

export interface CityClock {
  serverTick: number;
  timeOfDay: number;
  dayLengthMs: number;
  weather: CityWeather;
  weatherUntilTick: number;
}

/** A member's fuel tank (server-go/FUEL.md); absent while fuel is off. */
export interface CityFuel {
  kartName: string;
  /** small | medium | large | huge */
  sizeClass: string;
  capacityMl: number;
  fuelMl: number;
  useMlPerKm: number;
  /** 金币 per litre; a refill costs ceil(ml × price / 1000). */
  pricePerLiter: number;
  rescueFee: number;
  lucci: number;
  empty: boolean;
}

export interface CitySnapshot {
  instanceId: string;
  line: number;
  name: string;
  capacity: number;
  clock: CityClock;
  you: { id: number; spawn: CityPose & { id?: string }; fuel?: CityFuel };
  members: CityMember[];
  vehicles: CityVehicle[];
}

/** city-exit's and city-enter's reply: where the member sits now. */
export interface CitySeatReply { seat: CitySeat; pose?: CityPose; vehicle?: CityVehicle; fuel?: CityFuel }

/** city-refuel's reply: what was bought at which station. */
export interface CityRefuelReply { station: string; addedMl: number; cost: number; stale: boolean; fuel: CityFuel }

/** city-rescue's reply: the tow (pose at the station) or a stale tank. */
export interface CityRescueReply {
  station?: string; stationName?: string; pose?: CityPose; cost: number; free: boolean; stale: boolean; fuel: CityFuel;
}

export type CityEvent =
  | { type: "city-joined"; instanceId: string; member: CityMember; vehicle?: CityVehicle }
  | { type: "city-left"; instanceId: string; id: number; playerId: string }
  | { type: "city-chat"; instanceId: string; sequence: number; id: number; playerId: string; name: string; channel: string; text: string }
  | { type: "city-emote"; instanceId: string; id: number; emote: number }
  | { type: "city-state"; instanceId: string; id: number; state: CityMemberState }
  | { type: "city-respawn"; instanceId: string; id: number; pose: CityPose }
  | { type: "city-equipment"; instanceId: string; id: number; playerId: string; equipment: unknown }
  | { type: "city-clock"; instanceId: string; clock: CityClock }
  | { type: "city-fuel"; instanceId: string; reason: string; fuel: CityFuel }
  | { type: "city-vehicle"; instanceId: string; vehicle: CityVehicle }
  | { type: "city-vehicle-gone"; instanceId: string; id: number }
  | { type: "city-seat"; instanceId: string; id: number; playerId: string; seat: CitySeat; vehicle: number;
      pose?: CityPose; reason?: string }
  | { type: "city-quest-failed"; instanceId: string; quest: string; reason: string; collisions: number }
  | { type: "city-quest-progress"; instanceId: string; quest: string; collisions: number }
  | { type: "city-kicked"; instanceId: string; reason: string };

export const CITY_EVENT_TYPES = new Set([
  "city-joined", "city-left", "city-chat", "city-emote", "city-state", "city-respawn", "city-equipment",
  "city-clock", "city-fuel", "city-vehicle", "city-vehicle-gone", "city-seat", "city-kicked",
  "city-quest-failed", "city-quest-progress",
]);

/** Reply-only types (they always carry the requestId; CityNetwork parses them). */
export const CITY_REPLY_TYPES = new Set(["city-refuel", "city-rescue", "city-quest", "city-quest-done"]);

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
    seat: parseCitySeat(member.seat), vehicle: Number.isInteger(member.vehicle) ? member.vehicle as number : 0,
  };
}

/** Older nodes have no seats: everyone drives. */
export function parseCitySeat(value: unknown): CitySeat {
  return value === "passenger" || value === "foot" ? value : "driver";
}

export function parseCityVehicle(value: unknown): CityVehicle {
  const vehicle = value as Record<string, unknown>;
  const pose = vehicle && typeof vehicle === "object" ? parseCityPose(vehicle.pose) : undefined;
  if (!pose || !Number.isInteger(vehicle.id) || (vehicle.id as number) < 1 || !Number.isInteger(vehicle.owner))
    throw new Error("城市车辆数据无效。");
  const seat = (key: string) => Number.isInteger(vehicle[key]) ? vehicle[key] as number : 0;
  return {
    id: vehicle.id as number, owner: vehicle.owner as number,
    playerId: text(vehicle.playerId) ? vehicle.playerId : "", ownerName: text(vehicle.ownerName) ? vehicle.ownerName : "",
    equipment: vehicle.equipment, pose, locked: vehicle.locked === true, driver: seat("driver"), passenger: seat("passenger"),
  };
}

export function parseCitySeatReply(value: unknown): CitySeatReply {
  const reply = value as Record<string, unknown>;
  if (!reply || typeof reply !== "object") throw new Error("上下车回复无效。");
  const pose = parseCityPose(reply.pose);
  const fuel = parseCityFuel(reply.fuel);
  return {
    seat: parseCitySeat(reply.seat), ...(pose ? { pose } : {}),
    ...(reply.vehicle ? { vehicle: parseCityVehicle(reply.vehicle) } : {}), ...(fuel ? { fuel } : {}),
  };
}

export function parseCityFuel(value: unknown): CityFuel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fuel = value as Record<string, unknown>;
  const numbers = ["capacityMl", "fuelMl", "useMlPerKm", "pricePerLiter", "rescueFee", "lucci"] as const;
  if (!numbers.every(key => finite(fuel[key]) && (fuel[key] as number) >= 0) || (fuel.capacityMl as number) <= 0)
    return undefined;
  const capacityMl = fuel.capacityMl as number;
  const fuelMl = Math.min(fuel.fuelMl as number, capacityMl);
  return {
    kartName: text(fuel.kartName) ? fuel.kartName : "卡丁车",
    sizeClass: text(fuel.sizeClass) ? fuel.sizeClass : "medium",
    capacityMl, fuelMl, useMlPerKm: fuel.useMlPerKm as number, pricePerLiter: fuel.pricePerLiter as number,
    rescueFee: fuel.rescueFee as number, lucci: fuel.lucci as number,
    empty: fuel.empty === true || fuelMl <= 0,
  };
}

export function parseCityRefuelReply(value: unknown): CityRefuelReply {
  const reply = value as Record<string, unknown>;
  const fuel = reply && typeof reply === "object" ? parseCityFuel(reply.fuel) : undefined;
  if (!fuel) throw new Error("加油回复无效。");
  return {
    station: text(reply.station) ? reply.station : "", addedMl: finite(reply.addedMl) ? reply.addedMl : 0,
    cost: finite(reply.cost) ? reply.cost : 0, stale: reply.stale === true, fuel,
  };
}

export function parseCityRescueReply(value: unknown): CityRescueReply {
  const reply = value as Record<string, unknown>;
  const fuel = reply && typeof reply === "object" ? parseCityFuel(reply.fuel) : undefined;
  if (!fuel) throw new Error("救援回复无效。");
  const pose = parseCityPose(reply.pose);
  return {
    ...(text(reply.station) ? { station: reply.station } : {}),
    ...(text(reply.stationName) ? { stationName: reply.stationName } : {}),
    ...(pose ? { pose } : {}),
    cost: finite(reply.cost) ? reply.cost : 0, free: reply.free === true, stale: reply.stale === true || !pose, fuel,
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
  const fuel = parseCityFuel(you.fuel);
  return {
    instanceId: city.instanceId, line: city.line as number, name: city.name, capacity: city.capacity as number,
    clock: parseCityClock(city.clock),
    you: { id: you.id as number, spawn: { ...spawn, ...(text(spawnId) ? { id: spawnId } : {}) }, ...(fuel ? { fuel } : {}) },
    members: city.members.map(parseCityMember),
    vehicles: Array.isArray(city.vehicles) ? city.vehicles.map(parseCityVehicle) : [],
  };
}

/** Validates a server event; returns undefined for messages that are not city events. */
export function parseCityEvent(message: Record<string, unknown>): CityEvent | undefined {
  const type = message.type;
  if (!text(type) || !CITY_EVENT_TYPES.has(type)) return undefined;
  const instanceId = text(message.instanceId) ? message.instanceId : "";
  switch (type) {
    case "city-joined": return { type, instanceId, member: parseCityMember(message.member),
      ...(message.vehicle ? { vehicle: parseCityVehicle(message.vehicle) } : {}) };
    case "city-vehicle": return { type, instanceId, vehicle: parseCityVehicle(message.vehicle) };
    case "city-vehicle-gone":
      if (!Number.isInteger(message.id)) throw new Error("city-vehicle-gone 缺少车辆编号。");
      return { type, instanceId, id: message.id as number };
    case "city-seat": {
      if (!Number.isInteger(message.id)) throw new Error("city-seat 数据无效。");
      const pose = parseCityPose(message.pose);
      return { type, instanceId, id: message.id as number, playerId: text(message.playerId) ? message.playerId : "",
        seat: parseCitySeat(message.seat), vehicle: Number.isInteger(message.vehicle) ? message.vehicle as number : 0,
        ...(pose ? { pose } : {}), ...(text(message.reason) ? { reason: message.reason } : {}) };
    }
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
    case "city-fuel": {
      const fuel = parseCityFuel(message.fuel);
      if (!fuel) throw new Error("city-fuel 数据无效。");
      return { type, instanceId, reason: text(message.reason) ? message.reason : "", fuel };
    }
    case "city-quest-failed":
      if (!text(message.quest) || !text(message.reason)) throw new Error("city-quest-failed 数据无效。");
      return { type, instanceId, quest: message.quest, reason: message.reason,
        collisions: finite(message.collisions) ? message.collisions : 0 };
    case "city-quest-progress":
      if (!text(message.quest) || !finite(message.collisions)) throw new Error("city-quest-progress 数据无效。");
      return { type, instanceId, quest: message.quest, collisions: message.collisions };
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

// ---- 送货任务 (server-go/CITY-QUESTS.md) ----

/** city-quest: an accepted delivery (ticks are node ms). */
export interface CityQuestRun {
  quest: string;
  runId: string;
  startedAt: number;
  /** 0 without a time limit. */
  deadline: number;
  collisions: number;
}

/** city-quest-done: what the delivery credited and the account afterwards. */
export interface CityQuestDone {
  quest: string;
  elapsedMs: number;
  collisions: number;
  exp: number;
  lucci: number;
  capped: boolean;
  levelUps: Array<{ level: number; lucci: number; koin: number; coupon: number }>;
  walletLucci: number;
  totalExp: number;
  level: number;
}

export function parseCityQuestRun(value: unknown): CityQuestRun {
  const reply = value as Record<string, unknown>;
  if (!reply || !text(reply.quest) || !text(reply.runId) || !finite(reply.startedAt) || !finite(reply.deadline))
    throw new Error("送货任务数据无效。");
  return { quest: reply.quest, runId: reply.runId, startedAt: reply.startedAt, deadline: reply.deadline,
    collisions: finite(reply.collisions) ? reply.collisions : 0 };
}

export function parseCityQuestDone(value: unknown): CityQuestDone {
  const reply = value as Record<string, unknown>;
  const numbers = ["elapsedMs", "collisions", "exp", "lucci", "walletLucci", "totalExp", "level"] as const;
  if (!reply || !text(reply.quest) || numbers.some(key => !finite(reply[key])))
    throw new Error("送货结算数据无效。");
  const levelUps = Array.isArray(reply.levelUps) ? reply.levelUps.flatMap(entry => {
    const up = entry as Record<string, unknown>;
    return up && finite(up.level) ? [{ level: up.level, lucci: finite(up.lucci) ? up.lucci : 0,
      koin: finite(up.koin) ? up.koin : 0, coupon: finite(up.coupon) ? up.coupon : 0 }] : [];
  }) : [];
  return { quest: reply.quest, elapsedMs: reply.elapsedMs as number, collisions: reply.collisions as number,
    exp: reply.exp as number, lucci: reply.lucci as number, capped: reply.capped === true, levelUps,
    walletLucci: reply.walletLucci as number, totalExp: reply.totalExp as number, level: reply.level as number };
}
