# 单人计时赛：练习目标、赛道对决、排位计时赛与录像观看

本文是单人游戏 计时赛 三个入口在数据服务一侧的约定，补充 `ECONOMY.md` 2.2（计时赛结算）。前端在 `client/src/timeattack/`（`timeattack-api.ts`、`ready-ranking.ts`、`ready-duel.ts`、`ready-replay.ts`、`replay-session.ts`）与 `client/src/ui/`（`ready-missions.ts`、`ranking-ready-window.ts`、`replay-console.ts`）。

| 入口（原版资源） | 说明 |
| --- | --- |
| 练习计时赛 `stage_timeAttackReady`（标签页 赛道对决 / 练习目标） | 第 1、2 节 |
| 排位计时赛 `stage_rankingTimeAttackReady` | 第 3 节 |
| 录像观看 `stage_replay`（OB 视角） | 第 4 节 |
| 竞争排位赛 | 未实现，入口提示"暂未开放" |

原版网页版只实现了练习计时赛，赛道对决、练习目标、排位榜和回放舞台只有布局资源；这里的规则是按这些布局与原版数据自定的。所有记录以**数据服务**为准；浏览器本地的影子记录（IndexedDB）只用于"我的幻影"。

## 1. 练习目标（training goals）

- 数据来自原版 `zeta_/cn/content/timeAttack/timeAttackMission.xml` 的 `trainingMissionListSet`，由 `client/tools/export-timeattack-missions.mjs` 导出为 `internal/data/timeattack/missions.json`（`go:embed`）；334 条赛道各有 4 组目标（未在镜像中的赛道 `village_R07` 跳过）：

| 类型 | 原版 type | 统计 |
| --- | --- | --- |
| 完成赛道 `finish` | 无 | 完成次数，累计（阶段 1–5：1/2/3/4/5 次） |
| 使用加速器道具 `booster` | 0 | 完成时累计加速次数（5/10/15/20/25） |
| 撞击次数 %s 次以内 `crash` | 1 | 每阶段单独计数：以不超过该阶段 requirement 的撞击数完成 N 次，阶段依次开放 |
| 达成赛道纪录 `record` | 2 | 一次以不超过 requirement 的成绩完成（隐藏目标，卡片照常显示目标时间） |

- 进度在 `POST /api/timeattack/settle` 带 `mode:"practice"` 时推进（见第 3 节的请求体）；只有练习模式计入，排位与赛道对决不计。
- 达成的阶段在窗口里"领取奖励"：`POST /api/timeattack/goals/claim`，奖励进奖励箱（来源 `timeattack`，消息"练习目标：<标题> N阶段"）；RP（原版 rewardType 3）直接加经验；stock（原版 rewardType 1）按原版 `stock.kml` 展开成道具。
- 表 `timeattack_missions(account_id, track_id, mission, value, cleared_at, claimed_at)`：`goal:<组>`（累计值）、`goal:<组>:<阶段>`（撞击类每阶段）、`claim:<组>:<阶段>`（已领取）。

## 2. 赛道对决（duel）

- 同一数据文件的 `duelMissionList`：按期间举办的活动，每期一条赛道、三个 NPC 阶段（名字、人物、车、喷漆、染色、对白、难度表、胜利奖励）。导出时保留两期（`tomb_R05` 2026-09-24~10-08、`tomb_I09` 2026-10-08~10-22，北京时间）；`GET /api/timeattack/missions` 返回当前进行中的一期（没有则 `duel: null`）。
- 每个阶段的 NPC 是原版录像 `zeta_/cn/content/timeAttack/ksv/<ksv>.ksv`（DataPack4，属于必需的"首页"资源组）：比赛里浏览器把它当对手影子播放（`client/src/timeattack/ready-duel.ts`），和其他 .ksv 一样从倒计时开始计时（第 7 秒 GO），保留录制时的起跑槽位，人物、车、喷漆、染色按任务的 `npcId` / `itemOn` 换装。阶段目标时间 `targetMs` = 该录像的最好成绩（导出时写进 `missions.json` 的 `npcTimeMs`，例如 `tomb_I09` 小乖 / 黑妞 / 皮蛋 = 1:58.04 / 1:54.76 / 1:51.29）。
- 胜负由数据服务判定：完成且 `elapsedMs < targetMs + 难度让步`。难度设定（原版 difficulty）：在一个阶段每累计落败 3 次（原版 point）解锁一级，NPC 晚 1 / 3 / 5 秒出发；解锁后一直可选。第一次赢得阶段发放原版胜利奖励，在某难度等级下第一次获胜另发该等级的特别奖励；都进奖励箱。
- 阶段依次开放（`DUEL_STAGE_LOCKED`）；对决比赛不计练习记录、不计计时赛奖励。
- 行：`duel:<赛道>@<开始时间>:<阶段>`（value = 落败次数，cleared_at = 首胜）、`duelbonus:…:<难度>`。

