# 地图工坊（自制地图）

玩家在地图工坊（`client/editor.html`）里用官方赛道的物件、贴图拼一张地图，浏览器自己生成与官方赛道同格式的赛道包（`track_custom_<id>.rho`），发布到数据服务。所有人都能在“单人游戏 → 自定义游戏”里玩到它，多人竞速房可以选它，放了道具箱的地图道具房也能选，其他玩家进房时自动下载。本文是数据服务一侧的约定。

## 1. 赛道 id

| 用途 | 赛道 id | 容器挂载目录 |
| --- | --- | --- |
| 已发布地图 | `custom_<地图 id>` | `track_custom_<地图 id>/` |
| 本机草稿（只在作者本机的计时赛里出现） | `custom_<地图 id>_draft` | `track_custom_<地图 id>_draft/` |

地图 id 是 6–16 个小写字母或数字（编辑器随机生成 10 位）。赛道 id 满足游戏节点的 `identifierPattern`，普通、组队、抓地、幽灵、RP 房间不需要改动就能接受；巨人模式、乱斗、挡人和 LTE 不会选到自制地图，随机赛道也只从官方赛道里抽。

道具赛：数据服务的全局大厅给 `lobby.Options.CustomItemTrack` 一个内存表（`itemMapSet`：未隐藏且 `items > 0` 的已发布地图，启动后每分钟刷新，发布、下架、隐藏时立即刷新），道具房的 `track` 请求除了 `itemmode.json` 的官方道具赛道，也接受表里的 `custom_<id>`；草稿 id 和节点自己的大厅（没有这张表）一律 `TRACK_NOT_ITEM`。节点的道具赛对未知赛道用零值 `itemmode.Track`（level 0，不触发 `trackTransforms`），道具箱请求只按 1..4096 编号检查；反作弊插件对未知赛道跳过赛道相关的道具箱检查。客户端的道具箱来自赛道包里的 `ToItemCube`（编号 1..N，离路面 1.2 米，一排间距 3.85 米），外观用地图主题的道具箱模型。

计时赛结算只认 `internal/data/economy/tracks.json` 里的官方赛道，自制地图返回 `INVALID_TRACK`，客户端按“不发奖励”处理；排位与回放同理。多人比赛结算照常（内部接口只检查赛道 id 长度），反作弊插件遇到未知赛道时跳过赛道专属检查。

## 2. 存储（schema v20、v21）

- `custom_maps`：列表需要的字段——作者、名字（1–24 字）、主题、圈数（1–9）、难度（1–5）、`road_extent`（碰撞网格范围，客户端用它注册元数据）、`items`（道具箱个数，v21；0 表示只能竞速）、容器内文件清单 `files_json`（`[{path,size}]`）、容器的 SHA-256 与大小、`hidden`、创建与更新时间。作者账号删除时级联删除。
- `custom_map_files`：设计文件（JSON）、赛道包（LONGBLOB，最大 40 MB）、选图卡片 `card`（352×206 PNG）与缩略图 `thumb`（222×130 PNG）。列表查询不读这张表。

每个账号最多 20 张地图（`mapsPerAccount`）。同一个 id 再次发布即更新（只限作者），容器和哈希一起换掉。

## 3. 接口

公开（不需要登录）：

| 路径 | 说明 |
| --- | --- |
| `GET /api/maps` | `{maps: [摘要…]}`，未隐藏的地图，最近更新在前。摘要：`id, name, author, theme, laps, difficulty, roadExtent, items, files, sha256, size, createdAt, updatedAt` |
| `GET /api/maps/{id}` | 一张地图的摘要；不存在或已隐藏 404 `MAP_NOT_FOUND` |
| `GET /api/maps/{id}/container` | 赛道包（`application/octet-stream`） |
| `GET /api/maps/{id}/card`、`/thumb` | 选图卡片与缩略图（PNG） |
| `GET /api/maps/{id}/design` | 设计文件（JSON，编辑器“打开”已发布地图时用） |

