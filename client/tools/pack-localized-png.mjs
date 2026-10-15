#!/usr/bin/env node
/** Package complete localized PNG artwork, then optionally register the independent Rho. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { packRhoArchive } from "../src/codecs/rho-writer.ts";
import { decodePngRgba } from "../src/resources/png-decoder.ts";
import { LOCALIZED_PNG_CONTAINER, localizedPngArchivePath, localizedPngSourcePath } from "../src/resources/localized-png.ts";
import { registerContainer } from "./city/register-container.mjs";

/**
 * spec: { entries: [{ canonicalPath, locale: "en"|"ko"|"zh-CN", file,
 *                    provenance?, width?, height? }] }
 * file is relative to the spec's directory; dimensions optionally enforce the source sprite size.
 */
export async function buildLocalizedPngPack(spec, baseDirectory = process.cwd()) {
  if (!spec || !Array.isArray(spec.entries) || spec.entries.length === 0)
    throw new Error("Localized PNG spec must contain a nonempty entries array.");
  const seen = new Set();
  const files = [], entries = [];
  for (const row of spec.entries) {
    if (!row || !["zh-CN", "en", "ko"].includes(row.locale) || typeof row.file !== "string" ||
        typeof row.canonicalPath !== "string" || !/\.png$/i.test(row.canonicalPath) ||
        /[\\\0-\x1f]/.test(row.canonicalPath) || row.canonicalPath.startsWith("/") ||
        row.canonicalPath.split("/").some(part => part === "." || part === ".." || !part) ||
        row.canonicalPath.startsWith("locale_ui/"))
      throw new Error(`Invalid localized PNG entry: ${JSON.stringify(row)}`);
    const canonicalPath = localizedPngSourcePath(row.canonicalPath);
    const archivePath = localizedPngArchivePath(canonicalPath, row.locale);
    if (seen.has(archivePath.toLowerCase())) throw new Error(`Duplicate localized PNG: ${archivePath}`);
    seen.add(archivePath.toLowerCase());
    const bytes = readFileSync(path.resolve(baseDirectory, row.file));
    const { width, height } = await decodePngRgba(bytes);
    if ((row.width !== undefined && row.width !== width) || (row.height !== undefined && row.height !== height))
      throw new Error(`Wrong dimensions for ${archivePath}: ${width}x${height}, expected ${row.width}x${row.height}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    entries.push({ canonicalPath, locale: row.locale, archivePath, width, height, sha256,
      ...(typeof row.provenance === "string" ? { provenance: row.provenance } : {}) });
    files.push({ path: archivePath, bytes });
  }
  entries.sort((a, b) => a.archivePath.localeCompare(b.archivePath, "en"));
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const manifest = { version: 1, container: LOCALIZED_PNG_CONTAINER, entries };
  files.push({ path: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n") });
  return { bytes: await packRhoArchive(LOCALIZED_PNG_CONTAINER, files), manifest };
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!["--spec", "--out", "--register"].includes(key) || !value) throw new Error(`Invalid argument ${key}`);
    options[key.slice(2)] = value;
  }
  if (!options.spec || !options.out)
    throw new Error("Usage: node --import tsx tools/pack-localized-png.mjs --spec assets.json --out <directory> [--register <repo-root>]");
  const specPath = path.resolve(options.spec), out = path.resolve(options.out);
  const { bytes, manifest } = await buildLocalizedPngPack(JSON.parse(readFileSync(specPath, "utf8")), path.dirname(specPath));
  mkdirSync(out, { recursive: true });
  const containerPath = path.join(out, LOCALIZED_PNG_CONTAINER);
  writeFileSync(containerPath, bytes);
  writeFileSync(path.join(out, "locale_ui.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (options.register) await registerContainer({ mirrorRoot: options.register, containerPath });
  console.log(JSON.stringify({ containerPath, images: manifest.entries.length, bytes: bytes.length,
    registered: !!options.register }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