## 3. 排位计时赛（ranked）

- 每条赛道按（速度、加速模式）各一张榜；排位成绩与练习成绩分开记录（`timeattack_records.mode`）。
- 开始前先付入场费 **500 金币**（`timeattack.RankedEntryLucci`）：`POST /api/timeattack/ranked/enter`，按 `requestId` 幂等（同一请求只扣一次）；流水原因 `rankedentry`。结算用同一个 `requestId`（`mode:"ranked"`），没有未使用的入场记录、或赛道/速度/模式不符时 409 `NO_RANKED_ENTRY`；入场记录 24 小时后由每小时清理任务删除。
- 排位跑次同样享受 2.2 的经验/金币奖励与每日上限、节奏限制。
- 前 **10 名** 的录像（本局的 `.ksv`，浏览器用幻影编码上传，base64，≤ 512 KB）保存在 `timeattack_replays`；刷新排位纪录时覆盖，掉出前十的录像删除。
- 排名按最佳成绩升序，同成绩先到者在前。

| 路径 | 说明 |
| --- | --- |
| `POST /api/timeattack/settle` | 2.2 的请求体另可带 `mode`（`practice` / `ranked`，不带为原样结算）、`speed`、`booster`、`kart{itemId,systemKey,name}`、`crashCount`、`boosterCount`、`replay`（排位：base64 .ksv）；回应另带 `modeBestMs`、`modeNewRecord`、`rank`、`topTen`。400 `INVALID_SPEED_MODE`、`INVALID_REPLAY`；409 `NO_RANKED_ENTRY` |
| `GET /api/timeattack/ranking?trackId&speed&booster` | `{trackId,speed,booster,rows:[{rank,accountId,nickname,kartName,bestMs,updatedAt,hasReplay,self}],ranked,practice,myRank,fee}`；`ranked`/`practice` 为自己的记录 `{bestMs,kart,crashCount,boosterCount,updatedAt}` 或 null |
| `POST /api/timeattack/ranked/enter` | `{requestId,trackId,speed,booster}` → `{requestId,fee,summary}`；409 `INSUFFICIENT_FUNDS` |
| `GET /api/timeattack/replay?trackId&speed&booster&accountId` | 该排位纪录的 `.ksv`（`application/octet-stream`，带 ETag）；404 `REPLAY_NOT_FOUND` |
| `GET /api/timeattack/missions?trackId` | `{trackId,goals:[{index,title,type,hidden,current,stages:[{stage,count,requirement,value,cleared,claimed,rewards}]}],duel:{key,trackId,track,from,to,stages:[…npc,difficulties,targetMs,rewards],standing:[{stage,open,won,losses,difficulty,bonus}]}|null,recordGoalMs}` |
| `POST /api/timeattack/goals/claim` | `{requestId,trackId,set,stage}` → `{goals,summary}`；409 `GOAL_NOT_CLEARED` / `GOAL_CLAIMED`，400 `INVALID_GOAL` |
| `POST /api/timeattack/duel/settle` | `{requestId,key,stage,difficulty,elapsedMs,finished}` → `{won,targetMs,result:{firstWin,bonus,losses,difficulty,stages},duel,summary}`；404 `DUEL_NOT_ACTIVE`，400 `INVALID_DUEL`，409 `DUEL_STAGE_LOCKED` |

所有路径需要 Bearer（未登录 401 `LOGIN_REQUIRED`）；`speed` 0–9，`booster` 0/1，`trackId` 必须在计时赛赛道表中。

## 4. 录像观看（OB）

