import assert from "node:assert/strict";
import { test } from "node:test";
import { findTextureSourceFile } from "./texture-source-file";

function library(...paths: string[]) {
  return {
    exactCanonicalCandidates: (path: string) => paths.filter(p => p === path),
    canonicalCandidates: (path: string) => paths.filter(p => p.toLowerCase() === path.toLowerCase()),
  };
}
const track = { canonicalPrefix: "track_/wkc_R12" };

test("a texture cased differently from its file is found, as on Windows (WKC 美洲赛道 skydome.PNG)", () => {
  const found = findTextureSourceFile(library("track_/wkc_R12/skydome.PNG"), track, "skydome");
  assert.equal(found?.status === "found" && found.entry, "track_/wkc_R12/skydome.PNG");
  assert.equal(found?.status === "found" && found.extension, "png");
  assert.equal(findTextureSourceFile(library("track_/wkc_R12/Road01.dds"), track, "road01")?.status, "found");
});

test("an exact spelling under any extension wins (村庄 可乐版 W_fence00.png over w_fence00.dds)", () => {
  const village = { canonicalPrefix: "theme_/village/texture" };
  const coke = findTextureSourceFile(library("theme_/village/texture/W_fence00.png", "theme_/village/texture/w_fence00.dds"),
    village, "W_fence00");
  assert.equal(coke?.status === "found" && coke.entry, "theme_/village/texture/W_fence00.png");
  // Without one, extensions keep their order.
  const found = findTextureSourceFile(library("track_/wkc_R12/Sky.png", "track_/wkc_R12/SKY.DDS"), track, "sky");
  assert.equal(found?.status === "found" && found.entry, "track_/wkc_R12/SKY.DDS");
  const exact = findTextureSourceFile(library("track_/wkc_R12/sky.dds", "track_/wkc_R12/SKY.dds"), track, "sky");
  assert.equal(exact?.status === "found" && exact.entry, "track_/wkc_R12/sky.dds");
  assert.equal(findTextureSourceFile(library("track_/wkc_R12/Sky.dds", "track_/wkc_R12/SKY.dds"), track, "sky")?.status, "unresolved");
  assert.equal(findTextureSourceFile(library("track_/other/sky.dds"), track, "sky"), undefined);
});
