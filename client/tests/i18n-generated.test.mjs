import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { localizeGeneratedModule } from '../tools/i18n-generated.mjs';

test('generated resource readers retain language selection after regeneration', () => {
  const fixtures = [
    ['library.js', `w = p.querySelector('m[c="cn"]')?.getAttribute("v");`],
    ['ui.js', 'r = t.children.find((o) => T(o, "c") === "cn"),\n        s = r && T(r, "v");'],
    ['world.js', 'a = Array.from(r.children)\n          .find((c) => c.getAttribute("c") === "cn")\n          ?.getAttribute("v");'],
  ];
  for (const [file, source] of fixtures) {
    const result = localizeGeneratedModule(file, source);
    assert.match(result, /resourceText\(/);
    assert.doesNotMatch(result, /=== "cn"|m\[c="cn"\]/);
    assert.equal(localizeGeneratedModule(file, result), result);
  }
  assert.equal(localizeGeneratedModule('formats.js', 'unchanged'), 'unchanged');
});

test('checked-in generated readers have no fixed Chinese string selection', () => {
  for (const file of ['library.js', 'ui.js', 'world.js']) {
    const source = fs.readFileSync(new URL('../src/generated/'+file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:getAttribute\("c"\)|\w+\(\w+, "c"\)) === "cn"|m\[c="cn"\]/);
  }
});

test('generated lobby exposes a stable page marker independently of its translated label', () => {
  const source = 'this.canvas.setAttribute("aria-label", "多人游戏大厅"),\nthis.element.setAttribute("aria-label", "多人游戏大厅"),';
  const result = localizeGeneratedModule('library.js', source);
  assert.match(result, /dataset.uiPage = "multiplayer-lobby"/);
  assert.match(result, /translateGeneratedLabel\("多人游戏大厅"\)/);
  assert.equal(localizeGeneratedModule('library.js', result), result);
  const checkedIn = fs.readFileSync(new URL('../src/generated/library.js', import.meta.url), 'utf8');
  assert.match(checkedIn, /dataset.uiPage = "multiplayer-lobby"/);
});

test('generated room labels localize only the mode suffix and survive regeneration', () => {
  const source = 'function iR(n) {\n  return H6[n.channelName];\n}\nfunction rR(n) { return `${n.name}（${iR(n)}）`; }';
  const result = localizeGeneratedModule('formats.js', source);
  assert.match(result, /return tr\(roomModeLabelSource\(n\)\)/);
  assert.match(result, /\$\{n\.name\}/);
  assert.equal(localizeGeneratedModule('formats.js', result), result);
});

test('ghost selection labels translate display words while retaining the version identifier', () => {
  const source = 'return `${n.version === "国服" ? "" : "复古 "}${e} ${n.booster === 0 ? "个人" : "组队"}`;';
  const result = localizeGeneratedModule('timeattack.js', source);
  assert.match(result, /n.version === "国服"/);
  assert.match(result, /tr\("复古"\)/);
  assert.match(result, /tr\(n.booster === 0/);
  assert.equal(localizeGeneratedModule('timeattack.js', result), result);
});

test('generated track cards localize official names without changing metadata or selection rules', () => {
  const library = 'd = c.cnTitle;\nif (!d) continue;\nreturn { id: o.id, title: o.reverse ? `[反]${d}` : d, };';
  const ui = 'if (!t?.cnTitle) throw new Error("missing");\nreturn { trackTitle: t.cnTitle, };';
  for (const [file, original] of [['library.js', library], ['ui.js', ui]]) {
    const result = localizeGeneratedModule(file, original);
    assert.match(result, /trackDisplayTitle\(/);
    assert.equal(localizeGeneratedModule(file, result), result);
    const checkedIn = fs.readFileSync(new URL('../src/generated/'+file, import.meta.url), 'utf8');
    assert.match(checkedIn, /trackDisplayTitle\(/);
  }
  assert.match(localizeGeneratedModule('library.js', library), /d = c.cnTitle;\nif \(!d\) continue;/);
  assert.match(localizeGeneratedModule('ui.js', ui), /if \(!t\?\.cnTitle\)/);
});

test('generated record panels translate kart labels without rewriting stored summaries', () => {
  const original = 'function summary(n) { return { kart: n.kartName, elapsedMs: n.elapsedMs }; }';
  const result = localizeGeneratedModule('ui.js', original);
  const render = new Function('translateItemName', result.replace(/^import .*;\n/gm, '') + '\nreturn summary;')(
    name => name === '爆烈 C1' ? 'Burst C1' : name);
  const saved = { kartName: '爆烈 C1', elapsedMs: 42000 };
  assert.deepEqual(render(saved), { kart: 'Burst C1', elapsedMs: 42000 });
  assert.equal(saved.kartName, '爆烈 C1');
  assert.equal(render({ kartName: 'My custom kart', elapsedMs: 42000 }).kart, 'My custom kart');
  assert.equal(localizeGeneratedModule('ui.js', result), result);
  const checkedIn = fs.readFileSync(new URL('../src/generated/ui.js', import.meta.url), 'utf8');
  assert.match(checkedIn, /kart: translateItemName\(n.kartName\)/);
});

test('generated multiplayer mode cards prefer packaged complete locale images', () => {
  const source = 'const a = fetch(`/ui/multiplayer/${p.editedImage}${v}.png`);\nconst b = fetch(`/ui/multiplayer/${p.image}`);';
  const result = localizeGeneratedModule('library.js', source);
  assert.match(result, /loadMultiplayerModeImage\(n, `\$\{p.editedImage\}\$\{v\}.png`\)/);
  assert.match(result, /loadMultiplayerModeImage\(n, p.image\)/);
  assert.doesNotMatch(result, /fetch\(/);
  assert.equal(localizeGeneratedModule('library.js', result), result);
});
