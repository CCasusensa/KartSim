// 卡丁城（开放世界城市地图）v2 的权威数据。
//
// 坐标系与游戏世界一致：x 向东，z 向南（three.js 的 +z），y 向上；单位为世界米。
// 原点是中央广场的中心。地图范围 x、z ∈ [-1200, 1200]，即 2.4 km × 2.4 km。
//
// v2 的思路：城区直接搬用官方赛道（整条赛道连同路面碰撞、房屋、围栏、动画一起
// 摆进来），中间用官方贴图与道具铺设连接道路——摆放排布因此与原版地图一致。
// 每个城区给出它用的赛道、赛道路面范围（赛道自己的坐标：x 向东、y 向北）、摆放
// 中心与入口；建城脚本据此放置、裁开入口围栏，并把赛道路线导出为 city-map.json
// 的 district 道路（最近道路复位与小地图用）。

/** 道路等级：宽度（米）与渲染样式。 */
export const ROAD_TYPES = {
  expressway: { label: "环城高速", width: 18, lanes: 4, speed: "最高速", color: "#4b5563" },
  avenue:     { label: "主干道",   width: 14, lanes: 4, speed: "高速",   color: "#6b7280" },
  street:     { label: "街区道路", width: 12, lanes: 2, speed: "中速",   color: "#9ca3af" },
  district:   { label: "城区赛道", width: 20, lanes: 2, speed: "赛道",   color: "#7c3aed" },
};

/** 圆角矩形的折线（顺时针，从北边中点开始），用于环线。 */
export function roundedRect(half, radius, segments = 8) {
  const pts = [];
  const corner = (cx, cz, startDeg) => {
    for (let i = 0; i <= segments; i++) {
      const a = ((startDeg + (90 * i) / segments) * Math.PI) / 180;
      pts.push([round(cx + radius * Math.cos(a)), round(cz + radius * Math.sin(a))]);
    }
  };
  pts.push([0, -half]);
  corner(half - radius, -half + radius, -90);   // 东北角
  corner(half - radius, half - radius, 0);      // 东南角
  corner(-half + radius, half - radius, 90);    // 西南角
  corner(-half + radius, -half + radius, 180);  // 西北角
  pts.push([0, -half]);
  return pts;
}
const round = v => Math.round(v * 10) / 10;

/**
 * 城区：整条官方赛道。extents 是赛道路面在它自己坐标里的范围（x 向东、y 向北，
 * 由 tools/city/track-topdown.mjs 量得），center 是路面范围中心要摆到的设计坐标；
 * entrances 是连接道路接入处，local 为赛道坐标、facing 为连接道路来的方向。
 */
export const DISTRICTS = [
  { id: "plaza", name: "中央广场", theme: "village", track: "village_B04", color: "#fde68a",
    // The stadium: a flat rim (z 30.2) at street level around a slope down
    // into the fenced flag field (z 27), the stands beyond the rim. Streets
    // arrive on the rim through the stands (reach) and the corridors run on
    // down to the field so its fence opens too (corridorInward).
    extents: { min: [129, 148], max: [509, 458] }, center: [0, 0], yaw: 0,
    reach: 110, corridorInward: 90,
    // The arena's floating coins and the lucci start board are not collectable here.
    drop: "coin|lucci",
    entrances: [
      { id: "plaza-n", local: [319, 458], facing: "n", width: 14 },
      { id: "plaza-s", local: [319, 148], facing: "s", width: 14 },
      { id: "plaza-w", local: [129, 303], facing: "w", width: 14 },
      { id: "plaza-e", local: [509, 303], facing: "e", width: 14 },
    ],
    desc: "城镇旗帜竞技场（体育场）：四条主干道穿过看台汇合到环形平台，中间是下沉的旗帜场地，是进城出生点与聊天热区。" },
  { id: "oldtown", name: "城镇老街", theme: "village", track: "village_I02", color: "#fecaca",
    extents: { min: [5, 12], max: [561, 551] }, center: [-620, -560], yaw: 0,
    entrances: [{ id: "oldtown-e", local: [555, 250], facing: "e", width: 12 }],
    desc: "城镇运河街区：房屋、石桥与运河，赛道一圈约 2 km。" },
  { id: "homes", name: "小屋街", theme: "village", track: "village_I04", color: "#fed7aa",
    extents: { min: [68, 31], max: [833, 739] }, center: [600, -600], yaw: 0,
    entrances: [{ id: "homes-s", local: [400, 40], facing: "s", width: 12 }],
    desc: "城镇居民区：公交站、木箱与小屋，赛道一圈约 1.6 km。" },
  { id: "forest", name: "森林公园", theme: "forest", track: "forest_I01", color: "#bbf7d0",
    extents: { min: [66, 35], max: [879, 778] }, center: [-600, 580], yaw: 0,
    entrances: [{ id: "forest-n", local: [505.6, 672], facing: "n", width: 12 }],
    desc: "森林山路：木隧道、悬崖与松林，赛道一圈约 2 km。" },
  { id: "funpark", name: "冰雪游乐园", theme: "ice", track: "ice_I02", color: "#e0f2fe",
    extents: { min: [103, 97], max: [864, 859] }, center: [620, 600], yaw: 0,
    entrances: [{ id: "funpark-s", local: [535, 100], facing: "s", width: 12 }],
    desc: "冰川与雪道：冰面广场与雪山盘道，赛道一圈约 1.9 km。" },
];

