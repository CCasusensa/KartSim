import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import cityMap from "./city-map.json";
import { CityNav, NavField, pathLength, roundCorners, simplify } from "./city-nav";
import { ARRIVE_RADIUS, CityNavigator, distanceLabel } from "./city-navigator";
import { clampView, initialView, MAP_CONTENT, stationUnder, toDesign, toScreen, viewScale, zoomAt } from "./city-map-window";
import { designToMinimap, ribbonTriangles } from "./city-route-minimap";
import { FUEL_STATIONS } from "./city-fuel";

const nav = new CityNav(gunzipSync(readFileSync(new URL("./city-nav.bin", import.meta.url))));
const stations = cityMap.pois.filter(poi => poi.kind === "fuel") as unknown as Array<{ id: string; park: { at: [number, number] } }>;
const park = (id: string) => stations.find(station => station.id === id)!.park.at;

test("the shipped network decodes: 2 m cells over the design extent, road and connector nodes", () => {
  assert.equal(nav.cell, 2);
  assert.equal(nav.x0, cityMap.meta.extent[0]![0]);
  assert.equal(nav.z0, cityMap.meta.extent[0]![1]);
  assert.ok(nav.count > 300_000);
  let road = 0;
  for (let n = 0; n < nav.count; n++) road += nav.road[n]!;
  assert.ok(road > nav.count / 2, "mostly road");
  // Edges are symmetric: n → m implies m → n.
  for (let n = 0; n < nav.count; n += 997) for (let d = 0; d < 8; d++) {
    const m = nav.neighbour(n, d);
    if (m < 0) continue;
    let back = false;
    for (let e = 0; e < 8; e++) back ||= nav.neighbour(m, e) === n;
    assert.ok(back, `edge ${n} → ${m} has no way back`);
  }
});

test("every gas station's parking spot is on the network and all of them reach each other", () => {
  const goal = nav.nearest(...park("fuel-airport"));
  const field = new NavField(nav, goal);
  let slices = 0;
  while (!field.grow(5)) slices++;
  assert.ok(slices > 0 || field.done);
  for (const station of stations) {
    const node = nav.nearest(...station.park.at, 10);
    assert.ok(node >= 0, `${station.id} has no road within 10 m`);
    const chain = field.chain(node);
    assert.ok(chain, `${station.id} cannot reach the airport`);
    assert.deepEqual(chain.at(-1), nav.point(goal));
  }
  // Ocean Beach → airport crosses the bay: longer than the straight line, not absurdly.
  const from = park("fuel-ocean-beach"), to = park("fuel-airport");
  const length = pathLength(field.chain(nav.nearest(...from))!);
  const straight = Math.hypot(from[0] - to[0], from[1] - to[1]);
  assert.ok(length > straight && length < straight * 1.8, `route ${length} m vs ${straight} m`);
});

test("a field settles its goal first; chains wait for their node", () => {
  const goal = nav.nearest(...park("fuel-havana")), far = nav.nearest(...park("fuel-vice-point"));
  const field = new NavField(nav, goal);
  let clock = 0;
  field.grow(0, () => clock++); // one batch
  assert.equal(field.chain(far), undefined);
  assert.deepEqual(field.chain(goal), [nav.point(goal)]);
  field.grow(1e9);
  assert.ok(field.done && field.chain(far));
});

test("nearest snaps to the network, honours radius and accept", () => {
  const [x, z] = cityMap.roads[0]!.points[0]! as number[] as [number, number];
  const node = nav.nearest(x + 0.3, z - 0.4);
  const p = nav.point(node);
  assert.ok(Math.hypot(p.x - x, p.z - z) < 3, "a road point is on the network");
  assert.equal(nav.nearest(-2700, 2600, 30), -1, "the open sea");
  const other = nav.nearest(x, z, 60, undefined, n => n !== node);
  assert.ok(other >= 0 && other !== node);
});

test("simplify keeps the ends and the corners", () => {
  const line = [{ x: 0, z: 0 }, { x: 1, z: 0.1 }, { x: 2, z: 0 }, { x: 2, z: 5 }, { x: 2.1, z: 10 }];
  assert.deepEqual(simplify(line, 0.5), [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2.1, z: 10 }]);
  assert.equal(pathLength([{ x: 0, z: 0 }, { x: 3, z: 4 }]), 5);
});

test("roundCorners cuts a bend by the radius and keeps the ends", () => {
  const bend = roundCorners([{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }], 6, 4);
  assert.deepEqual(bend[0], { x: 0, z: 0 });
  assert.deepEqual(bend.at(-1), { x: 30, z: 30 });
  assert.deepEqual(bend[1], { x: 24, z: 0 });
  assert.deepEqual(bend[5], { x: 30, z: 6 });
  assert.ok(pathLength(bend) < 60);
  // Short legs: the cut is a third of the leg.
  assert.deepEqual(roundCorners([{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }], 6, 2)[1], { x: 2, z: 0 });
});

function navigatorAt(pose: { x: number; z: number } | undefined) {
  const notices: string[] = [];
  let clock = 0;
  const state = { pose };
  const navigator = new CityNavigator({ pose: () => state.pose, notice: text => notices.push(text), load: async () => nav,
    now: () => clock });
  const tick = (ms = 250) => { clock += ms; navigator.frame(clock); };
  return { navigator, notices, state, tick };
}

