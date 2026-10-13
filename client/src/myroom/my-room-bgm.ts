/**
 * 小屋音乐 (roomAdmin 设置音乐). The combo lists the official BGM table
 * (zeta_/cn/content/bgmList.xml, names from etc_/bgmList.xml) after
 * "默认" (#sb(defaultBgm)); the room saves the chosen bgm id. 默认 plays the
 * room environment's own music (myRoomLocale@cn bgm / bgmTheme, e.g. 888小屋,
 * 神之国度, 圣诞小屋), else the MyRoomStage default of defaultBgmList, which
 * refers to MainMenuEx — the main-menu music, the player's 主页面音乐 when set.
 */

export interface MyRoomBgmChoice {
  /** bgmList.xml id, saved as MyRoomProfile.bgmId. */
  id: number;
  /** The combo text, unique within the list. */
  label: string;
  path: string;
}

export interface MyRoomBgmEnvironment {
  bgm?: string;
  bgmTheme?: string;
}

/** What the room can find in this build's archives. */
export interface MyRoomBgmSources {
  choices: readonly MyRoomBgmChoice[];
  /** The MyRoomStage default (defaultBgmList ref chain), when the table names one. */
  stageDefault?: string;
  exists(path: string): boolean;
  /** The ogg tracks under sound_/bgm/<theme>/, in archive order. */
  themeTracks(theme: string): string[];
}

const SAFE_NAME = /^[^\\/]+$/;

function bgmPath(theme: string, name: string): string | undefined {
  return SAFE_NAME.test(theme) && SAFE_NAME.test(name) && !theme.includes("..") &&
    !name.includes("..") ? `sound_/bgm/${theme}/${name}.ogg` : undefined;
}

/** Combo values must be unique; repeated track names get a running number. */
export function myRoomBgmChoices(choices: readonly { id: number; label: string; path: string }[]):
  MyRoomBgmChoice[] {
  const seen = new Map<string, number>();
  return choices.map(choice => {
    const label = choice.label.trim() || String(choice.id);
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return { ...choice, label: count === 1 ? label : `${label} (${count})` };
  });
}

function elements(xml: string, tag: string): Array<Record<string, string>> {
  const found: Array<Record<string, string>> = [];
  for (const match of xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))) {
    const attributes: Record<string, string> = {};
    for (const pair of match[1]!.matchAll(/([\w:-]+)\s*=\s*(['"])(.*?)\2/g))
      attributes[pair[1]!] = pair[3]!;
    found.push(attributes);
  }
  return found;
}

/**
 * The track a stage plays by default in bgmList.xml's defaultBgmList,
 * following ref="…" (MyRoomStage → MainMenuEx → bgm id 149).
 */
export function stageDefaultBgmPath(bgmListXml: string, stage: string): string | undefined {
  const defaults = elements(bgmListXml, "defaultBgm");
  const tracks = elements(bgmListXml, "bgm");
  const seen = new Set<string>();
  let current = stage;
  while (!seen.has(current)) {
    seen.add(current);
    const entry = defaults.find(item => item.stage === current);
    if (!entry) return undefined;
    if (entry.ref) { current = entry.ref; continue; }
    const track = entry.id ? tracks.find(item => item.id === entry.id) : entry;
    return track?.theme && track.name ? bgmPath(track.theme, track.name) : undefined;
  }
  return undefined;
}

/** The environment's own music: bgm (in its bgmTheme, sound_/bgm/main or the table), else bgmTheme's first track. */
export function environmentBgmPath(environment: MyRoomBgmEnvironment | undefined,
  sources: MyRoomBgmSources): string | undefined {
  if (!environment) return undefined;
  const { bgm, bgmTheme } = environment;
  if (bgm) {
    const candidates = [
      bgmTheme ? bgmPath(bgmTheme, bgm) : undefined,
      bgmPath("main", bgm),
      sources.choices.find(choice => choice.path.endsWith(`/${bgm}.ogg`))?.path,
    ];
    const found = candidates.find((path): path is string => !!path && sources.exists(path));
    if (found) return found;
  }
  return bgmTheme && SAFE_NAME.test(bgmTheme) ? sources.themeTracks(bgmTheme)[0] : undefined;
}

/**
 * What a room plays: the chosen track; for 默认 (0, or a track this build
 * lacks) the environment's own music, else the main-menu music.
 */
export function myRoomBgmPath(bgmId: number | undefined, environment: MyRoomBgmEnvironment | undefined,
  sources: MyRoomBgmSources, mainMenuPath = ""): string | undefined {
  const chosen = bgmId ? sources.choices.find(choice => choice.id === bgmId) : undefined;
  if (chosen) return chosen.path;
  return environmentBgmPath(environment, sources) ||
    (mainMenuPath && sources.exists(mainMenuPath) ? mainMenuPath : sources.stageDefault);
}
