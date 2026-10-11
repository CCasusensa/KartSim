// 卡丁城（开放世界城市地图）的权威数据。
//
// 坐标系与游戏世界一致：x 向东，z 向南（three.js 的 +z），y 向上；单位为世界米
// （与现有赛道的路线长度同一尺度：城镇高速公路一圈约 3455）。原点是中央广场的喷泉。
// 地图范围 x、z ∈ [-1200, 1200]，即 2.4 km × 2.4 km，与现有最大赛道（约 2000 × 2000）同量级。
//
// render-city-map.mjs 把这份数据画成 city-map.svg，并导出 city-map.json 给后续的
// 程序化建城流水线（道路网 → 路面网格与碰撞三角形，街区 → 摆放主题建筑）。

/** 道路等级：宽度（米）、限速提示与渲染样式。 */
export const ROAD_TYPES = {
  expressway: { label: "环城高速", width: 18, lanes: 4, speed: "最高速", color: "#4b5563" },
  avenue:     { label: "主干道",   width: 14, lanes: 4, speed: "高速",   color: "#6b7280" },
  street:     { label: "街区道路", width: 10, lanes: 2, speed: "中速",   color: "#9ca3af" },
  lane:       { label: "小路/林道", width: 7, lanes: 2, speed: "低速",   color: "#b8bec7" },
  circuit:    { label: "赛道环道", width: 12, lanes: 2, speed: "计时",   color: "#7c3aed" },
  tunnel:     { label: "隧道",     width: 12, lanes: 2, speed: "高速",   color: "#374151" },
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
 * 道路：id、名称、等级、折线坐标 [x, z]（可选第三个分量 y 为高程，米），
 * closed 表示闭合环线。玩法说明放在 note。
 */
export const ROADS = [
  { id: "ring", name: "环城高速", type: "expressway", closed: true,
    points: roundedRect(1000, 250, 10),
    note: "一圈约 7.3 km 的闭合环线，同时是整张地图的路线图主环（lap 计数/复位都依赖它）。东南段跨海大桥抬高 20 m。" },
  { id: "loop2", name: "二环路", type: "avenue", closed: true,
    points: roundedRect(500, 120, 6),
    note: "围绕中心区的方形环线，连接八个分区入口。" },
  { id: "ave-ns", name: "中央大道", type: "avenue",
    points: [[0, -1000], [0, -230], [0, 230], [0, 1000]],
    note: "南北主干道，穿过中央广场环岛；在 z≈480 处跨泡泡河（中央大桥）。" },
  { id: "ave-ew", name: "东西大道", type: "avenue",
    points: [[-1000, 0], [-230, 0], [230, 0], [1000, 0]],
    note: "东西主干道；在 x≈-330 处跨河（西桥）。" },
  { id: "plaza-ring", name: "广场环岛", type: "avenue", closed: true,
    points: circle(0, 0, 200, 24),
    note: "中央广场外围的环岛，所有主干道在这里汇合，是最热闹的聊天区。" },
  { id: "diag-ne", name: "霓虹林荫道", type: "avenue",
    points: [[140, -140], [500, -500], [927, -927]],
    note: "从广场斜穿到商业区，再接环城高速东北匝道。" },
  { id: "diag-sw", name: "森林林荫道", type: "avenue",
    points: [[-140, 140], [-500, 500], [-927, 927]],
    note: "从广场斜穿到森林公园，再接环城高速西南匝道；在 (-300, 250) 附近过河（林荫桥）。" },
  { id: "biz-v1", name: "霓虹街", type: "street",
    points: [[750, -1000], [750, -500], [750, 0]] },
  { id: "biz-h1", name: "商城路", type: "street",
    points: [[500, -750], [750, -750], [1000, -750]] },
  { id: "biz-h2", name: "寻宝街", type: "street",
    points: [[500, -250], [750, -250], [1000, -250]] },
  { id: "old-loop", name: "老街环路", type: "street", closed: true,
    points: [[-350, -700], [-200, -850], [100, -900], [300, -750], [250, -600], [0, -650], [-250, -580], [-350, -700]],
    note: "城镇主题的弯弯曲曲老街，车库与改装店在这里。" },
  { id: "old-spur", name: "车库巷", type: "street",
    points: [[0, -500], [0, -650]] },
  { id: "coast", name: "滨海公路", type: "street",
    points: [[1000, -200], [900, 200], [800, 450], [650, 650], [500, 850], [400, 1000]],
    note: "贴着海岸线的观景路，日落时最好看。" },
  { id: "port-spur", name: "码头路", type: "lane",
    points: [[900, 200], [960, 300]] },
  { id: "ind-loop", name: "集装箱环道", type: "street", closed: true,
    points: [[150, 700], [450, 700], [450, 960], [150, 960], [150, 700]],
    note: "工业区的方形环道，中间是漂移练习场和特技跳台。" },
  { id: "ind-spur", name: "工厂路", type: "street",
    points: [[0, 700], [150, 700]] },
  { id: "circuit", name: "赛车公园计时环道", type: "circuit", closed: true,
    points: [[-300, 400], [-150, 450], [-80, 600], [-150, 800], [-350, 900], [-480, 800], [-520, 600], [-450, 450], [-300, 400]],
    note: "城内约 1.6 km 的闭合小环道：城内计时赛与驾照考试的实战场地。" },
  { id: "circuit-spur", name: "考场路", type: "street",
    points: [[-230, 230], [-300, 400]] },
  { id: "forest-loop", name: "湖畔林道", type: "lane", closed: true,
    points: [[-560, 560], [-700, 600], [-850, 700], [-900, 850], [-820, 960], [-650, 980], [-540, 900], [-520, 750], [-560, 560]],
    note: "绕湖一圈的林道，露营地和湖心岛在这里。" },
  { id: "home-h1", name: "小屋北街", type: "street",
    points: [[-950, -100], [-520, -100]] },
  { id: "home-h2", name: "小屋南街", type: "street",
    points: [[-950, 100], [-520, 100]] },
  { id: "home-v1", name: "小屋西巷", type: "lane", points: [[-900, -100], [-900, 100]] },
  { id: "home-v2", name: "小屋中巷", type: "lane", points: [[-700, -100], [-700, 100]] },
  { id: "home-v3", name: "会馆路", type: "street", points: [[-520, -100], [-520, 100]] },
  { id: "park-loop", name: "游乐园环道", type: "street", closed: true,
    points: [[-600, -350], [-900, -350], [-950, -600], [-800, -850], [-600, -800], [-550, -550], [-600, -350]],
    note: "冰雪游乐园：摩天轮、冰雪滑道和跳台。" },
  { id: "park-spur", name: "游乐园路", type: "street", points: [[-500, -350], [-600, -350]] },
  { id: "mountain", name: "盘山公路", type: "lane",
    points: [[-1000, -700, 0], [-1060, -800, 25], [-1130, -900, 55], [-1090, -1010, 85], [-990, -1070, 105], [-1060, -1130, 120], [-1100, -1100, 120]],
    note: "从环城高速西北匝道盘旋上山，终点是 120 m 高的观景台。" },
  { id: "tunnel", name: "穿山隧道", type: "tunnel",
    points: [[-1000, -600, 0], [-900, -700, -12], [-700, -900, -12], [-600, -1000, 0]],
    note: "直穿西北角的地下捷径，内有加速带。" },
];

function circle(cx, cz, r, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([round(cx + r * Math.sin(a)), round(cz - r * Math.cos(a))]);
  }
  return pts;
}