/** 一个城区的入口在设计坐标里的位置（center + 赛道坐标相对路面范围中心的偏移，y 轴翻转为 z）。 */
export function entranceAt(district, entrance) {
  const { min, max } = district.extents;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  return [round(district.center[0] + (entrance.local[0] - cx)), round(district.center[1] - (entrance.local[1] - cy))];
}

/**
 * 入口所在的路面范围边缘再往里 8 m（设计坐标）：道路围栏在这里留口；连接道路本身一直
 * 铺到入口点（城区赛道边缘），走廊里的东西由建城脚本清掉。
 */
export function gateAt(district, entrance) {
  const [x, z] = entranceAt(district, entrance);
  const { min, max } = district.extents;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const inset = 8;
  switch (entrance.facing) {
    case "e": return [round(district.center[0] + (max[0] - cx) - inset), z];
    case "w": return [round(district.center[0] + (min[0] - cx) + inset), z];
    case "n": return [x, round(district.center[1] - (max[1] - cy) + inset)];
    default: return [x, round(district.center[1] - (min[1] - cy) - inset)];
  }
}

/** 城区路面范围在设计坐标里的矩形（顺时针）。 */
export function districtPolygon(district) {
  const { min, max } = district.extents;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const [x0, x1] = [district.center[0] + (min[0] - cx), district.center[0] + (max[0] - cx)];
  const [z0, z1] = [district.center[1] - (max[1] - cy), district.center[1] - (min[1] - cy)];
  return [[round(x0), round(z0)], [round(x1), round(z0)], [round(x1), round(z1)], [round(x0), round(z1)]];
}

const D = Object.fromEntries(DISTRICTS.map(d => [d.id, d]));
const E = (districtId, entranceId) => entranceAt(D[districtId], D[districtId].entrances.find(e => e.id === entranceId));

/**
 * 道路：id、名称、等级、折线坐标 [x, z]（可选第三个分量 y 为高程，米），
 * closed 表示闭合环线。城区赛道的路线由建城脚本生成，不写在这里。
 */