- 排位榜上带录像的行可点击观看：浏览器下载 `.ksv`，用原版回放舞台 `stage_replay` 播放（`client/src/timeattack/replay-session.ts`）：被观看的车手作为幽灵参赛者，本机的车不出现、不能开；比赛 HUD（名次、圈数、比赛时间、道具栏、本机速度表）都不画，只留小地图，并以被观看的车手为中心。
- 回放舞台（`client/src/ui/replay-console.ts`）直接加载原版布局，不再自绘：`stage_/replay/mq_window@zz.bml`（操作台：选择车手 1–8 与锁定车手、选择视角面板 A S Q F D V 及其视野扇形、时间条、播放 / 暂停 / 0.5× / 0.25×；左上 帮助 / 比赛资料，右上 退出；帮助框）、放进其 ScreenUI 位置的 `screenui.bml`（时间条两端的比赛时间与记录时间、左上镜头信息、名次列表用 speedIndiGame 的 `ranklist_spot_observer.bml`）与 `tachometer.bml`（右侧速度）。按钮第 4 张状态图表示当前选中（镜头青色、车手白框、当前播放方式变暗）。
- 按键照原版帮助框：1–8 按名次选车手，-/+ 上一个 / 下一个，SPC 锁定车手（关时跟随名次、开时跟随车手），I 比赛资料开/关，F1 帮助开/关，A 第3人称、Q 第1人称、S 俯视、D 正面、E 正面旋转、F 左侧注视、R 右侧注视、V 低角度注视、G 低角度固定、T 高角度固定、H 左侧面、Y 右侧面；方向键按帮助说明调节（A D E 上/下拉近拉远，S 再加左/右旋转，H Y 上/下调高低、左/右拉近拉远）；L、BACK 原版就是“暂时未开放”。Esc 关帮助或退出。原版镜头的具体轨迹在原生客户端里、数据中没有，这里按选择视角面板的示意位置和帮助文字摆放；T 的鼠标自由视角未做。
- 录像只有 10 Hz 的姿态与状态位，没有道具、碰撞与音效；速度表的数值按回放时间由位移算出，指示灯 17 格、250 km/h 满格是估计值。
- 回放标签的三页（`client/src/timeattack/ready-replays.ts`，卡片都按原版 `replayCard` 画，一页 4 张，底部 上一页 / 下一页 与滚轮翻页；点卡片都用同一套 OB 操作台观看，看完回到原来那页）：
  - **联赛回放**：管理后台发布的录像（`GET /api/timeattack/featured` → `{replays:[{id,title,note,trackId,trackName,speed,booster,accountId,nickname,kartName,bestMs,byteSize,createdBy,createdAt}]}`，新的在前；文件 `GET /api/timeattack/featured/replay?id=` 与排位录像一样是 .ksv 字节流，带 ETag）。管理员在后台“联赛回放”页从排位录像池里挑一条，填标题与说明后发布，录像复制进 `featured_replays`（schema v18），之后原记录掉出前 10 名或账号删除都不影响；删除也在后台。卡片标题是发布的标题，说明显示在标题下；车手 / 日期 时间（发布时间）/ 赛道，卡丁车 / 记录 / 设置。
  - **其他回放**：浏览排位榜上别人的录像。页首一张设置卡显示当前赛道与设置（标准速度或无限 / 个人赛或组队赛），“选择赛道”打开原版选赛道窗口（随机赛道不可选），“切换速度”“切换模式”改设置；下面是该赛道、设置的排位榜前 10 名里带录像的记录（`GET /api/timeattack/ranking`，自己的也列出并标“我”），卡片标题是“第 N 名 昵称 成绩”。赛道默认是当前计时赛选中的赛道，设置默认取计时赛的设置。
- "我的回放"（单人游戏页的 回放 标签，`client/src/timeattack/ready-replays.ts`）列出本机影子库里带影子的记录，按原版 `replayCard` 画成一页 4 张卡（标题是赛道与成绩；车手 / 日期 时间 / 赛道，以及卡丁车 / 记录 / 设置两列；右上角 删除；底部 上一页 / 下一页，滚轮翻页）。点卡片用同样的 OB 操作台观看（本机导出 .ksv 后播放，看完回到 回放 标签）；删除先弹确认框。记录日期由完赛写入记录时记在浏览器存储里（`kartsim:replay-dates`），影子记录本身没有时间。

## 5. 存储

`timeattack_records`、`timeattack_replays`、`timeattack_entries`、`timeattack_missions` 在 schema v16 引入，联赛回放的 `featured_replays` 在 schema v18 引入（结构见 `internal/data/store/schema.go`）。kart-data 每小时删除 24 小时前的入场记录。
