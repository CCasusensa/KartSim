/**
 * 卡丁城 session: joins a city line on the lobby's game connection, then
 * drives the multiplayer race pipeline with a fabricated one-racer "race"
 * on the city track (no countdown wait, no finish), and layers the city on
 * top: members' karts (CityFleet), talk balloons and name tags, the day/night
 * and weather clock, city/near chat channels, resets to the nearest road and
 * the garage (G) for changing karts, character and accessories on the spot.
 */
import { beginRaceLoad, downloadTrack } from "../resources/resource-manager";
import { CityAtmosphere } from "./city-atmosphere";
import { skyStateAt, clockLabel } from "./city-clock";
import { CityNetwork, createCityRaceConnection, type CityClient } from "./city-connection";
import { designHeading, designToWorld, districtAt, nearestRoadPoint, physicsHeading, worldToDesign, type RoadSample } from "./city-coordinates";
import { CityFleet } from "./city-fleet";
import { CityLabels } from "./city-labels";
import type { CityEvent, CityPose, CitySnapshot } from "./city-protocol";
import { CITY_MAP, CITY_TRACK_ID, registerCityTrack } from "./city-track";
import { cityWaterLevel, type CityWaterMap } from "./city-water";
import { groundHeightAt } from "./city-ground";
import { applyCityVehicleScale, CITY_VEHICLE_SCALE } from "./city-vehicle-scale";
import { setTetherUnit } from "../vehicle/tether-motion";
import { beginCityLoading, firstCityFrame, type CityLoadingHandle } from "./city-loading";
import { CityFuelController } from "./city-fuel-controller";
import { CityOnFoot } from "./city-onfoot";
import { CityNavigator } from "./city-navigator";
import { CityRouteMinimap } from "./city-route-minimap";
import type { RaceChatMessage } from "../multiplayer/race-chat-overlay";
import type { GarageChoice, GarageView, GarageViewOptions } from "../multiplayer/lobby-garage";
import { formatMultiplayerError } from "../multiplayer/errors";
import { discardLocalKart, installLocalKart, loadLocalFlyingPet, loadLocalKart } from "./city-local-kart";
import { CityNpcs, withTraffic } from "./city-npcs";
import { CityQuests } from "./city-quests";
export { groundHeightAt } from "./city-ground";

export interface CityLobbyHost {
  client: CityClient;
  accountAbort?: AbortController;
  /** Called when the session ends: the lobby closes the city's node connection. */
  onCityClosed?: () => void;
  playerId: string;
  accountNickname?: string;
  lobby?: { show(): void; hide?(): void };
  disposed: boolean;
  render(): void;
  /** The room's 选择赛车 garage, opened over the city (lobby-controller.ts). */
  cityGarageView?(options: GarageViewOptions): Promise<GarageView>;
  normalizeCityEquipment?(profile: { equipment: unknown }, choice: GarageChoice): unknown;
  options: {
    library: unknown;
    root: unknown;
    raceLoader?: { prepare(room: any, race: any, signal: AbortSignal, connection: any): Promise<any> };
    cityLoading?: CityLoadingHandle;
    currentEquipment?(): unknown;
    initialEquipment?: unknown;
    /** The garage session and where a confirmed choice is saved (ready-multiplayer.ts). */
    garage?: { options(): Promise<GarageViewOptions>; apply(choice: GarageChoice): void };
    onRaceVisibility?(visible: boolean): void;
    onPageAudio?(page: string): void;
    status(message: string, error?: boolean): void;
    /** Set when the lobby was opened only for the city: leaving closes it. */
    onCityExit?(): void;
    lobbyGameplay?: string;
    [key: string]: unknown;
  };
}

const CHANNEL = "speedIndiCombine";

