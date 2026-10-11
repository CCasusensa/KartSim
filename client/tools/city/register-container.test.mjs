import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { packRhoArchive } from "../../src/codecs/rho-writer.ts";
import { loadSwWithReadableCodec } from "../../src/codecs/sw-compat.ts";
import { decodeArchiveIndex } from "../../src/resources/archive-index.ts";
import { parseResourceManifest } from "../../src/resources/manifest.ts";
import { encodeTrackModel, makeNode, makeTexProperty, makeTrackContainer, makeTriListNode,
  makeVertexData } from "../../src/resources/track-binary-writer.ts";
import { decodeIndexJson, diskSource, registerContainer, sha256Hex } from "./register-container.mjs";

const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(client, "..");
const tool = path.join(client, "tools/city/register-container.mjs");
const mirrorRoots = [root, path.resolve(root, "../KartSim")];
const realMirrorRoot = mirrorRoots.find(candidate =>
  existsSync(path.join(candidate, "mirror/p3553/aaa.pk")) &&
  existsSync(path.join(candidate, "mirror/__p3553/resources")) &&
  existsSync(path.join(candidate, "mirror/__p3553/archive-index")));

// The generated library touches document at import time.
globalThis.document ??= {
  createElement: () => ({ relList: { supports: () => true }, getContext: () => null, style: {} }),
};

function cityArchiveFiles() {
  const quad = makeVertexData({
    positions: [[0, 0, 0], [100, 0, 0], [100, 0, 100], [0, 0, 100]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    indices: [0, 1, 2, 0, 2, 3],
  });
  const scene = makeNode("Relement", { name: "scene", children: [
    makeTriListNode("ground", quad, { properties: [makeTexProperty("city_ground")] }),
  ] });
  const container = makeTrackContainer("kartcity", scene, [
    { kind: "ToDummy", name: "start", transform: { basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      position: [0, 0, 0], scale: [1, 1, 1] } },
  ]);
  return [
    { path: "track.1s", bytes: encodeTrackModel(container) },
    { path: "xt_minimap.png", bytes: new TextEncoder().encode("not really a png ".repeat(50)) },
  ];
}

async function temporaryMirror() {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "kartsim-register-"));
  const meta = path.join(temporary, "mirror/__p3553");
  mkdirSync(meta, { recursive: true });
  for (const name of ["resources", "archive-index"])
    copyFileSync(path.join(realMirrorRoot, "mirror/__p3553", name), path.join(meta, name));
  mkdirSync(path.join(temporary, "build"), { recursive: true });
  const archive = await packRhoArchive("track_kartcity.rho", cityArchiveFiles());
  const archivePath = path.join(temporary, "build/track_kartcity.rho");
  writeFileSync(archivePath, archive);
  return { temporary, archive, archivePath, meta };
}