test("a destination routes from the rider, follows it and ends on arrival", async () => {
  const [sx, sz] = park("fuel-haiti");
  const { navigator, notices, state, tick } = navigatorAt({ x: sx, z: sz });
  assert.equal(navigator.statusText(), "点击地图选择目的地");
  const [dx, dz] = park("fuel-havana");
  assert.equal(await navigator.setDestination(dx + 5, dz, "小哈瓦那加油站"), undefined);
  const status = () => navigator.status;
  assert.equal(status(), "routing");
  for (let i = 0; i < 400 && status() !== "active"; i++) tick();
  assert.equal(status(), "active");
  assert.deepEqual(navigator.route[0], { x: sx, z: sz }, "the route starts at the rider");
  const last = navigator.route.at(-1)!;
  assert.ok(Math.hypot(last.x - dx, last.z - dz) < 8);
  assert.ok(navigator.remaining > Math.hypot(sx - dx, sz - dz));
  assert.match(navigator.statusText(), /^小哈瓦那加油站 · [\d.]+ (m|km)$/);
  const revision = navigator.revision;
  state.pose = { x: navigator.route[1]!.x, z: navigator.route[1]!.z };
  tick();
  assert.ok(navigator.revision > revision, "moving re-routes");
  state.pose = { x: navigator.destination!.x + ARRIVE_RADIUS - 1, z: navigator.destination!.z };
  tick();
  assert.equal(navigator.destination, undefined);
  assert.deepEqual(notices, ["已到达目的地：小哈瓦那加油站。"]);
});

test("off the network, the sea and clearing", async () => {
  const { navigator, state, tick } = navigatorAt({ x: -2700, z: 2600 });
  assert.equal(await navigator.setDestination(-2700, 2600), "这里附近没有能开车到的路。");
  const [dx, dz] = park("fuel-airport");
  assert.equal(await navigator.setDestination(dx, dz), undefined);
  assert.notEqual(navigator.destination?.label, undefined);
  for (let i = 0; i < 400 && navigator.status === "routing"; i++) tick();
  assert.equal(navigator.status, "off-road");
  assert.deepEqual(navigator.route, []);
  state.pose = { x: park("fuel-downtown")[0], z: park("fuel-downtown")[1] };
  tick();
  assert.equal(navigator.status, "active");
  navigator.clear();
  assert.equal(navigator.status, "idle");
  assert.deepEqual(navigator.route, []);
});

test("distances read 850 m / 1.2 km", () => {
  assert.equal(distanceLabel(846), "850 m");
  assert.equal(distanceLabel(1234), "1.2 km");
  assert.equal(distanceLabel(-3), "0 m");
});

test("the M map view: fit, round trips, zoom at the cursor, clamping, station hits", () => {
  const rect = { x: 100, y: 50, width: 600, height: 760 };
  const view = initialView();
  const scale = viewScale(view, rect);
  assert.ok(Math.abs(scale - Math.min(600 / (MAP_CONTENT.x1 - MAP_CONTENT.x0), 760 / (MAP_CONTENT.z1 - MAP_CONTENT.z0))) < 1e-12);
  const s = toScreen(view, rect, -1000, 300), back = toDesign(view, rect, s.x, s.y);
  assert.ok(Math.abs(back.x + 1000) < 1e-9 && Math.abs(back.z - 300) < 1e-9);
  const zoomed = zoomAt(view, rect, 300, 400, 3);
  const anchorBefore = toDesign(view, rect, 300, 400), anchorAfter = toDesign(zoomed, rect, 300, 400);
  assert.equal(zoomed.zoom, 3);
  assert.ok(Math.hypot(anchorBefore.x - anchorAfter.x, anchorBefore.z - anchorAfter.z) < 1e-6);
  assert.equal(zoomAt(zoomed, rect, 300, 400, 100).zoom, 10);
  assert.equal(zoomAt(view, rect, 300, 400, 0.1).zoom, 1);
  // Panned far away, the view comes back to the content edge.
  const clamped = clampView({ cx: 5000, cz: -5000, zoom: 4 }, rect);
  const corner = toDesign(clamped, rect, rect.x + rect.width, rect.y);
  assert.ok(Math.abs(corner.x - MAP_CONTENT.x1) < 1e-6 && Math.abs(corner.z - MAP_CONTENT.z0) < 1e-6);
  for (const station of FUEL_STATIONS) {
    const at = toScreen(view, rect, station.x, station.z);
    assert.equal(stationUnder(view, rect, at.x, at.y - 2)?.id, station.id);
  }
  assert.equal(stationUnder(view, rect, rect.x + 2, rect.y + 2), undefined);
});

test("the HUD minimap frame and the route ribbon", () => {
  // The city's ToMinimap record (import-city.mjs): half extents, 256² canvas.
  const source = { centerX: 1600, centerY: 2350, canvasWidth: 256, canvasHeight: 256 };
  assert.deepEqual(designToMinimap(source, 0, 0), [1328, 478]);
  assert.deepEqual(designToMinimap(source, -100, 200), [1228, 278]);
  // A two-point ribbon: 2 discs of 8 triangles + one quad.
  const triangles = ribbonTriangles([[0, 0], [10, 0]], 4, 0.3);
  assert.equal(triangles.length, (2 * 8 + 2) * 9);
  for (let i = 2; i < triangles.length; i += 3) assert.equal(triangles[i], Math.fround(0.3));
  let maxY = 0;
  for (let i = 1; i < triangles.length; i += 3) maxY = Math.max(maxY, Math.abs(triangles[i]!));
  assert.ok(Math.abs(maxY - 2) < 1e-6, "half the width either side");
});
