// 喜羊羊三张赛道的配置。赛道表（track@zz）的行、计时赛评级线、7 条
// AI 线都是原版的；中文名原版数据里没有（trackLocale@cn 无这三行），
// 按剧情「皮蛋的青青草原之旅」暂定：
//   xyy_I01 剧情第 1 关「青青草原上的皮蛋」就在这张图 → 青青草原；
//   xyy_R01 剧情里追灰太狼、骗走灰太狼用的是这张 → 狼堡；
//   xyy_R02 走线是一个「羊」字 → 羊村。
//
// 地标坐标是原版坐标（AI 线的坐标系），构建时再加上平移量。
// yaw 省略时朝向最近的路。

/** 路边随机摆放的公告板（theme_xyy 贴图，uv = 图集里的格子）。 */
export const BILLBOARDS = {
  bush: [
    { texture: "C_grass_set00", uv: [0, 0, 1, 0.5] }, { texture: "C_grass_set00", uv: [0, 0.5, 1, 1] },
    { texture: "C_grass_set01", uv: [0, 0, 1, 0.5] }, { texture: "C_grass_set01", uv: [0, 0.5, 1, 1] },
    { texture: "C_grass_set02", uv: [0, 0, 1, 0.5] }, { texture: "C_grass_set02", uv: [0, 0.5, 1, 1] },
  ],
  tree: [
    { texture: "C_treeleaf_set", uv: [0, 0, 0.5, 0.5] }, { texture: "C_treeleaf_set", uv: [0.5, 0, 1, 0.5] },
    { texture: "C_treeleaf_set", uv: [0, 0.5, 0.5, 1] }, { texture: "C_treeleaf_set", uv: [0.5, 0.5, 1, 1] },
    { texture: "C_treeleaf00_set", uv: [0, 0, 0.5, 0.5] }, { texture: "C_treeleaf00_set", uv: [0.5, 0, 1, 0.5] },
    { texture: "C_treeleaf00_set", uv: [0, 0.5, 0.5, 1] }, { texture: "C_treeleaf00_set", uv: [0.5, 0.5, 1, 1] },
  ],
  pine: [
    { texture: "C_mtree01_set", uv: [0, 0, 0.5, 1] }, { texture: "C_mtree01_set", uv: [0.5, 0, 1, 1] },
    { texture: "C_treeleaf01_set", uv: [0, 0, 0.5, 1] }, { texture: "C_treeleaf01_set", uv: [0.5, 0, 1, 1] },
  ],
  flower: [
    { texture: "C_flower01", uv: [0, 0, 1, 1] },
    { texture: "C_tree_set", uv: [0, 0, 0.5, 0.5] }, { texture: "C_tree_set", uv: [0.5, 0, 1, 0.5] }, { texture: "C_tree_set", uv: [0.5, 0.5, 1, 1] },
  ],
  straw: [{ texture: "C_straw", uv: [0, 0, 1, 1] }],
};

