import assert from "node:assert/strict";
import test from "node:test";
import { beginCityLoading, firstCityFrame, type CityLoadingDependencies,
  type CityLoadingHost } from "./city-loading";
import { activeCitySession, CitySession, enterCity, type CityLobbyHost } from "./city-session";
import { enterCityOnNode } from "../multiplayer/race-host";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const messages: string[] = [], errors: string[] = [];
  const listeners = new Set<() => void>();
  let loads = 0, disposals = 0, bytes = 0;
  const view = { showStatus: (message: string) => messages.push(message),
    dispose: () => { disposals++; } };
  const deps: CityLoadingDependencies = {
    load: async () => { loads++; return view; },
    resources: () => ({
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      trackContainers: () => ["track_kartcity.rho"],
      bytesOf: () => 80 * 1048576,
      bytesDone: () => bytes,
    }),
  };
  const host: CityLoadingHost = { disposed: false,
    options: { library: {}, root: {}, status: message => errors.push(message) } };
  return { host, deps, view, messages, errors, listeners,
    counts: () => ({ loads, disposals }),
    download(value: number) { bytes = value; for (const listener of listeners) listener(); } };
}

test("one multiplayer loading overlay spans home, node and session with real byte progress", async () => {
  const f = fixture();
  const home = beginCityLoading(f.host, undefined, f.deps);
  await home.ready;
  const nodeHost = { ...f.host, options: { ...f.host.options, cityLoading: home } };
  const node = beginCityLoading(nodeHost, undefined, f.deps);
  home.dispose();
  // The homepage owner has returned; the in-flight node keeps the shared view alive.
  const session = beginCityLoading(nodeHost, undefined, f.deps);
  session.stage("正在下载城市地图…", "kartcity");
  assert.equal(f.messages.at(-1), "正在下载城市地图…  0.0 / 80.0 MB");
  f.download(24 * 1048576);
  assert.equal(f.messages.at(-1), "正在下载城市地图…  24.0 / 80.0 MB");
  session.stage("正在准备城市、车辆和界面…");
  f.download(80 * 1048576);
  assert.equal(f.messages.at(-1), "正在准备城市、车辆和界面…");
  node.dispose();
  assert.deepEqual(f.counts(), { loads: 1, disposals: 0 });
  session.dispose(); session.dispose();
  assert.deepEqual(f.counts(), { loads: 1, disposals: 1 });
  assert.equal(f.listeners.size, 0);
});

test("aborting while the loading art arrives removes listeners and never revives the overlay", async () => {
  const f = fixture(), pending = deferred<typeof f.view>(), abort = new AbortController();
  f.deps.load = () => pending.promise;
  const loading = beginCityLoading(f.host, abort.signal, f.deps);
  abort.abort();
  await loading.ready;
  assert.equal(loading.active, false);
  assert.equal(f.listeners.size, 0);
  pending.resolve(f.view);
  await pending.promise;
  await Promise.resolve();
  assert.equal(f.counts().disposals, 1);
  assert.deepEqual(f.messages, []);
  loading.dispose();
  assert.equal(f.counts().disposals, 1);
});

test("loading art errors report a failure without blocking entry or retaining progress subscriptions", async () => {
  const f = fixture();
  f.deps.load = async () => { throw new Error("missing image"); };
  const loading = beginCityLoading(f.host, undefined, f.deps);
  await loading.ready;
  assert.match(f.errors[0]!, /missing image/);
  loading.stage("正在准备城市、车辆和界面…");
  loading.dispose();
  assert.equal(f.listeners.size, 0);
});

test("first-frame completion waits for a real render and restores the original method on abort", async () => {
  const abort = new AbortController();
  let renders = 0, complete = false;
  const stage = { render(value: number) { assert.equal(this, stage); renders++; return value + 1; } };
  const original = stage.render;
  const frame = firstCityFrame(stage, abort.signal).then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  assert.equal(stage.render(41), 42);
  await frame;
  assert.equal(complete, true);
  assert.equal(renders, 1);
  assert.equal(stage.render, original);
  const cancelled = firstCityFrame(stage, abort.signal);
  abort.abort();
  await cancelled;
  assert.equal(stage.render, original);
  assert.equal(renders, 1);
});

const snapshot = {
  instanceId: "city-1", line: 1, name: "卡丁城 线路 1", capacity: 60,
  clock: { serverTick: 1000, timeOfDay: .5, dayLengthMs: 2880000,
    weather: "clear", weatherUntilTick: 0 },
  you: { id: 3, spawn: { id: "spawn-main", x: 0, y: 0, z: 95, heading: 0 } },
  members: [],
};
function sessionFixture(f: ReturnType<typeof fixture>, failPrepare = false) {
  const scheduled = deferred<void>();
  const stage = { bindClock() {}, updateRoom() {},
    render() { return "city-frame"; }, scheduleStart() { scheduled.resolve(); } };
  const loading = beginCityLoading(f.host, undefined, f.deps);
  const host: CityLobbyHost = {
    disposed: false, playerId: "p1", render() {},
    client: { request: async () => snapshot, subscribe: () => () => {}, captureClock: () => ({ offsetMs: 0 }) },
    options: { ...f.host.options, cityLoading: loading,
      raceLoader: { prepare: async () => {
        if (failPrepare) throw new Error("scene failed");
        return stage;
      } } },
  };
  const session = new CitySession(host);
  // This test covers entry/loading ownership; physical scene installation has its own tests.
  Object.assign(session, { installCity() {}, teleportLocal() {} });
  return { session, host, loading, stage, scheduled };
}

