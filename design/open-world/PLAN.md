# 卡丁城：开放世界自由驾驶模式 —— 计划书

## 2026-10-13 加油站与设计道具管线

为加油玩法在地图里设了 **7 个加油站**（`city-map.json` 里 `kind: "fuel"` 的兴趣点，编号 1–7）：原有的海洋海滩加油站，加上 6 座用现成 Tripo 模型 `tripo/c_gasstation.glb` 放置的卡通加油站（没有重新生成模型）。出生点等其他数据的取值不变，地图现在有 13 个兴趣点。

| id | 位置（设计坐标） | 说明 |
| --- | --- | --- |
| fuel-ocean-beach | (-721.6, 781.8) | 原版：两座雨棚、八台加油机，停车点在西雨棚南侧车道，朝东开出前场 |
| fuel-washington | (-306, -288) | 停车场北段；原定中心在人行道上，往西移约 16 m |
| fuel-vice-point | (-798, -1175) | 与原定一致 |
| fuel-havana | (-1610, 504) | 原定中心往东移约 5 m，靠近滨水大道 |
| fuel-haiti | (-1889, -24) | 原定位置的底座下地面高差 21 cm，往北约 25 m 移到平坦处 |
| fuel-downtown | (-1714, -1606) | 与原定一致 |
| fuel-airport | (-2449.5, 375) | 停机坪四周有约 1 m 高的围栏，从城里开不进去；改放到进场道路北侧停车场入口 |

每个兴趣点有 `zone`（雨棚外扩 3 m 的凸四边形加油区）和 `park`（拖车或空油时放车的位置）。`park` 在两组加油机之间的空当里，车头朝加油机一侧，也就是朝向道路；兴趣点自身的 `heading` 与 `park.heading` 相同。

**道具管线。**设计 JSON 新增顶层 `props`，由 `client/tools/city/blender/design-props.mjs` 读取，原生导入时放进地图。模型的包围盒中心对准 `at`。`heading` 是模型 −z 端（长轴）的朝向，按设计角度计（0 为北，顺时针），模型 +x 面（加油机正面）朝 `heading + 90`。`size` 是缩放后的包围盒，这里用 `[14, 20, 10]`，竖向缩放为水平缩放的 0.751。底座板顶面高出 `y`（板下最高地面）`lift` 米，自动取 ≤4 cm，并保证板顶比板下任何地面高出不到 0.1 m。道具材质带碰撞：柱子和加油机挡车，底座板可以开上去。贴图按 Tripo 生成贴图处理，小地图上显示为橙色。

美术模型的长轴平行于道路，车辆从道路一侧横穿两组加油机之间的空当。城市车辆缩小到 50% 后，15–17 cm 的路缘大多开不上去。华盛顿海滩、小哈瓦那和市中心三处在停车点通往道路的路线上自动加了 `kind: "ramp"` 降低路缘坡道：宽 5 m，坡长 2.2 m，两侧带斜坡，用路缘高处人行道的原有材质。

站点数据由 `client/tools/city/blender/fuel-stations.mjs` 生成。它从归档 GLB 的碰撞三角形量地面，并检测通往道路的路缘，写回暂存设计。`verify-vice-city-native.mjs` 新增加油站验收：加油区为凸四边形、停车点落地、车身包围盒无重叠、底座台阶 ≤ 0.1 m，并让原生 AL 车从停车点直线开出加油区 2 m 以外。它还会从同层最近道路规划一条路线开进加油区；遇到开不上去的路缘会绕开再试。另外让车沿道路从坡道旁双向驶过。最终结果：**0 个硬错误，原有 8/8 次驾驶通过，7/7 个加油站开出和开入都通过，3 处坡道 6/6 次顺路驶过都通过**；只有原版加油站需要斜着爬一次 15 cm 路缘，第 2 次尝试成功。报告存于 [vice-city/reports/native-verification.json](vice-city/reports/native-verification.json)，碰撞三角形为 979,386 个。

## 2026-10-13 当前实现：罪恶都市原生地图已生成并注册

