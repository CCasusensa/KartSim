/**
 * 卡丁城 members' karts: a dynamic version of the race RemoteFleet. Members
 * arrive and leave while the session runs; each one's kart and character
 * are loaded with the race asset loader's per-racer function and attached
 * to the presenter like a race participant. Poses come from 0xC1 city frames
 * (the race kinematic payload) through the race motion predictor; far members
 * only have a radar position (minimap).
 */
import { MotionClockMapping, RemoteMotionPredictor,
  type RemoteMotionFrameOptions, type RemoteMotionSnapshot } from "../multiplayer/remote-motion";
import { isNewerSequence } from "../multiplayer/motion";
import { RemotePoseSmoother } from "../multiplayer/remote-pose-smoothing";
import type { RailMatrix } from "../driving/rail-frame";
import { VehicleMotionReceiver } from "../vehicle/remote-vehicle-motion";
import { racePresenterInitializationDependencies } from "../generated/world.js";
import type { CityMember, CityPose, CityRadarEntry } from "./city-protocol";
import { designToWorld } from "./city-coordinates";

type Vector = [number, number, number];

interface Peer {
  member: CityMember;
  playerId: string;
  slot: number;
  participant?: any;
  motion?: RemoteMotionPredictor;
  /** Not in the release: the drawn pose glides onto each new frame's prediction. */
  smoother: RemotePoseSmoother;
  presentation: VehicleMotionReceiver;
  sequence?: number;
  receivedAt?: number;
  visualScale?: { x: number; y: number; z: number };
  radar?: CityRadarEntry;
  removed: boolean;
  loading?: Promise<void>;
}

function webBasis(matrix: RailMatrix) {
  return {
    right: { x: matrix[0].x, y: matrix[2].x, z: Math.fround(-matrix[1].x) },
    forward: { x: Math.fround(-matrix[0].y), y: Math.fround(-matrix[2].y), z: matrix[1].y },
    up: { x: matrix[0].z, y: matrix[2].z, z: Math.fround(-matrix[1].z) },
  };
}

const identityBasis = () => ({
  right: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 },
});

/** Pose vectors for a design pose (heading 0 = north, clockwise). */
export function poseFromDesign(pose: CityPose) {
  const world = designToWorld(pose.x, pose.y, pose.z);
  const radians = (pose.heading * Math.PI) / 180;
  // North is −z in the world; east is +x.
  const forward = { x: Math.sin(radians), y: 0, z: -Math.cos(radians) };
  const right = { x: Math.cos(radians), y: 0, z: Math.sin(radians) };
  return { position: world, right, forward, up: { x: 0, y: 1, z: 0 } };
}

export interface CityFleetHost {
  assets: any;
  presenter: any;
  track: any;
  now(): number;
  onError(error: unknown): void;
  localPlayerId: string;
  /** At most this many members keep fully loaded karts (nearest first). */
  renderCapacity: number;
}

export class CityFleet {
  readonly peers = new Map<string, Peer>();
  readonly byId = new Map<number, Peer>();
  clock?: MotionClockMapping;
  disposed = false;

  constructor(readonly host: CityFleetHost) {}

  bindClock(mapping: { offsetMs: number }): void {
    this.clock = new MotionClockMapping(mapping);
  }

  /** Adds a member; its kart loads in the background. */
  add(member: CityMember): void {
    if (this.disposed || member.playerId === this.host.localPlayerId) return;
    if (this.peers.has(member.playerId)) { this.update_member(member); return; }
    const peer: Peer = {
      member, playerId: member.playerId, slot: member.id % 8,
      presentation: new VehicleMotionReceiver(), smoother: new RemotePoseSmoother(), removed: false,
    };
    this.peers.set(member.playerId, peer);
    this.byId.set(member.id, peer);
    peer.loading = this.load(peer).catch(error => {
      console.warn("卡丁城成员的赛车加载失败", member.name, error);
    });
  }

  private update_member(member: CityMember): void {
    const peer = this.peers.get(member.playerId);
    if (!peer) return;
    peer.member = member;
    this.byId.set(member.id, peer);
  }

  private async load(peer: Peer): Promise<void> {
    const { assets } = this.host;
    if (typeof assets.loadRosterEntry !== "function")
      throw new Error("多人资源装配缺少 loadRosterEntry（请重新生成模块）。");
    const equipment = peer.member.equipment;
    if (!equipment || typeof equipment !== "object") throw new Error("成员没有装备。");
    const entry = { equipment: structuredClone(equipment), initial: "", favoriteTracks: [], favoriteItems: [] };
    const roster = { playerId: peer.playerId, name: peer.member.name, slot: peer.slot, team: null };
    const participant = await assets.loadRosterEntry(roster, entry);
    if (this.disposed || peer.removed) { participant.dispose?.(); this.detachFromAssets(participant); return; }
    peer.participant = participant;
    const mass = Math.fround(participant.remoteParameters.mass);
    const diagonal = Math.fround(12 / mass);
    peer.motion = new RemoteMotionPredictor(mass, [
      { x: diagonal, y: 0, z: 0 }, { x: 0, y: diagonal, z: 0 }, { x: 0, y: 0, z: diagonal },
    ]);
    this.attachView(peer, participant);
  }

