import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLocalizedPngPack } from "../tools/pack-localized-png.mjs";
import { encodePng } from "../tools/city/png.mjs";
import { loadSwWithReadableCodec, SwQueryIndex } from "../src/codecs/sw-compat.ts";
import { decodePngRgba } from "../src/resources/png-decoder.ts";
import { LOCALIZED_PNG_CONTAINER, resolveLocalizedPngPath } from "../src/resources/localized-png.ts";

test("locale PNG pack mounts and returns exact full-image pixels including transparency", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "kartsim-locale-png-"));
  try {
    const pixels = Uint8Array.of(3, 40, 90, 0, 200, 100, 50, 128);
    writeFileSync(path.join(directory, "button.png"), encodePng(2, 1, pixels));
    const spec = { entries: [{ canonicalPath: "gui_/window/menu/btn_mainMulti_1@zz.png", locale: "en",
      file: "button.png", width: 2, height: 1, provenance: "test fixture" }] };
    const { bytes, manifest } = await buildLocalizedPngPack(spec, directory);
    assert.equal(manifest.entries[0].archivePath, "en/gui_/window/menu/btn_mainMulti_1.png");
    assert.equal(manifest.entries[0].width, 2);
    assert.equal(manifest.entries[0].height, 1);
    assert.match(manifest.entries[0].sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(bytes, (await buildLocalizedPngPack(spec, directory)).bytes);
    const source = { name: LOCALIZED_PNG_CONTAINER, size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer,
      slice: (start = 0, end = bytes.length) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer }) };
    const state = await loadSwWithReadableCodec(class { constructor(input) { return input; } }, [source]);
    assert.deepEqual(state.errors, []);
    const library = new SwQueryIndex(state.files, state.manifestMountPaths);
    const resolved = resolveLocalizedPngPath(library, spec.entries[0].canonicalPath, "en");
    const entry = library.canonicalCandidates(resolved)[0];
    assert.equal(entry.sourceName, LOCALIZED_PNG_CONTAINER);
    assert.deepEqual((await decodePngRgba(await entry.bytes())).pixels, pixels);
    const embeddedManifest = library.canonicalCandidates("locale_ui/manifest.json")[0];
    assert.deepEqual(JSON.parse(await embeddedManifest.text()), manifest);
    await assert.rejects(() => buildLocalizedPngPack({ entries: [spec.entries[0], spec.entries[0]] }, directory), /Duplicate/);
    await assert.rejects(() => buildLocalizedPngPack({ entries: [{ ...spec.entries[0], width: 10 }] }, directory), /Wrong dimensions/);
    await assert.rejects(() => buildLocalizedPngPack({ entries: [{ ...spec.entries[0], canonicalPath: "../button.png" }] }, directory), /Invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("published language archive mounts every reviewed PNG with its recorded checksum", async () => {
  const bytes = new Uint8Array(readFileSync(new URL("../../mirror/p3553/locale_ui.rho", import.meta.url)));
  const manifest = JSON.parse(readFileSync(new URL("../assets/locale-ui/manifest.json", import.meta.url), "utf8"));
  const source = { name: LOCALIZED_PNG_CONTAINER, size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
    slice: (start = 0, end = bytes.length) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer }) };
  const state = await loadSwWithReadableCodec(class { constructor(input) { return input; } }, [source]);
  assert.deepEqual(state.errors, []);
  const library = new SwQueryIndex(state.files, state.manifestMountPaths);
  for (const row of manifest.entries) {
    const resolved = resolveLocalizedPngPath(library, row.canonicalPath, row.locale);
    assert.equal(resolved, `locale_ui/${row.archivePath}`);
    const matches = library.canonicalCandidates(resolved);
    assert.equal(matches.length, 1, resolved);
    const hash = createHash("sha256").update(await matches[0].bytes()).digest("hex");
    assert.equal(hash, row.sha256, resolved);
  }
  const embedded = JSON.parse(await library.canonicalCandidates("locale_ui/manifest.json")[0].text());
  assert.deepEqual(embedded.entries, manifest.entries);
});
