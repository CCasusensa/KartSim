# 喜羊羊赛道重建

p3553 的 `track@zz` 有 `xyy_I01`（道具 3 圈）、`xyy_R01`、`xyy_R02`（竞速 2 圈）三行，`timeAttackFilter` 有它们的评级线，`track_common` 有每张图 7 条 AI 线，`theme_xyy` 有贴图，还有两首喜羊羊 BGM 和 `itemCube/xyy`。缺的是赛道模型 `track_xyy_*.rho` 和中文名，所以发行版的目录一直把这三张图滤掉。

这里按原版 AI 线重建模型：

- `ai-path.mjs`：解码 `.kap`（KRData），切圈，用全部 AI 线的横向包络估中线、路宽、高度，并提取岔路。
- `route.mjs`：每 40 米一道路线门；岔路按官方 `<branch>` 写法生成，门不伸到另一条路上。
- `scene.mjs`：按贴图和 200 米分块合并网格，公告板、Tripo 摆件、隐形碰撞盒。
- `tracks.mjs`：三张图的配置（暂定名、路宽、护栏、地标、沿路摆放）。
- `assets.mjs`：Tripo 摆件清单，模型缓存在 `design/xyy/tripo/`（git LFS），不要重新生成。
- `build.mjs`：生成赛道包。路面用 theme_xyy 原版贴图（按主题前缀查找，不进赛道包），天空盒用 forest_I01 的（贴图名 `skydome_F`，theme_xyy 有喜羊羊版），卡片取 `design/xyy/cards/` 的游戏内截图。

```
cd client
node tools/xyy/assets.mjs                                  # 只生成缺的摆件
node --import tsx tools/xyy/build.mjs                      # 写 build/xyy/track_xyy_*.rho
node --import tsx tools/city/register-container.mjs --mirror <checkout> --container build/xyy/track_xyy_I01.rho
node --import tsx tools/export-economy-data.mjs            # 赛道表、道具赛数据、生涯数据跟着目录走
node --import tsx tools/export-item-mode-data.mjs
node --import tsx tools/export-career-data.mjs
```

每条原版 AI 线都要能按圈数跑完（`src/resources/xyy-tracks.test.ts`）。坐标是原版坐标加 `XYY_TRACK_OFFSETS` 的平移（碰撞只收录 [0, 2000)）。
