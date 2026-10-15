import { tr } from "../i18n/locale";
import type { ContainerMismatchError } from "../resources/container-store";
import { ensureFeatureResources, showResourceFailureNotice } from "../ui/resource-panel";
import { showAccountMessage, showAccountToast, type OverlayDocument } from "../account/account-dialogs";
import { activeBrowserSession } from "../account/account-runtime";
import { accountOwnedEquipment, garageViewCatalog } from "../account/garage-ownership";
import { channelLicenseWarning } from "../license/license-model";
import { cheatKickMessage, type CheatKick } from "../multiplayer/cheat-kick";
import type { ReadyOptions, ReadySelection } from "./ready-flow";
import { selectionKeep } from "./ready-garage";
import { isTopBarLibrary } from "../ui/lobby-top-bar-assets";
import { mountLobbyTopBar } from "../ui/lobby-top-bar";
import { MAIN_MENU_FONT_FAMILY } from "../ui/main-menu-view";
import { goReadyHome, type ReadyHomeController } from "./ready-home";
import { closeReadyLottery } from "./ready-lottery";
import { closeReadyShop } from "./ready-shop";
import { openShopUnlessRacing, type GuardedShopController } from "./ready-shop-guard";
import { beginCityLoading } from "../city/city-loading";
import { tellPlayer } from "../ui/game-popups";

interface Profile {
  favoriteTracks: unknown[];
  initial?: unknown;
  equipment?: unknown;
  [key: string]: unknown;
}

interface GarageChoice {
  kart: { path: string; itemId: number; systemKey: string; title: string };
  character: { path: string; itemId: number };
  equipment: unknown;
}

interface Lobby {
  open(): Promise<unknown>;
  dispose(): void;
  leaveRoom(reason: string): Promise<boolean>;
  networkDiagnostics(): unknown[];
  /** Select a channel's room list once connected (MultiplayerLobbyController.list). */
  list?(channel: string, page: number, quiet?: boolean, gameplay?: string): Promise<void>;
}

interface Notice {
  show(message: unknown, kind: unknown, details: unknown, durationMs?: number): void;
}

/** Operations the Ready controller needs when moving to the multiplayer lobby. */
export interface ReadyMultiplayerController {
  host: {
    root: HTMLElement;
    toonStageBinding: unknown;
    hud: { showDebugText(message: string, kind: string): void };
    shell: {
      current: string;
      modal?: string;
      enterMultiplayerLobby(from: string): boolean;
      restoreGarageFromMultiplayerLobby(): void;
      leaveMultiplayerLobby(): void;
    };
    multiplayerRaceLoader?: unknown;
    getLibrary(): { timeAttackGarageCatalog(): Promise<unknown> } | undefined;
    getReadyOptions(): ReadyOptions;
    setReadyOptions(options: ReadyOptions): void;
    getGameOptions(): { autoReady: boolean; mainMenuBgmPath: string; [key: string]: unknown };
    setGameOptions(options: { autoReady: boolean; mainMenuBgmPath: string;
      [key: string]: unknown }): void;
    saveGameOptions(): void;
    getSelection(): ReadySelection | undefined;
    setSelection(selection: ReadySelection): void;
    setVehicleTitle(title: string): void;
    getProfile(): Profile;
    setProfile(profile: Profile): void;
    saveProfile(): void;
    getBgm(): {
      prepareMultiplayer(library: unknown, path: string): Promise<unknown>;
      playMultiplayer(page: string): void;
    } | undefined;
    getAudioContext(): { resume(): Promise<unknown> } | undefined;
    getInterfaceAudio(): { playHover(): void; playStart(): void; playClick(): void } | undefined;
  };
  disposed: boolean;
  multiplayer?: Lobby;
  /** The lobby's resources are downloading before it opens. */
  multiplayerOpening?: boolean;
  activeGarage?: { freeze(): void; unfreeze(): void; dispose(): void };
  activeTimeAttackReady?: { freeze(): void; unfreeze(): void; hide(): void; show(): void };
  activeSettings?: { setRoomSpeed(speed: number, version: string): void };
  activeTaskbar?: { setVisible(visible: boolean): void };
  activeWindowNotice?: Notice;
  activeShop?: { close(): void };
  readyToonEnvironment?: unknown;
  closeMultiplayer(openReady?: boolean, restoreReady?: boolean): void;
  returnMultiplayerToSinglePlayer(): Promise<void>;
  multiplayerGarageOptions(): Promise<unknown>;
  applyMultiplayerGarage(choice: GarageChoice): void;
  changeFavoriteTrack(track: unknown, favorite: boolean): void;
  changeFavoriteItems(items: unknown): void;
  showGarageError(error: unknown): void;
  enterTimeAttackReady(): Promise<unknown>;
}

