import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeCityMotionFrame, decodeCityRadar, encodeCityMotionFrame, encodeCityRadar, parseCityEvent, parseCitySnapshot,
} from "./city-protocol";
import { clockLabel, daylightAt, skyStateAt, timeOfDayAt } from "./city-clock";

test("city motion frames round-trip and reject other markers", () => {
  const payload = new Uint8Array(80).map((_, i) => i);
  const frame = encodeCityMotionFrame(8, 0xfffffff0, payload);
  assert.equal(frame.length, 88);
  const decoded = decodeCityMotionFrame(frame)!;
  assert.deepEqual({ kind: decoded.kind, id: decoded.id, sequence: decoded.sequence }, { kind: 8, id: 0, sequence: 0xfffffff0 });
  assert.deepEqual([...decoded.payload], [...payload]);
  frame[2] = 7;
  assert.equal(decodeCityMotionFrame(frame)!.id, 7);
  assert.equal(decodeCityMotionFrame(new Uint8Array([1, 2, 3])), undefined);
});

test("radar frames quantise positions to 0.25 m and headings to 256 steps", () => {
  const entries = [{ id: 5, x: -123.5, z: 987.25, heading: 90 }, { id: 65535, x: 0, z: 0, heading: 359 }];
  const decoded = decodeCityRadar(encodeCityRadar(entries))!;
  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded[0], { id: 5, x: -123.5, z: 987.25, heading: 90 });
  assert.equal(decoded[1]!.id, 65535);
  assert.ok(Math.abs(decoded[1]!.heading - 359) < 1.5);
  assert.equal(decodeCityRadar(new Uint8Array([0xc2, 0, 5, 0])), undefined);
});

test("snapshots and events are validated", () => {
  const snapshot = parseCitySnapshot({
    instanceId: "city-1", line: 1, name: "卡丁城 线路 1", capacity: 60,
    clock: { serverTick: 1000, timeOfDay: 0.5, dayLengthMs: 2880000, weather: "rain", weatherUntilTick: 5000 },
    you: { id: 3, spawn: { id: "spawn-main", x: 0, y: 0, z: 95, heading: 0 } },
    members: [{ id: 2, playerId: "p2", name: "Bob", equipment: {}, state: "parked", pose: { x: 1, y: 0, z: 2, heading: 90 } }],
  });
  assert.equal(snapshot.you.spawn.id, "spawn-main");
  assert.equal(snapshot.members[0]!.state, "parked");
  assert.equal(snapshot.clock.weather, "rain");
  assert.throws(() => parseCitySnapshot({ instanceId: "x" }), /城市快照/);
  const event = parseCityEvent({ type: "city-chat", instanceId: "city-1", id: 2, name: "Bob", text: "hi", channel: "city", sequence: 4 });
  assert.equal(event?.type, "city-chat");
  assert.equal(parseCityEvent({ type: "room" }), undefined);
  assert.throws(() => parseCityEvent({ type: "city-emote", id: 2 }), /city-emote/);
});

test("the clock extrapolates and the sky curve is dark at night", () => {
  const clock = { serverTick: 0, timeOfDay: 0.9, dayLengthMs: 1000, weather: "clear" as const, weatherUntilTick: 0 };
  assert.ok(Math.abs(timeOfDayAt(clock, 200) - 0.1) < 1e-9);
  assert.equal(daylightAt(0.5), 1);
  assert.equal(daylightAt(0), 0);
  const night = skyStateAt(clock, 50);
  const noon = skyStateAt({ ...clock, timeOfDay: 0.5 }, 0);
  assert.ok(night.lightFactor < 0.4 && noon.lightFactor === 1);
  assert.ok(night.skyColor[2] < noon.skyColor[2]);
  const rain = skyStateAt({ ...clock, timeOfDay: 0.5, weather: "rain", weatherUntilTick: 100000 }, 20000);
  assert.equal(rain.precipitation, 1);
  assert.equal(clockLabel(0.5), "12:00");
  assert.equal(clockLabel(0.99999), "23:59");
});
