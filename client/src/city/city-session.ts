/**
 * 卡丁城 session: joins a city line on the lobby's game connection, then
 * drives the multiplayer race pipeline with a fabricated one-racer "race"
 * on the city track (no countdown wait, no finish), and layers the city on
 * top: members' karts (CityFleet), talk balloons and name tags, the day/night
 * and weather clock, chat on the near channel, resets to the nearest road.
 */
import { downloadRaceTrack } from "../resources/resource-manager";
import { CityAtmosphere } from "./city-atmosphere";
import { skyStateAt, clockLabel } from "./city-clock";
import { CityNetwork, createCityRaceConnection, type CityClient } from "./city-connection";
import { designHeading, designToWorld, districtAt, nearestRoadPoint, physicsHeading, worldToDesign } from "./city-coordinates";
import { CityFleet } from "./city-fleet";
import { CityLabels } from "./city-labels";
import type { CityEvent, CityPose, CitySnapshot } from "./city-protocol";
import { CITY_TRACK_ID, registerCityTrack } from "./city-track";

export interface CityLobbyHost {
  client: CityClient;
  playerId: string;
  accountNickname?: string;
  lobby?: { show(): void; hide?(): void };
  disposed: boolean;
  render(): void;
  options: {
    library: unknown;
    root: unknown;
    raceLoader?: { prepare(room: any, race: any, signal: AbortSignal, connection: any): Promise<any> };
    currentEquipment?(): unknown;
    initialEquipment?: unknown;
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
  snapshot?: CitySnapshot;
  clockMapping?: { offsetMs: number };
  readonly abort = new AbortController();
  disposed = false;
  private chatListeners = new Set<(message: any) => void>();
  private chatSequence = 0;
  private lastStatus = -Infinity;
  private lastSent = 0;
  private raceId = "";

  constructor(readonly host: CityLobbyHost) {}

  get client(): CityClient { return this.host.client; }

  async enter(): Promise<void> {
    const { host } = this;
    const loader = host.options.raceLoader;
    if (!loader) throw new Error("多人驾驶装配器不可用。");
    host.options.status("正在进入卡丁城…");
    registerCityTrack();
    await downloadRaceTrack(CITY_TRACK_ID);
    if (host.disposed) return;
    this.raceId = uuid();
    const network = new CityNetwork(host.client, this.raceId, {
      onEvent: event => this.onEvent(event),
      onMotion: (id, sequence, _kind, sample) => this.fleet?.receive(id, sequence, sample),
      onRadar: entries => this.fleet?.radar(entries),
    });
    this.network = network;
    const snapshot = await network.join();
    this.snapshot = snapshot;
    host.options.status(`已进入 ${snapshot.name}，正在装配城市…`);
    const equipment = host.options.currentEquipment?.() ?? host.options.initialEquipment;
    const { room, race } = fabricateCityRace(snapshot, host.playerId, host.accountNickname ?? "车手", equipment);
    this.raceId = race.raceId;
    // The network re-frames incoming frames with the encoder's race tag, so it must share the race id.
    network.dispose();
    this.network = new CityNetwork(host.client, race.raceId, {
      onEvent: event => this.onEvent(event),
      onMotion: (id, sequence, _kind, sample) => this.fleet?.receive(id, sequence, sample),
      onRadar: entries => this.fleet?.radar(entries),
    });
    const connection = createCityRaceConnection(this.network, host.playerId, room.roomId, race.raceId, {
      leave: async () => { await this.leave(); },
      onChat: listener => { this.chatListeners.add(listener); return () => { this.chatListeners.delete(listener); }; },
    });
    const stage = await loader.prepare(room, race, this.abort.signal, connection);
    this.stage = stage;
    if (host.disposed || this.disposed) { stage.dispose(); return; }
    this.clockMapping = (host.client.captureClock() as { offsetMs: number } | undefined) ?? { offsetMs: 0 };
    stage.bindClock(this.clockMapping);
    stage.updateRoom(room);
    this.installCity(snapshot);
    this.teleportLocal(snapshot.you.spawn);
    host.lobby?.hide?.();
    host.options.onRaceVisibility?.(true);
    // Start seven seconds in the past: the countdown has already happened.
    stage.scheduleStart(performance.now() - 7000);
    host.options.status(`欢迎来到${snapshot.name}。Enter 聊天，Esc 离开。`);
  }

  private installCity(snapshot: CitySnapshot): void {
    const stage = this.stage;
    const runtime = stage.runtime;
    const presenter = stage.scene;
    const root = stage.host.renderer.domElement.parentElement as HTMLElement;
    this.fleet = new CityFleet({
      assets: runtime.assets, presenter, track: runtime.local.track,
      now: () => performance.now(), onError: error => console.warn("城市成员错误", error),
      localPlayerId: this.host.playerId, renderCapacity: 24,
    });
    this.fleet.bindClock(this.clockMapping ?? { offsetMs: 0 });
    runtime.remotes?.dispose?.();
    runtime.remotes = this.fleet;
    for (const member of snapshot.members) this.fleet.add(member);

    this.labels = new CityLabels({
      root, library: this.host.options.library, camera: presenter.camera,
      heads: () => {
        const local = runtime.local.physics.body.position;
        const heads = [{ id: this.host.playerId, name: this.host.accountNickname ?? "我", position: { x: local.x, y: local.y, z: local.z } }];
        for (const peer of this.fleet!.peers.values()) {
          if (!this.fleet!.presentationVisible(peer.playerId, performance.now())) continue;
          const position = this.fleet!.worldPosition(peer.playerId);
          if (position) heads.push({ id: peer.playerId, name: peer.member.name, position });
        }
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

    // Chat stays open while driving; the city has no finish.
    const chat = stage.chat;
    if (chat) {
      const setAllowed = chat.setAllowed.bind(chat);
      chat.setAllowed = () => setAllowed(true);
      if (chat.input) chat.input.maxLength = 60;
    }
    presenter.hud?.ui?.setTimeInfoVisible?.(false);
    // No rank board in the city: the HUD gets no board, only the minimap markers.
    const hud = presenter.hud;
    if (hud && typeof hud.update === "function") {
      const update = hud.update.bind(hud);
      hud.update = (race: unknown, time: number, ghosts: unknown[]) => update(race, time, ghosts, undefined);
    }

    // Resets go to the nearest road instead of the ring's section start.
    const local = runtime.local;
    local.checkAutomaticReset = () => this.checkReset();

    const update = stage.update.bind(stage);
    stage.update = (frame: unknown) => {
      update(frame);
      if (!this.disposed && stage.active) this.frame(performance.now());
    };
  }

  private frame(now: number): void {
    this.atmosphere?.update(now);
    this.labels?.draw(now);
    if (now - this.lastStatus > 15000) {
      this.lastStatus = now;
      const state = this.atmosphere?.state;
      const design = this.localDesignPose();
      const district = design ? districtAt(design.x, design.z) : undefined;
      if (state) this.host.options.status(`${this.snapshot?.name ?? "卡丁城"} · ${district?.name ?? "城外"} · ${clockLabel(state.timeOfDay)}${state.weather === "rain" ? " · 雨" : state.weather === "snow" ? " · 雪" : ""} · 在线 ${(this.fleet?.peers.size ?? 0) + 1}`);
    }
  }

  private localDesignPose(): CityPose | undefined {
    const physics = this.stage?.runtime?.local?.physics;
    if (!physics) return undefined;
    const p = physics.body.position;
    const design = worldToDesign(p.x, p.y, p.z);
    return { ...design, heading: designHeading(physics.body.forward) };
  }

  /** Puts the local kart at a design pose (ground-snapped) and tells the node. */
  teleportLocal(pose: CityPose): void {
    const runtime = this.stage?.runtime;
    if (!runtime) return;
    const { physics, track } = runtime.local;
    const world = designToWorld(pose.x, pose.y, pose.z);
    const hit = track.rayQuery({ x: world.x, y: world.y + 40, z: world.z }, { x: 0, y: -120, z: 0 }, false)?.point;
    const ground = hit ? hit.y : world.y;
    physics.reset(world.x, ground + 0.4, world.z, physicsHeading(pose.heading));
    runtime.local.coordinator?.synchronizePositionAnchor?.();
    track.resetRouteState(physics, physics.body.position);
    physics.state.trackProgress = track.getRouteState(physics).distance;
    void this.network?.respawn(pose).catch(() => undefined);
  }

  private checkReset(): void {
    const runtime = this.stage?.runtime;
    if (!runtime) return;
    const physics = runtime.local.physics;
    const fell = physics.body.position.y < -6;
    const requested = physics.consumeAutomaticResetRequest?.() ?? false;
    if (!fell && !requested) return;
    const design = this.localDesignPose();
    if (!design) return;
    const road = nearestRoadPoint(design.x, design.z);
    const heading = ((Math.atan2(road.tx, -road.tz) * 180) / Math.PI + 360) % 360;
    this.teleportLocal({ x: road.x, y: 0, z: road.z, heading });
    this.host.options.status("已复位到最近的道路。");
  }

  private onEvent(event: CityEvent): void {
    const now = performance.now();
    switch (event.type) {
      case "city-joined":
        this.fleet?.add(event.member);
        this.pushChat(`${event.member.name} 进入了卡丁城`);
        break;
      case "city-left":
        this.fleet?.remove(event.playerId);
        break;
      case "city-chat": {
        const mine = event.playerId === this.host.playerId;
        this.pushChat(`${event.name}: ${event.text}`, event.playerId, event.name);
        this.labels?.say(mine ? this.host.playerId : event.playerId, event.text, now);
        break;
      }
      case "city-state":
        this.fleet?.setState(event.id, event.state);
        break;
      case "city-respawn":
        this.fleet?.respawn(event.id, event.pose);
        break;
      case "city-clock":
        this.atmosphere?.setClock(event.clock);
        if (this.snapshot) this.snapshot = { ...this.snapshot, clock: event.clock };
        break;
      case "city-kicked":
        this.host.options.status(`已离开卡丁城：${event.reason}`, true);
        void this.cleanup();
        break;
      default:
        break;
    }
  }

  private pushChat(text: string, playerId = "system", name = "系统"): void {
    const message = { sequence: ++this.chatSequence, playerId, name, text };
    for (const listener of this.chatListeners) {
      try { listener(message); } catch (error) { console.warn("聊天显示失败", error); }
    }
  }

  async leave(): Promise<void> {
    try { await this.network?.leave(); } catch { /* already gone */ }
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.labels?.dispose();
    this.atmosphere?.dispose();
    const stage = this.stage;
    this.stage = undefined;
    try { stage?.dispose(); } catch (error) { console.warn("城市会话释放失败", error); }
    this.fleet?.dispose();
    this.network?.dispose();
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
    console.error("进入卡丁城失败", error);
    host.options.status(`进入卡丁城失败：${error instanceof Error ? error.message : String(error)}`, true);
    await session.cleanup();
  }
}

export function activeCitySession(): CitySession | undefined {
  return current && !current.disposed ? current : undefined;
}

export { skyStateAt };
