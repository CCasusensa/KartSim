import assert from "node:assert/strict";
import test from "node:test";
import { createSpeedDriver } from "../driving/item-test-fixtures";
import { CitySession, type CityLobbyHost } from "./city-session";
import { designToWorld, nearestRoadPoint, worldToDesign } from "./city-coordinates";
import { applyCityVehicleScale, cityVisualScale } from "./city-vehicle-scale";

function scenario() {
  const notices: string[] = [], respawns: unknown[] = [];
  let anchors = 0, routeResets = 0, cancellations = 0;
  const session = new CitySession({
    client: {} as CityLobbyHost["client"], playerId: "local", disposed: false, render() {},
    options: { library: {}, root: {}, status(text) { notices.push(text); } },
  });
  const physics = createSpeedDriver().vehicle;
  applyCityVehicleScale(physics);
  const start = designToWorld(-1593, 10, 449);
  physics.reset(start.x, start.y, start.z, 0);
  physics.body.linearVelocity.z = 30;
  const local = {
    physics, disposed: false, lifecycle: { state: 2 },
    dependencies: { runtime: { states: { Racing: 2 } } },
    resetState: { phase: 0 }, lowSpeedResetStartedAtMs: 900,
    resetSoundPending: false,
    cancelModeDrivingInput() { cancellations++; },
    coordinator: { synchronizePositionAnchor() { anchors++; } },
    track: {
      rayQuery(origin: { y: number }) {
        return origin.y > 10 ? { point: { y: 10 }, normal: { y: 1 } } : undefined;
      },
      resetRouteState() { routeResets++; },
      getRouteState() { return { distance: 20 }; },
      prepareCurrentSectionReset() { throw new Error("City recovery must not enter race checkpoints"); },
    },
  };
  session.stage = { runtime: { local } };
  session.network = { respawn: async (pose: unknown) => { respawns.push(pose); } } as any;
  return { session, local, notices, respawns, counts: () => ({ anchors, routeResets, cancellations }) };
}

test("city reset stays on the nearest road and notifies the city node without a race reset", () => {
  const { session, local, respawns, notices, counts } = scenario();
  const nearest = nearestRoadPoint(-1593, 449);
  assert.equal(session.resetToRoad(), true);
  const position = local.physics.body.position;
  const design = worldToDesign(position.x, position.y, position.z);
  assert.ok(Math.hypot(design.x - nearest.x, design.z - nearest.z) < .001);
  assert.ok(Math.abs(position.y - 10.4) < .001, "ground snapped");
  assert.equal(local.physics.body.linearVelocity.z, 0);
  assert.deepEqual(local.physics.state.visualScale, cityVisualScale());
  assert.equal(local.resetState.phase, 0);
  assert.equal(local.resetSoundPending, true);
  assert.equal(local.lowSpeedResetStartedAtMs, 0);
  assert.deepEqual(counts(), { anchors: 1, routeResets: 1, cancellations: 1 });
  assert.equal(respawns.length, 1);
  assert.equal((respawns[0] as any).x, nearest.x);
  assert.equal((respawns[0] as any).z, nearest.z);
  assert.equal(session.disposed, false);
  assert.equal(notices.at(-1), "已复位到最近的道路。");
});

test("city reset ignores disposed, waiting and already resetting sessions", () => {
  for (const change of [
    (value: ReturnType<typeof scenario>) => { value.session.disposed = true; },
    (value: ReturnType<typeof scenario>) => { value.local.disposed = true; },
    (value: ReturnType<typeof scenario>) => { value.local.lifecycle.state = 0; },
    (value: ReturnType<typeof scenario>) => { value.local.resetState.phase = 1; },
  ]) {
    const value = scenario();
    change(value);
    assert.equal(value.session.resetToRoad(), false);
    assert.equal(value.respawns.length, 0);
    assert.equal(value.notices.length, 0);
    assert.deepEqual(value.counts(), { anchors: 0, routeResets: 0, cancellations: 0 });
  }
});