文件接口带 `?v=<sha256>` 且与当前版本相同时返回 `Cache-Control: public, max-age=31536000, immutable`，否则 `no-cache`；都带 ETag。隐藏的地图在这些公开接口里一律 404 `MAP_NOT_FOUND`。

需要登录（`Authorization: Bearer <会话令牌>`，与游戏共用）：

| 路径 | 说明 |
| --- | --- |
| `GET /api/maps/mine` | 自己的地图（含隐藏的） |
| `POST /api/maps/{id}` | 发布或更新。`multipart/form-data`：`meta`（JSON：`id,name,theme,laps,difficulty,roadExtent,items,files`，`items` 为 0–2048，`id` 必须与路径相同）、`design`（JSON）、`container`、`card`、`thumb`（PNG）。成功返回摘要。整个请求最大约 46 MB，单独的 3 分钟期限（不受 `requestTimeout` 限制） |
| `POST /api/maps/{id}/delete` | 下架（删除）；作者或管理员（管理员删别人的地图写日志 `admin map deleted`）。用 POST 是因为共享 CORS 策略只允许 GET/PUT/POST |

管理员（管理后台“自制地图”标签页，`ADMIN.md` 第 9 节；非管理员 403 `ADMIN_REQUIRED`）：

| 路径 | 说明 |
| --- | --- |
| `GET /api/admin/maps` | 全部地图（含隐藏的），按 `ADMIN.md` 第 3 节的列表约定分页：`q` 匹配地图名、作者用户名与昵称，ASCII 时还有地图 ID 与作者账号 ID；`state=public\|hidden`；`account`（作者的账号 ID 或用户名）；`from`/`to` 作用于更新时间；排序 `updatedAt`（默认）、`createdAt`、`name`、`size`、`items`。行：`id, name, ownerId, username, author`（作者昵称）`, theme, laps, difficulty, roadExtent, items, files`（赛道包里的文件数）`, size, sha256, hidden, createdAt, updatedAt` |
| `GET /api/admin/maps/{id}/{file}` | 与公开的文件接口相同（`container`、`card`、`thumb`、`design`），但隐藏的地图也返回，供后台预览；`Cache-Control` 为 `private`（带当前 `?v=` 时 `private, max-age=31536000, immutable`，否则 `private, no-cache`） |
| `POST /api/admin/maps/{id}/hidden` | `{hidden}` 从公开列表隐藏或恢复 → `{hidden}`；写日志 `admin map hidden` |
| `DELETE /api/admin/maps/{id}` | 永久删除任何人的地图（文件一起删除）→ `{ok: true}`；写日志 `admin map deleted`（管理员、地图 id、名字、作者账号） |

错误码：`LOGIN_REQUIRED`（401）、`MAP_NOT_OWNER`（403，id 属于别人）、`MAP_NOT_FOUND`（404）、`TOO_MANY_MAPS`（409）、`MAP_TOO_LARGE`（413）、`INVALID_MAP`（400：字段越界、文件名不合法或重复、缺 `track.1s` / `xt_minimap.png` / `xt_trackCard.png`、设计不是 JSON、卡片不是 PNG）。

服务端不解析赛道包本身：它只是作者浏览器生成、其他玩家浏览器读取的数据，与玩家上传的影子记录同样对待。

## 4. 客户端