/** 水体：海湾（东南）与泡泡河。 */
export const WATER = {
  sea: { name: "卡丁湾", polygon: [[1300, 120], [1100, 180], [950, 260], [880, 400], [850, 520], [760, 620], [640, 760], [520, 900], [420, 1050], [330, 1300], [1300, 1300]] },
  river: { name: "泡泡河", width: 40,
    points: [[-330, -1200], [-345, -1000], [-360, -900], [-420, -520], [-380, -250], [-330, 0], [-300, 250], [-150, 420], [100, 520], [350, 600], [560, 680], [720, 700]] },
  lake: { name: "森林湖", center: [-720, 830], radius: 90 },
};

/**
 * 分区：polygon 为范围，theme 是复用现有赛道主题素材的来源（track_<theme>_*），
 * buildings 描述程序化摆放建筑的密度。
 */
export const DISTRICTS = [
  { id: "plaza", name: "中央广场", theme: "common", color: "#fde68a", circle: [0, 0, 230],
    desc: "出生点、喷泉、传送门广场、排行榜大屏。所有人在这里见面。", buildings: "none" },
  { id: "oldtown", name: "城镇老街", theme: "village", color: "#fecaca",
    polygon: [[-400, -1000], [400, -1000], [400, -250], [-400, -250]],
    desc: "经典跑跑城镇风格：红屋顶、小广场；车库与改装店所在地。", buildings: "dense-low" },
  { id: "neon", name: "霓虹商业区", theme: "world", color: "#c7d2fe",
    polygon: [[400, -1000], [1000, -1000], [1000, -200], [400, -200]],
    desc: "高楼、霓虹招牌（世界/中国主题的都市素材）；商城与寻宝屋。", buildings: "dense-high" },
  { id: "harbor", name: "滨海港区", theme: "beach", color: "#bae6fd",
    polygon: [[400, -200], [1000, -200], [1000, 120], [880, 400], [760, 620], [520, 900], [420, 1000], [400, 1000]],
    desc: "海滩、码头、灯塔与舞台；日落观景。", buildings: "sparse" },
  { id: "industrial", name: "集装箱工业区", theme: "factory", color: "#e5e7eb",
    polygon: [[0, 560], [420, 560], [420, 1000], [0, 1000]],
    desc: "工厂、起重机、集装箱；漂移练习场与特技跳台。", buildings: "medium" },
  { id: "racepark", name: "赛车公园", theme: "wkc", color: "#ddd6fe",
    polygon: [[-560, 230], [0, 230], [0, 560], [-560, 1000], [-560, 1000]],
    desc: "驾照考场与城内计时环道，看台与维修区。", buildings: "sparse" },
  { id: "forest", name: "森林公园", theme: "forest", color: "#bbf7d0",
    polygon: [[-1000, 230], [-560, 230], [-560, 1000], [-1000, 1000]],
    desc: "林道、森林湖、露营地篝火；最安静的聊天和挂机点。", buildings: "none" },
  { id: "homes", name: "小屋街", theme: "village", color: "#fed7aa",
    polygon: [[-1000, -250], [-400, -250], [-400, 230], [-1000, 230]],
    desc: "一排排玩家小屋（进入即打开自己的小屋）与俱乐部会馆。", buildings: "houses" },
  { id: "funpark", name: "冰雪游乐园", theme: "ice", color: "#e0f2fe",
    polygon: [[-1000, -1000], [-400, -1000], [-400, -250], [-1000, -250]],
    desc: "摩天轮、冰雪滑道、跳台；西北角外是雪山和观景台。", buildings: "attractions" },
  { id: "mountain", name: "雪山", theme: "ice", color: "#f1f5f9",
    polygon: [[-1200, -1200], [-700, -1200], [-1000, -1000], [-1200, -700]],
    desc: "环城高速之外的山地，盘山公路通向 120 m 高的观景台。", buildings: "none" },
];

