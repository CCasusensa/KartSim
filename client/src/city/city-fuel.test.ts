import assert from "node:assert/strict";
import test from "node:test";

import {
  affordableMl, defaultRefuelMl, distanceText, FuelGauge, fuelErrorText, fuelPrompt, fuelWarning, liters,
  nearestStation, parseFuelStations, refuelCost, stationAt, stepRefuelMl, tankClassName, FUEL_STATIONS,
} from "./city-fuel";
import { parseCityEvent, parseCityFuel, parseCityRescueReply, parseCitySnapshot } from "./city-protocol";
import type { CityFuel } from "./city-protocol";
import { parseServerEvent } from "../multiplayer/server-events";

const stations = parseFuelStations([
  { id: "spawn-main", kind: "spawn", at: [0, 0] },
  { id: "fuel-a", name: "甲加油站", kind: "fuel", at: [100, 0], y: 10, zone: [[90, -10], [110, -10], [110, 10], [90, 10]],
    park: { at: [100, 0], y: 10, heading: 90 } },
  { id: "fuel-b", name: "乙加油站", kind: "fuel", at: [2000, 0], zone: [[1990, -10], [2010, -10], [2010, 10]],
    park: { at: [2000, 0] } },
  { id: "fuel-broken", kind: "fuel", at: [5, 5], zone: [[0, 0]], park: { at: [5, 5] } },
]);

const tank = (changes: Partial<CityFuel> = {}): CityFuel => ({
  kartName: "爆烈 C1", sizeClass: "medium", capacityMl: 40_000, fuelMl: 10_000, useMlPerKm: 2_800,
  pricePerLiter: 5, rescueFee: 300, lucci: 10_000, empty: false, ...changes,
});

test("fuel POIs become stations; the zone test allows 1 m outside", () => {
  assert.deepEqual(stations.map(station => station.id), ["fuel-a", "fuel-b"]);
  assert.equal(stations[0]!.park.heading, 90);
  assert.equal(stationAt(100, 0, stations)?.id, "fuel-a");
  assert.equal(stationAt(110.9, 0, stations)?.id, "fuel-a");
  assert.equal(stationAt(111.5, 0, stations), undefined);
  assert.equal(nearestStation(1500, 0, stations)?.station.id, "fuel-b");
  assert.equal(Math.round(nearestStation(40, 0, stations)!.distance), 60);
});

test("the shipped map has the gas stations, each parking inside its zone", () => {
  assert.ok(FUEL_STATIONS.length >= 1, "city-map.json lists no gas station");
  for (const station of FUEL_STATIONS) {
    assert.equal(stationAt(station.park.x, station.park.z)?.id, station.id, `${station.id} parks outside its zone`);
    assert.ok(station.name.endsWith("加油站"), station.name);
  }
});

test("litres, distances, costs and the class names", () => {
  assert.equal(liters(23_449), "23.4");
  assert.equal(liters(0), "0.0");
  assert.equal(distanceText(842.4), "842 m");
  assert.equal(distanceText(1250), "1.3 km");
  assert.equal(refuelCost(4_001, 5), 21);
  assert.equal(refuelCost(0, 5), 0);
  assert.equal(affordableMl(21, 5), 4_200);
  assert.equal(tankClassName("huge"), "巨型");
  assert.equal(tankClassName("??"), "中型");
});

test("the refuel amount fills the tank or what the wallet buys, in 5 L steps", () => {
  assert.equal(defaultRefuelMl(tank()), 30_000);
  assert.equal(defaultRefuelMl(tank({ lucci: 100 })), 20_000);
  assert.equal(stepRefuelMl(tank(), 30_000, -5), 25_000);
  assert.equal(stepRefuelMl(tank(), 27_300, -5), 25_000);
  assert.equal(stepRefuelMl(tank(), 27_300, 5), 30_000);
  assert.equal(stepRefuelMl(tank(), 2_000, -5), 0);
  assert.equal(stepRefuelMl(tank({ lucci: 100 }), 20_000, 5), 20_000);
});

test("the gauge burns by the local odometer between node updates and skips teleports", () => {
  const gauge = new FuelGauge();
  gauge.apply(tank({ fuelMl: 1_000, useMlPerKm: 2_000 }));
  gauge.advance({ x: 0, y: 0, z: 0 });
  gauge.advance({ x: 10, y: 0, z: 0 });
  assert.equal(gauge.displayMl, 980);
  gauge.advance({ x: 500, y: 0, z: 0 }); // a reset, not driving
  assert.equal(gauge.displayMl, 980);
  gauge.apply(tank({ fuelMl: 900, useMlPerKm: 2_000 }));
  assert.equal(gauge.displayMl, 900);
  assert.equal(Math.round(gauge.rangeMeters), 450);
  for (let x = 510; x < 2000; x += 10) gauge.advance({ x, y: 0, z: 0 });
  assert.equal(gauge.displayMl, 0);
});

