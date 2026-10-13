import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CAR_BRAKE, CAR_HORN, decodeTrafficPacket, encodeTrafficPacket } from "./city-traffic-protocol";
import {
  ASPECT_GREEN, ASPECT_RED, ASPECT_YELLOW, loadTrafficNetwork, pointAt, signalAspect, type TrafficNetwork,
} from "./city-traffic-network";
import { CityTraffic, NPC_PRESETS, npcEquipment, withTraffic } from "./city-traffic";
import npcData from "./city-npcs.json";
import { designToWorld } from "./city-coordinates";

const network = await loadTrafficNetwork();

test("traffic packets round-trip (1/16 m, 0.25 m/s, 0.1 m lateral) and reject other frames", () => {
  const packet = { tick: 0xfffffff0, network: network.wireId, cars: [
    { id: 7, path: 412, s: 123.4375, v: 9.25, flags: CAR_BRAKE | CAR_HORN, model: 200, lateral: 2.4 },
    { id: 65535, path: 0, s: 0, v: 0, flags: 0, model: 0, lateral: -1.5 },
  ] };
  const bytes = encodeTrafficPacket(packet);
  assert.equal(bytes.length, 12 + 2 * 10);
  assert.deepEqual(decodeTrafficPacket(bytes), packet);
  assert.equal(decodeTrafficPacket(bytes.subarray(0, 21)), undefined);
  bytes[0] = 0xc2;
  assert.equal(decodeTrafficPacket(bytes), undefined);
});

