/**
 * 冰河圣诞版: the release's Christmas theme for the ice tracks
 * (zeta_/cn/content/config.xml `xmasThemeType`: 0 none, 1 always,
 * 2 needsItem; p3553 ships 0). KartSim runs it as 1, always on.
 *
 * The ice tracks below ship a Christmas model next to their own
 * (track_/<id>/track_xmas.1s, and track_xmas_rvs.1s for the reverse
 * I01–I05). On those tracks a race loads that model (Christmas trees,
 * fences and signs from theme_ice.rho, and snow: the release's weather owner
 * turns ReSnow on for a track_xmas file), and with it
 * - the race music sound_/bgm/xmas (xmas_01 圣诞快乐, xmas_02 圣诞节之歌),
 * - the item cube item/itemCube/xmas (ice_item_xmas),
 * - the item slot frame `xmas` (item/slot/slot_frameResource.bml id 1),
 * - the classic dashboard skin zeta_/cn/stage/common/aw_01_xmas@cn.png.
 * Every racer decides from the track id alone, so a room races one model.
 * The HUD part (slot frame and dashboard) is the player's own choice: 设置 →
 * 自定义设置 → 冰河赛道使用圣诞节码表与道具栏 (game option `xmasHud`, off by
 * default). Ticked, karts the classic dial fits show it in this skin even
 * with 经典仪表 off; unticked, the race keeps the normal HUD.
 */

/** The ice tracks with a track_xmas.1s (reverse ids end in `_rvs`). */
export const XMAS_TRACK_IDS: ReadonlySet<string> = new Set([
  "ice_F01", "ice_I01", "ice_I02", "ice_I03", "ice_I04", "ice_I05", "ice_I06",
  "ice_R01", "ice_R02",
]);

export const XMAS_BGM_THEME = "xmas";
export const XMAS_ITEM_CUBE_THEME = "xmas";
export const XMAS_SLOT_FRAME = "xmas";
export const XMAS_DASHBOARD_PATH = "zeta_/cn/stage/common/aw_01_xmas@cn.png";

/** Whether a track (or its reverse) races its Christmas model. */
export function isXmasTrack(trackId: string): boolean {
  return XMAS_TRACK_IDS.has(trackId.replace(/_rvs$/i, ""));
}

interface XmasModelLibrary {
  findSibling(path: string, names: string[]): { virtualPath: string } | undefined;
}

/**
 * The Christmas model beside a track model path (`track.1s` →
 * `track_xmas.1s`, `track_rvs.1s` → `track_xmas_rvs.1s`), or undefined when
 * the track has none or the resources lack it.
 */
export function xmasTrackModelPath(library: XmasModelLibrary | undefined, path: string,
  trackId: string): string | undefined {
  if (!library || !isXmasTrack(trackId)) return undefined;
  const name = path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  const xmas = name === "track.1s" ? "track_xmas.1s"
    : name === "track_rvs.1s" ? "track_xmas_rvs.1s" : undefined;
  return xmas ? library.findSibling(path, [xmas])?.virtualPath : undefined;
}

/** The item slot frame of a race HUD: the plain `normal` frame turns `xmas`. */
export function xmasSlotFrame(frame: string, xmas: boolean): string {
  return xmas && frame === "normal" ? XMAS_SLOT_FRAME : frame;
}

interface XmasDashboardLibrary {
  exactCanonicalCandidates(path: string): { bytes(): Promise<Uint8Array> }[];
}

/**
 * The classic HUD package (stage window, aw_01/aw_02 textures) with the
 * dashboard texture swapped for aw_01_xmas@cn: the same 256×256 layout with
 * holly, bells and a snowflake dial.
 */
export async function xmasClassicHud<Package extends { textures: Map<string, Texture> }, Texture>(
  classic: Package, library: XmasDashboardLibrary,
  decode: (bytes: Uint8Array) => Promise<Texture>): Promise<Package> {
  const sources = library.exactCanonicalCandidates(XMAS_DASHBOARD_PATH);
  if (sources.length !== 1)
    throw new Error(`${XMAS_DASHBOARD_PATH} source 数量必须为 1，实际 ${sources.length}。`);
  const texture = await decode(await sources[0]!.bytes());
  return { ...classic, textures: new Map(classic.textures).set("aw_01@zz", texture) };
}