test("warnings and prompts: refuel at a stopped station, rescue when empty elsewhere", () => {
  assert.equal(fuelWarning(0.5, false), undefined);
  assert.equal(fuelWarning(0.15, false), "low");
  assert.equal(fuelWarning(0.05, false), "critical");
  assert.equal(fuelWarning(0, true), "empty");
  assert.equal(fuelPrompt(undefined, 100, 0, 0, stations).kind, "none");
  assert.equal(fuelPrompt(tank(), 100, 0, 0, stations).kind, "refuel");
  assert.match((fuelPrompt(tank(), 100, 0, 0, stations) as { text: string }).text, /甲加油站 · 按 F 加油/);
  assert.equal(fuelPrompt(tank(), 100, 0, 30, stations).kind, "slow-down");
  assert.equal(fuelPrompt(tank({ fuelMl: 40_000 }), 100, 0, 0, stations).kind, "full");
  // A few millilitres of room (under the 0.1 L shown) is full, not a 1 金币 refill.
  assert.equal(fuelPrompt(tank({ fuelMl: 39_950 }), 100, 0, 0, stations).kind, "full");
  assert.equal(fuelPrompt(tank({ fuelMl: 39_900 }), 100, 0, 0, stations).kind, "refuel");
  assert.equal(fuelPrompt(tank(), 500, 0, 0, stations).kind, "none");
  const rescue = fuelPrompt(tank({ fuelMl: 0, empty: true }), 500, 0, 0, stations);
  assert.equal(rescue.kind, "rescue");
  assert.match((rescue as { text: string }).text, /300 金币/);
  // An empty kart towed to the pumps is offered fuel, not another tow.
  assert.equal(fuelPrompt(tank({ fuelMl: 0, empty: true }), 100, 0, 0, stations).kind, "refuel");
});

test("the protocol carries the tank in the snapshot, city-fuel and the rescue reply", () => {
  const fuelJSON = { kartName: "擎天柱", sizeClass: "huge", capacityMl: 82_000, fuelMl: 0, useMlPerKm: 4060,
    pricePerLiter: 5, rescueFee: 300, lucci: 50, empty: true };
  assert.deepEqual(parseCityFuel(fuelJSON), fuelJSON);
  assert.equal(parseCityFuel({ ...fuelJSON, capacityMl: 0 }), undefined);
  assert.equal(parseCityFuel({ ...fuelJSON, fuelMl: -1 }), undefined);
  const snapshot = parseCitySnapshot({
    instanceId: "city-1", line: 1, name: "卡丁城 线路 1", capacity: 60, members: [],
    clock: { serverTick: 1, timeOfDay: 0.5, dayLengthMs: 1000, weather: "clear" },
    you: { id: 1, spawn: { x: 1, y: 2, z: 3, heading: 0 }, fuel: fuelJSON },
  });
  assert.equal(snapshot.you.fuel?.capacityMl, 82_000);
  const noFuel = parseCitySnapshot({
    instanceId: "city-1", line: 1, name: "n", capacity: 60, members: [],
    clock: { serverTick: 1, timeOfDay: 0.5, dayLengthMs: 1000, weather: "clear" },
    you: { id: 1, spawn: { x: 1, y: 2, z: 3, heading: 0 } },
  });
  assert.equal(noFuel.you.fuel, undefined);
  const event = parseCityEvent({ type: "city-fuel", instanceId: "city-1", reason: "empty", fuel: fuelJSON });
  assert.equal(event?.type, "city-fuel");
  const tow = parseCityRescueReply({ type: "city-rescue", station: "fuel-a", stationName: "甲加油站",
    pose: { x: 100, y: 10, z: 0, heading: 90 }, cost: 0, free: true, fuel: fuelJSON });
  assert.equal(tow.stale, false);
  assert.equal(tow.free, true);
  assert.equal(parseCityRescueReply({ stale: true, fuel: fuelJSON }).stale, true);
});

test("the refuel and rescue replies pass the connection's control validator", () => {
  // An unknown control message closes the whole game connection.
  const deps = { validRoom: () => false, validChannel: () => false, validGameplay: () => false, validRandomTrackCode: () => false };
  const fuel = { kartName: "k", sizeClass: "small", capacityMl: 28_000, fuelMl: 28_000, useMlPerKm: 2440,
    pricePerLiter: 5, rescueFee: 300, lucci: 19_993, empty: false };
  const refuel = parseServerEvent({ type: "city-refuel", requestId: "r-1", station: "fuel-havana",
    addedMl: 1377, cost: 7, fuel }, deps);
  assert.equal(refuel?.type, "city-refuel");
  const rescue = parseServerEvent({ type: "city-rescue", requestId: "r-2", stale: true, fuel }, deps);
  assert.equal(rescue?.type, "city-rescue");
  // Without a request one is no event the city handles, but the connection stays.
  assert.notEqual(parseServerEvent({ type: "city-refuel", fuel }, deps), undefined);
});

test("refusals read in Chinese", () => {
  assert.equal(fuelErrorText(new Error("INSUFFICIENT_FUNDS")), "金币不足。");
  assert.equal(fuelErrorText(new Error("WHATEVER")), "操作失败：WHATEVER");
});

test("the gauge is green from 60 %, yellow from 20 %, red below", async () => {
  const { gaugeColor, gaugeTexture } = await import("./city-fuel-hud");
  assert.equal(gaugeTexture(1), "full");
  assert.equal(gaugeTexture(0.6), "full");
  assert.equal(gaugeTexture(0.59), "half");
  assert.equal(gaugeTexture(0.2), "half");
  assert.equal(gaugeTexture(0.19), "low");
  assert.equal(gaugeTexture(0), "low");
  assert.equal(gaugeColor(0.7), "#4cff7a");
  assert.equal(gaugeColor(0.3), "#ffd23f");
  assert.equal(gaugeColor(0.1), "#ff4d4d");
});
