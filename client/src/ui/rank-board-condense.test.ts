import assert from "node:assert/strict";
import { test } from "node:test";
import { condenseRankRows } from "./rank-board-condense";

const rows = (count: number, local: number) => Array.from({ length: count }, (_, index) =>
  ({ id: index, y: index * 30, local: index === local }));
const height = () => 28;

test("eight rows or fewer are drawn as laid out", () => {
  const board = rows(8, 5);
  assert.deepEqual(condenseRankRows(board, height), board);
});

test("a long board shows the first eight while the local racer is among them", () => {
  const shown = condenseRankRows(rows(50, 3), height);
  assert.deepEqual(shown.map(row => row.id), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(shown.map(row => row.y), [0, 30, 60, 90, 120, 150, 180, 210]);
});

test("a long board shows the first seven and the local racer further back", () => {
  const board = rows(50, 23).reverse(); // in slot order, not rank order
  const shown = condenseRankRows(board, height);
  assert.deepEqual(shown.map(row => row.id), [0, 1, 2, 3, 4, 5, 6, 23]);
  assert.equal(shown.at(-1)!.y, 210);
});

test("a long board follows the current ranks, not the last layout", () => {
  const board = rows(50, 30).map((row, index) => ({ ...row, rank: index === 0 ? 2 : index === 1 ? 1 : index + 1 }));
  const shown = condenseRankRows(board, height);
  assert.deepEqual(shown.map(row => row.id), [1, 0, 2, 3, 4, 5, 6, 30]);
  assert.deepEqual(shown.map(row => row.y), [0, 30, 60, 90, 120, 150, 180, 210]);
});
