/**
 * 赛道对决 NPC ghosts (TIMEATTACK.md): the release delivered a recorded .ksv
 * per duel stage, which the resource mirror lacks, so the NPC drives the
 * track's course line at a steady pace and finishes in the stage's target
 * time. The record it produces is the ghost store's stamp format
 * (game/ghost/frame-codec.ts), so the race plays it like any ghost.
 */
import { bodyBasisMatrix, quaternionFromMatrix } from "../driving/orientation-math";
import type { GhostFrame, GhostFrameRecord } from "../game/ghost/frame-codec";

interface Vec3 { x: number; y: number; z: number }
interface RouteFrame { position: Vec3; forward: Vec3; up: Vec3 }
interface RouteSection { frames: RouteFrame[]; length: number; outgoing: Array<{ section: number }> }

/** The course graph of a loaded track (resources/track-course-graph.ts TrackCourseGraph). */
export interface NpcCourse {
  sections: RouteSection[];
  firstSection: number;
  lastSection: number;
}

/** What the race builder needs to make the NPC (story-race.ts StoryRaceRequest.npc). */
export interface NpcGhostSpec {
  /** The NPC's time from GO to the line; its playback is sampled at 10 Hz. */
  targetMs: number;
  /** 难度设定: the NPC sets off this much later (its playback runs behind the clock). */
  advantageMs: number;
  equipment: Record<string, unknown> & { startSlot: number; playerName?: string };
}

const f32 = Math.fround;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const normalize = (v: Vec3): Vec3 => {
  const n = length(v);
  return n > 0 ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 0, y: 0, z: -1 };
};
const cross = (a: Vec3, b: Vec3): Vec3 =>
  ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** The course line from the first section to the last, laps times, as world points with headings. */
export function courseLine(course: NpcCourse, laps: number): RouteFrame[] {
  const line: RouteFrame[] = [];
  for (let lap = 0; lap < Math.max(1, laps); lap++) {
    let index = course.firstSection;
    const visited = new Set<number>();
    for (;;) {
      const section = course.sections[index];
      if (!section || visited.has(index)) break;
      visited.add(index);
      for (const frame of section.frames) line.push(frame);
      if (index === course.lastSection) break;
      const next = section.outgoing[0]?.section;
      if (next === undefined) break;
      index = next;
    }
  }
  return line;
}

/** Quantize one pose into the stored stamp (the release's xD). */
export function quantizeStamp(pose: { timeMs: number; x: number; y: number; z: number; w: number; qx: number;
  qy: number; qz: number; status: number }, zCeiling: number): GhostFrame {
  const clamp = (value: number, low: number, high: number) => {
    const v = f32(value);
    return v > high ? f32(high) : v < low ? f32(low) : v;
  };
  const trunc = (value: number) => Math.trunc(f32(value));
  return {
    time: Math.trunc((pose.timeMs >>> 0) / 100),
    x: trunc(clamp(pose.x, -3000, 3000) * 10),
    y: trunc(clamp(pose.y, -3000, 3000) * 10),
    z: trunc(f32(clamp(pose.z, -10, zCeiling) - 590) * 50),
    w: trunc(f32(pose.w) * 1e4),
    qx: trunc(f32(pose.qx) * 1e4),
    qy: trunc(f32(pose.qy) * 1e4),
    qz: trunc(f32(pose.qz) * 1e4),
    status: pose.status & 0xffff,
  };
}

/**
 * The NPC's record: a pose every 100 ms along the course line, reaching
 * the end at targetMs (plus a short hold at the line so the ghost does not
 * vanish on the last stamp). Stamp 0 is the sentinel the recorder writes.
 */
export function generateNpcGhostRecord(course: NpcCourse, laps: number, targetMs: number,
  zCeiling: number): GhostFrameRecord {
  const line = courseLine(course, laps);
  if (line.length < 2) throw new Error("赛道路线不足以生成对手行驶记录。");
  const cumulative: number[] = [0];
  for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1]! + length(sub(line[i]!.position, line[i - 1]!.position)));
  const total = cumulative[cumulative.length - 1]!;
  const duration = Math.max(10_000, Math.min(600_000, Math.round(targetMs)));
  const stamps: GhostFrame[] = [];
  const poseAt = (distance: number) => {
    const d = Math.max(0, Math.min(total, distance));
    let lower = 0, upper = cumulative.length - 1;
    while (lower < upper) {
      const middle = (lower + upper + 1) >>> 1;
      if (cumulative[middle]! <= d) lower = middle; else upper = middle - 1;
    }
    const next = Math.min(line.length - 1, lower + 1);
    const span = cumulative[next]! - cumulative[lower]!;
    const t = span > 0 ? (d - cumulative[lower]!) / span : 0;
    const a = line[lower]!, b = line[next]!;
    const position = lerp(a.position, b.position, t);
    const forward = normalize(span > 0 ? sub(b.position, a.position) : a.forward);
    const up = normalize(lerp(a.up, b.up, t));
    const right = normalize(cross(forward, up));
    const quaternion = quaternionFromMatrix(bodyBasisMatrix({ right, forward, up }));
    return { position, quaternion };
  };
  let index = 0;
  const push = (timeMs: number, distance: number, status: number) => {
    const { position, quaternion } = poseAt(distance);
    // Wire space: x, y = -z (world), z = y (world), as the recorder stores it.
    stamps.push(quantizeStamp({ timeMs, x: position.x, y: -position.z, z: position.y, w: quaternion.w,
      qx: quaternion.x, qy: quaternion.y, qz: quaternion.z, status }, zCeiling));
    index++;
  };
  push(0, 0, 0); // the sentinel at the grid
  for (let timeMs = 0; timeMs <= duration; timeMs += 100) push(timeMs, total * (timeMs / duration), 0);
  for (let hold = 100; hold <= 3000; hold += 100) push(duration + hold, total, 0);
  return { stamps };
}
