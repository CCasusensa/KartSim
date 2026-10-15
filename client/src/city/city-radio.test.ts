import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { cityHelpPages } from "./city-help-window";
import { CityRadio, RADIO_SONGS, RadioPlaylist, radioSongUrl, type RadioState } from "./city-radio";
import { radioWindowDefinition } from "./city-radio-window";

const root = new URL("../../../", import.meta.url);

/** A seeded random, so shuffles repeat. */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

class FakeSource {
  private listeners: Array<() => void> = [];
  constructor(readonly buffer: unknown) {}
  addEventListener(_type: "ended", listener: () => void) { this.listeners.push(listener); }
  end() { for (const listener of this.listeners) listener(); }
}

/** The race BGM (P7): start() swaps the current source, restart() is the city's music. */
class FakeBgm {
  context = { kind: "bgm-context" };
  current?: { source: FakeSource };
  started: Array<{ buffer: unknown; loop: boolean; fade: boolean }> = [];
  cityMusic = 0;
  start(buffer: unknown, loop: boolean, fade: boolean) {
    const old = this.current?.source;
    this.current = { source: new FakeSource(buffer) };
    this.started.push({ buffer, loop, fade });
    old?.end();
  }
  restart() {
    this.cityMusic++;
    this.current = { source: new FakeSource("city") };
  }
}

const ogg = (name: string) => new Uint8Array([..."OggS"].map(c => c.charCodeAt(0)).concat([...name].map(c => c.charCodeAt(0))));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function radioWith(overrides: Partial<ConstructorParameters<typeof CityRadio>[0]> = {}, saved?: Partial<RadioState>) {
  const bgm = new FakeBgm();
  const played: string[] = [];
  const saves: RadioState[] = [];
  const fetched: string[] = [];
  const radio = new CityRadio({
    bgm,
    fetchBytes: async url => { fetched.push(url); return ogg(url); },
    decode: async (context, bytes) => {
      assert.equal(context, bgm.context);
      return `pcm:${String.fromCharCode(...bytes.subarray(4))}`;
    },
    playing: song => played.push(song.file),
    load: () => saved ?? { on: true, shuffle: false, song: RADIO_SONGS[0]!.file },
    save: state => saves.push(state),
    random: seeded(),
    schedule: callback => { callback(); return 0; },
    ...overrides,
  });
  return { radio, bgm, played, saves, fetched };
}

test("the radio plays RayCity's 22 Korean songs from list.xml, all shipped in mirror/ui/radio", () => {
  assert.equal(RADIO_SONGS.length, 22);
  assert.deepEqual(RADIO_SONGS[0], { file: "mu_bgm_sug_108", title: "108 AR", singer: "Sugar Donut" });
  assert.equal(RADIO_SONGS.filter(song => song.town).length, 6);
  assert.equal(new Set(RADIO_SONGS.map(song => song.file)).size, 22);
  // The two Christmas songs are commented out in the original list.
  assert.ok(!RADIO_SONGS.some(song => /jingle|santa/i.test(song.file)));
  for (const song of RADIO_SONGS) {
    assert.equal(radioSongUrl(song), `/ui/radio/${song.file}.ogg`);
    assert.ok(existsSync(new URL(`mirror/ui/radio/${song.file}.ogg`, root)), song.file);
  }
  const head = readFileSync(new URL(`mirror/ui/radio/${RADIO_SONGS[0]!.file}.ogg`, root)).subarray(0, 4).toString("latin1");
  // A git LFS pointer instead of the song means `git lfs pull` was skipped.
  if (head !== "vers") assert.equal(head, "OggS");
});

test("in order the playlist walks the list and wraps both ways", () => {
  const list = new RadioPlaylist(4, false, 2);
  assert.equal(list.current, 2);
  assert.equal(list.upcoming(), 3);
  assert.equal(list.next(), 3);
  assert.equal(list.upcoming(), 0);
  assert.equal(list.next(), 0);
  assert.equal(list.previous(), 3);
  assert.equal(list.select(1), 1);
  assert.equal(list.next(), 2);
});

test("shuffled, every song plays once a round and a round never starts on the song just heard", () => {
  const list = new RadioPlaylist(22, true, 5, seeded(3));
  assert.equal(list.current, 5);
  for (let round = 0; round < 6; round++) {
    const heard: Set<number> = new Set([list.current]);
    for (let i = 1; i < 22; i++) heard.add(list.next());
    assert.equal(heard.size, 22, `round ${round}`);
    const last = list.current;
    assert.equal(list.upcoming(), undefined);
    assert.notEqual(list.next(), last);
  }
  // 上一首 walks back to what was heard.
  const now = list.current;
  const after = list.next();
  assert.equal(list.previous(), now);
  assert.equal(list.next(), after);
  // Turning shuffle off keeps the song and goes on in list order.
  list.setShuffle(false);
  assert.equal(list.current, after);
  assert.equal(list.next(), (after + 1) % 22);
});

