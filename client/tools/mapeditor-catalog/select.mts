/**
 * 地图工坊素材目录 · 第一步：从全部官方赛道里挑出素材栏要用的物件、路面、
 * 护栏、地面贴图和天空，按类型和主题分好，写成待渲染清单。
 *
 *   node --import ./src/physics/node-raw-test-hook.mjs --import tsx \
 *     tools/mapeditor-catalog/select.mts <输出 candidates.json>
 *
 * 官方物件的名字大多是 3ds Max 的缺省名（Object03、Box12），分类靠贴图名
 * 里的关键词；同一种东西在不同赛道里会重复出现很多次（一套贴图 = 一种
 * 物件），按贴图组合去重，出现次数多的排前面。渲染缩略图见 render.ts。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  listPieces, listSourceTracks, listSurfaceTextures, loadSourceModel, sourceTrackPath,
  type PieceInfo, type SourceTrack,
} from "../../src/mapeditor/source-tracks";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("用法：select.mts <candidates.json>");

const { loadResourceLibrary } = await import("../economy-export/resource-library.mjs");
const { library, formats } = await loadResourceLibrary(root, "p3553", root);

// ---------------------------------------------------------------------------
// 分类

export type Category =
  | "building" | "tree" | "flower" | "rock" | "fence" | "light" | "sign" | "ad"
  | "booster" | "vehicle" | "creature" | "decor";

/** 每个主题每类最多几种，以及尺寸范围（米，取最长边）。 */
const LIMITS: Record<Category, { perTheme: number; min: number; max: number }> = {
  building: { perTheme: 10, min: 3, max: 160 },
  tree: { perTheme: 6, min: 1.5, max: 70 },
  flower: { perTheme: 4, min: 0.6, max: 20 },
  rock: { perTheme: 5, min: 2, max: 160 },
  fence: { perTheme: 5, min: 1.5, max: 90 },
  light: { perTheme: 4, min: 2, max: 40 },
  sign: { perTheme: 5, min: 1, max: 50 },
  ad: { perTheme: 4, min: 2, max: 70 },
  booster: { perTheme: 3, min: 3, max: 80 },
  vehicle: { perTheme: 3, min: 2, max: 90 },
  creature: { perTheme: 4, min: 1, max: 40 },
  decor: { perTheme: 8, min: 1, max: 60 },
};

/** 只是影子、透明板、远景、天空之类的贴图，不算物件的“外观”。 */
const IGNORED_TEXTURE = /^(transparency|shadow|waterdrop|twinkle)$|shadow|그림자|^q반짝/i;
const BACKGROUND = /(^|_)(far|back|bg|background|sky|skybox|cloud|horizon)(_|$|\d)|원경|배경|하늘/i;

const RULES: Array<[Category, (text: string, piece: PieceInfo) => boolean]> = [
  ["booster", (t, p) => p.drivable && /부스터|booster|bst|점프|jump/i.test(t)],
  ["tree", t => /tree|leaf|pine|palm|bamboo|sonamoo|나무|bush|cactus|선인장|야자/i.test(t) && !/tilegrass|treewood_floor/i.test(t)],
  ["flower", (t, p) => /flower|tulip|plant|weed|꽃|grass_set|f_grass|hene_grass|sea_weed|coral|풀/i.test(t) && size(p) < 20],
  ["light", t => /lamp|가로등|lantern|hongdeng|횃불|횟불|torch|streetlamp|garolight|_light_t|ct_light|t_light|v_light|f_light|elf_light|등불|촛불|candle/i.test(t)],
  ["ad", t => /ad_board|ad_fence|ad_start|(^|\s)ad(\s|$)|banner|billboard|neon|광고|전광판/i.test(t)],
  ["sign", t => /sign|arrow|direct|flag|방향|표지|이정표/i.test(t)],
  ["fence", t => /fence|rail|handrail|barrier|guard|펜스|울타리|road_block|wall|irongate|난간/i.test(t)],
  ["building", t => /house|build|billding|buil|castle|tower|tent|roof|집|건물|건축|church|temple|parthenon|stadium|station|busstop|_bd\d|pagoda|gate|무덤|성문|탑|windmill|풍차|bridge|다리/i.test(t)],
  ["rock", t => /ston|stone|rock|cliff|precipice|mountain|바위|glacial|돌/i.test(t)],
  ["vehicle", t => /train|car_|_car|(^|_)car\d|bus|ship|boat|submarine|airship|balloon|우주선|rocket|기차|배$/i.test(t)],
  ["creature", t => /penguin|펭귄|bird|fish|해골|박쥐|유령|audience|ppl|dino|animal|monster|dragon|(^|_)bat_|곰|토끼|사람|관객/i.test(t)],
  ["decor", () => true],
];

