import { tr } from "../i18n/locale";
/**
 * 游戏里的自制地图：把地图工坊生成的赛道包挂进资源库，并让计时赛选图、
 * 多人竞速房选图和比赛载入都能找到它们。
 *
 * 赛道包按需读取：资源库里先放好每个文件的条目，任何一个条目第一次被读取
 * 时才下载（或从本机草稿取出）整个容器；赛道卡片和缩略图另有小文件地址，
 * 选图界面不用下载整张地图。
 */
import { scanRhoArchiveIndex } from "../codecs/rho-index-scan";
import { RhoReader } from "../codecs/rho";
import type { TrackChoice, TrackMetadata } from "../resources/track-catalog";
import { registerTrackMetadata } from "../resources/track-overrides";
import { customTrackId, draftTrackId, isCustomTrackId } from "./design";

export interface CustomMapFile { path: string; size: number }

export interface CustomMapSummary {
  id: string;
  name: string;
  author: string;
  theme: string;
  laps: number;
  difficulty: number;
  roadExtent: number;
  sha256: string;
  size: number;
  /** 道具箱个数；0 表示只能竞速。 */
  items: number;
  files: CustomMapFile[];
  updatedAt: number;
  /** local：本机草稿（只在本机计时赛可选）；server：已发布。 */
  source: "local" | "server";
}

/** 摘要对应的赛道 id：草稿与发布版本不同。 */
export function summaryTrackId(summary: Pick<CustomMapSummary, "id" | "source">): string {
  return summary.source === "local" ? draftTrackId(summary.id) : customTrackId(summary.id);
}

export interface CustomMapLoaders {
  container(): Promise<Uint8Array>;
  /** 选图卡片的小文件（xt_trackCard.png 等），缺省从容器里读。 */
  file?(path: string): Promise<Uint8Array> | undefined;
}

interface Registered {
  summary: CustomMapSummary;
  metadata: TrackMetadata;
  loaders: CustomMapLoaders;
  reader?: Promise<RhoReader>;
}

const registry = new Map<string, Registered>();
const listeners = new Set<() => void>();

/** 自制地图的赛道元数据（与赛道表的字段相同）。 */
export function customTrackMetadata(summary: CustomMapSummary): TrackMetadata {
  const trackId = summaryTrackId(summary);
  return {
    id: trackId,
    gameType: "speed",
    laps: summary.laps,
    difficulty: summary.difficulty,
    folder: trackId,
    theme: summary.theme,
    texTheme: summary.theme,
    bgmTheme: summary.theme,
    choosable: true,
    blocked: false,
    cnTitle: summary.source === "local" ? tr("[草稿] {value}", { value: String(summary.name) }) : summary.name,
    speedPool: false,
    roadExtent: summary.roadExtent,
  };
}

export function customTrackPath(trackId: string): string {
  return `track_${trackId}/track.1s`;
}

/** 赛道包打包时的名字（Rho 的密钥由它导出，读取时必须用同一个名字）。 */
function packedName(summary: CustomMapSummary): string {
  return `track_${customTrackId(summary.id)}.rho`;
}

async function openReader(name: string, bytes: Uint8Array): Promise<RhoReader> {
  const blob = new Blob([bytes as BlobPart]);
  const source = {
    name, size: blob.size,
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start?: number, end?: number) => blob.slice(start, end),
  };
  return new RhoReader(source, await scanRhoArchiveIndex(source));
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  return new TextDecoder().decode(bytes);
}

interface LookupLibrary {
  files: any[];
  byPath: Map<string, any>;
  byCanonicalPath: Map<string, any[]>;
  byExactCanonicalPath: Map<string, any[]>;
  canonicalPrefixCache?: Map<string, unknown>;
}

function lookupLibrary(library: unknown): LookupLibrary | undefined {
  const value = library as Partial<LookupLibrary> | undefined;
  return value && Array.isArray(value.files) && value.byPath instanceof Map &&
    value.byCanonicalPath instanceof Map && value.byExactCanonicalPath instanceof Map
    ? value as LookupLibrary : undefined;
}

