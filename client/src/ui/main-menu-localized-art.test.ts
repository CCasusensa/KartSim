import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { U1 } from '../generated/library.js';
import { localizedPngPath, localizedPngSourcePath } from '../resources/localized-png';
import { decodePngRgba } from '../resources/png-decoder';

function withLocale(locale: string, run: () => void) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => locale}});
  try { run(); } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('shared release lookup selects complete locale artwork while BML geometry stays original', () => {
  const originalPath = 'zeta_/cn/stage/mainMenu/btn_timeAttack01_1.png';
  const original = {id: 'original'};
  const en = {id: 'English bitmap'}, ko = {id: 'Korean bitmap'};
  const layout = {id: 'original layout'};
  const entries = new Map<string, unknown>([[originalPath,original],
    [localizedPngPath(originalPath,'en'),en],[localizedPngPath(originalPath,'ko'),ko],
    ['stage_/mainMenu/mq_window@cn.bml',layout]]);
  const library = {canonicalCandidates: (path: string) => entries.has(path) ? [entries.get(path)] : []};
  for (const [locale,expected] of [['zh-CN',original],['en',en],['ko',ko]] as const) withLocale(locale, () => {
    assert.equal(U1(library,['stage_/mainMenu','zeta_/cn/stage/mainMenu'],'btn_timeAttack01_1'),expected);
    assert.equal(U1(library,['stage_/mainMenu'],'mq_window@zz','.bml'),layout);
  });
});

test('single-player translated atlases contain every state at its native layout size', async () => {
  const root = new URL('../../assets/locale-ui/main-menu/', import.meta.url);
  const spec = JSON.parse(fs.readFileSync(new URL('spec.json',root),'utf8'));
  assert.equal(spec.entries.length,232);
  for (const locale of ['en','ko']) {
    const entries = spec.entries.filter((row: {locale: string}) => row.locale === locale);
    assert.equal(entries.length,116);
    for (const row of entries) {
      const image = await decodePngRgba(fs.readFileSync(new URL(row.file,root)));
      assert.deepEqual([image.width,image.height],[row.width,row.height],row.canonicalPath);
      assert.ok(image.pixels.some((value,index) => index%4===3 && value>0),row.canonicalPath+' must not be blank');
    }
    for (const stem of ['btn_timeAttack01','btn_timeAttack02','btn_timeAttackCompetitive',
      'cat_timeAttack','cat_riderSchool','cat_scenirio','cat_training','cat_replay']) {
      for (let state=1;state<=4;state++) assert.ok(entries.some((row: {canonicalPath: string}) =>
        row.canonicalPath.endsWith(`/${stem}_${state}.png`)),`${locale}/${stem}/${state}`);
    }
  }
});

test('main menu draws localized images directly without a caption cover pass', () => {
  const source=fs.readFileSync(new URL('./main-menu-view.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/paintMainMenuCaption|paintStoryCardCaption|main-menu-caption/);
});

test('all three time attack explanation boards include full English and Korean PNGs', async () => {
  const root = new URL('../../assets/locale-ui/menu-descriptions/', import.meta.url);
  const spec = JSON.parse(fs.readFileSync(new URL('spec.json', root), 'utf8'));
  assert.equal(spec.entries.length, 6);
  const names = ['img_titleBlue', 'img_titleRed', 'img_titleYellow'];
  const resources = new Map<string, object>();
  for (const name of names)
    resources.set(`zeta_/cn/stage/mainMenu/${name}.png`, { locale: 'zh-CN', name });
  for (const locale of ['en', 'ko'] as const) {
    for (const name of names) {
      const canonicalPath = `zeta_/cn/stage/mainMenu/${name}.png`;
      const matches = spec.entries.filter((row: {locale: string; canonicalPath: string}) =>
        row.locale === locale && row.canonicalPath === canonicalPath);
      assert.equal(matches.length, 1, `${locale}/${name}`);
      const row = matches[0];
      const image = await decodePngRgba(fs.readFileSync(new URL(row.file, root)));
      assert.deepEqual([image.width, image.height], [246, 318], `${locale}/${name}`);
      assert.deepEqual([row.width, row.height], [246, 318]);
      assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 0));
      // The original art fades onto a white menu panel. A dark opaque footer
      // changes the game's appearance even when the translated words fit.
      for (const x of [12, 123, 233]) {
        const offset = ((image.height - 2) * image.width + x) * 4;
        assert.ok((image.pixels[offset] ?? 0) > 230 && (image.pixels[offset + 1] ?? 0) > 230 &&
          (image.pixels[offset + 2] ?? 0) > 230, `${locale}/${name}: footer must remain white`);
      }
      resources.set(localizedPngPath(canonicalPath, locale), { locale, name });
    }
  }
  const library = { canonicalCandidates: (path: string) => resources.has(path) ? [resources.get(path)] : [] };
  for (const locale of ['zh-CN', 'en', 'ko']) withLocale(locale, () => {
    for (const name of names)
      assert.deepEqual(U1(library, ['stage_/mainMenu', 'stage_/common', 'zeta_/cn/stage/mainMenu'], name),
        { locale, name });
  });
});

