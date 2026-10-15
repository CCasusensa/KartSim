import { tr } from "../i18n/locale";
/**
 * 卡丁城收音机：光线飞车（RayCity）车载电台的 22 首韩国歌曲（曲目表是原版
 * Data/sound/bgm/main/list.xml，歌在 mirror/ui/radio，见
 * client/tools/city/radio/extract-raycity-radio.mjs）。
 *
 * 收音机借用比赛的 BGM 通道（stage.scene.bgm，原版 P7）：歌按游戏自己的解码
 * （原生 decodeAudioData，不支持 Ogg 的浏览器走游戏的 Vorbis 解码）变成
 * AudioBuffer，用 bgm.start 淡入，音量跟“设置”里的背景音乐走。城里比赛音乐只在
 * 开局 bgm.restart() 一次：开着收音机时它改放收音机，关掉收音机再调原来的
 * restart，回到城市原本的音乐。一首放完接下一首（顺序或随机），P 窗口里选歌，
 * N / B 开车时直接换下一首 / 上一首。
 */
import { Q9 as decodeGameAudio } from "../generated/library.js";
import radioSongs from "./city-radio-songs.json";

export interface RadioSong {
  /** mirror/ui/radio/<file>.ogg */
  file: string;
  title: string;
  singer: string;
  /** Marked town="true" in RayCity's list (played while driving in town there). */
  town?: boolean;
}

export const RADIO_SONGS: readonly RadioSong[] = radioSongs.songs;
export const RADIO_BASE = "/ui/radio/";

export function radioSongUrl(song: RadioSong): string {
  return `${RADIO_BASE}${song.file}.ogg`;
}

/** "Only one — Sugar Donut" */
export function songLabel(song: RadioSong): string {
  return `${song.title} — ${song.singer}`;
}

/** A shuffled 0 … count−1 (Fisher–Yates). */
function shuffled(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * The play order. In order it walks the list; shuffled it walks a random
 * permutation, dealt again (not starting on the song just played) once it
 * has gone round; 上一首 walks back along it.
 */
export class RadioPlaylist {
  private order: number[];
  private position = 0;

  constructor(readonly count: number, private shuffleOn: boolean, current: number,
    private readonly random: () => number = Math.random) {
    this.order = [];
    this.deal(current);
  }

  get shuffle(): boolean { return this.shuffleOn; }
  get current(): number { return this.order[this.position]!; }

  /** Builds the order with `first` playing now. */
  private deal(first: number): void {
    const start = Math.min(Math.max(0, Math.trunc(first) || 0), this.count - 1);
    if (!this.shuffleOn) {
      this.order = Array.from({ length: this.count }, (_, i) => i);
      this.position = start;
      return;
    }
    this.order = [start, ...shuffled(this.count, this.random).filter(index => index !== start)];
    this.position = 0;
  }

  next(): number {
    if (this.position + 1 < this.order.length) this.position++;
    else if (!this.shuffleOn) this.position = 0;
    else {
      const last = this.current;
      const order = shuffled(this.count, this.random);
      // A new round never starts with the song that just ended.
      if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1]!, order[0]!];
      this.order = order;
      this.position = 0;
    }
    return this.current;
  }

  previous(): number {
    this.position = (this.position - 1 + this.order.length) % this.order.length;
    return this.current;
  }

  /** The song next() moves to, when it is already known (not at a shuffled round's end). */
  upcoming(): number | undefined {
    if (this.position + 1 < this.order.length) return this.order[this.position + 1];
    return this.shuffleOn ? undefined : this.order[0];
  }

  /** Plays `index` now; the order goes on from it. */
  select(index: number): number {
    const at = this.order.indexOf(index);
    if (at >= 0 && !this.shuffleOn) this.position = at;
    else this.deal(index);
    return this.current;
  }

  setShuffle(on: boolean): void {
    if (on === this.shuffleOn) return;
    this.shuffleOn = on;
    this.deal(this.current);
  }
}

/** What the radio needs of the race BGM (generated P7, timeattack/race-bgm-playback.ts). */
export interface RadioBgmHost {
  context: unknown;
  current?: { source: unknown };
  start(buffer: unknown, loop: boolean, fade: boolean): void;
  restart(): void;
}

