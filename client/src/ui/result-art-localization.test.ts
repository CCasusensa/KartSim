import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localizedRoadblockTexture } from "./result-art-localization";
import { localizedPngPath, resolveLocalizedPngPath } from "../resources/localized-png";
import { decodePngRgba } from "../resources/png-decoder";

function withLocale(locale: string, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
const directory = new URL("../../assets/locale-ui/race/", import.meta.url);
const spec = JSON.parse(readFileSync(new URL("spec.json", directory), "utf8")) as {
  entries: Array<{ canonicalPath: string; locale: "en" | "ko"; file: string; width: number; height: number; provenance: string }>;
};

test("all packaged race images decode as complete nonempty PNGs at the original design dimensions", async () => {
  assert.equal(spec.entries.length, 135);
  const paths = new Set<string>();
  for (const entry of spec.entries) {
    const key = localizedPngPath(entry.canonicalPath, entry.locale);
    assert.equal(paths.has(key), false, key);
    paths.add(key);
    const decoded = await decodePngRgba(readFileSync(new URL(entry.file, directory)));
    assert.equal(decoded.width, entry.width, entry.file);
    assert.equal(decoded.height, entry.height, entry.file);
    assert.ok(decoded.pixels.some((value, index) => index % 4 === 3 && value > 128), entry.file);
    assert.ok(entry.provenance.length > 10);
  }
});

test("pause, room and result lettering resolves to full native or packaged images in all three languages", () => {
  for (const canonical of ["stage_/common/btn_singleAgain_1@cn.png", "stage_/common/btn_menu_4@cn.png",
    "stage_/mqReady/btn_ready_1@cn.png", "stage_/mqReady/btn_set_4@cn.png", "stage_/mqReady/slotReady@cn.png",
    "stage_/common/btn_exit_2@cn.png", "stage_/common/btn_teamChange_3@cn.png",
    "stage_/mqGameFinal/redWin@cn.png", "stage_/mqGameFinal/victory@cn.png", "stage_/mqGameFinal/perpect@cn.png"]) {
    const paths = [canonical, ...spec.entries.map(entry => localizedPngPath(entry.canonicalPath, entry.locale))];
    if (canonical.includes("perpect")) paths.push(canonical.replace("@cn", "@kr"));
    const library = { canonicalCandidates: (path: string) => paths.includes(path) ? [path] : [] };
    for (const locale of ["zh-CN", "en", "ko"] as const)
      assert.equal(resolveLocalizedPngPath(library, canonical, locale), locale === "zh-CN" ? canonical : localizedPngPath(canonical, locale));
  }
});

test("roadblock Korean uses native same-size captions and the result modules contain no caption painter", () => {
  for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
    for (const name of ["runnerHeader", "blockerHeader", "lap_HandicapText", "gameresult_RunnerWin"])
      assert.equal(localizedRoadblockTexture(`${name}@cn`), `${name}@${locale === "ko" ? "kr" : "cn"}`);
  });
  for (const filename of ["result-art-localization.ts", "multiplayer-result-view.ts", "roadblock-result-view.ts"])
    assert.doesNotMatch(readFileSync(new URL(filename, import.meta.url), "utf8"), /paintLocalizedResultTexture|localizeResultTexture/);
});
