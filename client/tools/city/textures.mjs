// Texture lookup over the resource library, mirroring the browser's order:
// track folder → primary theme → extra themes → common; "@zz" prefers "@cn".
const EXTENSIONS = ["dds", "png", "jpg", "tga", "kng"];

export class TextureIndex {
  constructor(library) {
    this.byPath = new Map();
    for (const file of library.files) {
      const path = (file.canonicalPath ?? file.virtualPath).toLowerCase();
      if (!this.byPath.has(path)) this.byPath.set(path, file);
    }
  }

  /** Find the file for a texture stem in the given search prefixes. */
  resolve(name, prefixes) {
    const stems = name.endsWith("@zz") ? [`${name.slice(0, -3)}@cn`, name] : [name];
    for (const prefix of prefixes) {
      for (const stem of stems) {
        for (const extension of EXTENSIONS) {
          const file = this.byPath.get(`${prefix}/${stem}.${extension}`.toLowerCase());
          if (file) return { file, extension, stem };
        }
      }
    }
    return undefined;
  }
}

export const themePrefixes = (folder, themes) => [
  `track_/${folder}`,
  ...themes.map(theme => `theme_/${theme}/texture`),
  "theme_/common/texture",
];

/**
 * Collects the texture files the city needs and gives each a unique output
 * stem; copied landmark textures are renamed when two sources collide.
 */
export class TextureSet {
  constructor(index) { this.index = index; this.files = new Map(); this.stems = new Map(); }

  /** Register a theme texture by name; returns the stem to use in the model. */
  theme(name, themes) {
    const found = this.index.resolve(name, themePrefixes("", themes).slice(1));
    if (!found) throw new Error(`找不到主题贴图 ${name}（${themes.join("|")}）。`);
    return this.adopt(found, name);
  }

  /** Register a generated texture (bytes already encoded). */
  generated(stem, extension, bytes) {
    this.files.set(stem.toLowerCase(), { stem, extension, bytes: () => Promise.resolve(bytes) });
    return stem;
  }

  adopt(found, preferredStem) {
    const key = `${found.file.canonicalPath ?? found.file.virtualPath}`.toLowerCase();
    const known = this.stems.get(key);
    if (known) return known;
    let stem = preferredStem.endsWith("@zz") ? preferredStem.slice(0, -3) : preferredStem;
    stem = stem.replace(/[^A-Za-z0-9_@\-\.]/g, "_");
    let candidate = stem, n = 2;
    while (this.files.has(candidate.toLowerCase())) candidate = `${stem}_${n++}`;
    this.files.set(candidate.toLowerCase(), { stem: candidate, extension: found.extension, bytes: () => found.file.bytes() });
    this.stems.set(key, candidate);
    return candidate;
  }

  async entries() {
    const out = [];
    for (const { stem, extension, bytes } of this.files.values()) out.push({ path: `${stem}.${extension}`, bytes: await bytes() });
    return out;
  }
}
