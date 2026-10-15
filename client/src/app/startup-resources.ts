import { tr } from "../i18n/locale";
import { installResourceManager, type ResourceLibraryApi, type ResourceStoreApi } from "../resources/resource-manager";
import type { Rho5PackSpec } from "../resources/resource-groups";
import { isPrefetchStore, prefetchStartupReads } from "../resources/startup-reads";
import { holdRacePlaylists } from "../timeattack/race-bgm-loading";
import { StartupProgress, type StartupWork } from "./startup-progress";
import { installCustomMaps } from "../mapeditor/custom-map-loader";

/** Resource bootstrap, first-rider registration, and Ready-stage preparation. */
export interface StartupDisposable {
  dispose(): void;
}

export interface StartupSource {
  name: string;
}

export interface StartupSelection {
  trackId: string;
  mapPath: string;
  vehicleItemId: number;
  characterPath?: string;
  characterItemId?: number;
  [key: string]: unknown;
}

export interface RiderProfile {
  equipment: {
    itemIds: Record<number, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RiderCatalog {
  karts: Array<{ itemId: number; [key: string]: unknown }>;
  characters: Array<{ itemId: number; title: string; path: string }>;
  equipment: Array<{ kind: string; itemId: number; title: string }>;
}

export interface StartupLibrary {
  files: unknown[];
  archives: unknown[];
  errors: string[];
  warnings: string[];
  timeAttackGarageCatalog(): Promise<RiderCatalog>;
  mapCatalog(): Promise<unknown[]>;
  trackMetadata(trackId: string): Promise<unknown>;
}

export interface MountedStartupSources {
  sources: unknown;
  archiveIndexes: unknown;
}

export interface StartupAudioContext {
  state: string;
  close(): Promise<unknown> | void;
}

export interface StartupHost {
  root: unknown;
  assets: {
    beginGeneration(): number;
    isCurrent(generation: number): boolean;
    install(library: StartupLibrary, sources: MountedStartupSources): void;
  };
  hud: {
    beginStartupLoading?(): void;
    setStartupProgress?(percent: number, message: string): void;
    chooseResourceSource(defaultName: string): Promise<StartupSource | undefined>;
    setLoadingProgress(key: string, loadedBytes: number, totalBytes: number, message: string): void;
    /** A download that failed leaves the loading badge. */
    dropLoadingProgress?(key: string): void;
    showDebugText(message: string, level?: string): void;
    finishLoading(): void;
    showLoadingError(message: string): void;
  };
  rhoLibrary?: StartupLibrary;
  userProfile: RiderProfile;
  newRiderDialog?: RiderDialog;
  localNickname: string;
  toonStageBinding: { retain(environment: StartupDisposable): void };
  session: { selection?: StartupSelection; vehicleTitle: string };
  audio: {
    context?: StartupAudioContext;
    bgm?: StartupDisposable;
    bgmTrackId?: string;
    interfaceAudio?: StartupDisposable;
  };
  gameOptions: unknown;
  targetRandom: unknown;
  prepareStartupReady(library: StartupLibrary, selection: StartupSelection, vehicleTitle: string,
    onProgress?: (current: number, total: number) => void): Promise<void>;
  applyNewRiderRegistration(): Promise<void>;
  enterTimeAttackReady(): Promise<unknown>;
}

export interface ResourceLoadingDependencies {
  localResourcesSupported(): boolean;
  recoverLocalSource(): Promise<StartupSource | undefined>;
  defaultSourceName: string;
  versionId(version: string): string;
  loadVersionedSources(
    version: string,
    onProgress: (progress: { phase?: string; file: string; loadedBytes: number; totalBytes: number;
      background?: boolean }) => void,
    source: StartupSource | undefined,
  ): Promise<MountedStartupSources>;
  loadLibrary(sources: unknown, archiveIndexes: unknown,
    onProgress?: (event: { current: number; total: number; filename: string }) => void): Promise<StartupLibrary>;
  loadProfile(): RiderProfile | undefined | Promise<RiderProfile | undefined>;
  defaultProfile(): RiderProfile;
  resolveSelection(catalog: RiderCatalog, maps: unknown[], profile: RiderProfile): {
    selection: StartupSelection;
    vehicleTitle: string;
  };
  isSpecialKartId(itemId: number | undefined): boolean;
  displayKartName(itemId: number | undefined): string;
  localNickname(): string;
  /**
   * Account login gate (server-go/ECONOMY.md 7.1): runs after the resources
   * load and before the profile is read; resolves only with a signed-in account.
   */
  ensureAccount?(): Promise<void>;
  /** Replace equipment the account does not own before the startup selection. */
  sanitizeProfile?(profile: RiderProfile, catalog: RiderCatalog): RiderProfile;
  /** Whether the first-rider dialog runs; the release asks when no local nickname is saved. */
  needsRiderRegistration?(): boolean;
  /**
   * The account profile could not be read: explain it and resolve when the
   * player chooses 重试 (like the login gate). Without it the failure is the
   * loading error.
   */
  retryProfile?(error: unknown): Promise<void>;
}

/** How long after the home screen opens the 首页 group starts downloading (its own reads go first). */
const HOME_DOWNLOAD_DELAY_MS = 3_000;

/**
 * Installs the resource manager over the mounted container store. Startup
 * does not wait for the 首页 group: the store reads only the bytes startup
 * needs (HTTP Range) — about 40 MiB instead of the 870 MiB of containers
 * those reads touch. The returned function downloads the missing 首页
 * containers whole in the background (one download slot, low priority), so
 * the next start reads them from OPFS. A failure (no space) is reported;
 * pages keep reading on demand.
 */
function installHomeResources(mounted: MountedStartupSources, library: unknown,
  warn: (message: string) => void): (() => void) | undefined {
  const store = (mounted as { store?: ResourceStoreApi }).store;
  const indexes = mounted.archiveIndexes as { rho5?: readonly Rho5PackSpec[] } | undefined;
  if (!store || typeof store.cachedNames !== "function") return undefined;
  const lookup = library as Partial<ResourceLibraryApi>;
  const manager = installResourceManager(store, indexes?.rho5 ?? [],
    typeof lookup.entriesUnderCanonicalPrefix === "function" ? lookup as ResourceLibraryApi : undefined);
  return () => {
    void manager.ready.then(() => {
      const home = manager.group("home");
      if (!home || !manager.missing(home.containers).length) return;
      manager.download(home.containers, { label: tr("首页资源"), priority: "low", groupId: "home" }).done
        .catch(error => {
          if (error instanceof Error && error.message === "CANCELLED") return;
          warn(tr("首页资源后台下载未完成（{0}），使用时按需读取。", { "0": error instanceof Error ? error.message : String(error) }));
        });
    });
  };
}

/**
 * Starts fetching what startup is known to read (resources/startup-reads.ts)
 * so the decoders find it in memory instead of waiting one round trip per
 * file: the catalogs' and login window's part now, the home screen's part
 * at the login gate (`home`), after the first, and what every race reads
 * once the home screen is up (`race`: most players race next).
 */
function warmStartupReads(mounted: MountedStartupSources): { home(): void; race(): void } {
  const store = (mounted as { store?: unknown }).store;
  if (!isPrefetchStore(store)) return { home: () => undefined, race: () => undefined };
  const early = prefetchStartupReads(store, "early");
  let home: Promise<void> | undefined;
  return {
    home: () => { home ??= early.then(() => prefetchStartupReads(store, "late")); },
    race: () => { void (home ?? early).then(() => prefetchStartupReads(store, "race")); },
  };
}

/** Ignore results from superseded generations at every asynchronous boundary. */
export async function loadStartupResources(
  host: StartupHost,
  dependencies: ResourceLoadingDependencies,
): Promise<void> {
  const generation = host.assets.beginGeneration();
  host.hud.beginStartupLoading?.();
  const progress = new StartupProgress();
  let active = true;
  let finished = false;
  // The startup track's race music decodes once the home screen is up.
  let releaseRaceMusic: (() => void) | undefined;
  const report = (work: StartupWork, current: number, total: number, message: string): void => {
    if (active && host.hud.setStartupProgress && host.assets.isCurrent(generation))
      host.hud.setStartupProgress(progress.update(work, current, total), message);
  };
  try {
    const localSource = dependencies.localResourcesSupported()
      ? (await dependencies.recoverLocalSource()) ??
        (await host.hud.chooseResourceSource(dependencies.defaultSourceName))
      : undefined;
    if (!host.assets.isCurrent(generation)) return;

    const mounted = await dependencies.loadVersionedSources(
      dependencies.versionId("p3553"),
      progress => {
        // Background downloads show on the 资源下载 button, not the loading badge.
        if (progress.background || (!active && !finished) ||
            (host.hud.setStartupProgress && !host.assets.isCurrent(generation))) return;
        // Range reads share one entry: their bytes are counted together.
        const key = progress.phase === "partial" ? "resource:分段读取" : `resource:${progress.file.toLowerCase()}`;
        if (progress.phase === "failed") {
          host.hud.dropLoadingProgress?.(key);
          return;
        }
        host.hud.setLoadingProgress(
          key,
          progress.loadedBytes,
          progress.totalBytes,
          tr("正在加载 {0}", { "0": progress.file }),
        );
      },
      localSource,
    );
    if (!host.assets.isCurrent(generation)) return;
    const warm = warmStartupReads(mounted);
    report("sources", 1, 1, tr("正在解析资源索引"));

    const library = await dependencies.loadLibrary(mounted.sources, mounted.archiveIndexes,
      event => report("library", event.current, event.total, tr("正在解析资源索引")));
    if (!host.assets.isCurrent(generation)) return;
    if (library.files.length === 0) {
      throw new Error(library.errors[0] ?? "没有成功读取任何资源文件。");
    }
    // 地图工坊的本机草稿与已发布地图：只登记条目，比赛时才下载。
    void installCustomMaps(library);
    // Startup reads what it needs by range; the 首页 group downloads whole
    // once the home screen is open, everything else when a page needs it
    // (tracks when a race loads) or from the 资源下载 panel.
    const downloadHome = installHomeResources(mounted, library,
      message => host.hud.showDebugText(message, "error"));
    report("library", 1, 1, tr("正在加载车辆与赛道目录"));

    const [garageCatalog, maps] = await Promise.all([
      library.timeAttackGarageCatalog().then(catalog => {
        report("garage", 1, 1, tr("正在加载车辆与赛道目录"));
        return catalog;
      }),
      library.mapCatalog().then(maps => {
        report("maps", 1, 1, tr("正在加载车辆与赛道目录"));
        return maps;
      }),
    ]);
    if (!host.assets.isCurrent(generation)) return;

    warm.home();
    report("account", 0, 1, tr("正在连接账号服务，请完成登录"));
    if (dependencies.ensureAccount) {
      await dependencies.ensureAccount();
      if (!host.assets.isCurrent(generation)) return;
    }
    report("account", 1, 1, tr("正在读取车手档案"));
    let profile = dependencies.loadProfile();
    if (profile instanceof Promise) {
      let loaded: RiderProfile | undefined;
      for (;;) {
        try {
          loaded = await profile;
          break;
        } catch (error) {
          if (!dependencies.retryProfile || !host.assets.isCurrent(generation)) throw error;
          await dependencies.retryProfile(error);
          if (!host.assets.isCurrent(generation)) return;
          profile = dependencies.loadProfile();
          if (!(profile instanceof Promise)) {
            loaded = profile;
            break;
          }
        }
      }
      host.userProfile = loaded ?? dependencies.defaultProfile();
      if (!host.assets.isCurrent(generation)) return;
    } else {
      host.userProfile = profile ?? dependencies.defaultProfile();
    }
    if (dependencies.sanitizeProfile)
      host.userProfile = dependencies.sanitizeProfile(host.userProfile, garageCatalog);
    report("profile", 1, 1, tr("正在初始化音频与游戏场景"));
    const startup = dependencies.resolveSelection(garageCatalog, maps, host.userProfile);
    host.assets.install(library, mounted);
    releaseRaceMusic = holdRacePlaylists();
    await host.prepareStartupReady(library, startup.selection, startup.vehicleTitle,
      (current, total) => report("ready", current, total, tr("正在初始化音频与游戏场景")));
    if (!host.assets.isCurrent(generation)) return;
    report("ready", 1, 1, tr("游戏初始化完成"));

    if (library.errors[0]) host.hud.showDebugText(library.errors[0], "error");
    else if (library.warnings[0]) host.hud.showDebugText(library.warnings[0]);
    host.hud.showDebugText(
      tr("已读取资源：{0} 个容器，{1} 个文件", { "0": library.archives.length, "1": library.files.length }),
    );
    host.hud.showDebugText(tr("已加载发布版档案索引，物理容器按需缓存"));
    if (localSource) {
      host.hud.showDebugText(
        tr("优先读取本地 {0}，不匹配的容器使用在线资源", { "0": localSource.name }),
      );
    }
    const equippedKartId = host.userProfile.equipment.itemIds[3];
    if (dependencies.isSpecialKartId(equippedKartId) &&
      startup.selection.vehicleItemId !== equippedKartId) {
      host.hud.showDebugText(
        tr("{0} 本次使用{1}启动，未修改保存资料。", { "0": dependencies.displayKartName(equippedKartId), "1": startup.vehicleTitle }),
      );
    }
    host.hud.finishLoading();
    finished = true;
    releaseRaceMusic();
    warm.race();
    if (downloadHome) setTimeout(() => {
      if (host.assets.isCurrent(generation)) downloadHome();
    }, HOME_DOWNLOAD_DELAY_MS);
    const registerRider = dependencies.needsRiderRegistration
      ? dependencies.needsRiderRegistration() : dependencies.localNickname() === "";
    if (registerRider) await host.applyNewRiderRegistration();
  } catch (error) {
    if (host.assets.isCurrent(generation)) {
      host.hud.showLoadingError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    active = false;
    releaseRaceMusic?.();
  }
}

export interface RiderDialog {
  open(options?: { name?: string; maxLength?: number }): Promise<{
    name: string;
    characterItemId: number;
    paintItemId: number;
    dyeItemId: number;
  }>;
  dispose(): void;
}

export interface RiderRegistrationDependencies {
  loadEnvironment(library: StartupLibrary): Promise<StartupDisposable>;
  loadDialog(
    library: StartupLibrary,
    root: unknown,
    options: {
      characters: Array<{ itemId: number; title: string }>;
      paints: Array<{ itemId: number; title: string }>;
      dyes: Array<{ itemId: number; title: string }>;
      defaults: {
        character: number | undefined;
        paint: number | undefined;
        dye: number | undefined;
      };
    },
    context: {
      library: StartupLibrary;
      environment: StartupDisposable;
      stageBinding: StartupHost["toonStageBinding"];
      kartItem: RiderCatalog["karts"][number];
      characterItems: RiderCatalog["characters"];
      profile: RiderProfile;
    },
  ): Promise<RiderDialog>;
  saveProfile(profile: RiderProfile): void;
  saveNickname(name: string): void;
}

/** Register a rider and apply their initial character, color, and dye. */
export async function registerNewRider(
  host: StartupHost,
  dependencies: RiderRegistrationDependencies,
): Promise<void> {
  const library = host.rhoLibrary;
  if (!library) return;
  const catalog = await library.timeAttackGarageCatalog();
  const vehicleItemId = host.session.selection?.vehicleItemId;
  const kart = catalog.karts.find(item => item.itemId === vehicleItemId);
  if (kart === undefined) {
    throw new Error(`车手注册预览缺少启动车辆 ItemKart ${vehicleItemId}。`);
  }
  const environment = await dependencies.loadEnvironment(library);
  try {
    host.newRiderDialog ??= await dependencies.loadDialog(
      library,
      host.root,
      {
        characters: catalog.characters.map(({ itemId, title }) => ({ itemId, title })),
        paints: catalog.equipment
          .filter(item => item.kind === "color")
          .map(({ itemId, title }) => ({ itemId, title })),
        dyes: catalog.equipment
          .filter(item => item.kind === "dye")
          .map(({ itemId, title }) => ({ itemId, title })),
        defaults: {
          character: host.userProfile.equipment.itemIds[1],
          paint: host.userProfile.equipment.itemIds[2],
          dye: host.userProfile.equipment.itemIds[70],
        },
      },
      {
        library,
        environment,
        stageBinding: host.toonStageBinding,
        kartItem: kart,
        characterItems: catalog.characters,
        profile: host.userProfile,
      },
    );
    const choice = await host.newRiderDialog.open();
    const profile = host.userProfile;
    host.userProfile = {
      ...profile,
      equipment: {
        ...profile.equipment,
        itemIds: {
          ...profile.equipment.itemIds,
          1: choice.characterItemId,
          2: choice.paintItemId,
          70: choice.dyeItemId,
        },
      },
    };
    dependencies.saveProfile(host.userProfile);
    dependencies.saveNickname(choice.name);
    host.localNickname = choice.name;

    const character = catalog.characters.find(item => item.itemId === choice.characterItemId);
    if (character && host.session.selection?.characterPath !== undefined) {
      host.session.selection = {
        ...host.session.selection,
        characterPath: character.path,
        characterItemId: character.itemId,
      };
      await host.enterTimeAttackReady();
    }
  } finally {
    host.newRiderDialog?.dispose();
    host.newRiderDialog = undefined;
    host.toonStageBinding.retain(environment);
    environment.dispose();
  }
}

export interface StartupReadyDependencies {
  onProgress?(current: number, total: number): void;
  createAudioContext(): StartupAudioContext;
  applyAudioOptions(context: StartupAudioContext, gameOptions: unknown): void;
  loadBgm(library: StartupLibrary, metadata: unknown, random: unknown,
    context: StartupAudioContext): Promise<StartupDisposable>;
  loadInterfaceAudio(library: StartupLibrary,
    context: StartupAudioContext): Promise<StartupDisposable>;
}

/** Prepare music and interface sound before entering the Ready stage. */
export async function prepareStartupReady(
  host: StartupHost,
  library: StartupLibrary,
  selection: StartupSelection,
  vehicleTitle: string,
  dependencies: StartupReadyDependencies,
): Promise<void> {
  const metadata = await library.trackMetadata(selection.trackId);
  if (!metadata) throw new Error(`${selection.mapPath} 缺少权威 track metadata。`);
  const context = dependencies.createAudioContext();
  dependencies.applyAudioOptions(context, host.gameOptions);
  dependencies.onProgress?.(1, 4);
  let bgm: StartupDisposable | undefined;
  let interfaceAudio: StartupDisposable | undefined;
  try {
    bgm = await dependencies.loadBgm(library, metadata, host.targetRandom, context);
    dependencies.onProgress?.(2, 4);
    interfaceAudio = await dependencies.loadInterfaceAudio(library, context);
    dependencies.onProgress?.(3, 4);
    host.session.selection = { ...selection };
    host.session.vehicleTitle = vehicleTitle;
    host.audio.context = context;
    host.audio.bgm = bgm;
    host.audio.bgmTrackId = selection.trackId;
    host.audio.interfaceAudio = interfaceAudio;
    await host.enterTimeAttackReady();
    dependencies.onProgress?.(4, 4);
  } catch (error) {
    interfaceAudio?.dispose();
    bgm?.dispose();
    if (host.audio.bgm === bgm) {
      host.audio.bgm = undefined;
      host.audio.bgmTrackId = undefined;
    }
    if (host.audio.interfaceAudio === interfaceAudio) host.audio.interfaceAudio = undefined;
    if (host.audio.context === context) host.audio.context = undefined;
    if (context.state !== "closed") context.close();
    host.session.selection = undefined;
    host.session.vehicleTitle = "";
    throw error;
  }
}
