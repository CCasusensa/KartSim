import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  holdRacePlaylists, loadRaceBgm, prepareMultiplayerBgm, racePlaylistReady, selectRaceBgm,
  type RaceBgmLoadingDependencies, type RaceBgmLoadingHost,
} from "./race-bgm-loading";
import { restartRaceBgm, type RaceBgmHost } from "./race-bgm-playback";

const release = readFileSync(new URL("../../../recovered/formatted/index.js", import.meta.url), "utf8");
const start = release.indexOf("class P7 {");
const end = release.indexOf("\nfunction Zd0", start);
assert.ok(start >= 0 && end > start);
const originalClass = release.slice(start, end);

type Bgm = RaceBgmLoadingHost & {
  readyBuffer: unknown;
  garageBuffer: unknown;
  winBuffer: unknown;
  loseBuffer: unknown;
  random: unknown;
  prepareMultiplayer(library: unknown, lobbyPath?: string): Promise<void>;
  selectRace(library: unknown, track: unknown): Promise<void>;
};
type BgmConstructor = {
  new (context: unknown, playlist: { buffers: unknown[]; names: unknown[] },
    ready: unknown, garage: unknown, win: unknown, lose: unknown,
    random: unknown): Bgm;
  load(library: unknown, track: unknown, random: unknown,
    context: unknown): Promise<Bgm>;
};

function makeFixture(mode: "normal" | "alternate-garage" | "fail-update") {
  const events: unknown[][] = [];
  const cache = new Map<string, { path: string; bytes(): Promise<Uint8Array> }>();
  const dependencies: RaceBgmLoadingDependencies = {
    resource(_library, path) {
      events.push(["resource", path]);
      let resource = cache.get(path);
      if (!resource) {
        resource = { path, async bytes() {
          events.push(["bytes", path]);
          return new TextEncoder().encode("<bgm/>");
        } };
        cache.set(path, resource);
      }
      return resource;
    },
    garageMusic(_library, single) {
      events.push(["garage-music", (single as unknown as { path: string }).path]);
      return mode === "alternate-garage"
        ? dependencies.resource("library", "sound_/bgm/main/garage.ogg")
        : single;
    },
    parseMultiplayerList(xml, lobbyPath) {
      events.push(["parse-list", xml, lobbyPath]);
      return { lobby: `lobby:${lobbyPath}`, room: "room:standard" };
    },
    async decodeBuffer(resource, context) {
      const path = (resource as unknown as { path: string }).path;
      events.push(["decode", path, context]);
      if (mode === "fail-update" && path === "lobby:theme") {
        throw new Error("theme unavailable");
      }
      return `buffer:${path}`;
    },
    async racePlaylist(_library, track, context) {
      events.push(["playlist", track, context]);
      return { buffers: [`race:${String(track)}`], names: [`name:${String(track)}`] };
    },
    create: () => undefined,
  };
  const Original = new Function("G5", "Fc0", "Kt", "eG", "ef0",
    `${originalClass}\nreturn P7;`)(
      dependencies.resource, dependencies.parseMultiplayerList,
      dependencies.decodeBuffer, dependencies.racePlaylist,
      dependencies.garageMusic,
    ) as BgmConstructor;
  dependencies.create = (context, playlist, ready, garage, win, lose, random) =>
    new Original(context, playlist, ready, garage, win, lose, random);
  return { Original, dependencies, events };
}

function snapshot(bgm: Bgm) {
  return {
    ready: bgm.readyBuffer, garage: bgm.garageBuffer,
    win: bgm.winBuffer, lose: bgm.loseBuffer,
    context: bgm.context, random: bgm.random,
    raceBuffers: bgm.raceBuffers, raceNames: bgm.raceNames,
    currentRaceName: bgm.currentRaceNameValue,
    multiplayerBuffers: bgm.multiplayerBuffers,
    multiplayerLobbyPath: bgm.multiplayerLobbyPath,
  };
}

test("static BGM load preserves shared and separate garage buffer cases", async () => {
  for (const mode of ["normal", "alternate-garage"] as const) {
    const inspect = async (rewritten: boolean) => {
      const { Original, dependencies, events } = makeFixture(mode);
      const bgm = rewritten
        ? await loadRaceBgm("library", "track-a", "random", "context", dependencies) as Bgm
        : await Original.load("library", "track-a", "random", "context");
      // The race playlist is not waited for: it lands after the owner, and
      // starts after the other decodes, so the events match as a set.
      await bgm.racePlaylistLoad;
      return { events: events.map(event => JSON.stringify(event)).sort(), bgm: snapshot(bgm) };
    };
    assert.deepEqual(await inspect(true), await inspect(false), mode);
  }
});

