import list from "./startup-reads.json";

/**
 * The container byte ranges a first start reads on its way to the home
 * screen (recorded with tools/startup-reads.mjs), fetched together instead
 * of one round trip after another as the decoders discover them:
 *
 *  - "early": what the vehicle and track catalogs and the login window read;
 *  - "late": what the home screen reads after login (the Ready stage, the
 *    taskbar, a new account's 创建车手 window).
 *
 * The list belongs to one manifest revision; a store of another revision
 * skips it.
 */
export type StartupReadTier = "early" | "late";

export interface StartupReadList {
  readonly version: string;
  readonly revision: string;
  readonly early: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
  readonly late: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
}

export interface PrefetchStore {
  readonly manifest: { readonly version: string; readonly revision: string };
  prefetch(ranges: StartupReadList["early"]): Promise<void>;
}

export const STARTUP_READS = list as unknown as StartupReadList;

export function isPrefetchStore(store: unknown): store is PrefetchStore {
  const candidate = store as Partial<PrefetchStore> | undefined;
  return typeof candidate?.prefetch === "function" && typeof candidate.manifest?.revision === "string";
}

/** Fetches one tier of the list; resolves when done (failures are left to the reads). */
export async function prefetchStartupReads(store: PrefetchStore, tier: StartupReadTier,
  reads: StartupReadList = STARTUP_READS): Promise<void> {
  if (store.manifest.version !== reads.version || store.manifest.revision !== reads.revision) return;
  try {
    await store.prefetch(reads[tier]);
  } catch (error) {
    console.warn("启动资源预取失败", error);
  }
}
