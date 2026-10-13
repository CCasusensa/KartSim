import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { Rho5Reader } from "../codecs/rho5";
import type { Rho5ArchiveIndex } from "./archive-index";
import type { ArchiveSource } from "./container-store";
import { itemTableGarageDefinitions, overlayItemTable, parseItemDefinitions,
  type ItemTableDependencies, type ItemTableLibrary } from "./item-table";
import type { GarageItemDefinition, GarageResource } from "./timeattack-items";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const release = readFileSync(path.resolve(project, "../recovered/formatted/index.js"), "utf8");
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ relList: { supports: () => true } }),
};
const { x1, j0, Cr, _Z } = await import("../generated/formats.js");

function between(start: string, end: string): string {
  const from = release.indexOf(start);
  const to = release.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `release segment ${start}`);
  return release.slice(from, to);
}

const referenceSource = [
  between("class Sw {", "\nconst BZ = "),
  between("async function NZ(", "\nfunction qZ("),
  between("function O3(", "\nfunction nQ("),
  between("function z3(", "\nfunction sQ("),
  "return { Sw, UZ };",
].join("\n");
/** The release also returns decorationTrans, an item's `trans` drawn as model opacity. */
type ReleaseDefinition = GarageItemDefinition & { decorationTrans?: number };
const { Sw: ReleaseLibrary, UZ: releaseParseDefinitions } = new Function(
  "x1", "j0", "Cr", "_Z", referenceSource,
)(x1, j0, Cr, _Z) as {
  Sw: new (input: { files: GarageResource[]; [field: string]: unknown }) =>
    ItemTableLibrary & { itemTableGarageDefinitions(): Promise<ReleaseDefinition[]> };
  UZ: (nodes: unknown[]) => ReleaseDefinition[];
};

/** Release definitions without decorationTrans, which parseItemDefinitions drops on purpose. */
function withoutTrans(definitions: ReleaseDefinition[]): GarageItemDefinition[] {
  return definitions.map(({ decorationTrans: _trans, ...item }) => item);
}
const dependencies: ItemTableDependencies = { parseXml: x1, legacyFamilies: Cr };

class AuthoredLibrary extends ReleaseLibrary {
  itemTableGarageDefinitions() { return itemTableGarageDefinitions(this, dependencies); }
}

function utf16(xml: string): Uint8Array {
  const source = `<?xml version="1.0" encoding="UTF-16"?>${xml.replace(/^<\?xml[^>]*\?>/, "")}`;
  return Uint8Array.from(Buffer.concat([Buffer.from([255, 254]), Buffer.from(source, "utf16le")]));
}

function file(virtualPath: string, payload: Uint8Array): GarageResource {
  const name = virtualPath.split("/").at(-1)!;
  return {
    name, extension: name.split(".").at(-1)!.toLowerCase(), virtualPath,
    canonicalPath: virtualPath, sourceName: "DataPack1", sourceKind: "rho5",
    containerId: "rho5:datapack1", bytes: async () => payload,
    text: async () => new TextDecoder("utf-16le").decode(payload.subarray(2)),
  };
}

function setup<T extends ItemTableLibrary>(Constructor: new (input: any) => T,
  files: GarageResource[]): T {
  return new Constructor({
    files, archives: [], errors: [], warnings: [], region: "cn", manifestAvailable: false,
    manifestMountPaths: new Set(), archiveIndexes: { rho: [], rho5: [] },
  });
}

