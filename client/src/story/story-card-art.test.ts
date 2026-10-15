import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { decodePngRgba } from "../resources/png-decoder";
import { storyChapterCardPaths, STORY_CARD_ROOT } from "./story-card-art";

const root = new URL("../../assets/locale-ui/story/", import.meta.url);
const xyyRoot = new URL("../../assets/locale-ui/story-xyy/", import.meta.url);
type Entry = { canonicalPath: string; locale: "zh-CN" | "en" | "ko"; file: string; width: number; height: number };
const spec = JSON.parse(readFileSync(new URL("spec.json", root), "utf8")) as { entries: Entry[] };
const xyySpec = JSON.parse(readFileSync(new URL("spec.json", xyyRoot), "utf8")) as { entries: Entry[] };
const generation = JSON.parse(readFileSync(new URL("generation.json", root), "utf8")) as {
  chapters: string[]; groups: string[]; missing: string[];
};

function library(paths: Iterable<string>) {
  const files = new Set(paths);
  return { canonicalCandidates: (path: string) => files.has(path) ? [{}] : [] };
}

test("Abyss II chooses its complete 21–24 family instead of Abyss I's hover image", () => {
  const files = library([`${STORY_CARD_ROOT}/chapter_abyss2.png`,
    ...[1, 2, 3, 4].map(state => `${STORY_CARD_ROOT}/chapter_abyss2${state}.png`)]);
  for (const locale of ["zh-CN", "en", "ko"] as const)
    assert.deepEqual(storyChapterCardPaths(files, "chapter_abyss2", locale),
      [1, 2, 3, 4].map(state => `${STORY_CARD_ROOT}/chapter_abyss2${state}.png`));
  const partial = library([`${STORY_CARD_ROOT}/chapter_abyss2.png`, `${STORY_CARD_ROOT}/chapter_abyss21.png`]);
  assert.deepEqual(storyChapterCardPaths(partial, "chapter_abyss2", "zh-CN"),
    [`${STORY_CARD_ROOT}/chapter_abyss2.png`], "an incomplete state family does not replace a valid single image");
});

test("all 52 chapters resolve to complete art in Chinese, English and Korean", () => {
  const native = new Set(spec.entries.map(entry => entry.canonicalPath));
  const files = library([...native, ...[...spec.entries, ...xyySpec.entries]
    .map(entry => `locale_ui/${entry.locale}/${entry.canonicalPath}`)]);
  assert.equal(generation.chapters.length, 52);
  assert.deepEqual(generation.missing, ["xyy_1"]);
  for (const chapter of generation.chapters) for (const locale of ["zh-CN", "en", "ko"] as const) {
    const paths = storyChapterCardPaths(files, chapter, locale);
    if (chapter === "xyy_1") {
      assert.deepEqual(paths, [1, 2, 3, 4].map(state =>
        `locale_ui/${locale}/${STORY_CARD_ROOT}/xyy_1${state}.png`), "the missing native card has complete generated states");
      continue;
    }
    assert.ok(paths.length === 1 || paths.length === 4, `${locale}/${chapter}`);
    assert.ok(paths.every(path => locale === "zh-CN" ? native.has(path)
      : path.startsWith(`locale_ui/${locale}/`)), `${locale}/${chapter}`);
  }
  assert.deepEqual(storyChapterCardPaths(files, "chapter1", "zh-CN"), [`${STORY_CARD_ROOT}/chapter1.png`]);
  assert.deepEqual(storyChapterCardPaths(files, "chapter_fengshen2", "en"),
    [`locale_ui/en/${STORY_CARD_ROOT}/chapter_fengshen2.png`], "shared single theme art remains supported");
});

test("XYY has twelve distinct, complete 272×134 sprites and visible interaction states", async () => {
  assert.equal(xyySpec.entries.length, 12);
  const hashes = new Set<string>();
  for (const locale of ["zh-CN", "en", "ko"] as const) {
    const entries = xyySpec.entries.filter(entry => entry.locale === locale);
    assert.deepEqual(entries.map(entry => entry.canonicalPath), [1, 2, 3, 4]
      .map(state => `${STORY_CARD_ROOT}/xyy_1${state}.png`));
    const luminances: number[] = [];
    for (const [state, entry] of entries.entries()) {
      const bytes = readFileSync(new URL(entry.file, xyyRoot));
      hashes.add(createHash("sha256").update(bytes).digest("hex"));
      const png = await decodePngRgba(bytes);
      assert.deepEqual([png.width, png.height], [272, 134], entry.file);
      let luminance = 0;
      for (let i = 0; i < png.pixels.length; i += 4) {
        assert.equal(png.pixels[i + 3], 255, `${entry.file}: complete opaque artwork`);
        luminance += .2126 * png.pixels[i]! + .7152 * png.pixels[i + 1]! + .0722 * png.pixels[i + 2]!;
        if (state === 3) {
          assert.equal(png.pixels[i], png.pixels[i + 1], entry.file);
          assert.equal(png.pixels[i], png.pixels[i + 2], entry.file);
        }
      }
      luminances.push(luminance / (png.width * png.height));
    }
    assert.ok(luminances[1]! > luminances[0]!, `${locale}: hover is brighter`);
    assert.ok(luminances[2]! < luminances[0]!, `${locale}: pressed is darker`);
  }
  assert.equal(hashes.size, 12, "locale and state variants must not collapse to the same image");
});

test("original regional PNGs take precedence over generated chapter art", () => {
  const files = library([`${STORY_CARD_ROOT}/chapter1.png`, `${STORY_CARD_ROOT}/chapter1@kr.png`,
    `locale_ui/ko/${STORY_CARD_ROOT}/chapter1.png`]);
  assert.deepEqual(storyChapterCardPaths(files, "chapter1", "ko"), [`${STORY_CARD_ROOT}/chapter1@kr.png`]);
});

test("all 256 complete story sprites decode at native dimensions with grayscale disabled states", async () => {
  assert.equal(spec.entries.length, 256);
  assert.equal(new Set(spec.entries.map(entry => `${entry.locale}/${entry.canonicalPath}`)).size, 256);
  for (const entry of spec.entries) {
    const png = await decodePngRgba(readFileSync(new URL(entry.file, root)));
    assert.deepEqual([png.width, png.height], [entry.width, entry.height], entry.file);
    assert.deepEqual([png.width, png.height], entry.canonicalPath.includes("chapter_abyss2") &&
      /chapter_abyss2[1-4]\.png$/.test(entry.canonicalPath) ? [335, 78] : [272, 134]);
    assert.ok(png.pixels.some((value, index) => index % 4 === 3 && value > 0), entry.file);
    if (entry.file.endsWith("4.png")) for (let i = 0; i < png.pixels.length; i += 4) {
      assert.equal(png.pixels[i], png.pixels[i + 1], entry.file);
      assert.equal(png.pixels[i], png.pixels[i + 2], entry.file);
    }
  }
});