function size(piece: { min: number[]; max: number[] }): number {
  return Math.max(...piece.max.map((v, i) => v - piece.min[i]!));
}

/** 贴图名里的关键词 → 中文名（素材栏上显示）。先匹配的优先。 */
const NAMES: Array<[RegExp, string]> = [
  [/부스터|booster|bst/i, "加速板"], [/점프|jump/i, "跳台"],
  [/palm|야자/i, "椰子树"], [/pine/i, "松树"], [/bamboo/i, "竹子"], [/cactus|선인장/i, "仙人掌"],
  [/ice_tree|snow.*tree|tree.*snow/i, "雪松"], [/sonamoo/i, "松树"], [/bush/i, "灌木"], [/tree|leaf|나무/i, "树"],
  [/tulip/i, "郁金香"], [/flower|꽃/i, "花丛"], [/coral/i, "珊瑚"], [/sea_weed|weed/i, "水草"], [/grass|풀/i, "草丛"], [/plant/i, "植物"],
  [/streetlamp|garolight|가로등/i, "路灯"], [/hongdeng|lantern|등불/i, "灯笼"], [/torch|횃불|횟불/i, "火把"], [/candle|촛불/i, "蜡烛"],
  [/lamp|light/i, "灯"],
  [/neon/i, "霓虹灯牌"], [/ad_start/i, "起点广告"], [/ad_fence/i, "广告围栏"], [/ad_board|billboard|광고|전광판/i, "广告牌"], [/banner/i, "横幅"],
  [/flag/i, "旗子"], [/arrow|direct|방향/i, "方向牌"], [/sign|표지|이정표/i, "标志牌"],
  [/handrail|난간/i, "扶手"], [/irongate/i, "铁门"], [/road_block/i, "路障"], [/barrier|guard/i, "护栏"], [/fence|펜스|울타리/i, "栅栏"],
  [/rail/i, "栏杆"], [/wall/i, "墙"],
  [/castle|성/i, "城堡"], [/tower|탑/i, "塔"], [/tent/i, "帐篷"], [/church/i, "教堂"], [/temple|parthenon/i, "神殿"],
  [/stadium/i, "看台"], [/busstop/i, "公交站"], [/station/i, "车站"], [/pagoda/i, "宝塔"], [/windmill|풍차/i, "风车"],
  [/bridge|다리/i, "桥"], [/gate|성문/i, "大门"], [/무덤|tomb/i, "墓碑"], [/roof/i, "屋顶"], [/house|집/i, "房子"],
  [/build|billding|buil|건물|_bd\d/i, "楼房"],
  [/cliff|precipice/i, "山崖"], [/mountain|glacial/i, "山"], [/rock|바위/i, "岩石"], [/ston|돌/i, "石头"],
  [/train|기차/i, "火车"], [/bus/i, "巴士"], [/car/i, "汽车"], [/submarine/i, "潜艇"], [/airship/i, "飞艇"], [/balloon/i, "气球"],
  [/ship|boat|배$/i, "船"], [/rocket|우주선/i, "飞船"],
  [/penguin|펭귄/i, "企鹅"], [/bird/i, "鸟"], [/fish/i, "鱼"], [/해골/i, "骷髅"], [/박쥐|(^|_)bat_/i, "蝙蝠"], [/유령/i, "幽灵"],
  [/audience|관객|ppl|사람/i, "观众"], [/dino/i, "恐龙"], [/dragon/i, "龙"], [/monster/i, "怪物"], [/곰/i, "熊"], [/토끼/i, "兔子"],
  [/barrel|drum/i, "油桶"], [/box|상자/i, "箱子"], [/wood/i, "木头"], [/pipe/i, "管道"], [/fan/i, "风扇"], [/machin/i, "机器"],
  [/container/i, "集装箱"], [/chain/i, "铁链"], [/fire/i, "火焰"], [/water|fountion|fountain/i, "喷泉"], [/jewel/i, "宝石"],
  [/statue|동상/i, "雕像"], [/bench/i, "长椅"], [/umbrella|parasol/i, "遮阳伞"], [/garbage|fireplug/i, "垃圾桶"],
  [/smoke|연기/i, "烟"], [/crystal/i, "水晶"], [/skull/i, "骷髅"], [/cone/i, "路锥"], [/tire/i, "轮胎"],
];

const CATEGORY_TITLES: Record<Category, string> = {
  building: "建筑", tree: "树", flower: "花草", rock: "石头", fence: "围栏", light: "灯", sign: "标志牌",
  ad: "广告牌", booster: "机关", vehicle: "交通工具", creature: "动物", decor: "装饰",
};