test('completion stamps and track challenge have complete native-size EN/KO assets', async () => {
  const resources = new Map<string, object>();
  for (const [group, count] of [['menu-completion', 6], ['timeattack-vs', 8]] as const) {
    const root = new URL(`../../assets/locale-ui/${group}/`, import.meta.url);
    const spec = JSON.parse(fs.readFileSync(new URL('spec.json', root), 'utf8'));
    assert.equal(spec.entries.length, count);
    for (const row of spec.entries) {
      const dimensions = group === 'timeattack-vs' ? [272, 134] :
        row.canonicalPath.endsWith('/img_clearIcon.png') ? [96, 92] : [70, 70];
      const image = await decodePngRgba(fs.readFileSync(new URL(row.file, root)));
      assert.deepEqual([image.width, image.height], dimensions, row.canonicalPath);
      assert.deepEqual([row.width, row.height], dimensions);
      assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value > 0));
      if (group === 'menu-completion')
        assert.ok(image.pixels.some((value, index) => index % 4 === 3 && value === 0));
      resources.set(row.canonicalPath, { locale: 'zh-CN', name: row.canonicalPath });
      resources.set(localizedPngPath(row.canonicalPath, row.locale), { locale: row.locale, name: row.canonicalPath });
    }
  }
  const library = { canonicalCandidates: (path: string) => resources.has(path) ? [resources.get(path)] : [] };
  const originals = [...resources.keys()].filter(path => !path.startsWith('locale_ui/'));
  for (const locale of ['zh-CN', 'en', 'ko']) withLocale(locale, () => {
    for (const canonicalPath of originals) {
      const slash = canonicalPath.lastIndexOf('/');
      assert.deepEqual(U1(library, [canonicalPath.slice(0, slash)], canonicalPath.slice(slash + 1, -4)),
        { locale, name: canonicalPath });
    }
  });
});

test('audited single-player image families all resolve to packaged translations', () => {
  const assets = new URL('../../assets/locale-ui/', import.meta.url);
  const audit = JSON.parse(fs.readFileSync(new URL('menu-completion/source/single-menu-audit.json', assets), 'utf8'));
  assert.equal(audit.resources.length, 53);
  const covered = new Set<string>();
  for (const directory of fs.readdirSync(assets, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const specPath = new URL(`${directory.name}/spec.json`, assets);
    if (!fs.existsSync(specPath)) continue;
    for (const row of JSON.parse(fs.readFileSync(specPath, 'utf8')).entries)
      covered.add(`${row.locale}:${localizedPngSourcePath(row.canonicalPath)}`);
  }
  for (const row of audit.resources.filter((row: {disposition: string}) => row.disposition === 'Localized complete PNG family')) {
    for (const locale of ['en', 'ko'])
      assert.ok(covered.has(`${locale}:${localizedPngSourcePath(row.canonicalPath)}`), `${locale}/${row.canonicalPath}`);
  }
});
