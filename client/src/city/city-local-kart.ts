/**
 * 卡丁城 garage changes for the local kart. The race loader's per-racer
 * function (loadRosterEntry) loads the new kart, rider and accessories; they
 * then take the old ones' place in the running race scene. The physics
 * object stays (the race coordinator, sender and camera hold it) and is
 * re-initialized with the new kart's tuning, as AL's constructor does.
 */
import { initializeVehicle, type VehicleCollisionDimensions } from "../driving/construct-vehicle";
import { racePresenterInitializationDependencies } from "../generated/world.js";
import { mountRacer } from "./city-racer-mount";
import { applyCityVehicleScale } from "./city-vehicle-scale";

/** The parts of the race session (stage) a kart change touches. */
export interface CityKartStage {
  runtime: { assets: any; local: { physics: any } };
  scene: any;
  host: { audio?(): unknown };
}

/**
 * Loads `equipment` for the local racer. Nothing in the scene changes yet:
 * the participant is taken back out of the race's list until it is
 * installed (or disposed when the change is refused).
 */
export async function loadLocalKart(stage: CityKartStage, playerId: string, name: string,
  equipment: unknown): Promise<any> {
  const assets = stage.runtime.assets;
  if (typeof assets.loadRosterEntry !== "function")
    throw new Error("多人资源装配缺少 loadRosterEntry（请重新生成模块）。");
  const participant = await assets.loadRosterEntry({ playerId, name, slot: 0, team: null },
    { equipment: structuredClone(equipment), initial: "", favoriteTracks: [], favoriteItems: [] });
  const list = assets.participants as any[];
  const index = list.lastIndexOf(participant);
  if (index >= 0) list.splice(index, 1);
  return participant;
}

/** Releases a loaded kart that will not be installed. */
export function discardLocalKart(participant: any): void {
  try { participant?.dispose?.(); } catch (error) { console.warn("未使用的赛车释放失败", error); }
}

/**
 * Re-runs AL's constructor body on the live vehicle with another kart's
 * tuning and collision shape. The pose, motion and drift state start over
 * (the caller puts the kart back where it was); the clock and the mode
 * owners stay. Flying pet listeners go with the old pet.
 */
export function retuneCityVehicle(physics: any, vehicle: {
  physicsParams: Record<string, unknown>; collisionShape: VehicleCollisionDimensions;
}): void {
  physics.flyingPetListeners?.clear?.();
  initializeVehicle(physics, vehicle.physicsParams, vehicle.collisionShape,
    physics.teamBooster, physics.teamBoosterDirect, physics.externalTeamGauge,
    physics.speedRaceMode, physics.lteMotion, physics.giant, physics.checkClientFramerate,
    // The mode was validated when the race was built.
    () => {});
  applyCityVehicleScale(physics);
  physics.setRaceMotionLocked(false);
}

/**
 * Puts a loaded kart in place of the local racer's current one and releases
 * the old kart. The racer view keeps its root (the camera and the track's
 * event effects hang on it); only its model changes.
 */
export function installLocalKart(stage: CityKartStage, playerId: string, next: any): void {
  const deps = racePresenterInitializationDependencies as any;
  const presenter = stage.scene;
  const list = stage.runtime.assets.participants as any[];
  const index = list.findIndex(participant => participant.playerId === playerId);
  const view = presenter.views.get(playerId);
  if (index < 0 || !view) throw new Error("城市场景缺少本机赛车。");
  const old = list[index];
  list[index] = next;

  // The kart's own effects (trails, sparks, shadow...) live in the scene.
  for (const part of deps.vehicleParts(old.vehicle)) part?.removeFromParent?.();
  presenter.scene.add(...deps.vehicleParts(next.vehicle));
  view.clearImportedModel(false);
  view.setModel(next.vehicle.imported.object, next.vehicle.visual, next.vehicle.imported.animation,
    next.vehicle.imported.model, next.vehicle.imported.scene);
  mountRacer(presenter, playerId, next, view);

  presenter.tachometer = next.vehicle.tachometerRenderer;
  presenter.tachometer?.enableUiSmoothing?.();
  presenter.gaugePreserve?.configure?.(next.vehicle.tachometerSelection?.folder);
  presenter.flyingPet?.dispose?.();
  presenter.flyingPet = undefined;

  retuneCityVehicle(stage.runtime.local.physics, next.vehicle);
  if (presenter.audioStarted) next.vehicle.audio?.start?.();
  discardLocalKart(old);
}

/** Loads the new kart's flying pet (the old one went with the old kart). */
export async function loadLocalFlyingPet(stage: CityKartStage, library: unknown): Promise<void> {
  const presenter = stage.scene;
  if (presenter.disposed || typeof presenter.prepareFlyingPet !== "function") return;
  await presenter.prepareFlyingPet(library, stage.host.audio?.());
}
