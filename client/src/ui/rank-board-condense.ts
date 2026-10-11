/**
 * 50人乱斗 (server-go/BRAWL.md): the release rank board stacks one row per
 * racer, which for 50 racers runs off the screen. A board of more than
 * eight rows shows the first seven in its current order and the local
 * racer's row (or the first eight when the local racer is among them),
 * restacked from the top.
 */

/** Rows the rank board shows at most. */
export const RANK_BOARD_ROWS = 8;

export interface StackedRankRow {
  rank?: number;
  local?: boolean;
  y: number;
}

/**
 * The rows to draw of a laid-out board, in their current rank order (the
 * release reorders its rows every 500 ms, which with dozens of racers close
 * together shows the leaders out of order), restacked with each row's
 * height plus 2, as the release stacks them.
 */
export function condenseRankRows<T extends StackedRankRow>(rows: readonly T[],
  rowHeight: (row: T) => number, visible = RANK_BOARD_ROWS): T[] {
  if (rows.length <= visible) return [...rows];
  const ordered = [...rows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.y - b.y);
  const local = ordered.findIndex(row => row.local);
  const shown = local < 0 || local < visible ? ordered.slice(0, visible)
    : [...ordered.slice(0, visible - 1), ordered[local]!];
  let y = 0;
  return shown.map(row => {
    const placed = { ...row, y };
    y += Math.trunc(Math.fround(Math.fround(rowHeight(row)) + 2));
    return placed;
  });
}