function uuid(): string {
  const webCrypto = globalThis.crypto as Crypto;
  if (typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  const hex = [...webCrypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The room and race snapshots the race pipeline validates. */
export function fabricateCityRace(snapshot: CitySnapshot, playerId: string, name: string, equipment: unknown) {
  const raceId = uuid();
  const roomId = `city:${snapshot.instanceId}`;
  const member = { playerId, name, slot: 0, ready: true, team: null, equipment, initial: "" };
  const race = {
    raceId, channelName: CHANNEL, gameplay: "ordinary", trackId: CITY_TRACK_ID,
    roster: [{ playerId, name, slot: 0, team: null, equipment, initial: "" }],
    startSlots: { [playerId]: 0 }, loadedIds: [playerId], finishes: [], results: [],
    startAt: 0,
  };
  const room = {
    roomId, revision: 1, name: snapshot.name, mode: "individual", capacity: 8, speedVersion: "国服",
    channelName: CHANNEL, speed: 7, gameplay: "ordinary", resourceVersion: "p3553", hostId: playerId,
    phase: "racing", trackId: CITY_TRACK_ID, members: [member], race,
  };
  return { room, race };
}

export class CitySession {
  network?: CityNetwork;
  stage?: any;
  fleet?: CityFleet;
  labels?: CityLabels;
  atmosphere?: CityAtmosphere;
  /** 加油 (FUEL.md); absent while the node runs without fuel. */
  fuel?: CityFuelController;
  /** 下车步行 (CITY.md 7). */
  onFoot?: CityOnFoot;
  /** The node's traffic and the task-point NPCs. */
  npcs?: CityNpcs;
  /** 送货任务 (CITY-QUESTS.md). */
  quests?: CityQuests;
  snapshot?: CitySnapshot;
  clockMapping?: { offsetMs: number };
  readonly abort = new AbortController();
  disposed = false;
  private chatListeners = new Set<(message: RaceChatMessage) => void>();
  private chatSequence = 0;
  private lastStatus = -Infinity;
  private lastSent = 0;
  private raceId = "";
  private unbindHostAbort?: () => void;

  constructor(readonly host: CityLobbyHost) {}

  get client(): CityClient { return this.host.client; }

  async enter(): Promise<void> {
    const { host } = this;
    const accountSignal = host.accountAbort?.signal;
    if (accountSignal && !this.unbindHostAbort) {
      const cancelled = () => { void this.cleanup(); };
      accountSignal.addEventListener("abort", cancelled, { once: true });
      this.unbindHostAbort = () => accountSignal.removeEventListener("abort", cancelled);
    }
    if (host.disposed || this.disposed || accountSignal?.aborted || this.abort.signal.aborted) {
      await this.cleanup();
      return;
    }
    const loader = host.options.raceLoader;
    if (!loader) throw new Error("多人驾驶装配器不可用。");
    const loading = beginCityLoading(host, this.abort.signal);
    try {
      await loading.ready;
      if (host.disposed || this.disposed || this.abort.signal.aborted) { await this.cleanup(); return; }
      host.options.status("正在进入卡丁城…");
      registerCityTrack();
      loading.stage("正在下载城市地图…", CITY_TRACK_ID);
      // The city downloads whole (read nearly all, kept for the next visit);
      // the race basics are read by range as in a race (resource-manager).
      const endCityLoad = beginRaceLoad();
      try {
        await downloadTrack(CITY_TRACK_ID);
      } finally {
        endCityLoad();
      }
      if (host.disposed || this.disposed || this.abort.signal.aborted) { await this.cleanup(); return; }
      loading.stage("正在加入卡丁城线路…");
      this.raceId = uuid();
      const network = new CityNetwork(host.client, this.raceId, {
        onEvent: event => this.onEvent(event),
        onMotion: (id, sequence, _kind, sample) => this.fleet?.receive(id, sequence, sample),
        onRadar: entries => this.fleet?.radar(entries),
      });
      this.network = network;
      const snapshot = await network.join();
      if (host.disposed || this.disposed || this.abort.signal.aborted) { await this.cleanup(); return; }
      this.snapshot = snapshot;
      host.options.status(`已进入 ${snapshot.name}，正在装配城市…`);
      const equipment = host.options.currentEquipment?.() ?? host.options.initialEquipment;
      this.ownEquipment = equipment;
      const { room, race } = fabricateCityRace(snapshot, host.playerId, host.accountNickname ?? "车手", equipment);
      this.raceId = race.raceId;
      // The network re-frames incoming frames with the encoder's race tag, so it must share the race id.
      network.dispose();
      this.network = new CityNetwork(host.client, race.raceId, {
        onEvent: event => this.onEvent(event),
        onMotion: (id, sequence, _kind, sample) => this.fleet?.receive(id, sequence, sample),
        onRadar: entries => this.fleet?.radar(entries),
        onTraffic: packet => this.npcs?.receive(packet),
      });
      const connection = createCityRaceConnection(this.network, host.playerId, room.roomId, race.raceId, {
        leave: async () => { await this.leave(); },
        onChat: listener => { this.chatListeners.add(listener); return () => { this.chatListeners.delete(listener); }; },
        allowMotion: () => this.onFoot?.allowRaceMotion() ?? true,
      });
      loading.stage("正在准备城市、车辆和界面…");
      const stage = await loader.prepare(room, race, this.abort.signal, connection);
      if (host.disposed || this.disposed || this.abort.signal.aborted) {
        // Cancellation may already have cleaned the session while prepare was
        // pending. Its late result was never owned by this.stage.
        try { stage.dispose(); } catch (error) { console.warn("城市场景释放失败", error); }
        await this.cleanup();
        return;
      }
      this.stage = stage;
      this.clockMapping = (host.client.captureClock() as { offsetMs: number } | undefined) ?? { offsetMs: 0 };
      stage.bindClock(this.clockMapping);
      stage.updateRoom(room);
      this.installCity(snapshot);
      this.teleportLocal(snapshot.you.spawn);
      this.fuel?.greet();
      host.lobby?.hide?.();
      host.options.onRaceVisibility?.(true);
      // Start seven seconds in the past: the countdown has already happened.
      loading.stage("正在显示卡丁城…");
      const rendered = firstCityFrame(stage, this.abort.signal);
      stage.scheduleStart(performance.now() - 7000);
      await rendered;
      if (host.disposed || this.disposed || this.abort.signal.aborted) { await this.cleanup(); return; }
      host.options.status(`欢迎来到${snapshot.name}。Enter 聊天，G 车库，Esc 离开。`);
      stage.chat?.notice?.("按 G 打开车库，随时换车、换角色、换装扮");
    } finally {
      loading.dispose();
    }
  }

  private installCity(snapshot: CitySnapshot): void {
    const stage = this.stage;
    const runtime = stage.runtime;
    const presenter = stage.scene;
    applyCityVehicleScale(runtime.local.physics);
    // Every kart here is drawn at the city size; balloon ropes keep that proportion.
    setTetherUnit(CITY_VEHICLE_SCALE);
    const root = stage.host.renderer.domElement.parentElement as HTMLElement;
    this.fleet = new CityFleet({
      assets: runtime.assets, presenter, track: runtime.local.track,
      now: () => performance.now(), onError: error => console.warn("城市成员错误", error),
      localPlayerId: this.host.playerId, renderCapacity: 24,
    });
    this.fleet.bindClock(this.clockMapping ?? { offsetMs: 0 });
    runtime.remotes?.dispose?.();
    // The presenter asks the remotes about NPC karts too ("npc:" ids).
    runtime.remotes = withTraffic(this.fleet, () => this.npcs?.traffic);
    // The race sender routes by the roster's distance cadence, which has no
    // peers here; without routing it sends every bucket to the node, which
    // fans out by its own interest radius (CITY.md §3).
    if (runtime.sender) runtime.sender.routing = undefined;
    for (const member of snapshot.members) this.fleet.add(member);

    this.labels = new CityLabels({
      root, library: this.host.options.library, camera: presenter.camera,
      heads: () => {
        const onFoot = this.onFoot;
        const kart = runtime.local.physics.body.position;
        const local = onFoot?.footWorld() ?? (onFoot?.seat === "passenger" ? undefined : kart);
        const heads = local
          ? [{ id: this.host.playerId, name: this.host.accountNickname ?? "我", position: { x: local.x, y: local.y, z: local.z } }]
          : [];
        for (const peer of this.fleet!.peers.values()) {
          const walking = onFoot?.headOf(peer.playerId);
          if (walking) { heads.push({ id: peer.playerId, name: peer.member.name, position: walking }); continue; }
          if (!this.fleet!.presentationVisible(peer.playerId, performance.now())) continue;
          const position = this.fleet!.worldPosition(peer.playerId);
          if (position) heads.push({ id: peer.playerId, name: peer.member.name, position });
        }
        if (onFoot) heads.push(...onFoot.parkedHeads());
        if (this.npcs) heads.push(...this.npcs.heads());
        return heads;
      },
    });

    const track = runtime.local.track;
    this.atmosphere = new CityAtmosphere({
      library: (this.host.options.library as any),
      scene: presenter.scene, trackRoot: track.group,
      skydomeRoot: track.skydomeScene?.object ?? track.skydome?.object ?? track.skydome,
      rain: runtime.assets.rain, rainAudio: runtime.assets.rainAudio, snow: runtime.assets.snow,
      serverTick: now => now + (this.clockMapping?.offsetMs ?? 0),
    });
    this.atmosphere.setClock(snapshot.clock);

    this.npcs = new CityNpcs({
      stage, library: this.host.options.library,
      serverNow: () => performance.now() + (this.clockMapping?.offsetMs ?? 0),
      local: () => {
        // On foot the walker, on a back seat nobody (no greetings); else the kart.
        const foot = this.onFoot?.footWorld();
        if (foot) return { position: foot, speed: 0 };
        if (this.onFoot?.seat === "passenger") return undefined;
        const body = runtime.local.physics.body;
        const state = runtime.local.physics.state;
        return { position: body.position, speed: Math.hypot(state.vx ?? 0, state.vz ?? 0) };
      },
      view: () => {
        const e = presenter.camera.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14] };
      },
      say: (id, text, now) => this.labels?.say(id, text, now),
      onError: error => console.warn("卡丁城 NPC 错误", error),
    });
    void this.npcs.start().catch(error => console.warn("卡丁城车流载入失败", error));

    this.quests = new CityQuests({
      root, library: this.host.options.library,
      camera: () => presenter.camera,
      renderer: () => stage.host.renderer,
      network: () => this.network,
      serverNow: () => performance.now() + (this.clockMapping?.offsetMs ?? 0),
      local: () => {
        const foot = this.onFoot?.footWorld();
        if (foot) return { position: foot, speed: 0 };
        if (this.onFoot?.seat === "passenger") return undefined;
        const state = runtime.local.physics.state;
        return { position: runtime.local.physics.body.position, speed: Math.abs(state.forwardSpeed ?? Math.hypot(state.vx ?? 0, state.vz ?? 0)) };
      },
      npcFeet: id => this.npcs?.feetOf(id),
      say: (npcId, text) => this.labels?.say(`npc-task:${npcId}`, text, performance.now()),
      notice: text => stage.chat?.notice?.(text),
      playerName: () => this.host.accountNickname ?? "我",
      playerCharacter: () => Number((this.host.options.currentEquipment?.() as { itemIds?: Record<string, number> } | undefined)
        ?.itemIds?.[1]) || undefined,
      pauseDriving: paused => this.pauseDriving(paused),
      audioContext: () => cityAudioContext(stage),
    });

    // Chat stays open while driving (the city has no finish), but not under
    // a city window: its Enter belongs to the window's OK button.
    const chat = stage.chat;
    if (chat) {
      chat.element?.setAttribute("aria-label", "卡丁城聊天");
      const setAllowed = chat.setAllowed.bind(chat);
      this.chatAllowed = setAllowed;
      chat.setAllowed = () => setAllowed(!this.windowOpen());
      if (chat.input) chat.input.maxLength = 60;
    }
    presenter.hud?.ui?.setTimeInfoVisible?.(false);
    // No rank board in the city: the HUD gets no board, only the minimap markers.
    const hud = presenter.hud;
    // The city's dense street map needs more contrast than the native 30% opacity.
    hud?.ui?.minimap?.mapScene?.object?.traverse((node: any) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        const alpha = material?.uniforms?.textureAlpha;
        if (alpha) alpha.value = 0.85;
      }
    });
    if (hud && typeof hud.update === "function") {
      const update = hud.update.bind(hud);
      hud.update = (race: unknown, time: number, ghosts: unknown[]) => update(race, time, ghosts, undefined);
    }

    // Resets go to the nearest road instead of the ring's section start.
    const local = runtime.local;
    local.requestReset = () => this.resetToRoad();
    local.checkAutomaticReset = () => this.checkReset();

    const update = stage.update.bind(stage);
    stage.update = (frame: unknown) => {
      update(frame);
      if (!this.disposed && stage.active) this.frame(performance.now());
    };
    // The mission timer and result draw over the frame just rendered.
    const render = stage.render.bind(stage);
    stage.render = (...args: unknown[]) => {
      const result = render(...args);
      if (!this.disposed && stage.active) this.quests?.render(performance.now());
      return result;
    };

    if (snapshot.you.fuel) {
      this.fuel = new CityFuelController({
        library: this.host.options.library, root,
        network: () => this.network,
        physics: () => this.stage?.runtime?.local?.physics,
        pose: () => this.localDesignPose(),
        teleport: pose => this.teleportLocal(pose, false),
        notice: text => { this.stage?.chat?.notice?.(text); this.host.options.status(text); },
      }, snapshot.you.fuel);
    }

    this.onFoot = new CityOnFoot({
      library: this.host.options.library, playerId: this.host.playerId, name: this.host.accountNickname ?? "车手",
      stage: () => this.stage,
      network: () => this.network,
      fleet: () => this.fleet,
      equipment: () => this.ownEquipment,
      notice: text => { this.stage?.chat?.notice?.(text); this.host.options.status(text); },
      teleport: (pose, notify) => this.teleportLocal(pose, notify),
      kartPose: () => this.localDesignPose(),
      setFuel: fuel => this.fuel?.setTank(fuel),
      setDriving: driving => this.setDriving(driving),
      viewport: () => ({ width: root.clientWidth, height: root.clientHeight }),
      navigator: () => this.navigator,
      questTarget: () => this.quests?.target(),
      root,
    });
    this.onFoot.install(snapshot.you.id, snapshot.members, snapshot.vehicles);

    // 导航: M map destinations, the green route on the HUD minimap.
    this.navigator = new CityNavigator({
      pose: () => this.onFoot?.mapMarkers().me,
      notice: text => { this.stage?.chat?.notice?.(text); this.host.options.status(text); },
    });
    void this.navigator.ready();
    const minimap = hud?.ui?.minimap;
    if (minimap?.source) this.routeMinimap = new CityRouteMinimap(minimap, root, stage.host.renderer.domElement);
    this.footKeyUp = (event: KeyboardEvent) => this.onFoot?.keyup(event);
    this.footBlur = () => this.onFoot?.blur();
    window.addEventListener("keyup", this.footKeyUp);
    window.addEventListener("blur", this.footBlur);

    // Esc twice within two seconds leaves the city (the race's Esc only
    // cancels input); G opens the garage, F the gas station or the rescue,
    // E gets out of / into a kart, L locks it.
    this.escapeListener = (event: KeyboardEvent) => {
      if (this.disposed || this.garageView || this.garageOpening) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (this.quests?.windowOpen) return;
      if (!this.fuel?.windowOpen && this.quests?.keydown(event)) return;
      if (!this.fuel?.windowOpen && this.onFoot?.keydown(event)) return;
      if (event.repeat) return;
      if (event.code === "KeyG" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (this.fuel?.windowOpen) return;
        event.preventDefault();
        if (this.onFoot && (this.onFoot.seat !== "driver" || this.onFoot.localKartVehicle !== this.onFoot.myId)) {
          this.stage?.chat?.notice?.("坐回自己的车里才能打开车库。");
          return;
        }
        void this.openGarage();
        return;
      }
      if (event.code === "KeyF") { this.fuel?.keydown(event); return; }
      if (event.code !== "Escape") return;
      if (this.fuel?.consumesEscape(performance.now())) return; // it closes a fuel window
      if (this.onFoot?.consumesEscape(performance.now())) return; // it closes the map
      const now = performance.now();
      if (now - this.lastEscape < 2000) {
        this.lastEscape = -Infinity;
        this.host.options.status("正在离开卡丁城…");
        void this.leave();
      } else {
        this.lastEscape = now;
        this.host.options.status("再按一次 Esc 离开卡丁城。");
        this.stage?.chat?.notice?.("再按一次 Esc 离开卡丁城");
      }
    };
    window.addEventListener("keydown", this.escapeListener);
  }

  private escapeListener?: (event: KeyboardEvent) => void;
  private footKeyUp?: (event: KeyboardEvent) => void;
  private footBlur?: () => void;
  private lastEscape = -Infinity;
  /** The member's own equipment (its kart and rider), as the garage last set it. */
  private ownEquipment: unknown;

  /** The race keys drive the kart only while the rider sits at its wheel. */
  private setDriving(driving: boolean): void {
    const stage = this.stage;
    stage?.host?.input?.setEnabled?.(driving);
    if (!driving) {
      stage?.runtime?.local?.cancelModeDrivingInput?.();
      stage?.runtime?.local?.physics?.hardCancelControls?.();
    }
  }

  // ---- 车库: change karts, character and accessories in the city ----
  garageView?: GarageView;
  garageOpening = false;
  private garageBusy = false;

  /** Opens the room's garage window over the city; driving pauses meanwhile. */
  async openGarage(): Promise<void> {
    const { host } = this;
    const garage = host.options.garage;
    const stage = this.stage;
    if (this.disposed || !stage || this.garageView || this.garageOpening) return;
    if (!garage || !host.cityGarageView || !host.normalizeCityEquipment) {
      stage.chat?.notice?.("这里暂时不能打开车库");
      return;
    }
    this.garageOpening = true;
    this.pauseDriving(true);
    // The window's caption sits where the status line is.
    if (this.statusLine) this.statusLine.style.visibility = "hidden";
    try {
      const options = await garage.options();
      if (this.disposed || this.stage !== stage) { this.pauseDriving(false); return; }
      const view = await host.cityGarageView({
        ...options,
        onCancel: () => { if (this.garageView === view) this.closeGarage(); },
        onConfirm: choice => { if (this.garageView === view) void this.confirmGarage(view, options.profile, choice); },
      });
      if (this.disposed || this.stage !== stage) {
        view.dispose();
        this.pauseDriving(false);
        return;
      }
      this.garageView = view;
      view.show();
    } catch (error) {
      console.warn("卡丁城车库打开失败", error);
      stage.chat?.notice?.(`车库打开失败：${formatMultiplayerError(error)}`);
      this.pauseDriving(false);
    } finally {
      this.garageOpening = false;
    }
  }

  closeGarage(): void {
    const view = this.garageView;
    this.garageView = undefined;
    this.garageBusy = false;
    if (!view) return;
    try { view.dispose(); } catch (error) { console.warn("卡丁城车库关闭失败", error); }
    if (!this.disposed) this.pauseDriving(false);
  }

  /**
   * The new kart loads first; the node then checks the gear and tells the
   * line; only then does the kart change here, where it stood.
   */
  private async confirmGarage(view: GarageView, profile: { equipment: unknown }, choice: GarageChoice): Promise<void> {
    const { host } = this;
    const stage = this.stage;
    if (this.garageBusy || !stage || !this.network || !host.normalizeCityEquipment) return;
    this.garageBusy = true;
    view.freeze();
    let loaded: any;
    try {
      const equipment = host.normalizeCityEquipment(profile, choice);
      loaded = await loadLocalKart(stage, host.playerId, host.accountNickname ?? "车手", equipment);
      if (this.disposed || this.stage !== stage || this.garageView !== view) return;
      await this.network.equip(equipment);
      if (this.disposed || this.stage !== stage || this.garageView !== view) return;
      const pose = this.localDesignPose();
      installLocalKart(stage, host.playerId, loaded);
      loaded = undefined;
      if (pose) this.teleportLocal(pose);
      host.options.garage?.apply({ ...choice, equipment });
      this.ownEquipment = equipment;
      this.closeGarage();
      void loadLocalFlyingPet(stage, host.options.library).catch(error => console.warn("飞宠载入失败", error));
      stage.chat?.notice?.("已换上新的装备");
    } catch (error) {
      console.warn("卡丁城换装失败", error);
      if (!this.disposed) stage.chat?.notice?.(`换装失败：${formatMultiplayerError(error)}`);
      if (this.garageView === view) view.unfreeze();
    } finally {
      if (loaded) discardLocalKart(loaded);
      if (this.garageView === view) this.garageBusy = false;
    }
  }

  /** While the garage is open the kart stands parked and ignores the keys. */
  private pauseDriving(paused: boolean): void {
    const stage = this.stage;
    if (!paused && this.statusLine) this.statusLine.style.visibility = "";
    stage?.host?.input?.setEnabled?.(!paused);
    if (paused) {
      stage?.runtime?.local?.cancelModeDrivingInput?.();
      stage?.runtime?.local?.physics?.hardCancelControls?.();
    }
    void this.network?.state(paused ? "parked" : "driving").catch(() => undefined);
  }

  private statusLine?: HTMLDivElement;
  /** The chat overlay's own setAllowed (the city's override keeps it on outside windows). */
  private chatAllowed?: (allowed: boolean) => void;
  navigator?: CityNavigator;
  private routeMinimap?: CityRouteMinimap;

  /** A city window (refuel, rescue, map, garage) is up or opening. */
  private windowOpen(): boolean {
    return !!(this.fuel?.windowOpen || this.onFoot?.mapOpen || this.garageView || this.garageOpening ||
      this.quests?.windowOpen);
  }

  private frame(now: number): void {
    this.chatAllowed?.(!this.windowOpen());
    // The M map covers most of the view: the HUD overlays above it step aside.
    const covered = !!this.onFoot?.mapOpen;
    this.fuel?.cover(covered);
    this.quests?.cover(covered);
    if (this.statusLine) this.statusLine.style.visibility = covered ? "hidden" : "";
    if (this.navigator) {
      this.navigator.frame(now);
      this.routeMinimap?.update(this.navigator, covered);
    }
    this.atmosphere?.update(now);
    this.npcs?.update(now);
    this.quests?.update(now);
    this.labels?.draw(now);
    this.fuel?.frame(now);
    if (now - this.lastStatus > 1000) {
      this.lastStatus = now;
      const state = this.atmosphere?.state;
      const design = this.localDesignPose();
      const district = design ? districtAt(design.x, design.z) : undefined;
      if (state) {
        const weather = state.weather === "rain" ? " · 雨" : state.weather === "snow" ? " · 雪" : "";
        this.showStatus(`${this.snapshot?.name ?? "卡丁城"} · ${district?.name ?? "城外"} · ${clockLabel(state.timeOfDay)}${weather} · 在线 ${(this.fleet?.peers.size ?? 0) + 1} · G 车库`);
      }
    }
  }

  private showStatus(text: string): void {
    const root = this.stage?.host?.renderer?.domElement?.parentElement as HTMLElement | undefined;
    if (!root) return;
    if (!this.statusLine) {
      const line = document.createElement("div");
      line.className = "kartcity-status";
      line.setAttribute("aria-label", "卡丁城状态");
      Object.assign(line.style, {
        position: "absolute", left: "50%", top: "12px", transform: "translateX(-50%)",
        padding: "4px 14px", borderRadius: "14px", background: "rgba(10, 20, 40, 0.55)",
        color: "#ffffff", font: "bold 15px 'PingFang SC', 'Microsoft YaHei', sans-serif",
        letterSpacing: "0.5px", pointerEvents: "none", zIndex: "4", whiteSpace: "nowrap",
      });
      root.append(line);
      this.statusLine = line;
    }
    if (this.statusLine.textContent !== text) this.statusLine.textContent = text;
  }

  private localDesignPose(): CityPose | undefined {
    const physics = this.stage?.runtime?.local?.physics;
    if (!physics) return undefined;
    const p = physics.body.position;
    const design = worldToDesign(p.x, p.y, p.z);
    return { ...design, heading: designHeading(physics.body.forward) };
  }

  /** Puts the local kart at a design pose (ground-snapped) and tells the node (unless it moved it). */
  teleportLocal(pose: CityPose, notify = true): void {
    const runtime = this.stage?.runtime;
    if (!runtime) return;
    const { physics, track } = runtime.local;
    const world = designToWorld(pose.x, pose.y, pose.z);
    const ground = groundHeightAt(track, world.x, world.z, world.y) ?? world.y;
    physics.reset(world.x, ground + 0.4, world.z, physicsHeading(pose.heading));
    runtime.local.coordinator?.synchronizePositionAnchor?.();
    track.resetRouteState(physics, physics.body.position);
    physics.state.trackProgress = track.getRouteState(physics).distance;
    this.fuel?.jump();
    if (notify) void this.network?.respawn(pose).catch((error: unknown) => {
      if (error instanceof Error && error.message === "FUEL_EMPTY")
        this.stage?.chat?.notice?.("油箱空了，车已熄火，请按 F 呼叫道路救援。");
    });
  }

  private checkReset(): void {
    const runtime = this.stage?.runtime;
    if (!runtime) return;
    const physics = runtime.local.physics;
    const requested = physics.consumeAutomaticResetRequest?.() ?? false;
    // Only water, falling below the world, or an explicit physics reset causes
    // recovery. Ordinary terrain remains freely driveable beyond road edges.
    let road: RoadSample | undefined;
    const design = this.localDesignPose();
    const world = (CITY_MAP as typeof CITY_MAP & { world?: CityWaterMap }).world;
    const water = design ? cityWaterLevel(world, design.x, design.z) : undefined;
    const submerged = water !== undefined && physics.body.position.y < water - 1.5;
    if (physics.body.position.y < -6 || requested || submerged) {
      if (design) road = nearestRoadPoint(design.x, design.z);
    }
    if (!road) return;
    const fell = physics.body.position.y < road.y - 6;
    if (!fell && !requested && !submerged) return;
    this.resetToRoad(road);
  }

  /** City recovery is a notified teleport, never a race checkpoint transition. */
  resetToRoad(road?: RoadSample): boolean {
    const local = this.stage?.runtime?.local;
    if (this.disposed || !local || local.disposed ||
        local.lifecycle.state !== local.dependencies.runtime.states.Racing ||
        local.resetState.phase !== 0) return false;
    const design = this.localDesignPose();
    if (!design) return false;
    road ??= nearestRoadPoint(design.x, design.z);
    // A stalled kart may only reset nearby (the node refuses farther, FUEL.md 4.3).
    if (this.fuel?.fuel.empty && Math.hypot(road.x - design.x, road.z - design.z) > 140) {
      this.stage?.chat?.notice?.("油箱空了，车已熄火，请按 F 呼叫道路救援。");
      return false;
    }
    const heading = ((Math.atan2(road.tx, -road.tz) * 180) / Math.PI + 360) % 360;
    local.cancelModeDrivingInput();
    this.teleportLocal({ x: road.x, y: road.y, z: road.z, heading });
    local.lowSpeedResetStartedAtMs = 0;
    local.resetSoundPending = true;
    this.host.options.status("已复位到最近的道路。");
    return true;
  }

  private onEvent(event: CityEvent): void {
    const now = performance.now();
    switch (event.type) {
      case "city-joined":
        this.fleet?.add(event.member);
        this.onFoot?.memberJoined(event.member, event.vehicle);
        this.pushChat(`${event.member.name} 进入了卡丁城`);
        break;
      case "city-left":
        this.onFoot?.memberLeft(event.id, event.playerId);
        this.fleet?.remove(event.playerId);
        break;
      case "city-vehicle":
        this.onFoot?.vehicleChanged(event.vehicle);
        break;
      case "city-vehicle-gone":
        this.onFoot?.vehicleGone(event.id);
        break;
      case "city-seat":
        this.onFoot?.seatChanged(event);
        break;
      case "city-chat": {
        const mine = event.playerId === this.host.playerId;
        this.pushChat(event.text, event.playerId, event.name, event.channel);
        this.labels?.say(mine ? this.host.playerId : event.playerId, event.text, now);
        break;
      }
      case "city-state":
        this.fleet?.setState(event.id, event.state);
        break;
      case "city-respawn":
        this.fleet?.respawn(event.id, event.pose);
        break;
      case "city-equipment":
        this.fleet?.reequip(event.id, event.equipment);
        this.onFoot?.equipmentChanged(event.id, event.equipment);
        break;
      case "city-fuel":
        this.fuel?.apply(event.fuel, event.reason);
        break;
      case "city-clock":
        this.atmosphere?.setClock(event.clock);
        if (this.snapshot) this.snapshot = { ...this.snapshot, clock: event.clock };
        break;
      case "city-quest-failed":
      case "city-quest-progress":
        this.quests?.onEvent(event);
        break;
      case "city-kicked":
        this.host.options.status(`已离开卡丁城：${event.reason}`, true);
        void this.cleanup();
        break;
      default:
        break;
    }
  }

  private pushChat(text: string, playerId = "system", name = "系统", channel?: string): void {
    const message = { sequence: ++this.chatSequence, playerId, name, text, channel };
    for (const listener of this.chatListeners) {
      try { listener(message); } catch (error) { console.warn("聊天显示失败", error); }
    }
  }

  async leave(): Promise<void> {
    try { await this.network?.leave(); } catch { /* already gone */ }
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    if (current === this) current = undefined;
    const debug = globalThis as { __kartcity?: unknown };
    if (debug.__kartcity === this) delete debug.__kartcity;
    if (this.disposed) return;
    this.disposed = true;
    setTetherUnit(1);
    this.unbindHostAbort?.();
    this.unbindHostAbort = undefined;
    this.abort.abort();
    if (this.escapeListener) window.removeEventListener("keydown", this.escapeListener);
    this.escapeListener = undefined;
    const garage = this.garageView;
    this.garageView = undefined;
    try { garage?.dispose(); } catch (error) { console.warn("卡丁城车库关闭失败", error); }
    this.stage?.host?.input?.setEnabled?.(true);
    this.labels?.dispose();
    this.onFoot?.dispose();
    this.navigator?.dispose();
    this.routeMinimap?.dispose();
    this.routeMinimap = undefined;
    this.onFoot = undefined;
    if (this.footKeyUp) window.removeEventListener("keyup", this.footKeyUp);
    if (this.footBlur) window.removeEventListener("blur", this.footBlur);
    this.fuel?.dispose();
    this.fuel = undefined;
    this.atmosphere?.dispose();
    this.npcs?.dispose();
    this.quests?.dispose();
    this.statusLine?.remove();
    this.statusLine = undefined;
    const stage = this.stage;
    this.stage = undefined;
    try { stage?.dispose(); } catch (error) { console.warn("城市会话释放失败", error); }
    this.fleet?.dispose();
    this.network?.dispose();
    this.host.onCityClosed?.();
    this.host.options.onRaceVisibility?.(false);
    if (this.host.disposed) return;
    if (this.host.options.lobbyGameplay === "city" && this.host.options.onCityExit) {
      this.host.options.onCityExit();
      return;
    }
    this.host.lobby?.show();
    this.host.render();
    this.host.options.onPageAudio?.("lobby");
    this.host.options.status("已返回多人大厅。");
  }
}

let current: CitySession | undefined;

/** Opens the city from the multiplayer lobby. */
export async function enterCity(host: CityLobbyHost): Promise<void> {
  if (current && !current.disposed) return;
  const session = new CitySession(host);
  current = session;
  (globalThis as { __kartcity?: unknown }).__kartcity = session;
  try {
    await session.enter();
  } catch (error) {
    if (!host.disposed && !session.disposed && !session.abort.signal.aborted) {
      console.error("进入卡丁城失败", error);
      host.options.status(`进入卡丁城失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
    await session.cleanup();
  }
}

export function activeCitySession(): CitySession | undefined {
  return current && !current.disposed ? current : undefined;
}

export { skyStateAt };

/** The race's audio context (for the mission success / fail sounds). */
function cityAudioContext(stage: any): AudioContext | undefined {
  let hosted: unknown;
  try { hosted = typeof stage?.host?.audio === "function" ? stage.host.audio() : undefined; } catch { hosted = undefined; }
  for (const candidate of [hosted, stage?.runtime?.assets?.draftAudio?.context, stage?.scene?.bgm?.context])
    if (candidate && typeof candidate.createBufferSource === "function") return candidate as AudioContext;
  return undefined;
}
