export interface StartPoint { x: number; y: number; z: number }
export interface RaceStarter { playerId: string }
export interface RaceStartGrid {
  roster: RaceStarter[];
  startSlots?: Record<string, number>;
}

/** Start places of a 50人乱斗 race (server-go/BRAWL.md); the release grid has 8. */
export const RACE_START_SLOTS = 50;
/** Racers per grid row: the release's single row of paired columns. */
const ROW_SLOTS = 8;
/** Meters between grid rows behind the release row. */
const ROW_SPACING = 5;

/**
 * A room must assign one unique grid slot to each racer: zero through seven
 * (the release), or below `slots` for a 50人乱斗 race.
 */
export function validateRaceStartGrid(grid: RaceStartGrid, slotCount = ROW_SLOTS): void {
  const slots = grid.startSlots;
  if (!slots || Object.keys(slots).length !== grid.roster.length)
    throw new Error("本局缺少完整起跑位表。");
  const used = new Set<number>();
  for (const racer of grid.roster) {
    const slot = slots[racer.playerId];
    if (!Object.hasOwn(slots, racer.playerId) || !Number.isInteger(slot) ||
        slot! < 0 || slot! >= slotCount || used.has(slot!))
      throw new Error("本局起跑位重复或越界。");
    used.add(slot!);
  }
}

/**
 * Places racers in paired columns, then optionally snaps them to the road.
 * Slots 0–7 form the release's single row; with the start heading
 * `forward` (a 50人乱斗 race) slots 8–49 repeat that row 5 m further back
 * each eight slots.
 */
export function raceStartPosition(
  origin: StartPoint,
  right: StartPoint,
  slot: number,
  groundAt: (origin: StartPoint, direction: StartPoint) => StartPoint | undefined,
  forward?: StartPoint,
): StartPoint {
  const slotLimit = forward ? RACE_START_SLOTS - 1 : ROW_SLOTS - 1;
  if (!Number.isInteger(slot) || slot < 0 || slot > slotLimit)
    throw new Error(forward ? "多人起跑位必须是0至49。" : "多人起跑位必须是0至7。");
  const f32 = Math.fround;
  const column = slot % ROW_SLOTS;
  const side = f32(f32(column & 1 ? -((column >>> 1) + 1) : column >>> 1) * f32(2));
  const back = f32(Math.floor(slot / ROW_SLOTS) * ROW_SPACING);
  const position = {
    x: f32(f32(origin.x + f32(right.x * side)) - f32((forward?.x ?? 0) * back)),
    y: f32(f32(origin.y + f32(right.y * side)) - f32((forward?.y ?? 0) * back)),
    z: f32(f32(origin.z + f32(right.z * side)) - f32((forward?.z ?? 0) * back)),
  };
  const road = groundAt({ x: position.x, y: f32(position.y + 10), z: position.z },
    { x: 0, y: -100, z: 0 });
  return road ? { ...road } : position;
}