function nameOf(category: Category, text: string): string {
  for (const [pattern, name] of NAMES) if (pattern.test(text)) return name;
  return CATEGORY_TITLES[category];
}

// ---------------------------------------------------------------------------
// 扫描

interface Candidate {
  category: Category;
  theme: string;
  track: string;
  path: number[];
  label: string;
  min: number[];
  max: number[];
  origin: number[];
  triangles: number;
  /** 同一套贴图（同一种物件）在全部赛道里出现的次数。 */
  uses: number;
  key: string;
}

interface SurfaceCandidate {
  kind: "surface" | "wall" | "ground";
  theme: string;
  track: string;
  name: string;
  road?: [string, string][];
  alpha?: "test" | "blend";
  triangles: number;
  uses: number;
}

const tracks: SourceTrack[] = await listSourceTracks(library);
const groups = new Map<string, Candidate[]>();
const surfaces = new Map<string, SurfaceCandidate>();
const skies: Array<{ theme: string; track: string; title: string; size: number; uses: number }> = [];
const skySeen = new Map<string, (typeof skies)[number]>();

const round = (v: number) => Math.round(v * 100) / 100;

let done = 0;
for (const track of tracks) {
  done++;
  if (done % 40 === 0) console.error(`扫描赛道 ${done}/${tracks.length}`);
  let model: any;
  try { model = await loadSourceModel(library, formats, track.folder); } catch { continue; }
  // 天空：同一主题里同一个 skydome 文件只算一次（记下几条赛道在用），挑有中文名的赛道；不同主题
  // 共用的天空各自都留，否则城镇高速公路的晴天会被算到别的主题去
  const sky = library.findSibling(sourceTrackPath(track.folder), ["skydome.1s"]);
  if (sky && track.metadata?.cnTitle) {
    const bytes = await sky.bytes();
    let hash = 0;
    for (let i = 0; i < bytes.length; i += 7) hash = (hash * 31 + bytes[i]!) | 0;
    const key = `${track.theme}:${bytes.length}:${hash}`;
    const seen = skySeen.get(key);
    if (seen) seen.uses++;
    else {
      const entry = { theme: track.theme, track: track.folder, title: track.title, size: bytes.length, uses: 1 };
      skySeen.set(key, entry);
      skies.push(entry);
    }
  }
  for (const piece of listPieces(model)) {
    if (piece.reset || piece.triangles < 6) continue;
    const textures = piece.textures.filter(name => !IGNORED_TEXTURE.test(name));
    if (!textures.length || textures.length > 6) continue;
    const text = `${piece.name} ${textures.join(" ")}`;
    if (BACKGROUND.test(text)) continue;
    const category = RULES.find(([, test]) => test(text, piece))![0];
    if (piece.drivable && category !== "booster") continue;
    const length = size(piece);
    const limit = LIMITS[category];
    if (length < limit.min || length > limit.max) continue;
    if (piece.max[2]! - piece.min[2]! < 0.3 && category !== "booster") continue;
    const key = `${category}|${[...textures].sort().join("|")}`;
    const candidate: Candidate = {
      category, theme: track.theme, track: track.folder, path: piece.path, label: nameOf(category, text),
      min: piece.min.map(round), max: piece.max.map(round), origin: piece.origin.map(round), triangles: piece.triangles,
      uses: 1, key,
    };
    const list = groups.get(key);
    if (list) list.push(candidate); else groups.set(key, [candidate]);
  }
  for (const texture of listSurfaceTextures(model)) {
    const name = texture.name;
    if (IGNORED_TEXTURE.test(name) || BACKGROUND.test(name)) continue;
    let kind: SurfaceCandidate["kind"] | undefined;
    // 带 road 属性的不一定是路面（护栏、广告牌也能撞），按名字再挑一遍
    // 路面只要普通路面（可以带原版的声音、尘土），减速草地、加速充能、重置这类 surface 属性不要
    if (texture.road && !texture.road.some(([key]) => key === "surface" || key === "movable") && !texture.alpha &&
      /road|cement|asphalt|street|ston|brick|plank|wood|sand|snow|ice|soil|dirt|tile|floor|step|bridge|path|grass|mud|metal|steel|iron|길|바닥/i.test(name) &&
      !/fence|ad_|sign|start|stick|wall|side|board|rail|arrow|direct|light|lamp|tree|leaf|flag|line|goal|finish/i.test(name)) kind = "surface";
    else if (!texture.road && /fence|rail|handrail|guard|barrier|펜스|난간/i.test(name) && !/^ad_/i.test(name)) kind = "wall";
    else if (!texture.road && /grass|sand|snow|soil|ground|dirt|tile|desert|ice_p|field|lawn|bottom|floor|흙|잔디|땅/i.test(name) &&
      !/penguin|snowman|egg|구멍|굴/i.test(name) && !texture.alpha) kind = "ground";
    if (!kind) continue;
    // 加速带、跳台这类有特殊效果的路面不能当整条路的路面
    if (kind === "surface" && /부스터|점프|booster|jump/i.test(name + JSON.stringify(texture.road))) continue;
    const key = `${kind}|${name}|${JSON.stringify(texture.road ?? null)}`;
    const found = surfaces.get(key);
    if (found) { found.uses++; found.triangles += texture.triangles; continue; }
    surfaces.set(key, { kind, theme: track.theme, track: track.folder, name, road: texture.road, alpha: texture.alpha, triangles: texture.triangles, uses: 1 });
  }
}