test("register-container 登记新容器：复制、清单、档案索引，且库可读取其中文件", { skip: !realMirrorRoot && "mirror/p3553 不存在" }, async () => {
  const { temporary, archive, archivePath, meta } = await temporaryMirror();
  try {
    const originalManifest = JSON.parse(readFileSync(path.join(meta, "resources"), "utf8"));
    const originalIndex = decodeIndexJson(readFileSync(path.join(meta, "archive-index")));

    const result = await registerContainer({ mirrorRoot: temporary, containerPath: archivePath, now: 1234567890123 });
    assert.equal(result.name, "track_kartcity.rho");
    assert.equal(result.target, path.join(temporary, "mirror/p3553/track_kartcity.rho"));
    assert.deepEqual(result.files, ["track.1s", "xt_minimap.png"]);
    assert.deepEqual(readFileSync(result.target), Buffer.from(archive));

    // Manifest: one new entry, everything else byte-for-byte the same.
    const manifestText = readFileSync(path.join(meta, "resources"), "utf8");
    const manifestJson = JSON.parse(manifestText);
    assert.equal(manifestJson.revision, originalManifest.revision);
    assert.equal(manifestJson.version, originalManifest.version);
    assert.deepEqual(manifestJson.files.slice(0, -1), originalManifest.files);
    assert.deepEqual(manifestJson.files.at(-1), {
      name: "track_kartcity.rho", size: archive.length, mtimeMs: 1234567890123, sha256: sha256Hex(archive),
    });
    assert.equal(manifestText, `${JSON.stringify(manifestJson, null, 2)}\n`);
    const manifest = parseResourceManifest(manifestJson, "p3553");

    // Archive index: decodes against the manifest, other entries untouched.
    const indexBytes = readFileSync(path.join(meta, "archive-index"));
    const index = await decodeArchiveIndex(new Blob([indexBytes]).stream(), manifest);
    assert.equal(index.rho.length, originalIndex.rho.length + 1);
    assert.deepEqual(index.rho.slice(0, -1), originalIndex.rho);
    assert.deepEqual(index.rho5, originalIndex.rho5);
    const entry = index.rho.at(-1);
    assert.equal(entry.name, "track_kartcity.rho");
    assert.equal(entry.version, "1.0");
    assert.equal(entry.mediaSize, archive.length);
    assert.deepEqual(entry.files.map(file => file.path), ["track.1s", "xt_minimap.png"]);

    // --check passes through the CLI, and fails once the container is tampered with.
    const run = (...args) => execFileSync(process.execPath, ["--import", "tsx", tool, ...args],
      { cwd: client, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const output = run("--mirror", temporary, "--container", archivePath, "--check");
    assert.match(output, /已正确登记/);
    const tampered = JSON.parse(readFileSync(path.join(meta, "resources"), "utf8"));
    tampered.files.at(-1).sha256 = "0".repeat(64);
    writeFileSync(path.join(meta, "resources"), `${JSON.stringify(tampered, null, 2)}\n`);
    assert.throws(() => run("--mirror", temporary, "--container", archivePath, "--check"),
      error => error.status === 1 && /sha256/.test(error.stderr));
    const checked = await registerContainer({ mirrorRoot: temporary, containerPath: archivePath, check: true });
    assert.equal(checked.problems.length, 1);

    // Re-registering replaces the entry in place instead of duplicating it.
    const again = await registerContainer({ mirrorRoot: temporary, containerPath: archivePath, now: 5 });
    assert.match(again.log.join("\n"), /清单已替换/);
    const replaced = parseResourceManifest(JSON.parse(readFileSync(path.join(meta, "resources"), "utf8")), "p3553");
    assert.equal(replaced.files.filter(file => file.name === "track_kartcity.rho").length, 1);
    assert.equal(replaced.files.at(-1).mtimeMs, 5);
    const replacedIndex = await decodeArchiveIndex(
      new Blob([readFileSync(path.join(meta, "archive-index"))]).stream(), replaced);
    assert.equal(replacedIndex.rho.filter(item => item.name === "track_kartcity.rho").length, 1);

    // The browser's library loader reads the new container through the index
    // (aaa.pk comes from the real mirror; the unmounted archive mounts as track_kartcity/).
    const { Sw } = await import("../../src/generated/library.js");
    const sources = [
      diskSource(path.join(realMirrorRoot, "mirror/p3553/aaa.pk"), "aaa.pk"),
      diskSource(result.target, "track_kartcity.rho"),
    ];
    const library = await loadSwWithReadableCodec(Sw, sources, undefined, replacedIndex);
    assert.deepEqual(library.errors, []);
    const model = library.files.find(file => file.virtualPath === "track_kartcity/track.1s");
    assert.ok(model, "track_kartcity/track.1s is listed");
    assert.equal(model.sourceName, "track_kartcity.rho");
    assert.deepEqual(await model.bytes(), cityArchiveFiles()[0].bytes);
    const formats = await import("../../src/generated/formats.js");
    assert.equal(formats.y9(await model.bytes()).root.name, "kartcity");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("register-container 拒绝非 .rho 名称和缺失的镜像", async () => {
  await assert.rejects(registerContainer({ mirrorRoot: os.tmpdir(), containerPath: "x/track.1s" }), /容器名无效/);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "kartsim-register-empty-"));
  try {
    await assert.rejects(registerContainer({ mirrorRoot: temporary, containerPath: "x/a.rho" }), /找不到/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
