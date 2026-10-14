import { drivenPose, motionOffset, type KartPoseVectors } from "../item/item-kart-motion";
import type { HazardTrapPhysics, HazardTraps } from "../item/hazard-traps";
import type { ItemPairWorld } from "../item/item-cubes";

/**
 * Time attack's water-mine traps (item/hazard-traps.ts): the carriers' water
 * mines catch the kart. The race session owns them like its other per-race
 * owners (race-publication.ts); a restart pairs them with the new coordinator.
 */

/** TimeAttack lifecycle `Racing` (Ne.Racing). */
const RACING_PHASE = 2;
/** The one local racer's id on the trap presenter. */
const LOCAL_RACER = "local";

export function hazardTrapsOf(session: unknown): HazardTraps | undefined {
  return (session as { hazardTraps?: HazardTraps } | undefined)?.hazardTraps;
}

interface TrapRaceHost {
  session: {
    hazardTraps?: HazardTraps;
    coordinator?: unknown;
    lifecycle: { phase: number };
    speedResetState?: { phase?: number };
  };
  warpNext?: { blocksDriving?(): boolean };
  getPhysics(): unknown;
}

/** A new start: a fresh hazard field on the new coordinator, no bubble left over. */
export function attachRaceHazardTraps(host: TrapRaceHost): void {
  const traps = hazardTrapsOf(host.session);
  if (!traps || !host.session.coordinator) return;
  traps.attach(host.session.coordinator as ItemPairWorld, {
    physics: host.getPhysics() as HazardTrapPhysics,
    playerId: LOCAL_RACER,
    canTrigger: () => host.session.lifecycle.phase === RACING_PHASE &&
      (host.session.speedResetState?.phase ?? 0) === 0 && host.warpNext?.blocksDriving?.() !== true,
  });
}

/** After the track render update: the mines' positions, the bubble and its sounds. */
export function presentRaceHazardTraps(traps: HazardTraps, nowMs: number, camera: unknown,
  width: number, height: number, body: KartPoseVectors): void {
  traps.present(nowMs, camera, width, height, body);
}

/**
 * The kart state drawn lifted into its bubble (the item race's firedkart
 * motion; the body itself stays), or undefined while it is not lifted.
 */
export function trapDrawnState<T extends { body: KartPoseVectors; state: object }>(traps: HazardTraps,
  physics: T, nowMs: number): T["state"] | undefined {
  const motion = traps.kartMotion(nowMs);
  if (!motion) return undefined;
  const drawn = drivenPose(physics.body, motion);
  return { ...physics.state, x: drawn.position.x, y: drawn.position.y, z: drawn.position.z,
    right: drawn.right, forward: drawn.forward, up: drawn.up };
}

/** How far the camera follows that lift (never its flips). */
export function trapCameraLift(session: unknown, body: KartPoseVectors,
  nowMs: number): { x: number; y: number; z: number } | undefined {
  const motion = hazardTrapsOf(session)?.kartMotion(nowMs);
  return motion ? motionOffset(body, motion) : undefined;
}
