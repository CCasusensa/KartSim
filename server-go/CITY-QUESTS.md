# 卡丁城任务

本文是卡丁城（[`CITY.md`](CITY.md)）任务点人物（[`CITY-NPC.md`](CITY-NPC.md) §5）身上的任务：在一个 NPC 那里接下任务，做完后到收件人那里交付，按路程结算金币和经验。共四种类型：

| 类型 | 界面名 | 要做什么 |
| --- | --- | --- |
| `delivery` | 送货 | 把托付人的物品送到收件人那里 |
| `passenger` | 载客 | 托付人坐进你车的后座，送到收件人那里；开得平稳有小费 |
| `collect` | 收集 | 开到每个收集点（地图上的“★”），收齐后交给收件人 |
| `search` | 寻物 | 失物藏在一片范围里（地图上的圆圈），凭信号找到它，再交给收件人 |

## 1. 任务数据

任务、人物背景故事和对话写在 `client/tools/city/quests/city-quests.data.mjs`，生成脚本算出路程、时限、报酬和寻物候选点，写三份相同的 `city-quests.json`：

| 文件 | 用途 |
| --- | --- |
| `design/open-world/vice-city/city-quests.json` | 设计副本 |
| `client/src/city/city-quests.json` | 浏览器（对话、任务卡、头顶标记、地图、结算） |
| `server-go/internal/game/city/city-quests.json` | 节点（`go:embed`；`TestEmbeddedQuestsMatchDesign` 检查与设计副本一致） |

```bash
node tools/city/quests/build-city-quests.mjs          # 在 client/ 下；--check 只比较
```

人物站位改了（`build-city-npcs.mjs`）或车道网络改了，都要重跑。

- **路程**：托付人、收件人、收集点、寻物范围中心各取最近的车道点，沿车道网络算最短道路距离（玩家开车不受车道方向限制，所以每条车道当作双向，路口按中心点连接），加上从人物站位走到车道的距离。收集任务按“每次去最近的下一个点”的顺序串起所有收集点再到收件人（数据里的 `stops` 就是这个顺序）；寻物任务是托付人到范围中心 + 2 × 半径（搜索）+ 范围中心到收件人。
- **报酬**：金币 = (60 + 90 × 公里) × 类型倍率 × 限制倍率，取整到 10；经验 = (25 + 35 × 公里) × 两个倍率，取整。
- **类型倍率**：送货 ×1.0、载客 ×1.1（另有小费）、收集 ×1.2、寻物 ×1.3。
- **限制与倍率**（`rules.kinds`，任何类型都可以带）：

| 类型 | 界面名 | 倍率 | 要求 |
| --- | --- | --- | --- |
| `normal` | 普通 | 1.0 | 无 |
| `speed` | 限速 | 1.4 | 全程车速不超过 `maxKmh`，超出持续 1 s（`speedGraceMs`）即失败 |
| `collision` | 小心驾驶 | 1.5 | 碰撞不超过 `maxCollisions` 次 |
| `time` | 限时 | 1.6 | `timeLimitMs` 内完成；时限 = 路程 ÷ 15 m/s + 30 s（寻物再加 60 s），向上取整到 5 s |

- **载客**（`rules.passenger`）：乘客满意度从 100 起，每次碰撞扣 15，车速超过 80 km/h 每秒扣 4，扣到 0 乘客要求下车（失败）。小费 = 金币报酬 × 0.3 × 满意度 ÷ 100，取整到 10，和报酬一起结算。
- **收集点**：离收集点 10 m（`pickupRadius`，节点再放宽 4 m）内就算拿到，开车、步行都可以。
- **寻物**（`rules.search`）：范围里沿车道取 4 个分散的候选点（`area.spots`），节点每次接任务随机藏在其中一个；离失物 10 m 内就算找到。信号按离失物的距离分 5 格：25 m 内 5 格、60 m 内 4 格、120 m 内 3 格、200 m 内 2 格，更远 1 格。

当前 13 位任务点人物、35 个任务：送货 21、载客 5、收集 5、寻物 4；路程 0.4–4.3 km，报酬 110–830 金币、43–325 经验。

## 2. 协议

三个命令走游戏节点的城市 WebSocket（与 `city-respawn` 等相同，`CITY.md` §2）：

| 命令 | 字段 | 说明 |
| --- | --- | --- |
| `city-quest-accept` | `quest` | 站在托付人身边（12 m，节点再放宽 4 m 给旧姿态）接任务；载客任务要坐在驾驶座、后座空着。答复 `{"type":"city-quest", quest, questType, runId, startedAt, deadline, collisions, …进度}`（节点毫秒；`deadline` 为 0 表示不限时） |
| `city-quest-abandon` | — | 放弃当前任务，没有报酬 |
| `city-quest-deliver` | — | 在收件人身边交付（收集要收齐、寻物要找到）；答复 `{"type":"city-quest-done", quest, elapsedMs, collisions, exp, lucci, capped, levelUps, walletLucci, totalExp, level}`，载客另有 `satisfaction`、`tip` |

进度字段按类型：载客 `satisfaction`（0–100），收集 `collected`（按 `stops` 顺序的布尔数组），寻物 `found`、`signal`（1–5）。

错误码：`CITY_QUESTS_OFF`（节点没配数据服务）、`INVALID_QUEST`、`TOO_FAR`、`QUEST_ACTIVE`（一次只能接一个）、`NO_QUEST`、`RATE_LIMITED`（每秒 2 个，突发 4 个）、`NOT_DRIVING`、`SEAT_TAKEN`（载客）、`NOT_COLLECTED`、`NOT_FOUND`。

下行事件（只发给本人）：