- 编辑器：`client/editor.html` → `client/src/mapeditor/editor/`。设计数据 `src/mapeditor/design.ts`，生成器 `src/mapeditor/track-builder.ts`（道路样条 `road-geometry.ts`，官方物件 `source-tracks.ts`），服务端接口 `map-service.ts`，本机草稿 `draft-store.ts`（IndexedDB）。
- 简单模式（缺省）：像玩游戏一样操作，说法都是大白话，框体全用原版 `frame.bml`。底部素材栏（`editor/dock.ts`）分赛道（形状模板 `templates.ts`、路面、护栏）、建筑、自然、路边、机关道具（加速跳台、道具箱）、装饰、环境（主题套装、天空、地面）七类，每样素材都有缩略图，鼠标停留时右边转着显示大预览（`editor/preview.ts`），选中/放置中/使用中的卡片套原版选中圈和角标。视口上是游戏界面（`editor/hud.ts`）：左边工具条（选择、画赛道、拆除），右上任务卡（铺赛道 → 摆 10 样东西 → 放道具箱 → 开车试玩 → 分享，带热闹度星星），选中的东西头顶弹出原版说话气泡里的一排按钮（转向、变大变小、抬高降低、复制、删除；赛道是变宽变窄、装护栏、换路面、掉头），正在做的动作在底部动作条里，右下是视角按钮。拖动空地移动视角、WASD 也能移动，按住任何东西直接拖走（`editor/tools.ts`）。放东西时滚轮转方向（不缩放视角），长按左键 0.35 秒后上下拖动调离地高度（物件跟着鼠标升降，有竖线指到地面，动作条显示高度和“贴地”），按住立刻拖动则连着放。地图改动 1.5 秒后自动存到本机。第一次打开和“新地图”是向导（`editor/wizard.ts`）：选主题套装和赛道形状，可勾“路边自动种树、摆路灯”和“放道具箱”（`decorate.ts`），一步得到能试跑的地图。“更多 → 高级模式”保留原来的整条官方赛道取件、变换手柄和全部数值。
- 道路自动修顺（`road-settle.ts`）：画完、闭合、拖完路点、抬高降低、变宽变窄时在同一步里去掉挤在一起的点（闭合时落在起点旁边的点）、把内侧会翻折的急弯往外修圆、路点抬到地面上方 0.3 米、超过 22% 的坡分摊给两头；路点之间的高度用单调三次插值（`road-geometry.ts`），不会冲到地面下面露出草地。旧地图打开时贴地的路点自动抬高。
- 素材目录：`src/mapeditor/catalog/catalog.json` 加 `sheet-N.webp` 雪碧图（96 像素一格，`catalog.ts` 读取），由 `client/tools/mapeditor-catalog/build.mjs` 生成：`select.mts` 扫全部官方赛道，按贴图名关键词把物件分成 12 类、按贴图组合去重，每个主题每类留出现最多的几种，路面/护栏/地面贴图和天空同理；再由无头 Chrome 打开开发服务器上的 `render.html`，用游戏装配（`c5`）把每样素材画成缩略图，画不出来（空白、读不到贴图）的跳过。换资源版本或改分类规则后重新生成：`node tools/mapeditor-catalog/build.mjs --origin http://127.0.0.1:8780`（先 `npm run dev`）。
- 游戏：启动后 `custom-map-loader.ts` 登记本机草稿与 `GET /api/maps` 的地图，只放文件条目，比赛载入时才下载赛道包（卡片和缩略图走单独的小文件）。`track-catalog.ts` 的 `timeAttackTrackCatalog` 与 `trackMetadata` 带上这些地图；多人选图滤掉草稿，并在打开前刷新列表；房间卡片和比赛载入遇到没见过的 `custom_*` 赛道会先向数据服务取摘要。
- 试跑：编辑器把赛道包存进 IndexedDB 后打开 `/?testmap=<地图 id>`，游戏回到首页后翻到计时赛页面并选好草稿（`test-drive.ts`）。
- 单人游戏 · 自定义游戏：单人游戏标题栏上的按钮打开 `ui/custom-game-window.ts`（发行版窗口渲染器）：全部地图（`GET /api/maps`）与我的地图（`/api/maps/mine` 加本机草稿），开始计时赛、用地图工坊打开（`/editor.html?open=<地图 id>`）、下架或删除草稿、制作新地图。
- 道具赛：`itemTrackCatalog` 带上已发布、`items > 0` 的地图（随机卡片不含自制地图），道具房选图前也刷新列表。
- 导出：地图包 `.kartmap`（zip：`map.json` 清单、`design.json`、`track_custom_<id>.rho`、`card.png`、`thumb.png`；导入时文件表与哈希从赛道包本身重新算，`map-package.ts`）、赛道包 `.rho`、设计文件 `.json`。
- 部署：Docker 的 Nginx 给 `^/api/maps/<id>$` 单独放宽请求体到 48 MB（`client/docker/default.conf.template`）。