export const TRACKS = [
  {
    id: "xyy_I01",
    title: "喜羊羊 青青草原",
    centerline: { margin: 5, minWidth: 22, maxWidth: 32 },
    branches: true,
    /** 道具箱：主路线距离（米），每排 4 个；岔路中段各 2 个。 */
    itemRows: [180, 520, 860, 1330, 1640, 1960],
    branchItems: 2,
    fence: ["hedge", "wood", "hedge", "flowers"],
    roadside: [
      { every: 150, offset: [4, 30], assets: ["x_house_a", "x_hay", "x_house_b", "x_sheepbush", "x_house_c", "x_cart", "x_well", "x_scarecrow", "x_house_a", "x_flowers", "v_windmill", "x_house_b", "x_signpost", "x_hay"] },
      // 赛道围起来的里面（逆时针跑，左侧）再摆一圈羊村
      { every: 110, start: 0.3, side: 1, offset: [30, 70], assets: ["x_house_b", "x_house_c", "x_sheepbush", "x_house_a", "x_hay", "x_house_b", "v_tree_pink", "x_house_c", "x_well", "x_house_a", "x_cart", "x_bigtree"] },
    ],
    scatter: { tripoTrees: ["v_tree", "f_oak", "v_tree_pink", "x_bigtree", "f_pine_b"], trees: 260, bushes: 1.0, props: ["x_hay", "x_cart", "x_sheepbush", "x_flowers", "x_scarecrow", "f_stump", "f_rock"] },
    landmarks: [
      // 赛道围成的「房子」里面是羊村
      { asset: "x_school", at: [520, 790] },
      { asset: "x_well", at: [520, 700] },
      { asset: "x_house_a", at: [430, 830] }, { asset: "x_house_b", at: [610, 830] },
      { asset: "x_house_c", at: [430, 650] }, { asset: "x_house_a", at: [620, 650] },
      { asset: "x_house_b", at: [520, 580] }, { asset: "x_house_c", at: [660, 740] },
      { asset: "x_house_a", at: [380, 740] },
      { asset: "x_sheepbush", at: [470, 720] }, { asset: "x_sheepbush", at: [575, 720] },
      { asset: "v_windmill", at: [380, 960] }, { asset: "x_bigtree", at: [640, 990] },
      { asset: "x_hay", at: [700, 560] }, { asset: "x_hay", at: [340, 560] }, { asset: "x_cart", at: [360, 600] },
      { asset: "x_scarecrow", at: [460, 510] }, { asset: "v_fountain", at: [520, 900] },
      { asset: "x_flowers", at: [767, 760] }, { asset: "x_flowers", at: [817, 780] },
      { asset: "x_megaphone", at: [212, 700] },
      { asset: "f_tower", at: [930, 640] },
      { asset: "v_windmill", at: [950, 1080] },
      { asset: "x_balloon", at: [470, 900], lift: 55 }, { asset: "x_balloon", at: [660, 560], lift: 70 },
      { asset: "x_balloon", at: [120, 1050], lift: 60 },
    ],
  },
  {
    id: "xyy_R01",
    title: "喜羊羊 狼堡",
    // 发卡弯里个别 AI 线跑得很宽：不过滤，路面整体加宽
    centerline: { margin: 5, minWidth: 22, maxWidth: 36, outlierWidth: 80 },
    branches: false,
    fence: ["hedge", "wood", "hedge", "wood"],
    roadside: { every: 200, offset: [4, 30], assets: ["x_hay", "w_deadtree", "x_house_b", "w_lamp", "x_cart", "f_cabin", "x_sheepbush", "w_tower", "x_house_a", "x_signpost", "x_scarecrow", "w_pot", "x_well", "x_house_c"] },
    /** 狼堡一带（原版坐标的矩形）护栏换成城墙、树换成枯树和路灯。 */
    castle: { min: [330, 800], max: [600, 1150] },
    scatter: { tripoTrees: ["v_tree", "f_oak", "f_pine_a", "f_pine_b", "x_bigtree"], trees: 300, bushes: 1.0, props: ["x_hay", "x_cart", "x_sheepbush", "f_rock", "f_stump", "f_mushroom"] },
    landmarks: [
      { asset: "w_castle", at: [462, 1090], yaw: -Math.PI / 2 },
      { asset: "w_tower", at: [350, 1010] }, { asset: "w_tower", at: [575, 1010] },
      { asset: "w_tower", at: [355, 880] }, { asset: "w_tower", at: [560, 880] },
      { asset: "w_wall", at: [395, 1040], yaw: 0 }, { asset: "w_wall", at: [530, 1040], yaw: 0 },
      { asset: "w_pot", at: [438, 905] }, { asset: "w_deadtree", at: [440, 840] }, { asset: "w_deadtree", at: [436, 960] },
      { asset: "w_lamp", at: [440, 780] }, { asset: "w_lamp", at: [440, 700] },
      { asset: "w_deadtree", at: [340, 760] }, { asset: "w_deadtree", at: [585, 780] },
      // 十字中间和四个角的草地
      { asset: "x_house_a", at: [330, 520] }, { asset: "x_house_b", at: [260, 580] },
      { asset: "v_windmill", at: [720, 470] }, { asset: "x_bigtree", at: [690, 380] },
      { asset: "x_hay", at: [760, 540] }, { asset: "x_cart", at: [820, 470] },
      { asset: "x_house_c", at: [880, 760] }, { asset: "f_cabin", at: [210, 760] },
      { asset: "x_well", at: [380, 470] }, { asset: "x_scarecrow", at: [640, 560] },
      { asset: "x_balloon", at: [462, 900], lift: 65 }, { asset: "x_balloon", at: [720, 650], lift: 55 },
      { asset: "x_balloon", at: [250, 400], lift: 60 },
    ],
  },
  {
    id: "xyy_R02",
    title: "喜羊羊 羊村",
    centerline: { margin: 5, minWidth: 20, maxWidth: 30 },
    branches: true,
    fence: ["wood", "hedge", "wood", "flowers"],
    roadside: { every: 130, offset: [4, 26], assets: ["x_house_a", "x_house_b", "x_hay", "x_house_c", "x_sheepbush", "x_well", "x_house_a", "x_cart", "x_house_b", "x_flowers", "x_house_c", "x_signpost", "x_scarecrow", "x_megaphone"] },
    scatter: { tripoTrees: ["v_tree", "v_tree_pink", "f_oak", "x_bigtree"], trees: 240, bushes: 1.0, props: ["x_hay", "x_cart", "x_sheepbush", "x_flowers", "x_well", "x_scarecrow"] },
    landmarks: [
      // 「羊」字的笔画之间是羊村的房子
      { asset: "x_school", at: [500, 760] },
      { asset: "x_house_a", at: [420, 790] }, { asset: "x_house_b", at: [585, 790] },
      { asset: "x_house_c", at: [495, 650] }, { asset: "x_house_a", at: [485, 450] },
      { asset: "x_house_b", at: [500, 550] }, { asset: "x_well", at: [495, 600] },
      { asset: "x_house_c", at: [330, 420] }, { asset: "x_house_a", at: [690, 420] },
      { asset: "x_house_b", at: [370, 180] }, { asset: "x_house_c", at: [620, 180] },
      { asset: "x_house_a", at: [300, 610] }, { asset: "x_sheepbush", at: [190, 460] },
      { asset: "v_windmill", at: [100, 470] }, { asset: "v_windmill", at: [880, 470] },
      { asset: "x_bigtree", at: [490, 330] }, { asset: "v_fountain", at: [610, 610] },
      { asset: "x_hay", at: [760, 400] }, { asset: "x_cart", at: [800, 230] }, { asset: "x_hay", at: [220, 200] },
      { asset: "x_megaphone", at: [250, 225] },
      { asset: "x_balloon", at: [500, 700], lift: 60 }, { asset: "x_balloon", at: [800, 500], lift: 50 },
      { asset: "x_balloon", at: [200, 380], lift: 70 },
    ],
  },
];
