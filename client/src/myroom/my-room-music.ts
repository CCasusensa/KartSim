/** Plays the room's music (my-room-bgm.ts) through the game's BGM owner. */
import { Q9 } from "../generated/library.js";
import { parseOfficialBgmChoices } from "../ui/settings-window-assets";
import {
  myRoomBgmChoices, myRoomBgmPath, stageDefaultBgmPath, type MyRoomBgmChoice,
  type MyRoomBgmEnvironment, type MyRoomBgmSources,
} from "./my-room-bgm";

interface MusicResource {
  name: string;
  extension?: string;
  sourceOrdinal?: number;
  bytes(): Promise<Uint8Array>;
}

export interface MyRoomMusicLibrary {
  exactCanonicalCandidates(path: string): MusicResource[];
  entriesUnderCanonicalPrefix?(path: string): MusicResource[];
}

/** The global BGM owner (generated timeattack.js P7). */
export interface MyRoomBgmOwner {
  context: unknown;
  current?: { source: { buffer?: unknown } };
  start(buffer: unknown, loop: boolean, fade: boolean): void;
  playReady(): void;
}

/** The room's music as MyRoomView uses it. */
export interface MyRoomMusic {
  /** 设置音乐's tracks. */
  choices(): Promise<readonly MyRoomBgmChoice[]>;
  /** Plays a room's music: bgmId 0 is 默认 (see my-room-bgm.ts). */
  play(bgmId: number | undefined, environment: MyRoomBgmEnvironment | undefined): void;
  /** Leaving the room: back to the Ready music if the room's is still playing. */
  stop(): void;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder(bytes[0] === 255 ? "utf-16le" : "utf-8").decode(bytes);
}

export async function loadMyRoomBgmSources(library: MyRoomMusicLibrary): Promise<MyRoomBgmSources> {
  const exists = (path: string) => library.exactCanonicalCandidates(path).length === 1;
  const list = library.exactCanonicalCandidates("zeta_/cn/content/bgmList.xml")[0];
  const names = library.exactCanonicalCandidates("etc_/bgmList.xml")[0];
  const [listXml, namesXml] = await Promise.all([list?.bytes(), names?.bytes()]);
  const listText = listXml ? decode(listXml) : "";
  const choices = listText && namesXml
    ? myRoomBgmChoices(parseOfficialBgmChoices(listText, decode(namesXml))
      .filter(choice => exists(choice.path)))
    : [];
  return {
    choices,
    stageDefault: listText ? stageDefaultBgmPath(listText, "MyRoomStage") : undefined,
    exists,
    themeTracks: theme => (library.entriesUnderCanonicalPrefix?.(`sound_/bgm/${theme}`) ?? [])
      .filter(entry => (entry.extension ?? entry.name.split(".").pop())?.toLowerCase() === "ogg")
      .sort((a, b) => (a.sourceOrdinal ?? -1) - (b.sourceOrdinal ?? -1) ||
        a.name.localeCompare(b.name))
      .map(entry => `sound_/bgm/${theme}/${entry.name}`),
  };
}

export function createMyRoomMusic(options: {
  library: MyRoomMusicLibrary;
  owner(): MyRoomBgmOwner | undefined;
  /** The player's 主页面音乐 ("" for the default). */
  mainMenuPath(): string;
  onError(error: unknown): void;
}): MyRoomMusic {
  let sources: Promise<MyRoomBgmSources> | undefined;
  const load = () => sources ??= loadMyRoomBgmSources(options.library).catch(error => {
    sources = undefined;
    throw error;
  });
  // Only the playing track stays decoded (a few minutes of PCM is tens of MB).
  let decoded: { path: string; buffer: unknown } | undefined;
  let ticket = 0;
  return {
    choices: async () => (await load()).choices,
    play(bgmId, environment) {
      const mine = ++ticket;
      void (async () => {
        const path = myRoomBgmPath(bgmId, environment, await load(), options.mainMenuPath());
        const owner = options.owner();
        if (!path || !owner || mine !== ticket) return;
        if (decoded?.path !== path) {
          const resource = options.library.exactCanonicalCandidates(path)[0];
          if (!resource) return;
          const buffer = await Q9(owner.context, await resource.bytes());
          if (mine !== ticket) return;
          decoded = { path, buffer };
        }
        if (owner.current?.source.buffer !== decoded.buffer) owner.start(decoded.buffer, true, true);
      })().catch(options.onError);
    },
    stop() {
      ticket++;
      const owner = options.owner();
      if (owner && decoded && owner.current?.source.buffer === decoded.buffer) owner.playReady();
      decoded = undefined;
    },
  };
}
