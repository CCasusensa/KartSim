/**
 * 50人乱斗 (server-go/BRAWL.md): in a release room every remote kart's
 * slipstream is followed against every other kart each frame (it only
 * decides how that kart's draft looks), which for 49 karts is 49 × 49 checks
 * per frame. With more karts than a release room holds, only the karts near
 * the local one are followed, each against the karts near it, and a third
 * of them is updated per frame.
 */

import type { RacePoint, SlipstreamPeer } from "./race-driving-scales";

/** Meters from the local kart within which another kart's draft is followed. */
export const SLIPSTREAM_RANGE = 60;
/** Frames over which the followed karts take turns. */
export const SLIPSTREAM_TURNS = 3;

const squaredDistance = (a: RacePoint, b: RacePoint): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/** The karts within SLIPSTREAM_RANGE of a point. */
export function nearbySlipstreamPeers<T extends SlipstreamPeer>(peers: readonly T[],
  center: RacePoint): T[] {
  const range = SLIPSTREAM_RANGE * SLIPSTREAM_RANGE;
  return peers.filter(peer => squaredDistance(peer.position, center) <= range);
}

/** The other karts a kart can draft behind: those within SLIPSTREAM_RANGE of it. */
export function slipstreamCandidates<T extends SlipstreamPeer>(peers: readonly T[],
  peer: SlipstreamPeer): T[] {
  const range = SLIPSTREAM_RANGE * SLIPSTREAM_RANGE;
  return peers.filter(other => other.playerId !== peer.playerId &&
    squaredDistance(other.position, peer.position) <= range);
}