interface EndedSource {
  addEventListener?(type: "ended", listener: () => void): void;
}

export interface RadioState { on: boolean; shuffle: boolean; song?: string }

export interface CityRadioOptions {
  bgm: RadioBgmHost;
  songs?: readonly RadioSong[];
  /** The song's bytes (fetch by default). */
  fetchBytes?(url: string): Promise<Uint8Array>;
  /** Bytes → AudioBuffer in the BGM's context (the game's own decoder by default). */
  decode?(context: unknown, bytes: Uint8Array): Promise<unknown>;
  /** A song started (the 正在播放 notice). */
  playing?(song: RadioSong): void;
  /** Something the window shows changed. */
  changed?(): void;
  /** A message for the player (no signal …). */
  notice?(text: string): void;
  load?(): Partial<RadioState> | undefined;
  save?(state: RadioState): void;
  random?: () => number;
  schedule?(callback: () => void, ms: number): unknown;
}

const STATE_KEY = "kartsim.city.radio";

function loadState(): Partial<RadioState> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) as Partial<RadioState> : undefined;
  } catch { return undefined; }
}

function saveState(state: RadioState): void {
  try { globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

async function fetchSong(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Songs that fail one after another before the radio gives up. */
const MAX_FAILURES = 3;
/** Bytes kept for the songs around the current one. */
const KEEP_BYTES = 3;

export class CityRadio {
  readonly songs: readonly RadioSong[];
  readonly playlist: RadioPlaylist;
  on: boolean;
  /** A song is downloading / decoding. */
  loading = false;
  private disposed = false;
  /** Bumped by every play / stop: a song that lands later than another request is dropped. */
  private ticket = 0;
  /** The BGM source the radio's song plays on. */
  private source: unknown;
  private failures = 0;
  private readonly bytes = new Map<string, Promise<Uint8Array>>();
  private readonly bgm: RadioBgmHost;
  /** The BGM's own restart (the city's music) and how to give it back. */
  private readonly originalRestart: () => void;
  private readonly ownRestart?: RadioBgmHost["restart"];
  private readonly patchedRestart: () => void;

  constructor(private readonly options: CityRadioOptions) {
    this.songs = options.songs ?? RADIO_SONGS;
    this.bgm = options.bgm;
    const saved = (options.load ?? loadState)() ?? {};
    const random = options.random ?? Math.random;
    const shuffle = saved.shuffle ?? true;
    const savedIndex = this.songs.findIndex(song => song.file === saved.song);
    // Shuffled, each visit starts on a new song; in order, it carries on where it was.
    const first = shuffle || savedIndex < 0 ? Math.floor(random() * this.songs.length) : savedIndex;
    this.playlist = new RadioPlaylist(this.songs.length, shuffle, first, random);
    this.on = saved.on ?? true;
    // The race starts its music with restart(): while the radio is on, it plays the radio instead.
    if (Object.prototype.hasOwnProperty.call(this.bgm, "restart")) this.ownRestart = this.bgm.restart;
    const original = this.bgm.restart;
    this.originalRestart = () => original.call(this.bgm);
    this.patchedRestart = () => {
      if (this.disposed || !this.on) this.originalRestart();
      else this.resume();
    };
    this.bgm.restart = this.patchedRestart;
  }

  get index(): number { return this.playlist.current; }
  get song(): RadioSong { return this.songs[this.index]!; }
  /** The radio's song is what the BGM plays now. */
  get playing(): boolean { return !!this.source && this.bgm.current?.source === this.source; }

  /** Plays the current song unless it is already on air. */
  resume(): void {
    if (this.disposed || !this.on || this.playing || this.loading) return;
    void this.play(this.index);
  }

  turnOn(): void {
    if (this.disposed || this.on) return;
    this.on = true;
    this.failures = 0;
    this.persist();
    void this.play(this.index);
  }

  /** Back to the city's own music. */
  turnOff(): void {
    if (this.disposed || !this.on) return;
    // Unless other music has taken over meanwhile, the city's own comes back.
    const silentOrOurs = !this.bgm.current || this.bgm.current.source === this.source;
    this.on = false;
    this.ticket++;
    this.loading = false;
    this.source = undefined;
    this.persist();
    if (silentOrOurs) this.originalRestart();
    this.options.changed?.();
  }

  toggle(): void {
    if (this.on) this.turnOff();
    else this.turnOn();
  }

  next(): void { this.change(() => this.playlist.next()); }
  previous(): void { this.change(() => this.playlist.previous()); }
  select(index: number): void {
    if (index >= 0 && index < this.songs.length) this.change(() => this.playlist.select(index));
  }

  setShuffle(on: boolean): void {
    if (this.disposed) return;
    this.playlist.setShuffle(on);
    this.persist();
    this.options.changed?.();
  }

  /** 下一首 / 上一首 / a song picked in the window; they turn the radio on too. */
  private change(move: () => number): void {
    if (this.disposed) return;
    const index = move();
    this.failures = 0;
    this.on = true;
    this.persist();
    void this.play(index);
  }

  private bytesFor(song: RadioSong): Promise<Uint8Array> {
    const url = radioSongUrl(song);
    let pending = this.bytes.get(url);
    if (pending) this.bytes.delete(url); // most recently used goes last
    else {
      const fetched = (this.options.fetchBytes ?? fetchSong)(url);
      fetched.catch(() => { if (this.bytes.get(url) === fetched) this.bytes.delete(url); });
      pending = fetched;
    }
    this.bytes.set(url, pending);
    while (this.bytes.size > KEEP_BYTES) this.bytes.delete(this.bytes.keys().next().value!);
    return pending;
  }

  private async play(index: number): Promise<void> {
    const ticket = ++this.ticket;
    const song = this.songs[index]!;
    this.loading = true;
    this.options.changed?.();
    try {
      const bytes = await this.bytesFor(song);
      if (ticket !== this.ticket || this.disposed) return;
      // Without git LFS the file is a text pointer: say so instead of a decoder error.
      if (bytes.length < 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== "OggS")
        throw new Error(`${song.file}.ogg 不是 Ogg 文件`);
      const buffer = await (this.options.decode ?? decodeGameAudio)(this.bgm.context, bytes);
      if (ticket !== this.ticket || this.disposed || !this.on) return;
      this.bgm.start(buffer, false, true);
      const source = this.bgm.current?.source;
      this.source = source;
      (source as EndedSource | undefined)?.addEventListener?.("ended", () => this.ended(source));
      this.loading = false;
      this.failures = 0;
      this.persist();
      this.options.changed?.();
      this.options.playing?.(song);
      // The next song downloads meanwhile, so it starts without a wait.
      const upcoming = this.playlist.upcoming();
      if (upcoming !== undefined) void this.bytesFor(this.songs[upcoming]!).catch(() => undefined);
    } catch (error) {
      if (ticket !== this.ticket || this.disposed) return;
      this.loading = false;
      console.warn(`卡丁城收音机：${song.file} 播放失败`, error);
      if (++this.failures >= MAX_FAILURES) {
        this.failures = 0;
        this.options.notice?.(tr("收音机没有信号：歌曲文件下载失败，换回城市音乐。"));
        this.turnOff();
        return;
      }
      this.options.changed?.();
      (this.options.schedule ?? setTimeout)(() => {
        if (ticket === this.ticket && !this.disposed && this.on) void this.play(this.playlist.next());
      }, 300);
    }
  }

  /** A song played to its end: on to the next one (unless another is on its way already). */
  private ended(source: unknown): void {
    if (this.disposed || !this.on || this.loading || this.source !== source || this.bgm.current?.source !== source) return;
    void this.play(this.playlist.next());
  }

  private persist(): void {
    (this.options.save ?? saveState)({ on: this.on, shuffle: this.playlist.shuffle, song: this.song.file });
  }

  /** The city is left: the BGM's restart is its own again (the BGM itself goes with the race). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ticket++;
    this.bytes.clear();
    if (this.bgm.restart === this.patchedRestart) {
      if (this.ownRestart) this.bgm.restart = this.ownRestart;
      else delete (this.bgm as Partial<RadioBgmHost>).restart;
    }
  }
}
