/** Loads single-player and multiplayer music banks for the race BGM owner. */

interface AudioResource {
  bytes(): Promise<Uint8Array>;
}

interface RacePlaylist {
  buffers: unknown[];
  names: unknown[];
}

export interface RaceBgmLoadingHost {
  context: unknown;
  raceBuffers: unknown[];
  raceNames: unknown[];
  currentRaceNameValue?: unknown;
  multiplayerBuffers?: {
    lobby: unknown; room: unknown; finish: unknown; podium: unknown;
  };
  multiplayerLobbyPath?: string;
  /**
   * The race playlist loadRaceBgm left decoding (the owner is returned
   * without it); a race waits for it (racePlaylistReady), and a selectRace
   * replaces it.
   */
  racePlaylistLoad?: Promise<void>;
}

let racePlaylistGate: Promise<void> = Promise.resolve();

/**
 * Holds race-music decoding back until the returned release is called:
 * startup releases it once the home screen is up, so the theme's race
 * music (several MB of ogg) does not compete with the home screen's bytes.
 * Release it on every path (a race waits for the playlist).
 */
export function holdRacePlaylists(): () => void {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  racePlaylistGate = gate;
  return () => {
    release();
    if (racePlaylistGate === gate) racePlaylistGate = Promise.resolve();
  };
}

/** Waits for a playlist loadRaceBgm left decoding; a failed one loads again for this track. */
export async function racePlaylistReady(owner: {
  racePlaylistLoad?: Promise<void>;
  selectRace(library: unknown, track: unknown): Promise<void>;
}, library: unknown, track: unknown): Promise<void> {
  const load = owner.racePlaylistLoad;
  if (!load) return;
  try {
    await load;
  } catch {
    if (owner.racePlaylistLoad === load) await owner.selectRace(library, track);
  }
}

export interface RaceBgmLoadingDependencies {
  resource(library: unknown, path: string): AudioResource;
  garageMusic(library: unknown, single: AudioResource): AudioResource;
  parseMultiplayerList(xml: string, lobbyPath: string): {
    lobby: string; room: string;
  };
  decodeBuffer(resource: AudioResource, context: unknown): Promise<unknown>;
  racePlaylist(library: unknown, track: unknown,
    context: unknown): Promise<RacePlaylist>;
  create(context: unknown, playlist: RacePlaylist, ready: unknown,
    garage: unknown, win: unknown, lose: unknown, random: unknown): unknown;
}

export async function prepareMultiplayerBgm(host: RaceBgmLoadingHost,
  library: unknown, lobbyPath: string,
  dependencies: RaceBgmLoadingDependencies): Promise<void> {
  if (host.multiplayerBuffers && host.multiplayerLobbyPath === lobbyPath) return;
  const bytes = await dependencies.resource(library,
    "zeta_/cn/content/bgmList.xml").bytes();
  const xml = new TextDecoder(bytes[0] === 255 ? "utf-16le" : "utf-8")
    .decode(bytes);
  const paths = dependencies.parseMultiplayerList(xml, lobbyPath);
  if (host.multiplayerBuffers) {
    host.multiplayerBuffers = {
      ...host.multiplayerBuffers,
      lobby: await dependencies.decodeBuffer(
        dependencies.resource(library, paths.lobby), host.context),
    };
    host.multiplayerLobbyPath = lobbyPath;
    return;
  }
  const [lobby, room, finish, podium] = await Promise.all([
    dependencies.decodeBuffer(
      dependencies.resource(library, paths.lobby), host.context),
    dependencies.decodeBuffer(
      dependencies.resource(library, paths.room), host.context),
    dependencies.decodeBuffer(
      dependencies.resource(library, "sound_/bgm/main/game_end.ogg"), host.context),
    dependencies.decodeBuffer(
      dependencies.resource(library, "sound_/bgm/main/game_result.ogg"), host.context),
  ]);
  host.multiplayerBuffers = { lobby, room, finish, podium };
  host.multiplayerLobbyPath = lobbyPath;
}

/**
 * The music owner with the Ready, garage and result music decoded. The
 * track theme's race playlist (the largest part, several MB of ogg) keeps
 * decoding after the owner is returned (racePlaylistLoad): the Ready screen
 * does not play it, and races wait for it (racePlaylistReady).
 */
export async function loadRaceBgm(library: unknown, track: unknown,
  random: unknown, context: unknown,
  dependencies: RaceBgmLoadingDependencies): Promise<unknown> {
  const single = dependencies.resource(library, "sound_/bgm/main/single.ogg");
  const garage = dependencies.garageMusic(library, single);
  const win = dependencies.resource(library, "sound_/bgm/main/game_win.ogg");
  const lose = dependencies.resource(library, "sound_/bgm/main/game_lose.ogg");
  const playlist = racePlaylistGate.then(() => dependencies.racePlaylist(library, track, context));
  // Nobody may be waiting yet when it fails (racePlaylistReady reports it).
  playlist.catch(() => undefined);
  const [readyBuffer, garageBuffer, winBuffer, loseBuffer] =
    await Promise.all([
      dependencies.decodeBuffer(single, context),
      garage === single ? Promise.resolve(undefined)
        : dependencies.decodeBuffer(garage, context),
      dependencies.decodeBuffer(win, context),
      dependencies.decodeBuffer(lose, context),
    ]);
  const owner = dependencies.create(context, { buffers: [], names: [] }, readyBuffer,
    garageBuffer ?? readyBuffer, winBuffer, loseBuffer, random) as RaceBgmLoadingHost;
  const load: Promise<void> = playlist.then(result => {
    if (owner.racePlaylistLoad !== load) return;
    owner.racePlaylistLoad = undefined;
    owner.raceBuffers = result.buffers;
    owner.raceNames = result.names;
  });
  load.catch(() => undefined);
  owner.racePlaylistLoad = load;
  return owner;
}

export async function selectRaceBgm(host: RaceBgmLoadingHost,
  library: unknown, track: unknown,
  dependencies: RaceBgmLoadingDependencies): Promise<void> {
  const playlist = await dependencies.racePlaylist(library, track,
    host.context);
  host.racePlaylistLoad = undefined;
  host.raceBuffers = playlist.buffers;
  host.raceNames = playlist.names;
  host.currentRaceNameValue = undefined;
}
