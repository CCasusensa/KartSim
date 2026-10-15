import assert from "node:assert/strict";
import test from "node:test";
import { localizedRoadblockTexture, paintLocalizedResultTexture } from "./result-art-localization";

function withLocale(locale: string, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function drawing() {
  const text: unknown[][] = [], images: unknown[][] = [], cleared: unknown[][] = [];
  const context = { save() {}, restore() {}, strokeText() {},
    fillText: (...args: unknown[]) => text.push(args),
    drawImage: (...args: unknown[]) => images.push(args),
    clearRect: (...args: unknown[]) => cleared.push(args),
  } as unknown as CanvasRenderingContext2D;
  return { context, text, images, cleared };
}

test("race result caption projection removes baked text in English and Korean while Chinese remains original", () => {
  const sprite = { image: {} as CanvasImageSource, width: 324, height: 92 };
  for (const [locale, caption] of [["zh-CN", undefined], ["en", "Red Team Wins!"], ["ko", "레드팀 승리!"]] as const) {
    withLocale(locale, () => {
      const draw = drawing();
      assert.equal(paintLocalizedResultTexture(draw.context, sprite, "redWin@cn"), !!caption);
      assert.deepEqual(draw.text, caption ? [[caption, 162, 46, 312]] : []);
      assert.deepEqual(draw.cleared, caption ? [[0, 0, 324, 92]] : []);
      assert.deepEqual(draw.images, [], "caption-only winner art does not retain baked Chinese glyphs");
    });
  }
});

test("scoreboard and role strip repaint only their caption bands, preserving original dimensions and artwork", () => {
  withLocale("en", () => {
    const score = { image: {} as CanvasImageSource, width: 308, height: 86 };
    const draw = drawing();
    assert.equal(paintLocalizedResultTexture(draw.context, score, "scoreBox@zz"), true);
    assert.deepEqual(draw.text.map(args => args[0]), ["Blue Team", "Red Team"]);
    assert.deepEqual(draw.images[0], [score.image, 0, 0]);
    assert.deepEqual(draw.images.slice(1), [
      [score.image, 2, 0, 1, 28, 0, 0, 154, 28],
      [score.image, 156, 0, 1, 28, 154, 0, 154, 28],
    ]);
    const role = { image: {} as CanvasImageSource, width: 374, height: 33 };
    const header = drawing();
    assert.equal(paintLocalizedResultTexture(header.context, role, "runnerHeader@cn"), true);
    assert.deepEqual(header.text, [["Runner", 51, 17, 62]]);
    assert.deepEqual(header.images, [[role.image, 0, 0], [role.image, 21, 3, 1, 27, 23, 3, 57, 27]]);
    assert.equal(role.width, 374);
    assert.equal(role.height, 33);
  });
});

test("roadblock Korean uses native same-size captions and unrelated numeric sprites stay intact", () => {
  for (const locale of ["zh-CN", "en", "ko"]) withLocale(locale, () => {
    for (const name of ["runnerHeader", "blockerHeader", "lap_HandicapText", "gameresult_RunnerWin"])
      assert.equal(localizedRoadblockTexture(`${name}@cn`), `${name}@${locale === "ko" ? "kr" : "cn"}`);
    const draw = drawing();
    const sprite = { image: {} as CanvasImageSource, width: 182, height: 30 };
    assert.equal(paintLocalizedResultTexture(draw.context, sprite, "lap_HandicapText@kr"), false);
    assert.equal(paintLocalizedResultTexture(draw.context, sprite, "big_num"), false);
    assert.deepEqual(draw.text, []);
  });
});