test("CitySession keeps the loading skin through scene preparation until its first rendered frame", async () => {
  const f = fixture(), { session, loading, stage, scheduled } = sessionFixture(f);
  let entered = false;
  const enter = session.enter().then(() => { entered = true; });
  loading.dispose();
  await scheduled.promise;
  assert.equal(entered, false);
  assert.equal(f.counts().disposals, 0);
  assert.equal(f.messages.at(-1), "正在显示卡丁城…");
  assert.ok(f.messages.some(message => message.startsWith("正在下载城市地图…")));
  assert.ok(f.messages.includes("正在准备城市、车辆和界面…"));
  stage.render();
  await enter;
  assert.equal(entered, true);
  assert.equal(f.counts().disposals, 1);
  assert.equal(f.listeners.size, 0);
  session.network?.dispose();
});

test("CitySession releases its loading overlay if scene preparation fails", async () => {
  const f = fixture(), { session, loading } = sessionFixture(f, true);
  const enter = session.enter();
  loading.dispose();
  await assert.rejects(enter, /scene failed/);
  assert.equal(f.counts().disposals, 1);
  assert.equal(f.listeners.size, 0);
  session.network?.dispose();
});

test("closing the lobby while node assignment is pending removes an inherited homepage overlay", async () => {
  const f = fixture(), home = beginCityLoading(f.host, undefined, f.deps);
  const requested = deferred<void>(), assignment = deferred<any>();
  const lobby = { request: () => { requested.resolve(); return assignment.promise; } };
  const accountAbort = new AbortController();
  let created = false;
  const host = {
    ...f.host, options: { ...f.host.options, cityLoading: home }, accountAbort,
    client: lobby, lobbyClient: lobby,
    nodeDependencies: { createClient() { created = true; throw new Error("cancelled node"); } },
  } as unknown as Parameters<typeof enterCityOnNode>[0];
  const enter = enterCityOnNode(host);
  home.dispose();
  await requested.promise;
  assert.equal(f.host.disposed, false, "the homepage controller itself is still alive");
  assert.equal(f.counts().disposals, 0);
  accountAbort.abort();
  assert.equal(f.counts().disposals, 1);
  assert.equal(f.listeners.size, 0);
  assignment.resolve({ name: "test" });
  await enter;
  assert.equal(created, false);
});

test("a scene returned after account cancellation is disposed without publication", async () => {
  const f = fixture(), { session, host, loading } = sessionFixture(f);
  host.accountAbort = new AbortController();
  const preparing = deferred<void>(), prepared = deferred<any>();
  let stageDisposals = 0, installations = 0;
  host.options.raceLoader = { prepare: () => { preparing.resolve(); return prepared.promise; } };
  Object.assign(session, { installCity() { installations++; } });
  const enter = session.enter();
  loading.dispose();
  await preparing.promise;
  host.accountAbort.abort();
  assert.equal(session.disposed, true);
  assert.equal(session.abort.signal.aborted, true);
  assert.equal(session.network?.disposed, true);
  assert.equal(f.counts().disposals, 1);
  prepared.resolve({ dispose() { stageDisposals++; } });
  await enter;
  assert.equal(stageDisposals, 1);
  assert.equal(session.stage, undefined);
  assert.equal(installations, 0);
});

test("cancelled or disposed city joins clear the current session and allow another entry", async () => {
  for (const cancelWithSignal of [false, true]) {
    const f = fixture(), { host, loading } = sessionFixture(f);
    host.accountAbort = new AbortController();
    const joining = deferred<void>(), joined = deferred<any>();
    host.client.request = () => { joining.resolve(); return joined.promise; };
    const enter = enterCity(host);
    loading.dispose();
    await joining.promise;
    const session = activeCitySession();
    assert.ok(session, "a subsequent entry must not be blocked by the previous session");
    if (cancelWithSignal) {
      host.accountAbort.abort();
      assert.equal(activeCitySession(), undefined, "abort clears current immediately");
    } else host.disposed = true;
    joined.resolve(snapshot);
    await enter;
    assert.equal(session.disposed, true);
    assert.equal(session.network?.disposed, true);
    assert.equal(activeCitySession(), undefined);
    assert.equal(f.counts().disposals, 1);
    assert.equal(f.listeners.size, 0);
  }
});