- `city-quest-progress {quest, collisions, …进度}`：碰撞计入（小心驾驶、载客）、满意度变化（碰撞时立刻，车速扣分时最多每 0.5 s 一次）、拿到收集点、找到失物、寻物信号变化（1 Hz）。
- `city-quest-failed {quest, reason, collisions}`：`reason` 为 `SPEED`、`COLLISION`、`TIMEOUT`、`TELEPORT`、`UNHAPPY`（乘客不满）或 `EXITED`（载客时离开驾驶座）。

载客期间司机的车 `city-vehicle` 里多一个 `npcPassenger`（乘客的人物 id），全线路都能看见后座上的人物；这辆车的后座不再让玩家上（`VEHICLE_FULL`）。

## 3. 节点判定（`internal/game/city/quest.go`）

- 车速和碰撞取自本人的运动帧：kind 3（108 字节表现载荷）偏移 80 的 `forwardSpeed`（float32，m/s），偏移 104 的碰撞序号（uint32）；没有表现载荷时用节点按位置算出的速度。碰撞序号一帧最多计 5 次（序号回绕或重置不算连撞），接任务后的第一个序号只作起点。
- 收集点、寻物按每帧的位置判定；寻物信号在线路的 1 Hz 心跳里更新，限时任务也在心跳里检查，过了 `deadline` 即失败。
- **任务要开过去**：节点替成员移动位置（`city-respawn` 到任意点、道路救援拖车）一次超过 150 m，或本次任务累计超过 300 m，都算 `TELEPORT` 失败。掉进水里、按 R 复位到旁边的路不受影响。
- 载客时离开驾驶座（`city-exit`）即 `EXITED` 失败；离开卡丁城（断线、换线、回大厅）时任务直接作废。
- 交付时节点在线路锁外调用数据服务（5 s 超时），期间这单不再判定失败。

## 4. 结算（数据服务）

节点调用内部接口 `POST /internal/v1/city/quest/reward`（`contract.CityQuestRewardRequest {accountId, runId, questId, exp, lucci}`，载客的 `lucci` 含小费）。数据服务（`store.SettleCityQuest`）：

- 先乘后台经济设置里的经验、金币倍率（`rewards.ApplyRate`），再记账，账目原因 `cityquest`、引用 `runId`，同一 `runId` 只记一次（重试不会重复发）。
- 每个北京日最多 50 单有报酬（`daily_rewards` 计数 `cityquest`），超出的照常完成，`capped` 为真、报酬为 0。
- 经验升级时按比赛相同的等级奖励发放，`levelUps` 列出每一级及其奖励。

## 5. 浏览器（`client/src/city/`）

- `city-quests.ts`：走到任务点人物 12 m 内，HUD 提示“T 与某某对话”。按 T 打开故事模式的对话窗口（`stage_scene`，人物立绘与背景见数据里的 `sprite`、`background`），每次进城第一次和某人说话先讲他的背景故事，再说委托；读完后是故事模式的任务卡（`stage_scenarioReady`，左上角写类型和限制，插图按类型用原版的 `mq_배달`（送货）、`mq_멀티`（载客）、`mq_주행거리`（收集）、`mq_추격`（寻物），左下角画收件人的立绘），按“开始”接任务。载客任务没坐在驾驶座上时人物会提醒“你得开着车来接我呀”。接了任务再找托付人按 T 会问要不要放弃。
- 头顶标记（`city-quest-markers.ts`）：有任务可接的人物头顶浮着金色“!”；能交付时收件人头顶是金色“?”；还没到的收集点上空浮着金色“★”。
- 后座乘客（`city-quest-passenger.ts`）：`npcPassenger` 的车后座上坐着那位人物（同一套步行人物模型，用原版坐车动作 `f00`），人物原来站的地方暂时空着。
- M 地图（`city-map-window.ts`）：能交付时在收件人位置画“?”，收集点画“★”，寻物范围画金色虚线圆圈；打开地图时自动缩放到能同时看到自己和这些标记；目标在视野外时“?”贴在地图边缘、箭头指向目标。
- 任务 HUD：屏幕上方一行显示类型、物品 → 收件人、方位和直线距离（收集时指向最近的收集点，寻物时在范围外指向范围），以及满意度、收集进度或寻物信号格；限速任务显示车速，小心驾驶显示碰撞次数，限时任务另有原版倒计时（`missionTimer.bml`）。
- 到收件人 12 m 内（能交付时）自动交付。成功或失败都在屏幕中间播放原版任务结果动画（`missionSuccess` / `missionFail`，跳过原版为终点横幅预留的约 1.9 s 空白，放大 1.8 倍居中），然后成功时道谢（载客由乘客自己道谢，其余由收件人），再弹出“任务成功”结算窗口（用时、路程、收集数、满意度、倍率、小费、获得金币和经验、升级奖励、现有金币）；失败时弹出“任务失败”窗口（原因、限制、可以回去重接）。
- 本机记录每个任务做过几次（`localStorage` 的 `kartsim.city.questsDone`），找同一个人时先给做得最少的任务。

## 6. 操作说明（`city-help-window.ts`）

H 或 F1 打开卡丁城操作说明（第一次进城时自动打开一次，`localStorage` 的 `kartsim.city.helpSeen`），原版 CaptionDialog 里分“驾驶”“城市”“任务”三页：驾驶页按玩家在“设置 → 按键”里的键位显示（原版 22 个绑定），城市页是 E/L/M/G/F/H 和步行键，任务页说明四种任务、限制和报酬。←/→ 或 1/2/3 换页，确定、Esc、Enter、H、F1 关闭；打开时暂停驾驶、隐藏顶部状态栏和任务 HUD。
