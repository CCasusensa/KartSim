/**
 * 地图包（.kartmap）：一张地图的全部文件打成一个 zip，导出后可以发给别人，
 * 导入编辑器继续修改，或直接在游戏的计时赛里玩（导入时登记成本机地图）。
 *
 *   map.json                  清单：格式、版本、摘要（名字、主题、圈数…）
 *   design.json               设计文件（与“设计文件”导出相同）
 *   track_custom_<id>.rho     与官方赛道同格式的赛道包
 *   card.png / thumb.png      选图卡片与缩略图
 *
 * 导入时不信任清单里的文件表和哈希：容器的文件表从容器本身读出，哈希重新计算。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { scanRhoArchiveIndex } from "../codecs/rho-index-scan";
import { RhoReader } from "../codecs/rho";
import { customTrackId, itemBoxCount, parseDesign, type MapDesign } from "./design";
import type { CustomMapFile, CustomMapSummary } from "./custom-tracks";
import { sha256Hex } from "./map-service";

export const PACKAGE_FORMAT = "kartsim-mappack";
export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = ".kartmap";
/** 与服务端发布上限相同。 */
export const PACKAGE_CONTAINER_LIMIT = 40 << 20;

export interface MapPackage {
  design: MapDesign;
  summary: CustomMapSummary;
  container: Uint8Array;
  card?: Uint8Array;
  thumb?: Uint8Array;
}

export function containerName(mapId: string): string {
  return `track_${customTrackId(mapId)}.rho`;
}

/** 读出赛道包里的文件表（路径与解压后大小）。 */
export async function containerFiles(name: string, bytes: Uint8Array): Promise<CustomMapFile[]> {
  const blob = new Blob([bytes as BlobPart]);
  const source = { name, size: blob.size, arrayBuffer: () => blob.arrayBuffer(), slice: (start?: number, end?: number) => blob.slice(start, end) };
  const reader = new RhoReader(source, await scanRhoArchiveIndex(source));
  const files: CustomMapFile[] = [];
  for (const file of reader.files) files.push({ path: file.path, size: (await reader.read(file.path)).length });
  return files;
}

export function encodeMapPackage(pack: MapPackage): Uint8Array {
  const { source: _source, ...summary } = pack.summary;
  void _source;
  const manifest = { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exportedAt: Date.now(), summary };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    "map.json": strToU8(JSON.stringify(manifest, null, 1)),
    "design.json": strToU8(JSON.stringify(pack.design, null, 1)),
    // 赛道包里的贴图已经压缩过，原样存放
    [containerName(pack.design.id)]: [pack.container, { level: 0 }],
  };
  if (pack.card) files["card.png"] = [pack.card, { level: 0 }];
  if (pack.thumb) files["thumb.png"] = [pack.thumb, { level: 0 }];
  return zipSync(files, { level: 6 });
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 解开并校验一个地图包；格式不对时抛出中文错误。 */
export async function decodeMapPackage(bytes: Uint8Array): Promise<MapPackage> {
  if (!isZip(bytes)) throw new Error("不是地图包文件。");
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new Error("地图包已损坏，无法解开。"); }
  const manifestBytes = entries["map.json"], designBytes = entries["design.json"];
  if (!manifestBytes || !designBytes) throw new Error("地图包缺少 map.json 或 design.json。");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as { format?: string; version?: number; summary?: Partial<CustomMapSummary> };
  if (manifest.format !== PACKAGE_FORMAT) throw new Error("不是地图工坊的地图包。");
  if (manifest.version !== PACKAGE_VERSION) throw new Error(`不支持的地图包版本 ${String(manifest.version)}。`);
  const design = parseDesign(strFromU8(designBytes));
  const name = containerName(design.id);
  const container = entries[name];
  if (!container) throw new Error(`地图包里没有赛道包 ${name}。`);
  if (container.length > PACKAGE_CONTAINER_LIMIT) throw new Error("赛道包超过 40 MB。");
  const files = await containerFiles(name, container).catch(() => { throw new Error("赛道包已损坏，无法读取。"); });
  if (!files.some(file => file.path === "track.1s")) throw new Error("赛道包里没有 track.1s。");
  const declared = manifest.summary ?? {};
  const summary: CustomMapSummary = {
    id: design.id, name: design.name, author: typeof declared.author === "string" ? declared.author : "",
    theme: design.theme, laps: design.laps, difficulty: design.difficulty,
    roadExtent: typeof declared.roadExtent === "number" && declared.roadExtent >= 100 ? declared.roadExtent : 20000,
    items: itemBoxCount(design),
    sha256: await sha256Hex(container), size: container.length, files,
    updatedAt: design.updatedAt, source: "local",
  };
  return { design, summary, container, card: entries["card.png"], thumb: entries["thumb.png"] };
}
