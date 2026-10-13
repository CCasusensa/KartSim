# 卡丁城 · 罪恶都市

完整运行地图位于 `mirror/p3553/track_kartcity.rho`，已登记到镜像清单和档案索引；客户端与服务端使用对应的 `city-map.json`。从游戏大厅点击“卡丁城 »”进入。城市内人物和卡丁车尺寸为普通赛道的 50%，碰撞及车轮接地点同步缩小。

## 获取完整资源

本目录的 Blender / GLB 与原生 RHO 使用 Git LFS。克隆后执行：

```sh
git lfs pull
```

`assets/kartcity.blend` 内嵌全部 2,495 张贴图，没有外链库，可直接在 Blender 打开。`assets/kartcity.glb` 是合并后的完整三维地图。原生地图保留城区、机场、沙滩、跨海桥及碰撞；`assets/overview.png` 为全境俯视图。

## 从已归档模型重新构建

无需再次下载原始六块 GLB。在仓库根目录执行：

```sh
mkdir -p client/build/vice-city/out
cp design/open-world/vice-city/assets/kartcity.glb client/build/vice-city/out/
cp design/open-world/city-map.json client/build/vice-city/out/kartcity-design.json
cp design/open-world/vice-city/source.json client/build/vice-city/out/
cd client
node --import tsx tools/city/blender/import-city.mjs \
  --in build/vice-city/out --out build/vice-city/native
node --import ./src/physics/node-raw-test-hook.mjs --import tsx \
  tools/city/blender/verify-vice-city-native.mjs
```

验证通过后，可在导入命令后加 `--register`，同步原生容器、索引和三份地图 JSON。设计预览地址为 `/tools/city/blender/preview.html?map=vice-city`。

`city-map.json` 的顶层 `props` 列出加油站模型和路缘坡道。导入时会读取 `design/open-world/tripo/c_gasstation.glb`（同样使用 LFS）。验证脚本同时检查 7 个加油站的停车点、开出和开入。若要重新推导加油站数据，在导入前执行 `node --max-old-space-size=12000 tools/city/blender/fuel-stations.mjs`，它会改写 `build/vice-city/out/kartcity-design.json`。说明见上级 [PLAN.md](../PLAN.md) 的“加油站与设计道具管线”。

若要重新导出 Blender 工程，把 `kartcity.blend`、`vice-city-source-report.json` 一起复制到 `client/build/vice-city/out/`，再按上级 [PLAN.md](../PLAN.md) 的 `--resume-blend` 命令执行。重建导航时将归档的 `source-road-surfaces.json` 复制到 `client/build/vice-city/`；`navigation-exclusions.json` 对输入道路做哈希检查，修改道路后需要重新进行碰撞验收。

## 来源与记录

出处、上传者署名、源文件 SHA-256 和授权状态见 [source.json](source.json)。上传者标注 CC BY 4.0，但其对 Rockstar 原作资源的授权未核实；该标注不是 Rockstar 官方许可。

`reports/` 保存源文件、导出、导航和原生验收记录。地图适配与修复详见上级 [PLAN.md](../PLAN.md)。原始 RAR 与六块重复源模型未再次归档。
