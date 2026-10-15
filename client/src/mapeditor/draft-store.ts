import { tr } from "../i18n/locale";
/**
 * 本机草稿（IndexedDB，编辑器页和游戏页同源共享）：设计文件，以及最近一次
 * 生成的赛道包。游戏启动时把生成过的草稿挂成“本机地图”，计时赛里就能试跑。
 */
import type { MapDesign } from "./design";
import type { CustomMapSummary } from "./custom-tracks";

const DB_NAME = "kartsim-mapeditor";
const DESIGNS = "designs";
const BUILDS = "builds";

export interface StoredBuild {
  id: string;
  summary: CustomMapSummary;
  container: Blob;
  card?: Blob;
  thumb?: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error(tr("浏览器不支持 IndexedDB。"))); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DESIGNS)) db.createObjectStore(DESIGNS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BUILDS)) db.createObjectStore(BUILDS, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(tr("IndexedDB 打开失败。")));
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = work(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error(tr("IndexedDB 写入失败。")));
      transaction.onabort = () => reject(transaction.error ?? new Error(tr("IndexedDB 事务中止（存储空间不足？）。")));
    });
  } finally {
    db.close();
  }
}

export function saveDesign(design: MapDesign): Promise<unknown> {
  return run(DESIGNS, "readwrite", store => store.put(design));
}

export function loadDesign(id: string): Promise<MapDesign | undefined> {
  return run(DESIGNS, "readonly", store => store.get(id) as IDBRequest<MapDesign | undefined>);
}

export async function listDesigns(): Promise<MapDesign[]> {
  const designs = await run(DESIGNS, "readonly", store => store.getAll() as IDBRequest<MapDesign[]>);
  return designs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  await run(DESIGNS, "readwrite", store => store.delete(id));
  await run(BUILDS, "readwrite", store => store.delete(id));
}

export function saveBuild(build: StoredBuild): Promise<unknown> {
  return run(BUILDS, "readwrite", store => store.put(build));
}

export function loadBuild(id: string): Promise<StoredBuild | undefined> {
  return run(BUILDS, "readonly", store => store.get(id) as IDBRequest<StoredBuild | undefined>);
}

export async function listBuilds(): Promise<StoredBuild[]> {
  return run(BUILDS, "readonly", store => store.getAll() as IDBRequest<StoredBuild[]>);
}