  private detachFromAssets(participant: any): void {
    const list = this.host.assets.participants as any[];
    const index = list.indexOf(participant);
    if (index >= 0) list.splice(index, 1);
  }

  /** Mirrors initializeRacePresenter's per-participant block for a remote kart. */
  private attachView(peer: Peer, participant: any): void {
    const deps = racePresenterInitializationDependencies as any;
    const presenter = this.host.presenter;
    const vehicle = participant.vehicle;
    const view = deps.createRacerView(presenter.scene);
    presenter.views.set(peer.playerId, view);
    presenter.scene.add(vehicle.trails.object);
    view.setModel(vehicle.imported.object, vehicle.visual, vehicle.imported.animation,
      vehicle.imported.model, vehicle.imported.scene);
    const sourceRoot = deps.serializedRoot(vehicle.imported.model);
    const riderSource = sourceRoot.children[6]?.value;
    const riderMount = riderSource && "children" in (riderSource as object)
      ? vehicle.imported.renderScene?.bySource.get(riderSource) : undefined;
    const character = participant.characters.linked ?? participant.characters.ordinary;
    if (character && riderMount) {
      riderMount.clear();
      riderMount.add(character.scene.object);
      character.scene.object.scale.setScalar(vehicle.visual.onCharacterSize);
      if (participant.characters.linked) {
        const vehicleRoot = vehicle.imported.renderScene?.bySource.get(sourceRoot);
        if (vehicleRoot && character.award) {
          const linked = deps.createLinkedPresentation(vehicleRoot, riderMount,
            character.scene.object, vehicle.kartItem.alwaysLinkCharacter);
          linked.resetForRacePresentation();
          presenter.linkedPresentations.set(peer.playerId, linked);
        }
      }
    }
    if (character) {
      for (const accessory of vehicle.accessories) {
        const socketName = accessory.kind === "aura" ? undefined : deps.accessorySockets[accessory.kind];
        const socket = socketName
          ? character.scene.getDecorationSocket(socketName[0], socketName[1])
          : character.scene.getDecorationOwner();
        if (!socket) continue;
        socket.add(accessory.render.scene.object);
        if (accessory.kind === "aura" && riderMount) {
          const vehicleRoot = vehicle.imported.renderScene?.bySource.get(sourceRoot);
          if (vehicleRoot) deps.attachAura(socket, vehicleRoot, accessory.render.scene.object);
        }
      }
    }
    if (vehicle.decoration) view.getAttachment(16)?.add(vehicle.decoration.scene.object);
    const pose = poseFromDesign(peer.member.pose ?? { x: 0, y: 0, z: 0, heading: 0 });
    presenter.initialPoses.set(peer.playerId, pose);
    view.updatePose({ x: pose.position.x, y: pose.position.y, z: pose.position.z, ...pose,
      visualScale: { x: 1, y: 1, z: 1 } });
  }

  remove(playerId: string): void {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    peer.removed = true;
    this.peers.delete(playerId);
    this.byId.delete(peer.member.id);
    const presenter = this.host.presenter;
    const view = presenter.views.get(playerId);
    if (view) {
      presenter.views.delete(playerId);
      presenter.scene.remove(view.root);
    }
    presenter.linkedPresentations.delete(playerId);
    presenter.initialPoses.delete(playerId);
    if (peer.participant) {
      presenter.scene.remove(peer.participant.vehicle.trails.object);
      this.detachFromAssets(peer.participant);
      try { peer.participant.dispose?.(); } catch (error) { console.warn("成员赛车释放失败", error); }
    }
  }

  /** A 0xC1 frame payload decoded to the race kinematic sample. */
  receive(id: number, sequence: number, sample: RemoteMotionSnapshot & { tick: number }): void {
    const peer = this.byId.get(id);
    if (!peer || !this.clock || peer.removed) return;
    if (peer.sequence !== undefined && !isNewerSequence(sequence, peer.sequence)) return;
    peer.sequence = sequence;
    const now = Math.trunc(this.host.now());
    const tick = this.clock.decode(sample.tick, now);
    if (tick <= 0 || now <= 0) return;
    if (sample.kind === "kinematic" && sample.presentation) peer.presentation.receive(sample.presentation as any);
    if (sample.kind === "kinematic" && (sample as any).visualScale) peer.visualScale = { ...(sample as any).visualScale };
    if (!peer.motion) return;
    try {
      if (peer.motion.receive(sample, tick, now)) peer.receivedAt = now;
    } catch (error) { console.warn("城市运动帧无效", error); }
  }

