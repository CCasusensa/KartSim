/** Keep release-owned StringBag readers on the same policy as authored menus. */
export function localizeGeneratedModule(filename, source) {
  if (filename === "timeattack.js") {
    const original = 'return `${n.version === "国服" ? "" : "复古 "}${e} ${n.booster === 0 ? "个人" : "组队"}`;';
    const localized = 'return `${n.version === "国服" ? "" : tr("复古") + " "}${e} ${tr(n.booster === 0 ? "个人" : "组队")}`;';
    if (source.includes(original)) {
      source = 'import { tr } from "../i18n/locale.ts";\n' + source.replace(original, localized);
    }
    return source;
  }
  if (filename === "formats.js") {
    // Localize the system mode suffix only; rR/CX also contain the player's room name.
    if (source.includes("function iR(n) {\n") && !source.includes("function roomModeLabelSource(n) {")) {
      source = source.replace("function iR(n) {\n",
        "function iR(n) {\n  return tr(roomModeLabelSource(n));\n}\n\nfunction roomModeLabelSource(n) {\n");
      source = 'import { tr } from "../i18n/locale.ts";\n' + source;
    }
    return source;
  }
  if (!["library.js", "ui.js", "world.js"].includes(filename)) return source;
  if (filename === "ui.js") {
    // Record summaries keep canonical names; localize only the painted result field.
    source = source.replace('kart: n.kartName,', 'kart: translateItemName(n.kartName),');
    const itemImport = 'import { translateItemName } from "../i18n/item-names.ts";\n';
    if (source.includes('translateItemName(') && !source.includes(itemImport)) source = itemImport + source;
  }
  if (filename === "library.js" || filename === "ui.js") {
    // Keep native metadata and track eligibility in CN; localize only displayed titles.
    source = source.replace('title: o.reverse ? `[反]${d}` : d,',
      'title: trackDisplayTitle(o.id, o.reverse ? `[反]${d}` : d),');
    source = source.replace('trackTitle: t.cnTitle,', 'trackTitle: trackDisplayTitle(e, t.cnTitle),');
    const trackImport = 'import { trackDisplayTitle } from "../resources/track-names.ts";\n';
    if (source.includes('trackDisplayTitle(') && !source.includes(trackImport)) source = trackImport + source;
  }
  if (filename === "library.js") {
    source = source.replace('this.canvas.setAttribute("aria-label", "多人游戏大厅")',
      'this.canvas.setAttribute("aria-label", translateGeneratedLabel("多人游戏大厅"))');
    source = source.replace('this.element.setAttribute("aria-label", "多人游戏大厅"),',
      'this.element.setAttribute("aria-label", translateGeneratedLabel("多人游戏大厅")),\n      (this.element.dataset.uiPage = "multiplayer-lobby"),');
    const labelImport = 'import { tr as translateGeneratedLabel } from "../i18n/locale.ts";\n';
    if (source.includes('translateGeneratedLabel(') && !source.includes(labelImport)) source = labelImport + source;
  }
  const importLine = 'import { resourceText } from "../i18n/locale.ts";\n';
  source = source.replace(
    `w = p.querySelector('m[c="cn"]')?.getAttribute("v");`,
    `w = resourceText(Array.from(p.children), (entry, key) => entry.getAttribute(key));`,
  );
  source = source.replace(
    `const b = s\n            .find((x) => j0(x, "n") === g)\n            ?.children.find((x) => j0(x, "c") === "cn"),\n          A = b && j0(b, "v");`,
    `const b = s.find((x) => j0(x, "n") === g),\n          A = b && resourceText(b.children, j0);`,
  );
  // DOM XML bags used by resource item names, track names and the garage.
  source = source.replace(
    /Array\.from\((\w+)\.children\)\s*\.find\(\((\w+)\) => \2\.getAttribute\("c"\) === "cn"\)\s*\?\.getAttribute\("v"\)/g,
    'resourceText(Array.from($1.children), (entry, key) => entry.getAttribute(key))',
  );
  // Binary XML bags in the remaining release-owned menu asset loaders.
  source = source.replace(
    /r = t\.children\.find\(\(o\) => T\(o, "c"\) === "cn"\),\s*s = r && T\(r, "v"\);/g,
    'r = resourceText(t.children, T),\n        s = r;',
  );
  if (source.includes('resourceText(') && !source.includes(importLine)) source = importLine + source;
  return source;
}
