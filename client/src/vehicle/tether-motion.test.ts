import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Matrix4, Quaternion, Vector3 } from "three";
import { TetherMotion, setTetherUnit, tetherFrameFromMatrix, type TetherParameters } from "./tether-motion";

const release = readFileSync(new URL("../../../recovered/formatted/index.js", import.meta.url), "utf8");
function sourceBetween(start: string, end: string): string {
  const startAt = release.indexOf(start);
  const endAt = release.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0 && endAt > startAt, `${start} to ${end}`);
  return release.slice(startAt, endAt);
}
const classSource = sourceBetween("class H10 {", "function fi(");
const helperSource = sourceBetween("function fi(", "const q10 =");
const Original = new Function("W10", "U10", "$10", "kh",
  `${helperSource}\n${classSource}\nreturn H10;`,
)(Math.fround(0.001), 0.05, 0.01, 1) as new (parameters: TetherParameters) => TetherMotion;

const parameters: TetherParameters = {
  pos: [0.2, -0.3, 1.4],
  wireLengthLimit: 1.8,
  floatingForce: 2.3,
  viscousDrag: 0.27,
};
// A rigid frame: the release's transposed mapping back is exact only there.
const transform = [
  0.6, 0.8, 0, 12,
  -0.8, 0.6, 0, 3,
  0, 0, 1, -4,
];

function compare(
  label: string,
  action: (motion: TetherMotion) => unknown,
  config: TetherParameters = parameters,
): void {
  const expected = new Original(config), actual = new TetherMotion(config);
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${label}: field order`);
  assert.deepEqual({ ...actual }, { ...expected }, `${label}: initial state`);
  const released = action(expected), rewritten = action(actual);
  assert.deepEqual(rewritten, released, `${label}: result`);
  assert.deepEqual({ ...actual }, { ...expected }, `${label}: state`);
}

test("tether initializes, advances and resets exactly like release", () => {
  compare("first timestamp returns input reference", motion => {
    const input = [0.4, 0.5, -0.8];
    return motion.update(transform, input, 1000) === input;
  });
  compare("several 16ms frames", motion => {
    motion.update(transform, [0.4, 0.5, -0.8], 1000);
    motion.update(transform, [0.4, 0.5, -0.8], 1016);
    return motion.update(transform, [0.4, 0.5, -0.8], 1032) === motion.output;
  });
  compare("long frame clamped to 50ms", motion => {
    motion.update(transform, [0.4, 0.5, -0.8], 1000);
    return motion.update(transform, [0.4, 0.5, -0.8], 1500);
  });
  compare("time reversal returns input", motion => {
    motion.update(transform, [0.4, 0.5, -0.8], 1000);
    const input = [9, 8, 7];
    return motion.update(transform, input, 999) === input;
  });
  compare("reset returns initial local reference", motion => {
    motion.update(transform, [0.4, 0.5, -0.8], 1000);
    motion.update(transform, [0.4, 0.5, -0.8], 1016);
    return motion.reset() === motion.initialLocal;
  });
});

test("hitch median and stretch force branches match release", () => {
  compare("30-frame median rejects outlier", motion => {
    for (let index = 0; index < 35; index += 1) motion.filterHitch(0.016);
    return motion.filterHitch(0.4);
  });
  compare("inside rest length", motion => {
    motion.world = [0.5, 0, 0];
    motion.substep([0, 0, 0], 0.01);
  });
  compare("wire stretched beyond diameter", motion => {
    motion.world = [8, 2, -4];
    motion.velocity = [1, -2, 0.5];
    motion.substep([0, 0, 0], 0.01);
  });
  compare("zero separation", motion => {
    motion.world = [0, 0, 0];
    motion.substep([0, 0, 0], 0.01);
  });
  compare("direct integration transforms output to local space", motion => {
    motion.world = [13, 4, -5];
    return motion.integrate(transform, 0.035);
  });
});

const anchor = new Vector3(0, 0.7, 0);

function markerMatrix(scale: Vector3): Matrix4 {
  return new Matrix4().compose(new Vector3(12, 3, -4),
    new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 0.7), scale);
}

/** Settled rope, from the marker's hitch to the balloon in world space, as the decoration draws it. */
function settledRope(scale: Vector3): Vector3 {
  const marker = markerMatrix(scale);
  const motion = new TetherMotion({ pos: [anchor.x, anchor.y, 1], wireLengthLimit: 1.3, floatingForce: 80, viscousDrag: 3 });
  const frame = new Array(12).fill(0);
  let local = motion.reset().slice();
  for (let time = 1000; time < 21000; time += 16) {
    tetherFrameFromMatrix(marker, frame);
    local = motion.update(frame, local, time).slice();
  }
  return new Vector3(local[0], local[1], local[2]).applyMatrix4(marker)
    .sub(anchor.clone().applyMatrix4(marker));
}

test("a grown or shrunk kart carries its balloon on a rope of the same length", () => {
  const unit = settledRope(new Vector3(1, 1, 1));
  // Track scale events 60/180/320, giant stages and the press squash.
  for (const scale of [[0.6, 0.6, 0.6], [1.8, 1.8, 1.8], [3.2, 3.2, 3.2], [4.4, 4.4, 4.4], [1.2, 1.2, 0.2]]) {
    const rope = settledRope(new Vector3(...scale));
    assert.ok(rope.distanceTo(unit) < 1e-3, `${scale}: ${rope.toArray()} vs ${unit.toArray()}`);
  }
});

test("city karts keep their rope in proportion to the city size", () => {
  const unit = settledRope(new Vector3(1, 1, 1));
  setTetherUnit(0.5);
  try {
    for (const scale of [0.5, 1.6]) {
      const rope = settledRope(new Vector3(scale, scale, scale));
      assert.ok(rope.distanceTo(unit.clone().multiplyScalar(0.5)) < 1e-3, `${scale}x: ${rope.toArray()}`);
    }
  } finally {
    setTetherUnit(1);
  }
});

test("tether frame is the release copy in races and divides out the city size", () => {
  const scaled = markerMatrix(new Vector3(3.2, 1.2, 0.2));
  const t = scaled.elements;
  const release = [t[0], t[4], t[8], t[12], t[1], t[5], t[9], t[13], t[2], t[6], t[10], t[14]];
  const frame = new Array(12).fill(0);
  tetherFrameFromMatrix(scaled, frame);
  assert.deepEqual(frame, release);
  setTetherUnit(0.5);
  try {
    tetherFrameFromMatrix(scaled, frame);
    assert.deepEqual(frame, release.map(value => value / 0.5));
  } finally {
    setTetherUnit(1);
  }
  assert.throws(() => setTetherUnit(0));
});

test("a scaled frame maps the balloon back through its inverse", () => {
  const marker = markerMatrix(new Vector3(3.2, 1.2, 0.2));
  const frame = new Array(12).fill(0);
  tetherFrameFromMatrix(marker, frame);
  const motion = new TetherMotion(parameters);
  motion.world = [13, 4, -5];
  const local = motion.integrate(frame, 0);
  const drawn = new Vector3(local[0], local[1], local[2]).applyMatrix4(marker);
  assert.ok(drawn.distanceTo(new Vector3(13, 4, -5)) < 1e-4, drawn.toArray().join(","));
});