export interface ReadyMultiplayerDependencies {
  sanitizeReadyOptions(options: ReadyOptions): ReadyOptions;
  nickname(): string | undefined;
  version(id: string): string;
  initialEquipment(profile: Profile): unknown;
  favoriteTrackIds(favorites: unknown[], scope: unknown): unknown;
  createNotice(root: HTMLElement): Notice;
  createLobby(options: Record<string, unknown>): Lobby;
  /**
   * A game node refused unowned equipment (403 ITEM_NOT_OWNED): re-read the
   * inventory and replace unowned items in the live profile
   * (account-startup repairEquipmentForMultiplayer).
   */
  repairEquipment?(): Promise<void>;
}

/** Commands whose equipment is replaced by the repaired gear before sending them again. */
const GEAR_COMMANDS = new Set(["create", "join"]);

/** Create the lobby, bind its UI callbacks, then open its login/connection flow. */
export async function openReadyMultiplayer(controller: ReadyMultiplayerController,
  deps: ReadyMultiplayerDependencies, channel?: string,
  gameplay = "ordinary"): Promise<void> {
  if (controller.disposed || controller.multiplayer || controller.multiplayerOpening) return;
  const host = controller.host;
  const library = host.getLibrary();
  if (!library) return;
  controller.multiplayerOpening = true;
  const cityLoading = gameplay === "city" ? beginCityLoading({
    get disposed() { return controller.disposed; },
    options: { library, root: host.root,
      status: (message, error) => { if (error) tellPlayer(host.hud, message); } },
  }) : undefined;
  try {
    if (cityLoading) await cityLoading.ready;
    if (controller.disposed) return;
    cityLoading?.stage(tr("正在准备联机资源…"));
    try {
      await ensureFeatureResources(host.root, "multiplayer");
    } catch { /* Pages read on demand. */ } finally {
      controller.multiplayerOpening = false;
    }
    if (controller.disposed || controller.multiplayer) return;

    const garage = host.shell.modal === "garage" ? controller.activeGarage : undefined;
    if (!host.shell.enterMultiplayerLobby(garage ? "garage" : "ready")) return;
    // channel.xml licenseLevel: the CN client only advises (joinChannelWarning).
    const warning = channelLicenseWarning(channel, activeBrowserSession()?.summary()?.progress.license ?? 0);
    if (warning) showAccountToast(host.root.ownerDocument as unknown as OverlayDocument, warning);
    host.setReadyOptions(deps.sanitizeReadyOptions(host.getReadyOptions()));
    garage?.freeze();

    let becameVisible = false;
    // Game nodes refuse unowned gear, so only owned items leave this client.
    const equipment = () => accountOwnedEquipment(deps.initialEquipment(host.getProfile()));
    const lobby = deps.createLobby({
      library,
      root: host.root,
      ...(cityLoading ? { cityLoading } : {}),
      nickname: deps.nickname() ?? "",
      version: deps.version("p3553"),
      // The room list opens on the category of a home quick entry.
      lobbyChannel: channel,
      lobbyGameplay: channel ? gameplay : undefined,
      raceLoader: host.multiplayerRaceLoader,
      prepareAudio: async () => {
        const bgm = host.getBgm();
        if (!bgm) throw new Error("多人缺少 BGM owner。");
        await bgm.prepareMultiplayer(library, host.getGameOptions().mainMenuBgmPath);
      },
      audioContext: () => host.getAudioContext(),
      onPageAudio: (page: string) => host.getBgm()?.playMultiplayer(page),
      onRaceVisibility: (visible: boolean) => {
        // The race covers everything; the shop is not modal to it.
        if (visible) {
          closeReadyShop(controller);
          closeReadyLottery(controller as unknown as { activeLottery?: { close(): void } });
        }
        controller.activeTaskbar?.setVisible(!visible);
      },
      initialTrackId: host.getSelection()?.trackId,
      initialEquipment: equipment(),
      currentEquipment: equipment,
      repairEquipment: async (command: Record<string, unknown>) => {
        if (!deps.repairEquipment) return undefined;
        await deps.repairEquipment();
        if (command.type === "equipment")
          return { ...command, equipment: accountOwnedEquipment(command.equipment) };
        return GEAR_COMMANDS.has(String(command.type))
          ? { ...command, equipment: equipment() } : undefined;
      },
      initial: host.getProfile().initial,
      garage: {
        options: () => controller.multiplayerGarageOptions(),
        apply: (choice: GarageChoice) => controller.applyMultiplayerGarage(choice),
      },
      speed: (speed: number, version: string) => {
        host.setReadyOptions({
          ...host.getReadyOptions(),
          speed: version === "国服" && speed === 4 ? 4 : 7,
          version,
          settingSpeed: speed,
        });
        controller.activeSettings?.setRoomSpeed(speed, version);
      },
      status: (message: string, error: boolean) => {
        if (error) tellPlayer(host.hud, message);
      },
      // The status line is easy to miss: a failed city entry gets a window, with
      // 资源下载 on the 卡丁城 group when its resources may be the cause, or
      // 刷新页面 when the server holds other versions of them (no download helps).
      onCityFailed: (reason: string, resources: boolean, mismatch?: ContainerMismatchError) => {
        const onActivate = () => host.getInterfaceAudio()?.playClick();
        if (mismatch) {
          void showResourceFailureNotice(host.root, tr("进入卡丁城失败"),
            tr("服务器上的游戏资源 {file} 和当前游戏版本不一致\n", { file: mismatch.file }) +
            tr("（需要 {expected} 字节，服务器上是 {actual} 字节），\n", { expected: mismatch.expectedBytes, actual: mismatch.servedBytes }) +
            tr("重新下载也无法解决。\n\n先点“刷新页面”再试；仍然这样时，\n") +
            tr("请服务器管理员更新游戏资源（git pull、git lfs pull）后重启服务。"), { reload: true, onActivate });
          return;
        }
        void showResourceFailureNotice(host.root, tr("进入卡丁城失败"), resources
          ? tr("{reason}\n\n可能是卡丁城资源下载出错。\n点“资源下载”删除卡丁城资源后重新下载，\n", { reason: reason }) +
            tr("以后也可以在 设置 → 变更设置 里打开资源下载。")
          : reason, { ...(resources ? { group: "city" } : {}), onActivate });
      },
      // The lobby's status bar stays above the room, as in the original; its
      // "+" opens the shop like the home's.
      topBar: (barHost: HTMLElement) => {
        const session = activeBrowserSession();
        if (!session) return undefined;
        return mountLobbyTopBar(barHost, {
          session, fontFamily: MAIN_MENU_FONT_FAMILY,
          ...(isTopBarLibrary(library) ? { library } : {}),
          onHover: () => host.getInterfaceAudio()?.playHover(),
          onActivate: () => host.getInterfaceAudio()?.playClick(),
        });
      },
      // Our own connection dropped (mid-race too): leave multiplayer for the 大厅
      // (home); 多人游戏 there connects again.
      onDisconnected: (kick?: CheatKick) => {
        if (controller.multiplayer !== lobby || controller.disposed) return;
        const document = host.root.ownerDocument as unknown as OverlayDocument;
        if (kick) void showAccountMessage(document, tr("已被移出比赛"), cheatKickMessage(kick), tr("确定"));
        else showAccountToast(document, tr("与联机服务器的连接已断开，已返回大厅。可以重新进入多人游戏。"));
        void goReadyHome(controller as unknown as ReadyHomeController,
          () => controller.returnMultiplayerToSinglePlayer());
      },
      autoReadyEnabled: () => host.getGameOptions().autoReady,
      toggleAutoReady: () => {
        const current = host.getGameOptions();
        const autoReady = !current.autoReady;
        host.setGameOptions({ ...current, autoReady });
        host.saveGameOptions();
        return autoReady;
      },
      onVisible: () => {
        becameVisible = true;
        controller.activeTimeAttackReady?.hide();
        if (garage && controller.activeGarage === garage) {
          garage.dispose();
          controller.activeGarage = undefined;
        }
      },
      trackFavorites: {
        ids: (scope: unknown) => deps.favoriteTrackIds(host.getProfile().favoriteTracks, scope),
        count: () => host.getProfile().favoriteTracks.length,
        change: (track: unknown, favorite: boolean) =>
          controller.changeFavoriteTrack(track, favorite),
      },
      onNotice: (message: unknown, kind: unknown, details: unknown) => {
        controller.activeWindowNotice ??= deps.createNotice(host.root);
        controller.activeWindowNotice.show(message, kind, details, 2_000);
      },
      onHover: () => host.getInterfaceAudio()?.playHover(),
      onStartActivate: () => host.getInterfaceAudio()?.playStart(),
      onActivate: () => host.getInterfaceAudio()?.playClick(),
      // 卡丁城's 操作说明 shows the player's driving keys.
      keyMap: () => host.getGameOptions().keyMap,
      // 卡丁城 has no room list: leaving the city closes the lobby and returns to 首页.
      onCityExit: () => {
        if (controller.multiplayer !== lobby || controller.disposed) return;
        // The lobby only carried the connection; close it outright and show home.
        void goReadyHome(controller as unknown as ReadyHomeController,
          () => { if (controller.multiplayer === lobby) controller.closeMultiplayer(false, true); });
      },
    });
    controller.multiplayer = lobby;
    controller.activeTimeAttackReady?.freeze();

    try {
      cityLoading?.stage(tr("正在连接大厅…"));
      await lobby.open();
      if (controller.multiplayer !== lobby || controller.disposed) return;
      // A home quick entry opens straight onto its room list; 卡丁城 has none.
      if (channel && gameplay !== "city") await lobby.list?.(channel, 0, false, gameplay);
    } catch (error) {
      if (controller.multiplayer !== lobby) return;
      const cancelled = error instanceof Error && error.message === "ACCOUNT_CANCELLED";
      if (garage && !becameVisible) {
        controller.multiplayer = undefined;
        lobby.dispose();
        host.shell.restoreGarageFromMultiplayerLobby();
        garage.unfreeze();
        controller.activeTimeAttackReady?.unfreeze();
      } else if (becameVisible) {
        controller.closeMultiplayer();
      } else {
        controller.multiplayer = undefined;
        lobby.dispose();
        host.shell.leaveMultiplayerLobby();
        controller.activeTimeAttackReady?.unfreeze();
        controller.activeTimeAttackReady?.show();
      }
      if (!cancelled) tellPlayer(host.hud,
        tr("多人游戏：{error}", { error: error instanceof Error ? error.message : String(error) }));
    }
  } finally {
    controller.multiplayerOpening = false;
    cityLoading?.dispose();
  }
}