/**
 * 兴趣点。kind：
 *   function  有交互的功能点（打开现有界面或传送）
 *   social    聊天/挂机热区
 *   fun       玩法点（跳台、加速带、练习场）
 *   landmark  地标（只用于辨认方向）
 *   spawn     出生/复位点（heading 为朝向角度，0 = 北，顺时针）
 */
export const POIS = [
  { id: "fountain", name: "中央喷泉", kind: "social", at: [0, 0], desc: "聊天气泡最密集的地方；全城频道的象征。" },
  { id: "spawn-main", name: "中央停车场（出生点）", kind: "spawn", at: [0, 95], heading: 0, desc: "进城默认出生点，50 个停车位按入场顺序分配。" },
  { id: "portals", name: "传送门广场", kind: "function", at: [0, -150], desc: "四座传送门：竞速 / 道具 / 计时 / 乱斗。开到门里 = 用当前队伍一键开房。" },
  { id: "board", name: "排行榜大屏", kind: "landmark", at: [-120, -60], desc: "显示城内计时环道榜、俱乐部积分榜。" },
  { id: "notice", name: "公告栏", kind: "landmark", at: [120, -60], desc: "管理员公告与系统提醒的实体入口。" },
  { id: "quest-npc", name: "每日任务 NPC", kind: "function", at: [70, 20], desc: "靠近弹出任务窗口（复用任务系统）。" },
  { id: "garage", name: "车库", kind: "function", at: [-100, -620], desc: "开进车库门 = 打开车库界面，出来时换好车。" },
  { id: "tuning", name: "改装店", kind: "function", at: [120, -640], desc: "车辆强化入口。" },
  { id: "shop", name: "商城", kind: "function", at: [760, -560], desc: "开进商城大楼 = 打开商店。" },
  { id: "lottery", name: "寻宝屋 / 精品道具场", kind: "function", at: [850, -700], desc: "复用寻宝与精品道具场。" },
  { id: "club", name: "俱乐部会馆", kind: "function", at: [-640, 0], desc: "俱乐部界面、俱乐部频道聊天的实体空间。" },
  { id: "homes-row", name: "玩家小屋", kind: "function", at: [-760, 0], desc: "小屋街两侧的房子：开到自己门口打开小屋，开到好友门口拜访。" },
  { id: "license", name: "驾照考场", kind: "function", at: [-160, 330], desc: "进入考场 = 驾照考试入口（考试在城内计时环道上举行）。" },
  { id: "circuit-start", name: "计时环道起点", kind: "fun", at: [-300, 400], desc: "压线开始城内计时，一圈约 1.6 km，成绩上排行榜大屏。" },
  { id: "drift-lot", name: "漂移练习场", kind: "fun", at: [300, 830], desc: "集装箱围出的空地，地面有漂移记分圈。" },
  { id: "jump", name: "特技跳台", kind: "fun", at: [400, 900], desc: "三级跳台，腾空时间计入每日任务。" },
  { id: "pier", name: "码头 / 游艇", kind: "social", at: [960, 300], desc: "停车看海的地方。" },
  { id: "stage", name: "海滩舞台", kind: "social", at: [700, 420], desc: "活动舞台：管理员可以在这里放公告/音乐会事件。" },
  { id: "lighthouse", name: "灯塔", kind: "landmark", at: [1000, 80], desc: "跨海大桥北端的地标。" },
  { id: "campfire", name: "露营地篝火", kind: "social", at: [-760, 620], desc: "最安静的聊天点，晚上有篝火光。" },
  { id: "island", name: "湖心岛", kind: "landmark", at: [-720, 830], desc: "只能从西侧木桥上去的小岛，藏有金币。" },
  { id: "ferris", name: "摩天轮", kind: "landmark", at: [-700, -650], desc: "全城最高的建筑之一，远处就能看到。" },
  { id: "ice-slide", name: "冰雪滑道", kind: "fun", at: [-880, -800], desc: "低摩擦的冰面下坡滑道。" },
  { id: "lookout", name: "观景台", kind: "social", at: [-1100, -1100], desc: "盘山公路尽头，俯瞰全城。" },
  { id: "tunnel-w", name: "隧道西口", kind: "landmark", at: [-1000, -600] },
  { id: "tunnel-n", name: "隧道北口", kind: "landmark", at: [-600, -1000] },
  { id: "bridge-sea", name: "跨海大桥", kind: "landmark", at: [820, 820], desc: "环城高速东南段，抬高 20 m 的大桥。" },
  { id: "bridge-center", name: "中央大桥", kind: "landmark", at: [0, 500] },
  { id: "bridge-west", name: "西桥", kind: "landmark", at: [-330, 0] },
  { id: "bridge-forest", name: "林荫桥", kind: "landmark", at: [-300, 300] },
  { id: "gas-e", name: "加油站（氮气补给）", kind: "fun", at: [520, 40] },
  { id: "gas-w", name: "加油站（氮气补给）", kind: "fun", at: [-520, -40] },
  { id: "gas-s", name: "加油站（氮气补给）", kind: "fun", at: [40, 540] },
  { id: "tower", name: "广播塔", kind: "landmark", at: [-200, -980], desc: "全城喇叭消息的象征。" },
  { id: "spawn-homes", name: "小屋街出生点", kind: "spawn", at: [-700, 160], heading: 90 },
  { id: "spawn-garage", name: "老街出生点", kind: "spawn", at: [-40, -560], heading: 180 },
  { id: "spawn-beach", name: "海滩出生点", kind: "spawn", at: [820, 480], heading: 270 },
];

