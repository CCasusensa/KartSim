/**
 * 游戏页启动后装载自制地图：本机草稿（IndexedDB 里生成过的赛道包）和
 * 数据服务上已发布的地图。都只登记文件条目，真正比赛时才读取赛道包。
 */
import { mapIdOfTrack } from "./design";
import { customMap, registerCustomMap, type CustomMapSummary } from "./custom-tracks";
import { listBuilds } from "./draft-store";
import { downloadMapFile, fetchMapSummary, listPublishedMaps } from "./map-service";
import { startTestDrive, takeTestMapParameter } from "./test-drive";

const blobBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

function serverLoaders(summary: CustomMapSummary) {
  let container: Promise<Uint8Array> | undefined;
  return {
    container: () => container ??= downloadMapFile(summary, "container")
      .catch(error => { container = undefined; throw error; }),
    file: (path: string) => path === "xt_trackCard.png" ? downloadMapFile(summary, "card")
      : path === "xt_trackThumb.png" ? downloadMapFile(summary, "thumb") : undefined,
  };
}

export function registerServerMap(library: unknown, summary: CustomMapSummary): void {
  registerCustomMap(library, summary, serverLoaders(summary));
}

export async function registerLocalDrafts(library: unknown): Promise<number> {
  const builds = await listBuilds();
  for (const build of builds) {
    registerCustomMap(library, { ...build.summary, source: "local" }, {
      container: () => blobBytes(build.container),
      file: path => path === "xt_trackCard.png" && build.card ? blobBytes(build.card)
        : path === "xt_trackThumb.png" && build.thumb ? blobBytes(build.thumb) : undefined,
    });
  }
  return builds.length;
}

let installed: Promise<void> | undefined;

/** 启动时调用一次；失败（没有数据服务、没有 IndexedDB）只记日志。 */
export function installCustomMaps(library: unknown): Promise<void> {
  return installed ??= (async () => {
    const testMap = takeTestMapParameter();
    await registerLocalDrafts(library).catch(error => console.info("本机地图草稿未载入", error));
    if (testMap) void startTestDrive(testMap).catch(error => console.warn("试跑失败", error));
    try {
      for (const summary of await listPublishedMaps()) registerServerMap(library, summary);
    } catch (error) {
      console.info("自制地图列表未载入", error);
    }
  })();
}

/**
 * 多人房间选了一张本机还不知道（或版本不同）的已发布地图：向数据服务取
 * 最新摘要再登记。返回地图是否可用。
 */
export async function ensurePublishedMap(library: unknown, trackId: string): Promise<boolean> {
  const id = mapIdOfTrack(trackId);
  if (!id) return false;
  try {
    const summary = await fetchMapSummary(id);
    if (customMap(trackId)?.sha256 !== summary.sha256) registerServerMap(library, summary);
    return true;
  } catch {
    return customMap(trackId) !== undefined;
  }
}

let lastRefresh = 0;
let refreshing: Promise<void> | undefined;

/** 打开多人选图前刷新已发布地图列表（30 秒内只刷新一次，最多等 3 秒）。 */
export function refreshPublishedMaps(library: unknown, now = Date.now()): Promise<void> {
  if (refreshing) return refreshing;
  if (now - lastRefresh < 30_000) return Promise.resolve();
  lastRefresh = now;
  const work = listPublishedMaps().then(maps => { for (const summary of maps) registerServerMap(library, summary); })
    .catch(error => console.info("自制地图列表刷新失败", error));
  const timeout = new Promise<void>(resolve => setTimeout(resolve, 3_000));
  refreshing = Promise.race([work, timeout]).finally(() => { refreshing = undefined; });
  return refreshing;
}