按用户最新要求，已将免费的 **GTA Vice City 完整三维地图**转换为卡丁城使用的原生 `.1s` / RHO，并注册到 `mirror/p3553/track_kartcity.rho`。地图来自上传者 Father Of The Poor 提供的六块带内嵌贴图的 GLB；文件校验值、出处和改动记录保存在 [vice-city/source.json](vice-city/source.json)。来源为 [Sketchfab 模型页](https://sketchfab.com/3d-models/gtavc-bolum-4-6-3dmodel-d5b8f8b5cdd54bc29a4f0bbf7e800a5c)及作者链接的[免费 RAR 下载页](https://dosya.co/0oklfr4rb9f2/gtavicecity_full-map-file.rar.html)。没有购买付费包。

上传者给转换模型标注 **CC BY 4.0**；本记录保留其署名与来源，但并未核实其拥有 Rockstar 原始游戏模型、贴图的授权，不能把这个第三方标签描述为 Rockstar 官方许可。

六块共享同一世界坐标，合并时保持相对位置并统一放大 **100 倍**。游戏与导航范围为 **3.2 × 4.7 km**，设计坐标 X 为 `[-2800,400]`、Z 为 `[-2000,2700]`；普通主路实测约 9–27 m 宽。原始道路、建筑、机场、沙滩和跨海桥保留。设计数据为 v6，包含 **8 个区域、6 个兴趣点、6 个玩家出生点和 387 条恢复道路**。

### 产物与转换结果

| 产物 | 实际大小 | 路径 |
| --- | --- | --- |
| 可编辑 Blender 工程 | 203,244,485 字节（193.83 MiB） | `client/build/vice-city/out/kartcity.blend` |
| 完整合并 GLB | 283,677,788 字节（270.54 MiB） | `client/build/vice-city/out/kartcity.glb` |
| 原生地图对象图 | 90,352,975 字节（86.17 MiB） | `client/build/vice-city/native/track.1s` |
| 原生地图资源包 | 170,541,312 字节（162.64 MiB） | `client/build/vice-city/native/track_kartcity.rho`，同内容注册到 `mirror/p3553/track_kartcity.rho` |

源包有 1,638,942 个三角面、5,305 个图片引用。合并按完整几何、拆分法线、UV、材质图与最终世界变换去重，移除 **4,049 个精确重复实例**；最终 GLB 保留 **8,699 个网格、1,139,575 个三角面、2,629 个材质与 2,495 张唯一贴图**。逐图 SHA-256 检查确认导出图像载荷与原始图片一致。源 PNG 的透明区域已恢复，最终有 204 个 MASK 材质和 3 个 BLEND 材质；原漫反射贴图采用非金属材质响应。材质分类及来源说明随产物保存。

原生导入按空间重新组织为 **140 个块、6,214 个渲染网格**，保留全部 1,139,575 个渲染三角面；实际物理读取到 **970,644 个碰撞三角面**。RHO 内有 **2,503 个资源文件**，包含贴图、天空、地图对象图和来源记录。注册时同步了 `design/open-world/city-map.json`、`client/src/city/city-map.json` 与 `server-go/internal/game/city/city-map.json`。

北跨海桥的源模型在同一高度同时存在向上的沥青面与朝下的桥壳面，会使原生车辆选中错误法线。`road-collision-repair.mjs` 仅取消 **179 个与已确认向上道路完全重合的反向面**的碰撞，保留其渲染，也保留较低的真实桥底及侧墙。没有把全部向下面翻转，也没有删除桥梁模型。

恢复导航从实际沥青、跑道与桥面提取。针对飞机、护栏等实体障碍，按独立碰撞检查记录排除 **103 段不适合复位的导航线段**；这是恢复线调整，原场景模型与障碍物均保留。排除记录在 [vice-city/navigation-exclusions.json](vice-city/navigation-exclusions.json)，每条输入恢复线使用几何哈希校验，源线变化时要求重新核查。

### 已完成的原生验证

卡丁城车辆使用原尺寸的 **50%**：本地物理碰撞、轮胎接地点、角色/卡丁车表现与远端显示共享相同比例，复位后保持。普通赛道尺寸不变，设计预览同步缩放。城市小地图单独提高到 85% 不透明度，使道路与海岸线清晰可读，普通比赛 HUD 保持原样。`city-vehicle-scale.test.ts` 使用真实 AL 检查尺寸、轮胎、重生、持续行驶与远端姿态。缩小车辆的全图验收记录为 `native-verification-city-scale.json`：8/8 驾驶通过，0 硬错误、0 导航警告。

`client/build/vice-city/native-verification.json` 记录最终 `.1s` 的实际解析、地面射线、前向净空、车辆包围盒及原生 AL 车辆驾驶结果：**0 个硬错误、0 个导航警告、8/8 次驾驶通过**。8 次测试覆盖六个玩家出生点，以及北跨海桥向东、向西各至少 20 m 的驾驶；共执行 **22,966 个地面探针、13,685 次前向扫描**，出生点包围盒重叠为 0。该结论针对最终原生数据与自动驾驶检查。

复位落地逻辑另作修正：原生地面射线会返回真实桥底的朝下面，旧逻辑可能在桥顶下方约 1.96 m 处选中桥底。正式卡丁城和 Blender 预览现共用 `city-ground.ts`，只把法线向上且满足原生坡度阈值的表面作为落地点，保留桥底的实际碰撞。使用真实 `StaticTrackSurface` 的双层桥、隧道及仅含朝下面场景完成回归；落地与大陆相关测试 **7/7 通过**，预览语法检查和局部 TypeScript 检查通过。

正式游戏已从大厅“卡丁城 »”入口载入本版 RHO，使用现有账号的卡丁车、人物与原生 HUD。浏览器实际街道加速驶出 24.92 m；修复落点选择后，北跨海桥复位高度为路面上方 0.4 m，落地约 25.147 m，实际加速驶出 35.52 m。现场截图保存在 `client/build/vice-city/game-ocean-beach.png` 与 `game-bridge.png`。本地游玩地址为 **http://127.0.0.1:8782/**。最终 50% 车辆已在合并远端 main 后重新从大厅进入，实测行驶 22.28 m；最终截图归档为 `design/open-world/vice-city/assets/game-half-size.png`。客户端生产构建、19 项相关测试和 Go 城市/大厅/API 测试均通过。

服务端 `go test ./internal/game/city` 通过；`city-smoke.mjs` 通过加入城市、出生点复位、附近聊天、表情、移动转发、雷达和离开流程。RHO 清单/索引重新扫描一致，三份地图 JSON 的 SHA-256 一致。客户端相关定向检查通过；`resource-lookup.test.ts` 仍因仓库既有缺失 `recovered/formatted/index.js` 无法运行，全量测试不能据此宣称全部通过。

相关记录位于 `client/build/vice-city/`：`source-audit.json` 保存源审计；`out/vice-city-source-report.json`、`out/vice-city-export-check.json` 和 `out/vice-city-surface-classes.json` 保存合并、图像及材质检查；`out/navigation-report.json` 保存导航统计；`native-verification.json` 保存最终原生验收。`out/overview.png` 为 1536 × 1536 俯视图，精确像素对应范围在 `out/overview-bounds.json`。出处与授权记录同时保存在 `out/source.json`、`native/source.json` 和 RHO 内。

### 可复现构建与注册

先将已核验的 `bolum1.glb` 至 `bolum6.glb` 放入 `client/build/vice-city/source/`。在 `client/` 执行以下命令；Python 需安装 NumPy 与 Pillow，本机 Blender 路径可替换为其他平台的 Blender 5 可执行文件。

```sh
# 审计六块源文件，并抽取实际可行驶材质的道路三角面
node tools/city/blender/verify-vice-city.mjs

# 保持共同坐标、放大100倍、恢复透明材质，生成可编辑工程与GLB
"$HOME/.cache/kartsim/Blender.app/Contents/MacOS/Blender" \
  -b --disable-autoexec --python-exit-code 1 \
  --python tools/city/blender/vice_city_scene.py -- --scale 100

# 从源路面生成导航，应用已记录且经过几何哈希校验的障碍排除项
python3 tools/city/blender/vice-city-navigation.py \
  --exclusions ../design/open-world/vice-city/navigation-exclusions.json

# 先写隔离的原生地图，再运行实际原生碰撞与车辆检查
node --import tsx tools/city/blender/import-city.mjs \
  --in build/vice-city/out --out build/vice-city/native
node --import ./src/physics/node-raw-test-hook.mjs --import tsx \
  tools/city/blender/verify-vice-city-native.mjs

# 原生验收通过后注册RHO，并同步客户端、服务端与设计目录的地图JSON
node --import tsx tools/city/blender/import-city.mjs \
  --in build/vice-city/out --out build/vice-city/native --register
```

已有合并工程时，可将 Blender 命令末尾追加 `--resume-blend build/vice-city/out/kartcity.blend`，直接更新材质、俯视图与 GLB，无需重新读取六个源分块。场景设计预览入口为 `/tools/city/blender/preview.html?map=vice-city`，读取本版 GLB 和原生 `track.1s`；正式卡丁城使用已注册的 RHO。

旧 v5 中间产物保存在 `client/build/map-variants/continent-v5-wip/`，其原生碰撞仍有未解决问题，不作为完成版本。下方 v5、v4 及早期计划均为历史记录。

## 2026-10-13 历史设计：山海环游大陆 v5（未完成，已切换方向）

v5 针对 v4 的地形衔接、散点建筑、过高植被与大面积灰色建筑底座进行重构。范围保持 **4.8 × 4.4 km**，保留城镇、都市、森林、雪域、沙漠、矿山、工厂与海湾八个跑跑主题区域。下方 v4 的数量、画面与验收结果仅作为历史记录；本节描述当前生成源码及其验证状态。

### 参考与设计取舍

本次所说的“乐高城”参考明确为 **Forza Horizon 4: LEGO Speed Champions**。Xbox 官方介绍展示了积木山谷中的城镇、赛车场、特技公园与海盗海湾等目的地；本地图借鉴其集中聚落、清楚地标和可开车到达的游乐地点。[Xbox 官方介绍](https://news.xbox.com/en-us/2019/06/09/forza-horizon-4-lego-speed-champions-announce/)

**Mario Kart World** 的开发者访谈说明了将赛道、连接道路与自由漫游放在同一个连续世界中的设计。本地图据此把主题道路和新试驾环接入日常路网，让连接区域本身也有河谷、沿海与山岭驾驶体验。[Nintendo 官方开发者访谈](https://www.nintendo.com/us/whatsnew/ask-the-developer-vol-18-mario-kart-world-part-1/)

这些游戏提供布局和游玩节奏的参考。本版由本项目的程序化地形、既有主题素材及生成模型构建，没有复制或移植 Forza、LEGO 或 Mario Kart 的地图、模型与贴图。

### 大陆、道路与目的地

- 路网从 34 条扩展为 **39 条**，按当前源码中心线统计总长约 **53.25 km**。保留外环、内环和各主题区联络高速，普通道路继续使用开放路肩。
- 山体采用连续山脊、丘陵起伏与山口；取消随机摆放的巨大锥形雪山。道路以真实自然地形为初始高程，并通过全路网坡度约束形成连续山路、切坡和桥梁接近段。
- 曲流、湖盆与海湾纳入同一高度场。海岸的零距离线、河道边界和湖岸边界与相应水面高度匹配，岸坡再逐渐接回陆地，减少看似干燥但实际浸水的岸线。
- 草地、林地、干草原、沙漠、矿山、海岸与雪线使用连续的共享顶点颜色。雪量结合高程与坡度变化，陡面适当露岩；相邻 20 m 网格不再通过硬切换材质形成颜色棋盘。
- **积木嘉年华试驾环** `festival-circuit`：城镇西南侧约 `(-420, -350)`，通过 `festival-access` 接入街区，设计为可自由驶入的紧凑环路、彩色模块看台和集结场，不设置外围封闭围墙。
- **雪岭天际公路** `alpine-hairpins`：连接既有雪峰观景路，增加连续爬升、回头弯与山口视野。
- **落日崖海岸线** `coastal-lookout`：沿西南海岸连接外环与海湾，形成海崖和沙滩之间的观景驾驶支路。
- **林间河谷拉力线** `valley-rally`：把森林入口、河谷和沙漠联络路串成可驶入的土路探索路线。

本节坐标均使用 Blender 设计坐标：X 向东、Y 向北、Z 向上；导出的游戏地图会进行对应坐标转换。

### 聚落、景观与落地约束

城镇和都市沿道路布置连续街坊，加入贴地人行铺装、门前院、树荫小庭院、长椅、路灯和广场斑马线。多数普通建筑回到约 0.9–1.15 倍素材尺度，钟楼、风车、雪城、井架与灯塔保留为区域地标。中央喷泉移至 `(-43, 43)` 并缩至 0.85 倍，两个穿越广场的道路中心线保持通畅。

普通低面树由原先 22–46 m 的随机密布改为 **6.5–20 m** 的林簇，镇内外留出开阔草场和牧场；北方针叶树只在顶部树冠积雪。当前确定性布置 dry-run 生成 **830 个 Tripo 道具与 1,641 棵低面树**，包含约 210 幢城镇沿街建筑、35 幢都市沿街建筑及 83 幢港镇与绿洲沿街建筑；最终导出数量以构建产物为准。

建筑使用地形内的平缓场地与贴地石质裙基。放置前对完整旋转足迹的四角、中心及四边中点共 **9 点**采样，地面高差超过 **2 m** 的普通建筑地块会被拒绝，避免用高大灰盒填补山坡。雪城、金字塔与矿场工坊等大地标使用专门的地形平台；平台保留道路缓冲范围，避免改变通行路面。道具导出数据记录朝向、足迹、采样坐标、基础高度和道路净空，供独立复验。

### 当前验证状态与产物

截至本节更新，已完成生成源码的 Python 语法检查与最新高度场上的完整布置 dry-run。所有地标找到可用地块；按九点全足迹统计，最高外露基础约 **1.980 m**，普通 Tripo 道具对最近道路边缘的保守包围圆净空最小约 **5.035 m**。海上船只作为水面地标单独标记，不套用普通建筑落地标准。

正式 Blender 场景构建正在进行。**v5 的 RHO 导出、原生碰撞探测、实际卡丁城试驾和画面检查尚待本次构建完成后记录**，不能沿用下方 v4 的通过结果作为 v5 验收。

生成入口仍为 `continent.py`、`continent_scene.py` 和 `scene_library.py`，继续输出可编辑的 `kartcity.blend`、`kartcity.glb` 与设计数据，并走现有 RHO / `.1s` 导入链路。新增 `continent-props.json` 的九点落地元数据与 `continent-landscape.json` 的街坊、树簇、目的地统计用于检查场景布局。构建和正式游戏启动命令见下方 v4 历史记录中的对应操作段落；最终资源规模及验证报告由本次 v5 构建结果补充。

### 外部地图资源评估（2026-10-13）

本次检查了官方资产目录、许可证、文件列表和小型 XML 配置，**没有下载完整地图资产包，也没有将下列外部地图导入 v5**。可复用资产与游戏引擎分别核对许可；“可以下载游戏或模组”不等于该地图资产已授予跨项目复用许可。

| 候选及来源 | 实际格式与规模 | 可落地方式与许可范围 |
| --- | --- | --- |
| **SuperTuxKart · Overworld**：[Blender 源目录](https://svn.code.sf.net/p/supertuxkart/code/media/trunk/tracks/overworld/)、[可玩资产目录](https://svn.code.sf.net/p/supertuxkart/code/stk-assets/tracks/overworld/) | 源目录包含 `overworld.blend` 与贴图；发布数据为 `.spm`、`scene.xml`、`materials.xml`、`quads.xml`。是完整自由驾驶枢纽；解析官方 92 个道路四边形得到约 **219 × 620 世界单位**的路网包围范围，这不是完整场景外边界，也不是数公里大陆。 | 最接近现有 Blender → GLB → RHO 管线，适合改成单个区域。[资产 licenses.txt](https://svn.code.sf.net/p/supertuxkart/code/stk-assets/tracks/overworld/licenses.txt) 明确默认 **CC-BY-SA 3.0**，另列 CC0 / 公有领域例外。旧 [licence2.txt](https://svn.code.sf.net/p/supertuxkart/code/stk-assets/tracks/overworld/licence2.txt) 对 `palm_b`、`tree_1` 等保留许可待澄清注记；实际使用前应核清或替换这些素材，并保留资产署名和相同方式共享要求。 |
| **Stunt Rally 3 · MountCaro / BeachCity**：[官方赛道源库](https://github.com/stuntrally/tracks3) | `heightmap*.f32` 高度图、`road*.xml` 样条与 `scene.xml`。官方 [MountCaro 道路数据](https://raw.githubusercontent.com/stuntrally/tracks3/main/For18-MountCaro/road.xml)记录约 **21.75 km**路线、**1,411 m**高差，含海滨、村庄、山谷和隧道；道路控制点占地约 **1.75 × 1.68 km**。[BeachCity 道路数据](https://raw.githubusercontent.com/stuntrally/tracks3/main/Grc10-BeachCity/road.xml)记录约 **3.56 km**路线及城市海滨探索区域。 | 可将高度图与道路骨架转换进本项目，重新适配坡度、自由路网和卡丁车碰撞。源库明确将**赛道数据本身**以 **GPL 3.0 或后续版本**发布。共用贴图和模型需另外核对；官方 [data.md](https://github.com/stuntrally/stuntrally3/blob/main/docs/data.md)仍记录部分媒体许可清理事项，不能把整款游戏的素材都当成 CC0。它们是完整赛道场景，并非现成的大型自由道路网络。 |
| **Kenney · Starter Kit Racing**：[官方项目](https://github.com/KenneyNL/Starter-Kit-Racing)、[Racing Kit](https://kenney.nl/assets/racing-kit) | 官方项目直接提供 `models/*.glb`、Godot 的 `scenes/main.tscn` 和可驾驶示例；包含道路拼块、树林、帐篷与车辆。Racing Kit 页面列出 110 件资源。未声称有公里级大地图。 | GLB 可直接进入现有美术流程，适合补齐试驾环和节庆区域。官方 README 将**美术/音效定为 CC0，代码定为 MIT**。这是可扩展的场景组件和小型驾驶示例，不应当作完整开放世界交付。 |

**Mario Kart World** 已核实的官方公开资料是世界地图展示、截图、视频及设计访谈；本次没有找到官方发布、明确允许跨游戏复用的完整 3D 地图源包。[任天堂内容分享规则](https://www.nintendo.co.jp/networkservice_guideline/en/index.html)覆盖视频和截图平台，不能据此推导获得地图模型与贴图的再发布许可。这一结论针对已找到的资源与授权范围，**不表示技术上无法转换**；若提供已获授权的网格、贴图和场景数据，仍可检查格式后通过 Blender 与本项目原生地图管线接入。

---

## 2026-10-12 历史实现：山海环游大陆 v4

v4 地图采用当时选定的 [A 方案](concepts/2026-10-12/a-grand-continent.png)。本节记录 v4 当时的实现与验收；当前实现以顶部的罪恶都市 v6 记录为准。下方 2026-10-11 计划继续保留为更早的历史背景。

- 地图边界 **4.8 × 4.4 km**，约 **47.8 km** 道路；34 条道路全部连通。外环高速约 10.5 km，内环与七条联络高速连接各区。
- 八区：中央城镇老街、东方摩天都市、西北森林秘境、北方冰河雪域、西南金字塔沙漠、东北矿山峡谷、东南机械工厂、南方海盗海湾。
- 普通路面无封闭围墙，26 m 高速路面外是每侧 4 m 碎石路肩，再接连续、可碰撞的地形。河床、湖泊与海湾形成真实水域；桥上保留护栏，矿山有可穿行的岩石廊道。
- 20 m 网格地形包含山脊、丘陵、沙丘、河谷、湖岸与海岸。道路与肩部裁切到同一组地形三角形，防止穿插与碰撞台阶。相邻路段共享坡度约束，交汇区域采用连续高程混合。
- 新增 8 个 Tripo 低模模型：海盗船、港口瞭望塔、矿井井架、矿车、矿山工坊、工厂、巨型齿轮、储罐。与原有素材共同形成 726 个主题摆件实例，另有约 2400 棵低面数植被。
- 草地、林地、沙地、雪地与海水使用新生成的手绘贴图。原图和提示词保存在 [textures/v4](textures/v4/prompts.json)；道路、路肩和石材采用可复现的细粒度程序材质。
- 出生点和最近道路复位均携带真实高程。离开公路不会自动复位；水下、跌出地形或物理异常才触发恢复。
- 地图已接入正式游戏的“卡丁城”入口，使用玩家装备的卡丁车和人物、原生驾驶 HUD、城市线路与多人同步。远景下的相机剔除改为与 WebGL 实际投影一致，避免车辆在镜头内消失；原生小地图保持 256 单位投影，贴图提高为 1024×1024。

### 在卡丁城里游玩

本次本地完整服务地址为 **http://127.0.0.1:8782/**，从首页点击 **卡丁城 »** 即可进入山海环游大陆。方向键驾驶、Shift 漂移、Enter 聊天、连续两次 Esc 离开。此入口使用地图的原生 RHO / `.1s` 资源；下方 8780 地址是 Blender 场景设计预览。

本次启动使用隔离的开发 MySQL / Redis（13306 / 16379），账号服务为 8787，游戏节点为 8788；没有占用已有 3306 / 6379 服务。已有 Docker 依赖运行时，从仓库根目录重新启动游戏的命令为：

```sh
KART_VITE_PORT=8782 \
KART_MYSQL_DSN='kart:kart@tcp(127.0.0.1:13306)/kartsim?charset=utf8mb4&collation=utf8mb4_0900_as_ci' \
KART_REDIS_ADDR=127.0.0.1:16379 KART_CITY=true ./run-full-local.sh
```

### 当前生成入口

源文件位于 `client/tools/city/blender/`：`continent.py` 管道路、地形和地图数据，`continent_scene.py` 管 Blender 场景，`scene_library.py` 管材质、模型缓存和碰撞代理。旧 `kartcity.py` 为 v3 历史生成器。

在 `client/` 执行：

```sh
# 首次准备官方主题材质；原有及本次生成的 Tripo 模型已保存在仓库目录中
node --import tsx tools/city/blender/export-props.mjs

# BLENDER 环境变量或 --blender 可以指定其他平台的可执行文件
node tools/city/blender/blender-city.mjs build --render
node --import tsx tools/city/blender/import-city.mjs --register

# 读取实际 RHO，检查道路、出生点、路肩，并使用原生 AL 车辆驶出高速
node --import ./src/physics/node-raw-test-hook.mjs --import tsx tools/city/blender/verify-continent.mjs

# 本地场景与车辆物理预览
npm run dev
# http://127.0.0.1:8780/tools/city/blender/preview.html
```

本机 Blender 位于 `~/.cache/kartsim/Blender.app/Contents/MacOS/Blender`。构建会输出 `client/build/blender/out/kartcity.blend`（材质已打包、分集合可编辑）、`kartcity.glb` 和 `continent-overview.png`。导入器生成 `client/build/kartcity/track_kartcity.rho`，注册到 `mirror/p3553/`，同时同步设计、客户端、服务端三份 `city-map.json`。该 RHO 使用现有 `.1s` 编码器与游戏加载链路，不需要增加地图加载格式。

预览支持全境旋转缩放、八区定位和 WASD / 方向键驾驶，Shift 漂移、R 返回道路；画面读取 GLB，碰撞和驾驶读取导出的 `track.1s` 并使用游戏的 TrackWorld / AL。正式卡丁城仍从大厅进入，需要原有账号服务和开启 `KART_CITY` 的游戏节点。

实景可查看 [Blender 全境渲染](previews/2026-10-12/continent-overview.png)、[城镇试驾](previews/2026-10-12/town-drive.jpg)和[森林试驾](previews/2026-10-12/forest-drive.jpg)。预览车是用于检查比例和物理的简易车辆；正式卡丁城仍使用玩家选择的卡丁车。

验证报告输出为 `client/build/kartcity/continent-verification.json`。最终 RHO 包含 216,809 个碰撞三角形；1,356 个道路采样、20,536 个普通路肩采样、8 个出生点全部通过。九条高速双侧共 18 次原生车辆驶出测试全部通过，普通路肩每 0.5 m 采样的最大高差为 0.207 m。桥梁和隧道单独标记，不计入开放路肩承诺。34 条道路连成同一网络，三份地图数据和两个 RHO 副本一致。浏览器森林试驾实测可以加速到约 103 km/h，车辆保持着地。

`go test ./internal/game/city`、3 项大陆测试、4 项城市协议测试、2 项容器注册测试、2 项相机剔除回归测试与生产构建通过。完整 `npm run typecheck` 仍会遇到仓库缺少未发布文件 `recovered/embedded-data/vehicle-physics-overrides.mjs` 的既有问题；临时排除此单个历史对照测试后类型检查通过。既有发行版对照测试也依赖缺失的 `recovered/formatted/index.js`；未为此修改或跳过正式测试。

本地账号服务、游戏节点与客户端已实际启动。`server-go/test/city-smoke.mjs` 通过两个测试账号验证进城、成员广播、复位、聊天、表情、运动帧、雷达、离开与城市内开房限制。浏览器通过首页“卡丁城”入口加载该资源，使用正式人物和车辆试驾：城镇行驶 19.25 m，达到 99.36 km/h；森林高速驶离中心线 26.10 m（路面半宽 13 m），达到 87.66 km/h，仍着地且未触发复位。截图见 [卡丁城内实景](previews/2026-10-12/kartcity-in-game.jpg)。

---

> 目标：玩家进入一张持久的城市地图，开着自己的卡丁车到处闲逛、停车聊天、碰头后一键开房比赛。
> 本文档基于 2026-10-11 对代码的实际探索（文件行号均指向本仓库），地图图纸见同目录的
> [city-map.svg](city-map.svg)（[city-map.png](city-map.png) 为预览），地图数据见 [city-map.json](city-map.json)
> （由 [city-map.data.mjs](city-map.data.mjs) 经 [render-city-map.mjs](render-city-map.mjs) 生成）。

## 0. 结论先行

| 问题 | 结论 |
| --- | --- |
| 现有引擎能不能跑一张 2 km 级的城市？ | 能。现有最大赛道就是 2000 × 2000 m、40 万渲染三角形、6.4 万碰撞三角形；静态路面碰撞是 4 m 均匀网格，查询开销与地图大小无关。 |
| 现有代码能不能直接"不结束"地开？ | 不能。多人比赛没有 `lapTarget` 会在 GO 的一瞬间判定完赛；房间 2–8 人；名单在开赛时冻结，不能中途进出；运动帧只在比赛阶段转发。这四点都要新做一条"城市"玩法通路。 |
| 聊天气泡、车顶名牌有没有？ | 比赛里没有（只有排名板）。小屋（My Room）有一套完整的"多人位置同步 + 气泡 + 名牌"实现，可以照搬到车上。 |
| 地图怎么来？ | 没有 `.1s` 写入器，也没有编辑器，赛道是整体烘焙的。推荐**程序化建城**：从 `city-map.json` 生成路面/地形/街区网格与碰撞三角形，直接喂给现有的场景装配与路面提取代码；地标建筑可从现有赛道场景里抠出来摆放。 |
| 最快能玩到什么？ | **M0 原型**：用现有的开阔竞技场地图（如 `ice_F01` 冰雪旗帜场、`village_F01`）跑"城市"玩法，8 人、不结束、带气泡聊天。它验证网络与社交层，之后再换成真正的卡丁城。 |

## 1. 现状盘点（代码探索结论）

### 1.1 赛道数据与渲染

- 一条赛道 = 一个烘焙的 `track.1s` 二进制对象图（渲染网格 + 路面三角形 + 路线图 + 小地图 + 道具箱都在同一个文件里），贴图来自按主题共享的 `theme_<theme>.rho`（如 `theme_village` 521 张）。解析入口 `y9`（`client/src/generated/formats.js:258`），读取器 `client/src/resources/track-binary-reader.ts`。
- 路面碰撞不是单独文件：网格的 TexProperty 带 `<road surface=… rail=…/>` 就是可碰撞路面（`client/src/resources/track-road-extraction.ts:224-321`）。墙也是 road 三角形，法线 y ≤ 0.65 当墙处理（`client/src/driving/track-collision.ts:114-200`）。
- 加载硬性要求（`client/src/vehicle/load-track-map.ts`）：文件名必须是 `track*.1s`（:92）、恰好一个 ToMinimap（:138-141）、元数据必须有 `laps`（:192-208）、`stage_common` 的 readyCamera（:209-215）、路线图必须闭环（`client/src/resources/track-course-graph.ts:321-330`）。
- 尺寸限制：
  - 路面三角形只保留客户端坐标 x、y ∈ [0, 2000) 的（`track-road-extraction.ts:286-287`，一行规则）；
  - 4 m 碰撞网格用 `Math.trunc` 分格，**负坐标会丢三角形**（`client/src/world/static-track-surface.ts:46-56`）——新地图整体放在正坐标即可；
  - 单个网格顶点/索引 ≤ 65535，对象 id 为 uint16。
- 渲染：three.js 0.178，一个场景一个顶点池、每个网格一个 draw call、无合批无实例化（`client/src/resources/track-scene-assembly.js:73-93`）；用原版的层级包围盒剔除（`formats.js:1406-1589`）和 ToBlackPlane 遮挡体；**没有 LOD、没有流式加载**；远裁剪取赛道的 `<camera far>`（最小 300、中位 600、最大 2000），雾可配。
- 规模实测（498 个 `track.1s`）：中位 1.5 MB / 4.4 万渲染三角形 / 524 个网格；最大 39.7 万三角形（china_R09）、3952 个网格；最大占地 2000 × 2000 m（pirate_R05、china_R09、forest_R06 等），碰撞三角形最多 6.4 万（tomb_R04）。解析 china_R09 在 Node 里 172 ms + 路线/碰撞 58 ms。
- 现成的开阔地图（目前被加载器拒绝：没有 laps，或含 ToLucci/旗帜对象）：旗帜场 ice_F01（1284 × 1648 m）、village_F01、forest_F01、tomb_F01、sword_F01；死亡竞技场 northeu_D01（1.4 km）；金币大地图 village_B01–B04、forest_B01、ice_B01；练习场 village_I11。
- 组合钩子：`assembleTrackScene` 支持 `additionalRoots` + `rootPoseOverrides`（`track-scene-assembly.js:32-41`），`StaticTrackSurface` 接受任意三角形数组，小屋场景就是在比赛管线之外用 `y9 + W1` 自己装配的（`client/src/ui/my-room-scene.ts:688-699`）。

### 1.2 比赛生命周期与物理

- 多人生命周期在 `client/src/generated/library.js:1570-1660`（OQ 类）：`lap > routeTotal` 判定自然完赛；`routeTotal` 为 undefined 时 `t <= undefined` 恒为 false，**GO 之后立刻完赛**。HUD 没有 `lapTarget` 会直接抛错（`client/src/ui/multiplayer-race-hud.ts:171-172`、`client/src/multiplayer/race-presenter-events.ts:89-92`）。计时赛把 undefined 当作 `MAX_SAFE_INTEGER`（`client/src/timeattack/driving-loop.ts:102-108`）。
- 复位：掉到 y < -5 复位、低速 2 秒复位（`client/src/multiplayer/local-race-runtime.ts:49-87`），都回到当前路线段的第 0 帧（`client/src/world/route-state.ts:61-70`）。闲逛停车时这条 2 秒规则必须关掉。
- 物理只依赖：路面三角形（4 条向下射线 / 2 ms 子步，`client/src/driving/wheel-probe.ts:94-188`）、OBB 墙碰撞、表面标签效果（加速带 BS、跳台 JM 等，`client/src/driving/road-consumers.ts`）。路线图只用于圈数、排名、复位与追赶补正（`client/src/multiplayer/race-frame-coordination.ts:133-152`）。移动路面与障碍物是线性扫描（`client/src/world/moving-track-surface.ts`、`obstacle-surface.ts`），城市里要少用或分区裁剪。
- 服务端（`server-go/internal/game/lobby/lobby.go`）：整个节点一把全局锁（:190-196）；房间 `capacity` 2–8（:754）；开赛至少 2 人（:1304）、名单冻结（:1366-1374）；比赛中加入的人只能在房间等（:810-811）；首个完赛后 10 秒收尾（:1580-1585）；没有总时限。运动帧只在 loading/countdown/racing 阶段转发（`motion.go:47-51`），接收者由发送方的 1 字节 mask 决定（:72-81），**没有兴趣管理**，没有服务器 tick。
- 客户端远端车：`RemoteFleet` 按冻结名单一次性建好、槽位 0–7（`client/src/multiplayer/remote-fleet.ts:114-168`）；航位推算、每个新包直接重置姿态、不做平滑（`remote-motion.ts:149-204`）；发送 64 ms 门限，按距离分 128/256/512 ms 档（`race-peer-cadence.ts:130-185`）。
- 8 人上限散落在十几处：`motion.ts:23`、`payload.ts:281`、`room-validation.ts:246/397/416`、`race-peer-cadence.ts:213`、`individual-rider-colors.ts`、`lobby.go:754/1105/2203`、`motion.go:72-80`。
- **进行中的相关工作**：`KartSim-brawl` 工作树（分支 brawl-mode）正在做"50 人乱斗"，已把起跑位扩到 50（`client/src/vehicle/race-start-slots.ts` 未提交改动）并导出了赛道路线数据（`server-go/internal/game/brawl/tracks.json`），Go 侧尚未动手。它会先打掉上面的 8 人上限，城市模式应复用其协议改动，避免两套。

### 1.3 聊天与社交

| 已有 | 位置 | 可复用度 |
| --- | --- | --- |
| 房间聊天（120 字，保留 32 条）与头像气泡（5 秒） | `lobby.go:1242-1284`；`client/src/multiplayer/lobby-room-state.ts:159-180` | 气泡时长、换行逻辑可复用 |
| 比赛内聊天（20 字） | `client/src/multiplayer/race-chat-overlay.ts`；**驾驶中禁用**（`race-session-update.ts:245-248`） | 输入框与 Enter 流程可复用，需解除驾驶中禁用 |
| 全部聊天 / 俱乐部聊天（30 字，1 条/秒、突发 5、超限禁言 10 秒） | kart-data `server-go/internal/data/messenger/chat.go`；窗口 `client/src/menus/global-chat.ts` | 直接复用，加"附近/分区"两个页签 |
| 表情轮盘（反引号 + 1–8） | `client/src/multiplayer/lobby-room-construction.ts:126-156`；`generated/world.js:2733-2752` | 直接复用，动作播在车手模型上 |
| 小屋多人：8 人、`move{x,y,z,yaw,moving}` 100 ms 上报、15 次/秒限流、远端 3.6 m/s 追赶、超 8 m 吸附；名牌与气泡画在 WebGL 之上的 2D canvas，按投影的头顶位置定位 | `server-go/internal/data/myroom/{hub,socket}.go`；`client/src/ui/my-room-scene.ts:236-242,1027-1050`；`my-room-labels.ts:38-123` | **城市在线层的模板**：hub 模式、限流、名牌/气泡渲染器照搬到车顶 |
| 好友在线状态（online/inGame/offline） | `server-go/internal/data/messenger/hub.go` | 需要补"所在城市/线路"字段 |
| 比赛里的昵称 | 只在排名板（`race-presenter-hud.ts:126-145`），车顶没有名牌 | 需新做 |
| 小地图 | 已有（`generated/library.js:4113/4174`），画赛道自带的 ToMinimap 模型和每位参赛者的标记 | 需要城市级的小地图模型与缩放 |

## 2. 总体方案

```
浏览器                               游戏节点 kart-game ×N                     数据服务 kart-data
┌────────────────────┐   WebRTC/WS   ┌──────────────────────────┐   内部API   ┌──────────────────┐
│ 大厅 → 「卡丁城」   │ ───────────► │ zone 包：城市实例（线路） │ ─────────► │ presence: city:1 │
│ city-session       │  city-join   │   成员表、AOI 网格、聊天   │  心跳/占用  │ 好友所在线路      │
│ city-loader(建城)   │ ◄──────────  │   AFK、出生点、管理指令    │            │ 商店/车库/小屋…   │
│ city-fleet(动态车)  │  motion 帧   │ 每实例一把锁，≤60 人       │            │ （HTTP 原样复用） │
│ 气泡/名牌/小地图    │  AOI 转发    │ 运动帧按距离分档转发       │            └──────────────────┘
└────────────────────┘              └──────────────────────────┘
```

设计要点：

1. **城市不是房间，是 Zone（实例）。** 每个游戏节点启动时建立 N 条"线路"（线路 1、2、3…，可配置），每条 ≤ 60 人（`RULES.instancePlayers`）。实例常驻，不随最后一人离开而销毁；节点重启后客户端像小屋一样自动重连重进。
2. **自己的协议分支，不改比赛协议。** `hello` 之后用 `city-join` 进入，而不是 `create/join/start`。城市运动帧用新的 8 字节头（kind、flags、uint16 发送者 id、uint32 序号），**去掉发送方 mask，接收者由服务器的 AOI 决定**。比赛协议 40 原样保留。
3. **兴趣管理在服务器。** 100 m 网格；半径 160 m 内收完整运动帧（60 m 内每帧，60–160 m 每两帧），之外只收 1 Hz 的"雷达包"（每人 6 字节：id + 量化 x/z）供小地图使用。60 人全挤在广场的最坏情况：每人下行约 15 车 × 15 Hz × 171 B ≈ 38 KB/s；通常远小于此。
4. **客户端动态车队。** 远端车按加入/离开事件异步加载模型（小屋 `loadRemote` 的做法），完整渲染上限 24 辆，更远的车用名牌点或不画；远端姿态加 100–150 ms 的插值缓冲，避免 7.8 Hz 下的抖动。
5. **地图由数据生成，不手工烘焙。** `city-map.json` 是地图唯一真源；建城脚本生成路面、地形、街区与碰撞，并按 200 m 分块成带包围盒的节点，让现有层级剔除充当空间分区。
6. **城市里的功能点都"开进去"触发。** 车库、商城、俱乐部、小屋、考场、传送门都是触发体，进入就打开现有窗口（车库/商店/俱乐部/小屋/寻宝界面不改），出来时装备变化通过现有的 `equipment` 校验流程同步。

## 3. 地图：卡丁城

### 3.1 总览

- 2.4 km × 2.4 km，原点 = 中央喷泉，x 向东、z 向南（three.js），单位世界米（与赛道路线长度同尺度）。
- 建城时整体平移到正坐标：客户端坐标 = 世界坐标 + 1200，并把路面提取的 2 km 裁剪（`track-road-extraction.ts:286-287`）改为按地图范围参数化（原版赛道保持 2000，城市 2400）。如果想完全不碰这条规则，把城市缩到 2.0 km 即可（环城高速改为 ±850）。
- 道路总长 32.5 km，其中环城高速一圈 7.57 km；37 个兴趣点；10 个分区；5 处出生点。

### 3.2 分区

| 分区 | 位置 | 复用素材主题 | 内容 |
| --- | --- | --- | --- |
| 中央广场 | 中心 r=230 | common | 喷泉（聊天热区）、出生停车场、传送门广场（竞速/道具/计时/乱斗一键开房）、排行榜大屏、公告栏、每日任务 NPC |
| 城镇老街 | 北 | village | 红屋顶老街环路、车库、改装店、广播塔 |
| 霓虹商业区 | 东北 | world（+china） | 高楼与霓虹招牌、商城大楼、寻宝屋 / 精品道具场 |
| 滨海港区 | 东 / 东南 | beach | 滨海公路、码头游艇、海滩舞台（活动）、灯塔、跨海大桥 |
| 集装箱工业区 | 南 | factory（+mechanic） | 集装箱环道、漂移练习场、特技跳台 |
| 赛车公园 | 南 / 西南 | wkc | 驾照考场入口、1.6 km 城内计时环道（成绩上大屏） |
| 森林公园 | 西南 | forest（+camp） | 湖畔林道、森林湖与湖心岛、露营地篝火（最安静的聊天点） |
| 小屋街 | 西 | village | 两条街的玩家小屋（开到门口进小屋）、俱乐部会馆 |
| 冰雪游乐园 | 西北 | ice（+park） | 摩天轮、冰雪滑道、游乐园环道 |
| 雪山 | 西北角环外 | ice | 盘山公路盘旋 120 m 到观景台；穿山隧道是地下捷径 |

### 3.3 道路层级

| 等级 | 宽度 | 用途 |
| --- | --- | --- |
| 环城高速 | 18 m | 闭合主环（也是加载器要求的路线图主环），8 个匝道，直道上 8 条加速带，东南段跨海大桥抬高 20 m |
| 主干道 | 14 m | 中央大道、东西大道、二环路、两条斜向林荫道、广场环岛 |
| 街区道路 | 10 m | 各分区内部路 |
| 小路 / 林道 | 7 m | 林道、小屋巷、盘山公路 |
| 赛道环道 | 12 m | 赛车公园计时环道（独立路线图，用于城内计时与驾照） |
| 隧道 | 12 m | 穿山隧道（-12 m） |

### 3.4 玩法与社交规则（`city-map.json` 的 `rules`）

| 参数 | 值 | 说明 |
| --- | --- | --- |
| instancePlayers | 60 | 一条线路的上限，满了自动开下一条 |
| interestRadius | 160 m | 完整运动帧的同步半径 |
| chatBubbleRadius / Seconds | 60 m / 6 s | 气泡可见范围与时长 |
| 频道 | 附近（60 m）、分区、全城、俱乐部 | 全城与俱乐部走现有 messenger；附近与分区走 zone |
| afkMinutes | 10 | 停进最近停车位并显示"挂机中"，不再同步运动帧 |
| resetToRoad | 是 | 掉水/卡住：复位到最近的道路中心线采样点（不是路线段起点） |
| dayNightMinutes | 48 | 昼夜循环（改太阳/雾颜色），可关 |

### 3.5 坐标与建城用数据

`city-map.json` 里每条道路带 `lengthM`，每个分区带多边形与主题，每个兴趣点带坐标、类型与说明。建城脚本只认这份文件；改地图 = 改 `city-map.data.mjs` 再跑 `node design/open-world/render-city-map.mjs`。

## 4. 建城流水线

三条可行路线，推荐 **A 做原型，C 做正式版，B 用来摆地标**：

| 路线 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 直接用现成大地图 | 给 ice_F01 / village_F01 / china_R09 加"城市"玩法：放行 ToLucci/旗帜对象，lapTarget 设为极大 | 渲染、碰撞、物理零改动，一两周可玩 | 不是城市，最大 2 km |
| B. 拼接现有赛道场景 | 多个 `.1s` 各自解析后作为 `additionalRoots` 摆进同一世界，路面三角形合并进一个 `StaticTrackSurface`，路线图用代码合成 | 画面立刻是"跑跑"的味道 | 每次摆放都要重新解析；draw call 叠加没有 LOD；接缝需手工处理 |
| C. 程序化生成（推荐） | 建城脚本从 `city-map.json` 生成 `y9` 形状的节点树：路面（带 `<road/>` 属性 → 自动成为碰撞）、路缘与护栏（墙）、地形分块、街区建筑（盒子 + 屋顶，贴主题贴图）、水面与"落水复位"平面、路线图（环城高速）、小地图；按 200 m 分块、每块 ≤ 65535 顶点 | 地图可迭代、可做任意大小，与现有装配/剔除/碰撞代码无缝 | 需要写生成器（路面扫掠、路口拼接、UV），初版画面偏"方块城" |

路线 C 的输出不写 `.1s` 二进制（没有编码器），而是序列化成自己的 JSON/二进制包 `city_/kartcity/city.json`（新资源容器，进"卡丁城"资源分组按需下载），由 `city-loader.ts` 还原成 `y9` 形状对象后走现有的 `W1`/`assembleTrackScene` 与 `extractTrackRoads`。地标（摩天轮、灯塔、商城大楼）用路线 B 的方法从现有赛道里抠出子树摆放。

渲染预算（参照现有最大赛道）：可见渲染三角形 ≤ 30 万、draw call ≤ 2500、碰撞三角形 ≤ 8 万；`cameraFar` 800–1000 配雾。超预算的办法是分块 + 建筑远距离换低模（简单 LOD 开关）。

## 5. 分阶段计划

每个里程碑都是可独立合入 main 的一步；估算按一人全职、含测试。

### M0 原型：自由驾驶 + 气泡聊天（1–2 周）

- 新玩法 `city`（客户端 `client/src/city/`，服务端 `server-go/internal/game/zone/`）：`city-join` 进入节点上的常驻实例；没有倒计时、完赛、结算。
- 客户端用现有多人比赛管线跑：`lapTarget = 2^31`，隐藏圈数/排名/时差 HUD，关闭低速复位与追赶补正。
- 地图先用 ice_F01 或 village_F01（放行 ToLucci/旗帜对象，`registerTrackMetadata` 补 laps）。
- 车顶名牌 + 聊天气泡（移植 `my-room-labels.ts`），驾驶中可以聊天（解除 `race-session-update.ts:245-248`）。
- 验收：8 人同时进入、随意开 30 分钟不掉线不复位；气泡与名牌正确；离开后别人正常。

### M1 Zone 协议与规模（2–3 周）

- 与 50 人乱斗共用 uint16 槽位/发送者 id 的协议改动（协议 41）；城市帧去 mask，服务器 AOI 网格转发 + 分档；1 Hz 雷达包。
- 每实例独立锁；成员增删用增量事件（joined/left/changed），不再广播整份快照。
- 客户端动态车队、异步加载模型、24 辆完整渲染上限、插值缓冲。
- 机器人压测：复用 item-bot 的思路跑 60 个假客户端（`client/tools/`）。
- 验收：60 人一条线路，服务器单实例 CPU < 1 核的 30%，客户端 60 fps 不掉帧，网络下行 < 50 KB/s。

### M2 卡丁城 v1：建城与加载（3–4 周）

- 建城脚本 `client/tools/city/build-city.mjs`：路面扫掠、路口、地形、水面、街区盒子建筑、路线图、小地图、分块。
- `city-loader.ts`：从城市包装配场景与碰撞；出生点（5 处）与最近道路复位；雾与远裁剪。
- 资源分组新增"卡丁城"（`client/src/resources/resource-groups.ts`），进城时按需下载。
- 小地图：城市级 ToMinimap 替代 + 缩放 + 分区名横幅。
- 验收：按图纸能开遍所有道路（含桥、隧道、盘山路）；落水/卡住 3 秒内复位到路上；首屏下载 ≤ 30 MB。

### M3 社交层（2 周）

- 频道：附近 / 分区 / 全城 / 俱乐部（全局聊天窗加页签）；喇叭（全城 1 条/分钟）。
- 表情轮盘与鸣笛动作同步给附近的人；停车姿态。
- 组队与跟车：邀请 → 队伍；开进传送门 = 以队伍成员创建比赛房间并进入（复用 `create/join/start`）。比赛结束 `return-room` 改成回到城市原地。
- 好友面板显示"在卡丁城·线路 2"，可一键同线路。
- 验收：两人在城里碰头、组队、从传送门开一局竞速、回城继续聊天，全程无需回大厅。

### M4 城市功能（2 周）

- 触发体：车库、改装店、商城、寻宝屋、俱乐部会馆、玩家小屋（自己的门 = 进小屋，好友的门 = 拜访）、考场（驾照考试搬到城内环道）。
- 50 枚隐藏金币（每日刷新，K币奖励走数据服务）；城内计时环道成绩榜；跳台滞空与漂移练习计入每日任务。
- 管理：后台可向线路发公告、踢人/禁言、关闭线路；海滩舞台活动开关。
- 反作弊：城市帧只做速度上限与瞬移检查（WASM 插件新钩子），不做路线进度。

### M5 打磨与运营（持续）

- 地标模型抠取与摆放、昼夜循环、季节装饰（xmas 变体的思路）。
- 性能：建筑远距离低模、分块卸载、draw call 监控。
- 指标：线路人数、平均停留时长、聊天量进后台。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 协议改动与 50 人乱斗分支冲突 | 先合并乱斗的槽位/协议改动，城市在其上做；协议号统一升到 41 |
| 生成的城市画面"方块感"强 | 第一版就用主题贴图 + 现有赛道抠出的地标；建筑盒子加屋顶/招牌模板；后续替换为抠取的真实街区 |
| 没有 LOD，60 辆车 + 城市同时画 | 24 辆完整渲染上限、远车名牌点；分块剔除；雾与 800 m 远裁剪 |
| 单节点全局锁 | 城市实例自己的锁；节点容量另算（`KART_MAX_PLAYERS` 默认 400） |
| 闲逛时的作弊（飞天、瞬移） | 服务器速度与位移校验；超限直接复位 |
| 持久实例的内存泄漏 | 成员离开即释放；每小时自检；实例空闲 30 分钟可回收并按需重建 |
| 原版路面裁剪规则（2 km）与负坐标 | 城市整体平移到正坐标；裁剪范围参数化；用 `world.test.mjs` 的方式加回归测试 |

## 7. 需要你拍板的事

1. **地图名字**：暂定"卡丁城"（海湾叫卡丁湾、河叫泡泡河），可以换。
2. **尺寸**：2.4 km（本图）还是收到 2.0 km（不碰路面裁剪规则，环城高速改为 ±850）。
3. **先做 M0 原型**（现成竞技场地图，一两周可玩）再建城，还是直接从 M2 建城开始。
4. **一条线路的人数**：60（本文）还是 30/100。
5. **是否要昼夜循环与季节装饰**（M5，可后置）。
6. **是否接受"从现有赛道里抠地标模型"**，还是全部程序化生成。

## 8. 实施状态（2026-10-11）

用户拍板：名字「卡丁城」、2.4 km、不做 M0 原型直接建城、要昼夜循环、尽量带天气、地标从现有赛道抠。入口在首页「快速进入」第一项，点击直接进入节点上的城市线路（没有房间列表），双击 Esc 回首页。

**v2（2026-10-11 第二版，用户反馈第一版程序化城市"完全不可用"，要求参考官方地图的摆放排布）**：城区直接搬用整条官方赛道——网格、贴图连同路面碰撞属性、围栏、房屋与动画控制器一起放进一个带位移的组节点，所以城区的摆放排布就是原版美术的排布。地图数据 `city-map.data.mjs` 的 `DISTRICTS` 给出赛道 id、路面范围（`tools/city/track-topdown.mjs` 量得）、摆放中心与入口；建城脚本 `tools/city/city-districts.mjs` 放置赛道、按入口方向裁出走廊、把赛道路线导出为 city-map.json 的 `district` 道路（最近道路复位、小地图）和出生点。走廊规则：入口先从路面范围边缘向内吸附（2 m 一步、最多 120 m）到与路线道路高度相差 `snapTolerance`（默认 8 m）以内的地面，街道铺到吸附点再多搭 4 m；以吸附点向内 `corridorInward`（默认 12 m）、向外到路面范围边缘再加 `reach`（默认 12 m）为范围，街宽加 6 m、上下 −30/+40 m 的盒子里，只保留最高点不高于街面 2.5 m 的水平路面三角形（原版的路、坡底），其余（围栏、看台、斜坡、树、装饰）全部裁掉；城区整体下沉到吸附点内侧 3 m 处的地面高度，使街道与它齐平。赛道里 `surface=리셋` 的复位属性一律去掉（否则会把车复位到环线）。

| 城区 | 官方赛道 | 摆放中心 | 入口 |
| --- | --- | --- | --- |
| 中央广场 | village_B04（城镇旗帜竞技场＝体育场：平坦环形平台围着下沉 3 m 的草地场地，四周看台；`reach: 110` 穿过看台、`corridorInward: 90` 顺坡裁开场地围栏） | (0, 0) | 东南西北四条主干道，穿看台接到环形平台 |
| 城镇老街 | village_I02（运河街区，一圈 2 km） | (−620, −560) | 东门 ← 北街 |
| 小屋街 | village_I04（居民区，一圈 1.6 km） | (600, −600) | 南门 ← 小屋街路 |
| 森林公园 | forest_I01（木隧道、吊桥） | (−600, 580) | 北门 ← 林荫道 |
| 冰雪游乐园 | ice_I02（冰川与雪道） | (620, 600) | 南门 ← 游乐园路 |

连接道路：环城高速（±1120，闭合路线图主环）、十字主干道、三条街区道路；路面用原版贴图、两侧城镇围栏，路口与入口留口。地形为平地草地（城区自带地面）。容器 `track_kartcity.rho` 约 5.4 MB、199 个文件、2.3 万碰撞三角形。

| 模块 | 状态 |
| --- | --- |
| 建城流水线 | `client/tools/city/build-city.mjs`（v2 主流程）、`city-districts.mjs`（整赛道导入）、`city-roads.mjs`、`city-terrain.mjs`、`analyze-tracks.mjs`/`track-topdown.mjs`（量官方赛道：范围、路线、门宽、俯视图）；`track.1s` 编码器与 Rho 打包器不变 |
| 服务端 | `server-go/internal/game/city/`（协议见 `server-go/CITY.md`）：常驻线路、AOI 运动帧转发、聊天/状态/复位、昼夜与天气时钟；管理方法尚未接管理后台 |
| 客户端 | `client/src/city/`：复用多人比赛管线、动态车队、名牌与气泡、最近道路复位（含城区赛道高程）、状态栏、昼夜与雨雪 |
| 已验证 | 浏览器实测：体育场广场从四个方向穿看台、下坡进场再从对面开出；老街、小屋街、森林、冰雪四个入口开进城区道路；广场出生点在场地中 |

选广场时扫过全部赛道的平整度（路面面积、水平占比、高度分位）：village_B02 是中央深坑的倾斜碗形场地，不能做枢纽；village_C005/C106（驾校练习场）太大太空；village_B04 体育场平坦（96% 水平、高差 6 m）且尺寸合适（380 × 310 m）。

**还没做（v2 缺口）**：连接道路两侧还没有摆房屋/树木/路灯（计划从官方赛道抠子树按原版间距摆放）；表情与喇叭表现层；传送门开房、车库/商店/俱乐部/小屋入口；城市金币；车与车碰撞（刻意关闭）；远端车插值；状态栏仍是 DOM 文本；管理后台城市页面。调试传送（`__kartcity.teleportLocal`）连续跨城区会触发服务端 CHEAT 踢出，正常驾驶不受影响。

## 9. v3：Blender 建城 + Tripo AI 道具（2026-10-11 第三版）

用户要求：按跑跑卡丁车的风格全部重新设计一张卡丁城，用 Blender 设计后导出；所有 3D 模型素材用 Tripo（文生 3D）生成，风格覆盖跑跑卡丁车的各种主题；要低模，不要太多三角面；城市、隧道、高楼这类也用它生成。

**布局**（`client/tools/city/blender/kartcity.py`，Blender 5.2 无头运行）：圆形中央广场（r 90，喷泉 + 路灯 + 花坛 + 长椅，六座城门）；六条放射大道（0°/60°/…/300°，宽 14）从广场到 r 620 的环城高速（宽 16，路线图主环，每 100 m 一道门）；大道之间六个 60° 扇区，各一条 r 370 的环街（宽 10）和一条通向地标的支路：摩天城区（北，高楼、商场、车站、加油站、混凝土隧道）、冰河乐园（东北，冰城堡、冰屋、雪松、企鹅、冰洞）、阳光海滩（东南，灯塔、海滩小屋、棕榈、泻湖）、城镇小屋（南，小房子、风车、公交站）、金字塔沙漠（西南，金字塔、狮身人面像、仙人掌、方尖碑、沙漠集市、沙岩门）、森林公园（西北，松树、橡树、木屋、瞭望塔、蘑菇、树篱隧道）。环外是草地与树到 ±1200 的边界围栏。路面、路缘（b_side）、围栏、草地、沙地、冰面、海水都用官方主题贴图（按名字引用，转换时从镜像取原图）。

**素材**（`assets.mjs`，66 个）：Tripo `P1-20260311` 文生 3D，`face_limit` 300–4000、无 PBR、`auto_size`，提示词统一带"KartRider ×× theme, cute cartoon, chunky low-poly, hand-painted"后缀与负面词；glb 存 `design/open-world/tripo/`（LFS，每个一份 `<id>.json` 记录提示词/任务号，生成不可复现所以永不重生成），key 在本机 `~/.config/kartsim/tripo.env`。Blender 导入后按设计尺寸缩放（隧道按三轴拉伸并下沉到路面）、超预算减面、贴图缩到 512，并给每个道具加不可见碰撞体（kr_collider：盒 / 圆柱 / 柱，贴全透明贴图 + alpha test，带路面属性）；隧道与桥不做碰撞（AI 内部结构不保证能开）。

**转换**（`import-city.mjs`）：读 glb（`glb.mjs`）与 `kartcity-design.json`，材质自定义属性 kr_texture/kr_theme/kr_road/kr_alpha/kr_cull/kr_collider 决定贴图与碰撞，Tripo 材质的 baseColor 图直接进容器；按 240 m 分块合并网格；环城高速采样成路线记录；写小地图、track.xml、天空穹顶，打包注册 `track_kartcity.rho`（约 17 MB，57 万三角形、1.9 万碰撞三角形），并把设计 JSON 写到 design/、client/src/city、server-go。一键：`node tools/city/blender/blender-city.mjs all --mirror <主检出> --register-into <检出>`（分步：assets / props / build / import）。`kartcity.blend` 在 `client/build/blender/out/`（5 秒可重建，不入库），可直接用 Blender 打开修改。

**已验证**：无头浏览器 60 fps；出生点（东南大道）开到广场被喷泉碰撞体挡住；六个城区状态栏正确；城市隧道可穿行；各城区截图外观符合卡丁车风格。**缺口**：道具两两之间只按包围圆避让；隧道/桥仅装饰；环街与大道交叉处的路面叠层用略高的路口圆垫遮盖；没有昼夜灯光的发光贴图；官方道具库（`export-props.mjs`，36 个 OBJ）暂未摆进城里。