test("the browser's network is the design network the node embeds", () => {
  const design = readFileSync(new URL("../../../design/open-world/vice-city/traffic-network.json", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./traffic-network.json", import.meta.url), "utf8");
  assert.equal(copy, design, "client/src/city/traffic-network.json is stale: run tools/city/traffic/build-traffic-network.mjs");
  assert.equal(network.wireId, parseInt(network.id.slice(0, 8), 16));
  assert.ok(network.paths.length > 500 && network.junctions.length > 50);
});

test("points along a path, with a lateral offset to the left of travel", () => {
  const lane = network.paths.find(p => !p.link && p.length > 50)!;
  const start = pointAt(lane, 0);
  assert.equal(start.x, lane.x[0]);
  assert.equal(start.z, lane.z[0]);
  const end = pointAt(lane, lane.length + 10);
  assert.ok(Math.abs(end.x - lane.x[lane.x.length - 1]!) < 1e-9);
  const middle = pointAt(lane, lane.length / 2);
  const left = pointAt(lane, lane.length / 2, 2);
  // Left of travel (x east, z south) is (dz, −dx).
  assert.ok(Math.abs(left.x - (middle.x + middle.dz * 2)) < 1e-9);
  assert.ok(Math.abs(left.z - (middle.z - middle.dx * 2)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(middle.dx, middle.dz) - 1) < 1e-9);
});

test("signal plans match the node's (traffic_test.go TestSignalPlan)", () => {
  const plan = { greenA: 14, greenB: 11, yellow: 3, allRed: 2, offset: 0 };
  const cases: Array<[number, number, number]> = [
    [0, 0, ASPECT_GREEN], [0, 13_999, ASPECT_GREEN], [0, 14_000, ASPECT_YELLOW], [0, 17_000, ASPECT_RED],
    [1, 0, ASPECT_RED], [1, 18_999, ASPECT_RED], [1, 19_000, ASPECT_GREEN], [1, 30_000, ASPECT_YELLOW],
    [1, 33_000, ASPECT_RED], [0, 34_999, ASPECT_RED], [0, 35_000, ASPECT_GREEN],
  ];
  for (const [group, tick, aspect] of cases) assert.equal(signalAspect(plan, group, tick), aspect, `group ${group} at ${tick}`);
  // Never both groups green.
  for (let tick = 0; tick < 35_000; tick += 250)
    assert.ok(!(signalAspect(plan, 0, tick) === ASPECT_GREEN && signalAspect(plan, 1, tick) === ASPECT_GREEN));
});

test("every signal lamp faces an approach that arrives at its junction", () => {
  let lamps = 0;
  for (const junction of network.junctions) {
    if (junction.control !== "signal") continue;
    assert.ok(junction.signal, "signal junction without a plan");
    for (const lamp of junction.lamps ?? []) {
      lamps++;
      const approach = junction.approaches[lamp.approach]!;
      assert.ok(approach.in.length > 0);
      assert.ok(Math.hypot(lamp.x - junction.x, lamp.z - junction.z) < 40);
    }
  }
  assert.ok(lamps > 50, `${lamps} lamps`);
});

function fakeTraffic(net: TrafficNetwork, clock: { now: number }) {
  return new CityTraffic({
    assets: { participants: [] }, presenter: { views: new Map(), scene: { add() {}, remove() {} } },
    track: { rayQuery: (origin: { y: number }) => (origin.y > 10 ? { point: { y: 10 }, normal: { y: 1 } } : undefined) },
    library: {}, network: net, serverNow: () => clock.now, localPosition: () => undefined, onError: error => { throw error; },
  });
}

test("a car is replayed along the lane and into the junction link it took", () => {
  const lane = network.paths.find(p => !p.link && p.length > 40)!;
  const link = network.paths[lane.next[0]!]!;
  const clock = { now: 100_000 };
  const traffic = fakeTraffic(network, clock);
  const car = (s: number, path: number, tick: number) => ({ tick, network: network.wireId,
    cars: [{ id: 9, path, s, v: 10, flags: 0, model: 3, lateral: 0 }] });
  traffic.receive(car(lane.length - 2, lane.index, 100_000));
  traffic.receive(car(1, link.index, 100_200));
  // Replayed 260 ms in the past: halfway between the packets is 100 100.
  clock.now = 100_100 + 260;
  const pose = (traffic as any).poseOf(traffic.cars.get(9));
  // 2 m left on the lane plus 1 m on the link: halfway is the lane's end.
  const expected = designToWorld(lane.x[lane.x.length - 1]!, 0, lane.z[lane.z.length - 1]!);
  assert.ok(Math.hypot(pose.position.x - expected.x, pose.position.z - expected.z) < 0.6,
    `pose ${pose.position.x},${pose.position.z} vs ${expected.x},${expected.z}`);
  // On the road (flat at y 10) plus the body lift, forward along the lane.
  assert.ok(Math.abs(pose.position.y - 10.12) < 1e-6);
  const end = pointAt(lane, lane.length - 0.5);
  assert.ok(pose.forward.x * end.dx + pose.forward.z * end.dz > 0.9);
  // The engine's "right" is to the west of a kart facing north: forward × right is up.
  const f = pose.forward, r = pose.right;
  const cross = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
  assert.ok(Math.hypot(cross.x - pose.up.x, cross.y - pose.up.y, cross.z - pose.up.z) < 1e-9);
  assert.ok(pose.up.y > 0.99);
  // Packets from another network are ignored.
  traffic.receive({ ...car(5, lane.index, 100_400), network: network.wireId ^ 1, cars: [{ id: 10, path: 0, s: 5, v: 0, flags: 0, model: 0, lateral: 0 }] });
  assert.equal(traffic.cars.has(10), false);
});

test("the remotes proxy sends NPC ids to the traffic and the rest to the fleet", () => {
  const fleet = { copyWebPose: (id: string) => `fleet:${id}`, hasDeparted: (_id: string) => false, other: () => "fleet", value: 3 };
  const traffic = { copyWebPose: (id: string) => `traffic:${id}`, hasDeparted: () => true };
  const remotes = withTraffic(fleet, () => traffic as unknown as CityTraffic);
  assert.equal(remotes.copyWebPose("p1"), "fleet:p1");
  assert.equal(remotes.copyWebPose("npc:4"), "traffic:npc:4");
  assert.equal(remotes.hasDeparted("npc:4"), true);
  assert.equal(remotes.other(), "fleet");
  assert.equal(remotes.value, 3);
  const empty = withTraffic(fleet, () => undefined);
  assert.equal(empty.copyWebPose("npc:1"), undefined);
});

test("NPC karts carry a full equipment document; task-point NPCs have what they need", () => {
  for (const preset of NPC_PRESETS) {
    const equipment = npcEquipment(preset);
    assert.equal(equipment.itemIds[1], preset.character);
    assert.equal(equipment.itemIds[3], preset.kart);
    assert.ok(equipment.itemIds[2]! >= 1 && equipment.itemIds[70]! >= 1);
    assert.equal(equipment.itemIds[52], 0);
    assert.ok(preset.driver.length > 0);
  }
  assert.ok(npcData.npcs.length >= 6);
  for (const npc of npcData.npcs) {
    assert.ok(npc.name && npc.lines.length > 0 && npc.character > 0 && npc.dye > 0, npc.id);
    assert.ok(Number.isFinite(npc.x) && Number.isFinite(npc.z) && Number.isFinite(npc.heading), npc.id);
  }
  assert.equal(npcData.network, network.id, "city-npcs.json was placed on another network: run build-city-npcs.mjs");
});
