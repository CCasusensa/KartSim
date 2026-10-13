/**
 * 喜羊羊赛道（xyy_I01 / xyy_R01 / xyy_R02）。p3553 的 track@zz 有这三行、
 * timeAttackFilter 有评级线、track_common 有 AI 线，theme_xyy 有贴图和 BGM，
 * 但没有赛道模型，trackLocale@cn 也没有中文名，所以发行版的目录一直把它们
 * 过滤掉。模型由 tools/xyy/build.mjs 按原版 AI 线重建（track_xyy_*.rho）；
 * 名字原版数据里查不到，按剧情「皮蛋的青青草原之旅」暂定。
 */
export const XYY_TRACK_TITLES: Readonly<Record<string, string>> = {
  xyy_I01: "喜羊羊 青青草原",
  xyy_R01: "喜羊羊 狼堡",
  xyy_R02: "喜羊羊 羊村",
};

/**
 * 重建赛道相对原版坐标（AI 线的坐标系）的平移：游戏只收录 [0, 2000) 里的
 * 碰撞面，原版 R01/R02 的路贴着 0 甚至为负。tools/xyy/build.mjs 生成时核对。
 */
export const XYY_TRACK_OFFSETS: Readonly<Record<string, readonly [number, number]>> = {
  xyy_I01: [0, 0],
  xyy_R01: [110, 120],
  xyy_R02: [130, 50],
};

/** 重建的赛道包（不是 p3553 发行版的容器）。 */
export const XYY_TRACK_CONTAINERS = Object.keys(XYY_TRACK_TITLES).map(id => `track_${id}.rho`);