async function outcome(operation: () => Promise<unknown>): Promise<unknown> {
  try { return { value: await operation() }; }
  catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

test("项目、数字、布尔与装饰属性解析保持发行版边界", () => {
  const root = x1(utf16(`<?xml version="1.0"?><itemtable>
    <kart id="10" name="KartA" kartType="2" engineGrade="8" uniqueLevel="5" enchant="true"/>
    <character id="11" name="Dao" uniform="3" goggleType=" b "/>
    <plate id="12" name="PlateA" fontName="Bold"/>
    <balloon id="13" name="BalloonA" pos="1 2 3" wireLengthLimit="3.5" floatingForce="2" trans="0.5"/>
    <flyingPet id="14" name="PetA" tuneGroupId="123"/>
    <unknown id="15" name="Ignored"/>
  </itemtable>`)).root;
  assert.deepEqual(parseItemDefinitions(root.children),
    withoutTrans(releaseParseDefinitions(root.children)));
  for (const xml of [
    `<kart id="1" name="A" engineGrade="-1"/>`,
    `<kart id="1" name="A" enchant="maybe"/>`,
    `<balloon id="1" name="A" pos="1 2"/>`,
    `<balloon id="1" name="A" floatingForce="Infinity"/>`,
    `<kart id="9007199254740992" name="A"/>`,
  ]) {
    const nodes = x1(utf16(`<itemtable>${xml}</itemtable>`)).root.children;
    const capture = (operation: () => unknown) => {
      try { return { value: operation() }; }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
    };
    assert.deepEqual(capture(() => parseItemDefinitions(nodes)),
      capture(() => withoutTrans(releaseParseDefinitions(nodes))));
  }
});

test("护目镜的 trans 是道具赛的乌云减弱，不当作模型透明度", () => {
  // 167 天使宝宝护目镜 / 163 独眼怪护目镜 carry trans 0.7 in itemTable@cn.
  const root = x1(utf16(`<itemtable>
    <goggle id="167" name="성스러운빛고글" trans="0.7"/>
    <goggle id="163" name="리온고글" trans="0.7"/>
  </itemtable>`)).root;
  assert.deepEqual(releaseParseDefinitions(root.children).map(item => item.decorationTrans),
    [0.7, 0.7]);
  for (const item of parseItemDefinitions(root.children))
    assert.equal("decorationTrans" in item, false, `${item.internalId} 不应带 decorationTrans`);
});

test("真实 p3553 ItemTable 叠加 @cn 后只有 CN 覆盖的行与发行版不同，并扩展小屋装备身份", async () => {
  const index = JSON.parse(inflateSync(readFileSync(path.resolve(project,
    "../mirror/__p3553/archive-index"))).toString("utf8"), (_key, value: unknown) => {
    if (value && typeof value === "object" && "$u8" in value && typeof value.$u8 === "string")
      return Uint8Array.from(Buffer.from(value.$u8, "base64"));
    return value;
  }) as { rho5: Rho5ArchiveIndex[] };
  const dataPack = index.rho5.find(group => group.name.toLowerCase() === "datapack1");
  assert.ok(dataPack);
  const sources: ArchiveSource[] = dataPack.parts.map(part => {
    const bytes = readFileSync(path.resolve(project, "../mirror/p3553", part.name));
    const copy = (chunk: Uint8Array): ArrayBuffer => Uint8Array.from(chunk).buffer as ArrayBuffer;
    return {
      name: part.name, size: bytes.length,
      arrayBuffer: async () => copy(bytes),
      slice: (start = 0, end = bytes.length) => ({
        arrayBuffer: async () => copy(bytes.subarray(start, end)),
      }),
    };
  });
  const reader = new Rho5Reader(dataPack, sources);
  const localized = await reader.read("etc_/itemTable@cn.xml");
  const files = [
    file("etc_/itemTable.kml", await reader.read("etc_/itemTable.kml")),
    file("etc_/itemTable@cn.xml", localized),
    // 64 贺岁版雯雯 has its own CN model; 71 homrunDao_cn has none (textures only).
    file("character_/innerWearWonwon_Red/model.1s", new Uint8Array()),
  ];
  const original = setup(ReleaseLibrary, files);
  const authored = setup(AuthoredLibrary, files);
  const expected = await original.itemTableGarageDefinitions();
  const actual = await authored.itemTableGarageDefinitions();
  const originalKinds = new Set(expected.map(item => item.kind));
  const overlaid = new Set(x1(localized).root.children.map(node => `${node.name}:${Number(j0(node, "id"))}`));
  const kept = actual.filter(item => originalKinds.has(item.kind));
  const baseline = withoutTrans(expected);
  assert.equal(kept.length, baseline.length);
  kept.forEach((item, index) => {
    if (!overlaid.has(`${item.kind}:${item.itemId}`)) assert.deepEqual(item, baseline[index]);
    else assert.deepEqual([item.kind, item.itemId], [baseline[index]!.kind, baseline[index]!.itemId]);
  });
  const kart = (id: number) => kept.find(item => item.kind === "kart" && item.itemId === id)!;
  const character = (id: number) => kept.find(item => item.kind === "character" && item.itemId === id)!;
  // CN 580 暴走飓风Z7+ / 579 飓风 Z7+ are the zeno family, not the base rows' scooter3 / iron.
  assert.equal(expected.find(item => item.kind === "kart" && item.itemId === 580)!.internalId, "scooter3");
  assert.deepEqual([kart(580).internalId, kart(580).orgColorId, kart(580).engineGrade, kart(580).enchant,
    kart(580).uniqueLevel, kart(580).vehicleRarityLevel], ["zeno5", 8, 3, true, 2, 2]);
  assert.equal(kart(579).internalId, "zeno4");
  assert.deepEqual([kart(588).internalId, kart(588).kartType], ["snake1", 2]);
  assert.equal(kart(583).textureKey, "1_cn");
  assert.equal(character(64).internalId, "innerWearWonwon_Red");
  assert.equal(character(71).internalId, "homrunDao");
  for (const kind of ["pet", "uniform", "decal", "ridColor", "slotBg",
    "headPhone", "rpLucciBonus", "goItemSkinCard", "tachometer"]) {
    assert.ok(actual.some(item => item.kind === kind), `缺少 ${kind} 原版道具身份`);
  }
  assert.ok(actual.length > 1_000);
  assert.deepEqual(await authored.itemTableGarageDefinitions(), actual);
});

test("@cn 覆盖按 (标签, id) 逐属性生效，keepName 可拒绝换目录", () => {
  const base = x1(utf16(`<itemtable>
    <kart id="580" name="scooter3" orgColorId="1" kartType="2" engineGrade="4"/>
    <kart id="32" name="KartB" kartType="2"/>
    <character id="71" name="homrunDao" orgColorId="7"/>
    <balloon id="580" name="BalloonA"/>
  </itemtable>`)).root.children;
  const overlay = x1(utf16(`<itemtable>
    <kart id="580" name="zeno5" orgColorId="8" engineGrade="3" uniqueLevel="2"/>
    <kart id="32" iceBanana="100"/>
    <character id="71" name="homrunDao_cn"/>
  </itemtable>`)).root.children;
  const merged = parseItemDefinitions(overlayItemTable(base, overlay, (tag) => tag !== "character"));
  assert.deepEqual(merged.map(item => [item.kind, item.itemId, item.internalId, item.orgColorId,
    item.engineGrade, item.vehicleRarityLevel]), [
    ["kart", 580, "zeno5", 8, 3, 2],
    ["kart", 32, "KartB", 0, 0, undefined],
    ["character", 71, "homrunDao", undefined, undefined, undefined],
    ["balloon", 580, "BalloonA", undefined, undefined, undefined],
  ]);
  assert.throws(() => overlayItemTable(base, x1(utf16(`<itemtable>
    <kart id="580" uniqueLevel="2"/><kart id="580" uniqueLevel="3"/></itemtable>`)).root.children),
  /itemTable@cn kart id=580 存在冲突 uniqueLevel/);
});

test("小屋其他装备类别保留原版 ItemTable 的类别与物品 ID", () => {
  const root = x1(utf16(`<itemtable>
    <pet id="21" name="cat3"/><uniform id="18" name="panda"/>
    <decal id="20" name="blaze"/><ridColor id="31" name="red"/>
    <slotBg id="71" name="vip"/><headPhone id="12" name="headCamera01"/>
    <rpLucciBonus id="32" name="rp_bc"/>
    <goItemSkinCard id="58" name="snowman"/>
    <tachometer id="61" name="taxi"/>
  </itemtable>`)).root;
  assert.deepEqual(parseItemDefinitions(root.children).map(item =>
    [item.kind, item.itemId, item.internalId]), [
    ["pet", 21, "cat3"], ["uniform", 18, "panda"],
    ["decal", 20, "blaze"], ["ridColor", 31, "red"],
    ["slotBg", 71, "vip"], ["headPhone", 12, "headCamera01"],
    ["rpLucciBonus", 32, "rp_bc"],
    ["goItemSkinCard", 58, "snowman"],
    ["tachometer", 61, "taxi"],
  ]);
});

test("系统练习车与必需文件校验保持发行版行为", async () => {
  const itemTable = file("etc_/itemTable.kml", utf16("<itemtable/>"));
  const config = file("zeta_/cn/content/config.xml", utf16(
    '<config><content name="practiceKart" kartName="practice8"/></config>'));
  const bag = file("etc_/baseStringBag.xml", utf16(
    '<stringbag><k n="practiceKart"><m c="cn" v="练习用卡丁车"/></k></stringbag>'));
  const empty = new Uint8Array();
  const practiceX = ["model.1s", "param.xml", "f00.1s", "f01.1s", "f02.1s",
    "f03.1s", "f04.1s", "f05.1s", "f06.1s"]
    .map(name => file(`kart_/practiceX/${name}`, empty));
  for (const files of [[itemTable], [itemTable, config],
    [itemTable, config, bag], [itemTable, config, bag, ...practiceX]]) {
    const original = setup(ReleaseLibrary, files);
    const authored = setup(AuthoredLibrary, files);
    assert.deepEqual(await outcome(() => authored.itemTableGarageDefinitions()),
      await outcome(async () => withoutTrans(await original.itemTableGarageDefinitions())));
  }
});
