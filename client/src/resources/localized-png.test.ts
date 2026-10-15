import assert from "node:assert/strict";
import test from "node:test";
import { localizedPngCandidates, localizedPngPath, resolveLocalizedPngPath } from "./localized-png";

const library = (...paths: string[]) => ({
  canonicalCandidates: (path: string) => paths.filter(candidate => candidate.toLowerCase() === path.toLowerCase()),
});

test("localized PNG selection prefers native locale art, then the independent pack", () => {
  const source = "stage_/scenarioReady/타임어택@zz.png";
  const native = "stage_/scenarioReady/타임어택@us.png";
  const packed = localizedPngPath(source, "en");
  assert.equal(packed, "locale_ui/en/stage_/scenarioReady/타임어택.png");
  assert.equal(resolveLocalizedPngPath(library(native, packed, source), source, "en"), native);
  assert.equal(resolveLocalizedPngPath(library(packed, source), source, "en"), packed);
  assert.equal(resolveLocalizedPngPath(library(source), source, "en"), source);
  assert.equal(resolveLocalizedPngPath(library(packed), packed, "en"), packed);
});

test("all six taskbar buttons use their four audited Korean native frames", () => {
  for (const series of ["btn_mainMulti_", "btn_mainSingle_", "btn_mainMyroom_", "btn_mainShop_", "튜닝_0", "클럽_0"]) {
    for (let state = 1; state <= 4; state++) {
      const source = `gui_/window/menu/${series}${state}@zz.png`;
      const chinese = source.replace("@zz", "@cn");
      const files = library(source, chinese, localizedPngPath(source, "en"), localizedPngPath(source, "ko"));
      assert.equal(resolveLocalizedPngPath(files, source, "zh-CN"), chinese);
      assert.equal(resolveLocalizedPngPath(files, chinese, "ko"), source);
      assert.equal(resolveLocalizedPngPath(files, source, "en"), localizedPngPath(source, "en"));
    }
  }
});

test("unverified @zz images keep the legacy fallback; non-image resources never change", () => {
  const source = "stage_/unknown/icon@zz.png", chinese = source.replace("@zz", "@cn");
  assert.equal(resolveLocalizedPngPath(library(source, chinese), source, "ko"), chinese);
  assert.deepEqual(localizedPngCandidates("stage_/mainMenu/stage@zz.bml", "en"), ["stage_/mainMenu/stage@zz.bml"]);
  assert.deepEqual(localizedPngCandidates("kart_/test/model.dds", "ko"), ["kart_/test/model.dds"]);
  assert.equal(localizedPngPath("zeta_/cn/mainMenu/button@cn.png", "ko"), "locale_ui/ko/zeta_/cn/mainMenu/button.png");
  assert.equal(resolveLocalizedPngPath(library(), "missing.png", "en"), "missing.png");
});
