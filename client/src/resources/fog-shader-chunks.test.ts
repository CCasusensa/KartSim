import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ShaderChunk } from "three";

import { installTrackFogChunks } from "./fog-shader-chunks";

const releaseFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../../recovered/formatted/index.js");
const chunkNames = ["fog_pars_vertex", "fog_vertex", "fog_pars_fragment", "fog_fragment"] as const;

async function releaseChunks(): Promise<Record<string, string>> {
  const source = await readFile(releaseFile, "utf8");
  const begin = source.indexOf("function Vr0(");
  const end = source.indexOf("\nfunction kv(", begin);
  assert.ok(begin >= 0 && end > begin);
  const chunks: Record<string, string> = {};
  new Function("z2", "GE", `${source.slice(begin, end)}\nVr0();`)(chunks, false);
  return chunks;
}

test("fog chunks keep the release's except the EXP2 distance, now exact per pixel", async () => {
  const release = await releaseChunks();
  installTrackFogChunks();
  const perPixel = (chunk: string) => chunk
    .replace("varying float vFogRadialDistance;", "varying vec3 vFogViewPosition;")
    .replace("vFogRadialDistance = length( mvPosition.xyz );", "vFogViewPosition = mvPosition.xyz;")
    .replace(": vFogRadialDistance;", ": length( vFogViewPosition );");
  for (const name of chunkNames) {
    assert.equal(ShaderChunk[name], perPixel(release[name]!), name);
    assert.doesNotMatch(ShaderChunk[name], /vFogRadialDistance/, name);
  }
  // No distance is interpolated from the vertices any more.
  assert.doesNotMatch(ShaderChunk.fog_vertex, /length\(/);
});

test("installing the fog chunks twice leaves later chunk edits alone", () => {
  installTrackFogChunks();
  const installed = ShaderChunk.fog_fragment;
  ShaderChunk.fog_fragment = "edited";
  installTrackFogChunks();
  assert.equal(ShaderChunk.fog_fragment, "edited");
  ShaderChunk.fog_fragment = installed;
});