// ---------------------------------------------------------------------------
// 挑选：每种物件（一套贴图）取最常见的那个变体，记到出现最多的主题下

const picked: Candidate[] = [];
const byThemeCategory = new Map<string, Candidate[]>();
for (const list of groups.values()) {
  const variants = new Map<string, Candidate[]>();
  for (const candidate of list) {
    const shape = `${candidate.triangles}|${candidate.max.map((v, i) => Math.round(v - candidate.min[i]!)).join(",")}`;
    const bucket = variants.get(shape);
    if (bucket) bucket.push(candidate); else variants.set(shape, [candidate]);
  }
  const best = [...variants.values()].sort((a, b) => b.length - a.length)[0]!;
  const themeCount = new Map<string, number>();
  for (const candidate of list) themeCount.set(candidate.theme, (themeCount.get(candidate.theme) ?? 0) + 1);
  const theme = [...themeCount].sort((a, b) => b[1] - a[1])[0]![0];
  const representative = best.find(candidate => candidate.theme === theme) ?? best[0]!;
  representative.uses = list.length;
  const key = `${theme}|${representative.category}`;
  const bucket = byThemeCategory.get(key);
  const entry = { ...representative, theme };
  if (bucket) bucket.push(entry); else byThemeCategory.set(key, [entry]);
}
for (const [key, list] of byThemeCategory) {
  const category = key.split("|")[1] as Category;
  list.sort((a, b) => b.uses - a.uses || b.triangles - a.triangles);
  picked.push(...list.slice(0, LIMITS[category].perTheme));
}

const SURFACE_LIMITS = { surface: 5, wall: 3, ground: 4 };
const pickedSurfaces: SurfaceCandidate[] = [];
const surfaceBuckets = new Map<string, SurfaceCandidate[]>();
for (const surface of surfaces.values()) {
  const key = `${surface.theme}|${surface.kind}`;
  const bucket = surfaceBuckets.get(key);
  if (bucket) bucket.push(surface); else surfaceBuckets.set(key, [surface]);
}
for (const [key, list] of surfaceBuckets) {
  const kind = key.split("|")[1] as SurfaceCandidate["kind"];
  // 同名贴图（不同路面属性）只留用得最多的那个
  const byName = new Map<string, SurfaceCandidate>();
  for (const surface of list.sort((a, b) => b.triangles - a.triangles)) if (!byName.has(surface.name)) byName.set(surface.name, surface);
  // 路面按铺过的面积（三角形数）排，有原版路面声音/尘土属性的优先；其余按用到的赛道数
  const score = (surface: SurfaceCandidate) => kind === "surface"
    ? surface.triangles * (surface.road?.length ? 2 : 1) : surface.uses * 1000 + surface.triangles / 100;
  pickedSurfaces.push(...[...byName.values()].sort((a, b) => score(b) - score(a)).slice(0, SURFACE_LIMITS[kind]));
}

// 每个主题留用得最多的 3 种天空（主题套装取第一种，就是这个主题最典型的天空）
const skyPicks: typeof skies = [];
const skyCount = new Map<string, number>();
for (const sky of [...skies].sort((a, b) => b.uses - a.uses)) {
  const count = skyCount.get(sky.theme) ?? 0;
  if (count >= 3) continue;
  skyCount.set(sky.theme, count + 1);
  skyPicks.push(sky);
}

const counts: Record<string, number> = {};
for (const candidate of picked) counts[candidate.category] = (counts[candidate.category] ?? 0) + 1;
for (const surface of pickedSurfaces) counts[surface.kind] = (counts[surface.kind] ?? 0) + 1;
console.error("挑出", picked.length, "个物件，", pickedSurfaces.length, "张贴图，", skyPicks.length, "个天空", counts);

writeFileSync(output, JSON.stringify({
  pieces: picked.map(({ key: _key, ...rest }) => rest),
  surfaces: pickedSurfaces,
  skies: skyPicks,
}));
