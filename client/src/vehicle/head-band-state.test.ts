import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { headBandModelForBoosterState } from "./head-band-state";

const release = readFileSync(new URL("../../../recovered/formatted/index.js", import.meta.url), "utf8");

function releaseFunction<T>(name: string): T {
  const start = release.indexOf(`function ${name}(n) {`);
  assert.ok(start >= 0, `${name} 不在发行版中。`);
  const end = release.indexOf("\n}\n", start);
  return new Function(`${release.slice(start, end + 2)}; return ${name};`)() as T;
}

const releaseHeadBandModel = releaseFunction<(code: number) => number | undefined>("ae0");
const ksvBoosterCode = releaseFunction<(state: number) => number>("Gh0");

const START_BOOSTER = 1;
const DRIFT_INSTANT_BOOST = 2;
const NITRO = 3;
const TEAM_NITRO = 4;
const DUAL_BOOSTER = 10;
const LIGHTNING_MODEL = 2;

test("头饰闪电只在氮气时出现，起步加速和单喷不出现", () => {
  assert.notEqual(headBandModelForBoosterState(START_BOOSTER), LIGHTNING_MODEL);
  assert.notEqual(headBandModelForBoosterState(DRIFT_INSTANT_BOOST), LIGHTNING_MODEL);
  for (const state of [NITRO, TEAM_NITRO, DUAL_BOOSTER])
    assert.equal(headBandModelForBoosterState(state), LIGHTNING_MODEL, `state ${state}`);
  assert.equal(headBandModelForBoosterState(0), 1);
  assert.equal(headBandModelForBoosterState(DRIFT_INSTANT_BOOST), 3);
  assert.equal(headBandModelForBoosterState(START_BOOSTER), undefined);
});

test("发行版头饰表按原版加速码查，本地状态先经 KSV 加速码转换", () => {
  for (let state = 0; state <= 40; state += 1) {
    if (state === DUAL_BOOSTER) continue;
    assert.equal(headBandModelForBoosterState(state),
      releaseHeadBandModel(ksvBoosterCode(state)), `state ${state}`);
  }
  // The release fed the native state straight in: lightning on start and 单喷, none on nitro.
  assert.equal(releaseHeadBandModel(START_BOOSTER), LIGHTNING_MODEL);
  assert.equal(releaseHeadBandModel(DRIFT_INSTANT_BOOST), LIGHTNING_MODEL);
  assert.equal(releaseHeadBandModel(NITRO), 3);
});