  radar(entries: readonly CityRadarEntry[]): void {
    for (const entry of entries) {
      const peer = this.byId.get(entry.id);
      if (peer) peer.radar = entry;
    }
  }

  setState(id: number, state: CityMember["state"]): void {
    const peer = this.byId.get(id);
    if (peer) peer.member = { ...peer.member, state };
  }

  respawn(id: number, pose: CityPose): void {
    const peer = this.byId.get(id);
    if (!peer) return;
    peer.member = { ...peer.member, pose };
    peer.motion = peer.motion && peer.participant
      ? (() => { const mass = Math.fround(peer.participant.remoteParameters.mass); const d = Math.fround(12 / mass);
        return new RemoteMotionPredictor(mass, [{ x: d, y: 0, z: 0 }, { x: 0, y: d, z: 0 }, { x: 0, y: 0, z: d }]); })()
      : peer.motion;
    peer.receivedAt = undefined;
    peer.smoother.reset();
    this.host.presenter.initialPoses.set(peer.playerId, poseFromDesign(pose));
  }

  // ---- the RemoteFleet surface the race frame and presenter use ----

  update(now: number, options: RemoteMotionFrameOptions): void {
    if (this.disposed) return;
    const tick = Math.trunc(now);
    for (const peer of this.peers.values()) {
      try {
        if (!peer.motion) { peer.smoother.reset(); continue; }
        const reanchored = peer.motion.previousTick === undefined && peer.motion.snapshot !== undefined;
        peer.motion.update(tick, options);
        peer.smoother.observe(peer.motion.copyPose(), tick, reanchored, options.locked || options.bypass);
      } catch (error) {
        console.warn("城市成员预测失败", peer.member.name, error);
        peer.motion = undefined;
        peer.smoother.reset();
      }
    }
  }

  updateAndForEachFreshRacePeer(now: number, options: RemoteMotionFrameOptions,
    callback: (playerId: string, progress: undefined, pose: unknown, speedKmh: number) => void): void {
    this.update(now, options);
    for (const peer of this.peers.values()) {
      if (!peer.motion || peer.receivedAt === undefined || now - peer.receivedAt > 1000) continue;
      const velocity = peer.motion.copyPose()?.velocity;
      callback(peer.playerId, undefined, this.copyWebPose(peer.playerId),
        velocity ? Math.hypot(...velocity) * 3.6 : NaN);
    }
  }

  raceProgress(): undefined { return undefined; }
  updateRoom(): void {}
  updateGiantEffects(): void {}
  resetGiants(): void {}
  giant(): undefined { return undefined; }
  hasDeparted(): boolean { return false; }
  rankDisconnected(): boolean { return false; }
  forEachCollisionBody(): void { /* No kart-to-kart collisions in the city (no griefing). */ }

  consumePresentation(playerId: string): unknown {
    return this.peers.get(playerId)?.presentation.consume();
  }

  presentationVisible(playerId: string, now: number): boolean {
    const peer = this.peers.get(playerId);
    if (!peer || !peer.participant) return false;
    if (peer.receivedAt === undefined) return peer.member.state !== "afk" && !!peer.member.pose;
    return now - peer.receivedAt < 5000 || peer.member.state === "parked";
  }

  copyWebPose(playerId: string) {
    const peer = this.peers.get(playerId);
    if (!peer) return undefined;
    const raw = peer.motion?.copyPose();
    if (raw) {
      const pose = peer.smoother.displayed ?? raw;
      return {
        position: { x: pose.position[0], y: pose.position[2], z: Math.fround(-pose.position[1]) },
        ...webBasis(pose.rotation),
        visualScale: { ...(peer.visualScale ?? { x: 1, y: 1, z: 1 }) },
      };
    }
    if (peer.radar) {
      const world = designToWorld(peer.radar.x, peer.member.pose?.y ?? 0, peer.radar.z);
      return { position: world, ...identityBasis(), visualScale: { x: 1, y: 1, z: 1 } };
    }
    return undefined;
  }

  /** World position of a member's kart for labels (undefined when unknown). */
  worldPosition(playerId: string): { x: number; y: number; z: number } | undefined {
    return this.copyWebPose(playerId)?.position;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const playerId of [...this.peers.keys()]) this.remove(playerId);
  }
}