/** 环城高速直道上的加速带（x, z）。 */
export const BOOST_PADS = [
  [400, -1000], [-400, -1000], [400, 1000], [-400, 1000], [1000, 400], [1000, -400], [-1000, 400], [-1000, -400],
  [-800, -800, "隧道内"],
];

/** 50 枚隐藏金币（寻宝）的其中 12 枚示例位置，其余由建城脚本在各分区随机生成。 */
export const COINS = [
  [-720, 830], [-1100, -1090], [960, 310], [410, 910], [-880, -790], [-150, 800], [760, -740], [-250, -840], [-760, 610], [1000, 90], [820, 820], [-800, -800],
];

/** 聊天与同步的设计参数。 */
export const RULES = {
  instancePlayers: 60,        // 一个城市实例的玩家上限（超过另开"线路"）
  interestRadius: 160,        // 只同步这个半径内的其他车（米）
  chatBubbleRadius: 60,       // 气泡聊天可见半径（米）
  chatBubbleSeconds: 6,
  districtChannel: true,      // 每个分区一个频道
  cityChannel: true,          // 全城频道
  afkMinutes: 10,             // 挂机 10 分钟自动停进最近停车位
  resetToRoad: true,          // 掉水/卡住：复位到最近的路线帧
  dayNightMinutes: 48,        // 昼夜循环（可关）
};
