/**
 * The 0xC3 traffic packet of 卡丁城 (server-go/CITY-NPC.md; traffic.go on
 * the node): the NPC cars near a member, five times a second, on the same
 * motion channel as the 0xC1/0xC2 city frames.
 */
export const CITY_TRAFFIC_MARKER = 0xc3;
const TRAFFIC_VERSION = 1;
const HEADER_BYTES = 12;
const ENTRY_BYTES = 10;

/** Car flags. */
export const CAR_BRAKE = 1 << 0;
export const CAR_LEFT = 1 << 1;
export const CAR_RIGHT = 1 << 2;
export const CAR_HAZARD = 1 << 3;
export const CAR_HORN = 1 << 4;

export interface TrafficCarState {
  id: number;
  path: number;
  /** Distance along the path (m). */
  s: number;
  /** Speed (m/s). */
  v: number;
  flags: number;
  model: number;
  /** Offset left of the lane (m), while going round a kart. */
  lateral: number;
}

export interface TrafficPacket {
  /** Node time of the cars' state (ms, uint32). */
  tick: number;
  network: number;
  cars: TrafficCarState[];
}

export function decodeTrafficPacket(bytes: Uint8Array): TrafficPacket | undefined {
  if (bytes.length < HEADER_BYTES || bytes[0] !== CITY_TRAFFIC_MARKER || bytes[1] !== TRAFFIC_VERSION) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(2, true);
  if (bytes.length !== HEADER_BYTES + count * ENTRY_BYTES) return undefined;
  const cars: TrafficCarState[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * ENTRY_BYTES;
    cars.push({
      id: view.getUint16(at, true),
      path: view.getUint16(at + 2, true),
      s: view.getUint16(at + 4, true) / 16,
      v: bytes[at + 6]! / 4,
      flags: bytes[at + 7]!,
      model: bytes[at + 8]!,
      lateral: view.getInt8(at + 9) / 10,
    });
  }
  return { tick: view.getUint32(4, true), network: view.getUint32(8, true), cars };
}

/** Encodes a traffic packet (tests and bots). */
export function encodeTrafficPacket(packet: TrafficPacket): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + packet.cars.length * ENTRY_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = CITY_TRAFFIC_MARKER;
  bytes[1] = TRAFFIC_VERSION;
  view.setUint16(2, packet.cars.length, true);
  view.setUint32(4, packet.tick >>> 0, true);
  view.setUint32(8, packet.network >>> 0, true);
  packet.cars.forEach((car, i) => {
    const at = HEADER_BYTES + i * ENTRY_BYTES;
    view.setUint16(at, car.id, true);
    view.setUint16(at + 2, car.path, true);
    view.setUint16(at + 4, Math.min(65535, Math.round(car.s * 16)), true);
    bytes[at + 6] = Math.min(255, Math.round(car.v * 4));
    bytes[at + 7] = car.flags;
    bytes[at + 8] = car.model;
    view.setInt8(at + 9, Math.max(-127, Math.min(127, Math.round(car.lateral * 10))));
  });
  return bytes;
}