export const ROADS = [
  { id: "ring", name: "环城高速", type: "expressway", closed: true,
    points: roundedRect(1120, 250, 10),
    note: "一圈约 8.3 km 的闭合环线，也是整张地图的路线图主环（复位与路线进度都依赖它）。" },
  { id: "ave-n", name: "中央大道（北）", type: "avenue", points: [[0, -1120], E("plaza", "plaza-n")], note: "环城高速北端到中央广场。" },
  { id: "ave-s", name: "中央大道（南）", type: "avenue", points: [E("plaza", "plaza-s"), [0, 1120]] },
  { id: "ave-w", name: "东西大道（西）", type: "avenue", points: [[-1120, 0], E("plaza", "plaza-w")] },
  { id: "ave-e", name: "东西大道（东）", type: "avenue", points: [E("plaza", "plaza-e"), [1120, 0]] },
  { id: "st-north", name: "北街", type: "street",
    points: [E("oldtown", "oldtown-e"), [0, E("oldtown", "oldtown-e")[1]]],
    note: "从城镇老街东门到中央大道。" },
  { id: "st-homes", name: "小屋街路", type: "street",
    points: [[E("homes", "homes-s")[0], 0], E("homes", "homes-s")],
    note: "从东西大道北上到小屋街南门。" },
  { id: "st-forest", name: "林荫道", type: "street",
    points: [[E("forest", "forest-n")[0], 0], E("forest", "forest-n")],
    note: "从东西大道南下到森林公园北门。" },
  { id: "st-funpark", name: "游乐园路", type: "street",
    points: [[E("funpark", "funpark-s")[0], 1120], E("funpark", "funpark-s")],
    note: "从环城高速南段北上到冰雪游乐园南门。" },
];

/** 兴趣点：功能点（打开界面/传送）、聊天热区、玩法点、地标、出生点。城区出生点由建城脚本生成。 */
export const POIS = [
  { id: "fountain", name: "广场中心", kind: "social", at: [0, 0], desc: "聊天气泡最密集的地方；全城频道的象征。" },
  { id: "spawn-main", name: "广场出生点", kind: "spawn", at: [0, 30], heading: 0, desc: "进城默认出生点（场地中央偏南）。" },
  { id: "portals", name: "传送门（预留）", kind: "function", at: [0, -35], desc: "竞速 / 道具 / 计时 / 乱斗四座传送门。" },
  { id: "garage", name: "车库（预留）", kind: "function", at: [-60, -30], desc: "开进车库门 = 打开车库界面。" },
  { id: "shop", name: "商城（预留）", kind: "function", at: [60, -30], desc: "开进商城 = 打开商店。" },
  { id: "club", name: "俱乐部会馆（预留）", kind: "function", at: [-60, 30], desc: "俱乐部界面的实体空间。" },
  { id: "quest-npc", name: "每日任务 NPC（预留）", kind: "function", at: [60, 30], desc: "靠近弹出任务窗口。" },
];

export const BOOST_PADS = [];
export const COINS = [];

/** 玩法与社交规则（服务端/客户端共同遵守）。 */
export const RULES = {
  instancePlayers: 60,
  interestRadius: 160,
  chatBubbleRadius: 60,
  chatBubbleSeconds: 6,
  districtChannel: true,
  cityChannel: true,
  afkMinutes: 10,
  resetToRoad: true,
  dayNightMinutes: 48,
};

const lengthOf = (list, closed) => {
  let t = 0;
  for (let i = 1; i < list.length; i++) t += Math.hypot(list[i][0] - list[i - 1][0], list[i][1] - list[i - 1][1]);
  if (closed && list.length > 1) { const a = list[0], b = list[list.length - 1]; t += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return Math.round(t);
};

/**
 * The design as city-map.json carries it (before the builder adds the
 * district routes and spawns): the renderer writes it, the builder starts
 * from it on every run so nothing generated feeds back in.
 */
export function designJson() {
  const numbered = POIS.map((p, i) => ({ ...p, n: i + 1 }));
  return {
    meta: { name: "卡丁城", version: 2, extent: [[-1200, -1200], [1200, 1200]], units: "world meters", origin: "广场中心", axes: "x 东, z 南, y 上" },
    roadTypes: ROAD_TYPES,
    roads: ROADS.map(r => ({ ...r, lengthM: lengthOf(r.points, r.closed) })),
    districts: DISTRICTS.map(d => ({ ...d, polygon: districtPolygon(d), entrances: d.entrances.map(e => ({ ...e, at: entranceAt(d, e), gate: gateAt(d, e) })) })),
    pois: numbered,
    boostPads: BOOST_PADS,
    coins: COINS,
    rules: RULES,
  };
}