/** 把一张自制地图的文件条目放进资源库（同 id 的旧条目先移除）。 */
function mount(library: LookupLibrary, entry: Registered): void {
  const trackId = summaryTrackId(entry.summary);
  const containerId = `custom:${trackId}`;
  const sourceName = `track_${trackId}.rho`;
  unmount(library, containerId);
  const reader = () => entry.reader ??= entry.loaders.container().then(bytes => openReader(packedName(entry.summary), bytes))
    .catch(error => { entry.reader = undefined; throw error; });
  entry.summary.files.forEach((file, ordinal) => {
    const virtualPath = `track_${trackId}/${file.path}`;
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const bytes = () => entry.loaders.file?.(file.path) ??
      reader().then(r => r.read(file.path));
    const item = {
      name, extension: dot < 0 ? "" : name.slice(dot + 1).toLowerCase(), size: file.size,
      sourceName, sourceKind: "rho" as const, containerId, absenceAuthoritative: true,
      sourceOrdinal: ordinal, canonicalPath: virtualPath, virtualPath,
      bytes, text: async () => decodeText(await bytes()),
    };
    library.files.push(item);
    library.byPath.set(virtualPath.toLowerCase(), item);
    library.byCanonicalPath.set(virtualPath.toLowerCase(), [...(library.byCanonicalPath.get(virtualPath.toLowerCase()) ?? []), item]);
    library.byExactCanonicalPath.set(virtualPath, [...(library.byExactCanonicalPath.get(virtualPath) ?? []), item]);
  });
  library.canonicalPrefixCache?.clear();
}

function unmount(library: LookupLibrary, containerId: string): void {
  const removed = library.files.filter(file => file.containerId === containerId);
  if (!removed.length) return;
  const gone = new Set(removed);
  // 原地过滤（资源库有十几万个条目，不能展开成参数）
  let write = 0;
  for (let read = 0; read < library.files.length; read++) {
    const file = library.files[read];
    if (!gone.has(file)) library.files[write++] = file;
  }
  library.files.length = write;
  for (const file of removed) {
    library.byPath.delete(file.virtualPath.toLowerCase());
    for (const [map, key] of [[library.byCanonicalPath, file.canonicalPath.toLowerCase()], [library.byExactCanonicalPath, file.canonicalPath]] as const) {
      const rest = (map.get(key) ?? []).filter((item: unknown) => !gone.has(item));
      if (rest.length) map.set(key, rest); else map.delete(key);
    }
  }
  library.canonicalPrefixCache?.clear();
}

/** 登记（或更新）一张自制地图（草稿和发布版本各占一个赛道 id）。 */
export function registerCustomMap(library: unknown, summary: CustomMapSummary, loaders: CustomMapLoaders): void {
  const trackId = summaryTrackId(summary);
  const known = registry.get(trackId);
  if (known && known.summary.sha256 === summary.sha256 && known.summary.source === summary.source) return;
  const entry: Registered = { summary, metadata: customTrackMetadata(summary), loaders };
  registry.set(trackId, entry);
  registerTrackMetadata(entry.metadata);
  const lookup = lookupLibrary(library);
  if (lookup) mount(lookup, entry);
  for (const listener of listeners) listener();
}

export function removeCustomMap(library: unknown, trackId: string): void {
  if (!registry.delete(trackId)) return;
  const lookup = lookupLibrary(library);
  if (lookup) unmount(lookup, `custom:${trackId}`);
  for (const listener of listeners) listener();
}

export function customMap(trackId: string): CustomMapSummary | undefined {
  return registry.get(trackId)?.summary;
}

export function customMaps(): CustomMapSummary[] {
  return [...registry.values()].map(entry => entry.summary);
}

export function customMapMetadata(trackId: string): TrackMetadata | undefined {
  return isCustomTrackId(trackId) ? registry.get(trackId)?.metadata : undefined;
}

export function onCustomMapsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 道具赛房间的选图条目：已发布、带道具箱的地图。 */
export function customItemTrackChoices(): TrackChoice[] {
  return customTrackChoices(true)
    .filter(choice => (registry.get(choice.id)?.summary.items ?? 0) > 0)
    .map(choice => ({ ...choice, gameType: "item" as const }));
}

/**
 * 计时赛和多人竞速房的选图条目。`published` 为 true 时只给已发布的地图
 * （多人房间里别人也要能下载到）。
 */
export function customTrackChoices(published = false): TrackChoice[] {
  return [...registry.values()]
    .filter(entry => !published || entry.summary.source === "server")
    .sort((a, b) => b.summary.updatedAt - a.summary.updatedAt)
    .map(entry => ({
      id: entry.metadata.id,
      path: customTrackPath(entry.metadata.id),
      title: entry.metadata.cnTitle ?? entry.summary.name,
      theme: entry.summary.theme,
      gameType: "speed" as const,
      difficulty: entry.summary.difficulty,
    }));
}