test("the race's restart() plays the radio instead of the city music while the radio is on", async () => {
  const { radio, bgm, played, saves } = radioWith();
  bgm.restart();
  assert.equal(bgm.cityMusic, 0);
  assert.ok(radio.loading);
  await settle();
  assert.deepEqual(bgm.started, [{ buffer: "pcm:/ui/radio/mu_bgm_sug_108.ogg", loop: false, fade: true }]);
  assert.deepEqual(played, ["mu_bgm_sug_108"]);
  assert.ok(radio.playing && !radio.loading);
  assert.deepEqual(saves.at(-1), { on: true, shuffle: false, song: "mu_bgm_sug_108" });
  // A second restart while the song plays changes nothing.
  bgm.restart();
  await settle();
  assert.equal(bgm.started.length, 1);
});

test("a song played to its end goes on to the next; sources faded out by a switch do not", async () => {
  const { radio, bgm, played } = radioWith();
  bgm.restart();
  await settle();
  const first = bgm.current!.source;
  first.end();
  await settle();
  assert.deepEqual(played, ["mu_bgm_sug_108", "mu_bgm_sug_nowayout"]);
  // FakeBgm.start ends the old source as P7 does after the crossfade: that is no song end.
  radio.next();
  await settle();
  assert.deepEqual(played, ["mu_bgm_sug_108", "mu_bgm_sug_nowayout", "mu_bgm_sug_onlyone"]);
  assert.equal(bgm.started.length, 3);
});

test("only the last of quick 下一首 presses plays; a slow download that lands late is dropped", async () => {
  const pending = new Map<string, (bytes: Uint8Array) => void>();
  const { radio, bgm, played } = radioWith({
    fetchBytes: url => new Promise(resolve => pending.set(url, resolve)),
  });
  radio.next();
  radio.next();
  assert.equal(radio.song.file, "mu_bgm_sug_onlyone");
  pending.get("/ui/radio/mu_bgm_sug_onlyone.ogg")!(ogg("only"));
  await settle();
  pending.get("/ui/radio/mu_bgm_sug_nowayout.ogg")!(ogg("late"));
  await settle();
  assert.deepEqual(bgm.started.map(start => start.buffer), ["pcm:only"]);
  assert.deepEqual(played, ["mu_bgm_sug_onlyone"]);
});

test("turning the radio off brings the city music back; restart then plays the city music", async () => {
  const { radio, bgm, saves } = radioWith();
  bgm.restart();
  await settle();
  radio.turnOff();
  assert.equal(bgm.cityMusic, 1);
  assert.equal(radio.on, false);
  assert.deepEqual(saves.at(-1), { on: false, shuffle: false, song: "mu_bgm_sug_108" });
  bgm.restart();
  assert.equal(bgm.cityMusic, 2);
  // 下一首 turns it on again.
  radio.next();
  await settle();
  assert.equal(radio.on, true);
  assert.equal(bgm.current!.source.buffer, "pcm:/ui/radio/mu_bgm_sug_nowayout.ogg");
});

test("a radio left off stays off on the next visit and keeps its mode", async () => {
  const { radio, bgm } = radioWith({}, { on: false, shuffle: true, song: "mu_bgm_bl_believer" });
  assert.equal(radio.on, false);
  assert.equal(radio.playlist.shuffle, true);
  bgm.restart();
  await settle();
  assert.equal(bgm.cityMusic, 1);
  assert.equal(bgm.started.length, 0);
});

test("songs that will not load are skipped; after three the radio gives up for the city music", async () => {
  const notices: string[] = [];
  const { radio, bgm } = radioWith({
    fetchBytes: async () => new TextEncoder().encode("version https://git-lfs.github.com/spec/v1"),
    notice: text => notices.push(text),
  });
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    bgm.restart();
    for (let i = 0; i < 5; i++) await settle();
  } finally {
    console.warn = warn;
  }
  assert.equal(radio.on, false);
  assert.equal(bgm.cityMusic, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /收音机没有信号/);
});

test("leaving the city gives the BGM its own restart back", async () => {
  const { radio, bgm } = radioWith();
  assert.ok(Object.prototype.hasOwnProperty.call(bgm, "restart"));
  radio.dispose();
  assert.ok(!Object.prototype.hasOwnProperty.call(bgm, "restart"));
  bgm.restart();
  assert.equal(bgm.cityMusic, 1);
});

test("the radio window lists every song and the 操作说明 names P, N and B", () => {
  const window = radioWindowDefinition(RADIO_SONGS.length).children[0]!;
  const names = (node: typeof window): string[] => [
    ...node.attributes.filter(a => a.name === "name").map(a => a.value), ...node.children.flatMap(names)];
  const all = names(window);
  for (let i = 0; i < 22; i++) assert.ok(all.includes(`radioSong${i}`), `radioSong${i}`);
  for (const name of ["radioNow", "previousButton", "powerButton", "nextButton", "shuffleButton", "okButton"])
    assert.ok(all.includes(name), name);
  const keys = cityHelpPages().flatMap(page => page.rows.flatMap(row => row.keys));
  for (const key of ["P", "N", "B"]) assert.ok(keys.includes(key), key);
});