/** Build the same garage session used in the lobby from current Ready equipment. */
export async function readyMultiplayerGarageOptions(controller: ReadyMultiplayerController,
  createNotice: (root: HTMLElement) => Notice): Promise<Record<string, unknown>> {
  const host = controller.host;
  const library = host.getLibrary();
  const environment = controller.readyToonEnvironment;
  const selection = host.getSelection();
  if (!library || !environment || selection?.vehicleItemId === undefined ||
      !selection.characterItemId) {
    throw new Error("房间选车缺少资源或当前装备身份。");
  }
  return {
    library,
    environment,
    root: host.root,
    stageBinding: host.toonStageBinding,
    // The room garage lists only owned items (game nodes refuse unowned equipment).
    catalog: garageViewCatalog(await library.timeAttackGarageCatalog(), selectionKeep(selection)),
    profile: host.getProfile(),
    selectedKartItemId: selection.vehicleItemId,
    selectedKartSystemKey: selection.vehicleSystemKey,
    selectedKartPath: selection.vehiclePath,
    selectedCharacterItemId: selection.characterItemId,
    onFavoriteChange: (items: unknown) => controller.changeFavoriteItems(items),
    onHover: () => host.getInterfaceAudio()?.playHover(),
    onActivate: () => host.getInterfaceAudio()?.playClick(),
    onInteraction: () => { host.getAudioContext()?.resume(); },
    onNotice: (message: unknown, kind: unknown, details: unknown) => {
      controller.activeWindowNotice ??= createNotice(host.root);
      controller.activeWindowNotice.show(message, kind, details);
    },
  };
}

/** Keep Ready selection and persisted equipment aligned after a lobby garage choice. */
export function applyReadyMultiplayerGarage(controller: ReadyMultiplayerController,
  choice: GarageChoice): void {
  const host = controller.host;
  const selection = host.getSelection();
  if (!selection) return;
  host.setSelection({
    ...selection,
    vehiclePath: choice.kart.path,
    vehicleItemId: choice.kart.itemId,
    vehicleSystemKey: choice.kart.systemKey,
    characterPath: choice.character.path,
    characterItemId: choice.character.itemId,
  });
  host.setVehicleTitle(choice.kart.title);
  host.setProfile({ ...host.getProfile(), equipment: choice.equipment });
  try {
    host.saveProfile();
  } catch (error) {
    tellPlayer(host.hud, tr("本次装备选择未保存：{error}", { error: String(error) }));
  }
}