test("the race playlist decodes after the owner returns, held back while startup asks", async () => {
  const { dependencies, events } = makeFixture("normal");
  const release = holdRacePlaylists();
  const bgm = await loadRaceBgm("library", "track-a", "random", "context", dependencies) as Bgm;
  assert.deepEqual(bgm.raceBuffers, []);
  assert.ok(bgm.racePlaylistLoad);
  assert.equal(events.some(event => event[0] === "playlist"), false, "held until released");
  release();
  await bgm.racePlaylistLoad;
  assert.deepEqual(bgm.raceBuffers, ["race:track-a"]);
  assert.deepEqual(bgm.raceNames, ["name:track-a"]);
  assert.equal(bgm.racePlaylistLoad, undefined);

  // A selectRace made meanwhile wins over the playlist still decoding.
  let finish!: () => void;
  const slow = { ...dependencies, racePlaylist: async (library: unknown, track: unknown, context: unknown) => {
    await new Promise<void>(resolve => { finish = resolve; });
    return dependencies.racePlaylist(library, track, context);
  } };
  const owner = await loadRaceBgm("library", "track-a", "random", "context", slow) as Bgm;
  const pending = owner.racePlaylistLoad;
  await selectRaceBgm(owner, "library", "track-b", dependencies);
  finish();
  await pending;
  assert.deepEqual(owner.raceBuffers, ["race:track-b"]);
});

test("a race waits for the playlist; a failed one loads again, a started race plays it when it lands", async () => {
  const { dependencies } = makeFixture("normal");
  const failing = { ...dependencies, racePlaylist: async () => { throw new Error("decode failed"); } };
  const owner = await loadRaceBgm("library", "track-a", "random", "context", failing) as Bgm;
  const selected: unknown[] = [];
  owner.selectRace = async (_library, track) => {
    selected.push(track);
    await selectRaceBgm(owner, "library", track, dependencies);
  };
  await racePlaylistReady(owner, "library", "track-a");
  assert.deepEqual(selected, ["track-a"]);
  assert.deepEqual(owner.raceBuffers, ["race:track-a"]);

  let land!: () => void;
  const started: unknown[] = [];
  const host = {
    raceBuffers: [] as unknown[], raceNames: [] as unknown[], current: undefined,
    random: { next: () => 0 },
    racePlaylistLoad: new Promise<void>(resolve => { land = resolve; }).then(() => {
      host.raceBuffers = ["race"];
      host.raceNames = ["name"];
      host.racePlaylistLoad = undefined;
    }),
    start(buffer: unknown) { started.push(buffer); },
  } as unknown as RaceBgmHost;
  restartRaceBgm(host);
  assert.deepEqual(started, []);
  land();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(started, ["race"]);
  assert.equal(host.currentRaceNameValue, "name");
});

test("multiplayer music loads once, refreshes lobby only, and retains state on failure", async () => {
  for (const mode of ["normal", "fail-update"] as const) {
    const inspect = async (rewritten: boolean) => {
      const { Original, dependencies, events } = makeFixture(mode);
      const bgm = new Original("context", { buffers: [], names: [] },
        "ready", "garage", "win", "lose", "random");
      const outcomes: unknown[] = [];
      const prepare = async (path: string) => {
        try {
          outcomes.push(rewritten
            ? await prepareMultiplayerBgm(bgm, "library", path, dependencies)
            : await bgm.prepareMultiplayer("library", path));
        } catch (error) { outcomes.push({ error: (error as Error).message }); }
      };
      await prepare("");
      await prepare("");
      await prepare("theme");
      const afterPrepare = snapshot(bgm);
      bgm.currentRaceNameValue = "old-name";
      if (rewritten) await selectRaceBgm(bgm, "library", "new-track", dependencies);
      else await bgm.selectRace("library", "new-track");
      return { events, outcomes, afterPrepare, afterSelect: snapshot(bgm) };
    };
    assert.deepEqual(await inspect(true), await inspect(false), mode);
  }
});
