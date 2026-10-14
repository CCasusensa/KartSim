import assert from "node:assert/strict";
import { test } from "node:test";
import { groundHeightAt, type CityGroundTrack } from "./city-ground";

/** Flat faces stacked over one point: height and which way the face looks (1 up, -1 down). */
function column(...faces: Array<[number, 1 | -1]>): CityGroundTrack {
  const sorted = [...faces].sort((a, b) => b[0] - a[0]);
  return {
    rayQuery(origin, movement) {
      const face = sorted.find(([y]) => y <= origin.y && y >= origin.y + movement.y);
      return face && { point: { y: face[0] }, normal: { y: face[1] * 0.99 } };
    },
  };
}

test("a pavement wins over an older floor hidden under it (卡丁城 果果)", () => {
  assert.equal(groundHeightAt(column([11.91, 1], [11.16, 1]), 0, 0, 11.79), 11.91);
});

test("a downward-wound floor at the hint is stood on (跳跳); one away from it is not", () => {
  assert.equal(groundHeightAt(column([10.62, -1], [7.3, 1]), 0, 0, 10.63), 10.62);
  assert.equal(groundHeightAt(column([17.69, 1], [16.77, 1], [15.05, -1], [14.67, -1], [10.01, 1]), 0, 0, 15.56), 16.77);
});

test("a tunnel floor stays under its roof and a bridge deck over the road below", () => {
  const bridge = column([20, 1], [19, -1], [10, 1]);
  assert.equal(groundHeightAt(bridge, 0, 0, 10), 10);
  assert.equal(groundHeightAt(bridge, 0, 0, 20), 20);
  // A hint far off still finds the nearest floor above it, else the highest below.
  assert.equal(groundHeightAt(bridge, 0, 0, 14), 20);
  assert.equal(groundHeightAt(bridge, 0, 0, 40), 20);
});
