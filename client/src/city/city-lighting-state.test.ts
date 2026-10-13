import assert from "node:assert/strict";
import test from "node:test";
import { skyStateAt, type SkyState } from "./city-clock";
import type { CityClock, CityWeather } from "./city-protocol";

const clock = (timeOfDay: number, weather: CityWeather = "clear"): CityClock => ({
  serverTick: 0, timeOfDay, dayLengthMs: 86_400_000, weather, weatherUntilTick: 100_000,
});
const at = (timeOfDay: number, weather: CityWeather = "clear") => skyStateAt(clock(timeOfDay, weather), 0);
const close = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
const colorKeys = ["skyColor", "fogColor", "lightTint", "horizonColor"] as const;

test("clear 08:50 uses a turquoise sky, cream horizon and warm golden light", () => {
  const state = at((8 + 50 / 60) / 24);
  for (const [key, expected] of [
    ["skyColor", [.5, .83, .76]], ["fogColor", [.77, .74, .55]],
    ["horizonColor", [.94, .91, .66]], ["lightTint", [1.13, .98, .68]],
  ] as const) state[key].forEach((channel, index) => close(channel, expected[index]!));
  close(state.sunStrength, .22);
  assert.equal(state.lightFactor, 1);
  assert.equal(state.fogNear, 120);
  assert.equal(state.fogFar, 1100);
  const noon = at(.5), afternoon = at(.64), night = at(0);
  assert.ok(afternoon.lightTint[0] / afternoon.lightTint[2] > noon.lightTint[0] / noon.lightTint[2]);
  assert.ok(night.lightTint[2] > night.lightTint[0]);
  assert.equal(night.lightFactor, .42);
  assert.equal(night.sunStrength, 0);
  assert.equal(night.fogNear, 80);
  assert.equal(night.fogFar, 850);
});

test("rain weakens direct light and shortens visibility, then fades back to the clear palette", () => {
  const clear = at(.5), rain = at(.5, "rain");
  assert.equal(rain.precipitation, 1);
  assert.equal(rain.fogNear, 70);
  assert.equal(rain.fogFar, 700);
  assert.ok(rain.sunStrength < clear.sunStrength * .3);
  assert.ok(rain.lightFactor < clear.lightFactor);
  assert.ok(rain.lightTint[0] / rain.lightTint[2] < clear.lightTint[0] / clear.lightTint[2]);
  const ending = { ...clock(.5, "rain"), weatherUntilTick: 8000 };
  const half = skyStateAt(ending, 4000), ended = skyStateAt(ending, 8000);
  const dry = skyStateAt({ ...ending, weather: "clear" }, 8000);
  assert.equal(half.precipitation, .5);
  assert.equal(half.fogFar, 900);
  assert.ok(half.sunStrength > rain.sunStrength && half.sunStrength < clear.sunStrength);
  for (const key of colorKeys) assert.deepEqual(ended[key], dry[key]);
  for (const key of ["sunStrength", "fogNear", "fogFar", "lightFactor"] as const)
    assert.equal(ended[key], dry[key]);
});

test("sun direction is unit length and lighting stays continuous across the full day", () => {
  for (const weather of ["clear", "rain", "snow"] as const) {
    let previous: SkyState | undefined;
    for (let minute = 0; minute <= 1440; minute++) {
      const state = at(minute / 1440, weather);
      close(Math.hypot(...state.sunDirection), 1);
      assert.ok(state.lightFactor >= .42 && state.lightFactor <= 1);
      assert.ok(state.sunStrength >= 0 && state.sunStrength <= .22);
      if (state.sunDirection[1] <= 0) close(state.sunStrength, 0);
      assert.ok(state.fogNear > 0 && state.fogFar > state.fogNear);
      for (const key of colorKeys) {
        assert.ok(state[key].every(Number.isFinite));
        if (previous) state[key].forEach((channel, index) =>
          assert.ok(Math.abs(channel - previous![key][index]!) < .02, `${weather}: ${key} at ${minute}`));
      }
      if (previous) {
        state.sunDirection.forEach((axis, index) =>
          assert.ok(Math.abs(axis - previous!.sunDirection[index]!) < .005));
        assert.ok(Math.abs(state.sunStrength - previous.sunStrength) < .01);
        assert.ok(Math.abs(state.fogFar - previous.fogFar) < 5);
      }
      previous = state;
    }
    const before = at(1 - 1e-7, weather), after = at(1e-7, weather);
    for (const key of [...colorKeys, "sunDirection"] as const)
      before[key].forEach((channel, index) => close(channel, after[key][index]!, 2e-6));
  }
  close(at(.5).sunDirection[1], 1);
  close(at(0).sunDirection[1], -1);
  assert.ok(at(.25).sunDirection[0] > 0 && at(.75).sunDirection[0] < 0);
});
