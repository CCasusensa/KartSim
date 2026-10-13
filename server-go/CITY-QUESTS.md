# 卡丁城送货任务

本文是卡丁城（[`CITY.md`](CITY.md)）任务点人物（[`CITY-NPC.md`](CITY-NPC.md) §5）身上的 **送货任务**：在一个 NPC 那里接下物品，送到另一个 NPC 的位置，按路程结算金币和经验。目前只有送货一种任务。

## 1. 任务数据

任务、人物背景故事和对话写在 `client/tools/city/quests/city-quests.data.mjs`，生成脚本算出路程、时限和报酬，写三份相同的 `city-quests.json`：

| 文件 | 用途 |
| --- | --- |
| `design/open-world/vice-city/city-quests.json` | 设计副本 |
| `client/src/city/city-quests.json` | 浏览器（对话、任务卡、头顶标记、结算） |
| `server-go/internal/game/city/city-quests.json` | 节点（`go:embed`；`TestEmbeddedQuestsMatchDesign` 检查与设计副本一致） |

```bash
node tools/city/quests/build-city-quests.mjs          # 在 client/ 下；--check 只比较
```

人物站位改了（`build-city-npcs.mjs`）或车道网络改了，都要重跑。

- **路程**：托付人和收件人各自到最近车道点的步行距离，加上两点之间沿车道网络（车道和路口连接线，Dijkstra）的最短行驶距离，取整到米。
- **报酬**：金币 = (60 + 90 × 公里) × 倍率，取整到 10；经验 = (25 + 35 × 公里) × 倍率，取整。
- **限制与倍率**（`rules.kinds`）：

| 类型 | 界面名 | 倍率 | 要求 |
| --- | --- | --- | --- |
| `normal` | 普通配送 | 1.0 | 无 |
| `speed` | 限速配送 | 1.4 | 全程车速不超过 `maxKmh`，超出持续 1 s（`speedGraceMs`）即失败 |
| `collision` | 易碎品 | 1.5 | 碰撞不超过 `maxCollisions` 次 |
| `time` | 限时配送 | 1.6 | `timeLimitMs` 内送达；时限 = 路程 ÷ 15 m/s + 30 s，向上取整到 5 s |

当前 8 个任务点人物、16 个任务（每人 2 个），路程 1.3–3.9 km，报酬 220–620 金币、88–242 经验。

## 2. 协议

三个命令走游戏节点的城市 WebSocket（与 `city-respawn` 等相同，`CITY.md` §2）：

| 命令 | 字段 | 说明 |
| --- | --- | --- |
| `city-quest-accept` | `quest` | 站在托付人身边（12 m，节点再放宽 4 m 给旧姿态）接任务；答复 `{"type":"city-quest", quest, runId, startedAt, deadline, collisions}`（节点毫秒；`deadline` 为 0 表示不限时） |
| `city-quest-abandon` | — | 放弃当前任务，没有报酬 |
| `city-quest-deliver` | — | 在收件人身边交货；答复 `{"type":"city-quest-done", quest, elapsedMs, collisions, exp, lucci, capped, levelUps, walletLucci, totalExp, level}` |

错误码：`CITY_QUESTS_OFF`（节点没配数据服务）、`INVALID_QUEST`、`TOO_FAR`、`QUEST_ACTIVE`（一次只能接一个）、`NO_QUEST`、`RATE_LIMITED`（每秒 2 个，突发 4 个）。

下行事件（只发给本人）：

- `city-quest-progress {quest, collisions}`：易碎品任务每多一次碰撞。
- `city-quest-failed {quest, reason, collisions}`：`reason` 为 `SPEED`、`COLLISION`、`TIMEOUT` 或 `TELEPORT`。

## 3. 节点判定（`internal/game/city/quest.go`）

- 车速和碰撞取自本人的运动帧：kind 3（108 字节表现载荷）偏移 80 的 `forwardSpeed`（float32，m/s），偏移 104 的碰撞序号（uint32）；没有表现载荷时用节点按位置算出的速度。碰撞序号一帧最多计 5 次（序号回绕或重置不算连撞），接任务后的第一个序号只作起点。
- 限时任务在线路的 1 Hz 心跳里检查，过了 `deadline` 即失败。
- **送货要开过去**：节点替成员移动位置（`city-respawn` 到任意点、道路救援拖车）一次超过 150 m，或本次任务累计超过 300 m，都算 `TELEPORT` 失败。掉进水里、按 R 复位到旁边的路不受影响。
- 离开卡丁城（断线、换线、回大厅）时任务直接作废。
- 交货时节点在线路锁外调用数据服务（5 s 超时），期间这单不再判定失败。

## 4. 结算（数据服务）

节点调用内部接口 `POST /internal/v1/city/quest/reward`（`contract.CityQuestRewardRequest {accountId, runId, questId, exp, lucci}`）。数据服务（`store.SettleCityQuest`）：

- 先乘后台经济设置里的经验、金币倍率（`rewards.ApplyRate`），再记账，账目原因 `cityquest`、引用 `runId`，同一 `runId` 只记一次（重试不会重复发）。
- 每个北京日最多 50 单有报酬（`daily_rewards` 计数 `cityquest`），超出的照常完成，`capped` 为真、报酬为 0。
- 经验升级时按比赛相同的等级奖励发放，`levelUps` 列出每一级及其奖励。

## 5. 浏览器（`client/src/city/`）

- `city-quests.ts`：走到任务点人物 12 m 内，HUD 提示“T 与某某对话”。按 T 打开故事模式的对话窗口（`stage_scene`，人物立绘与背景见数据里的 `sprite`、`background`），每次进城第一次和某人说话先讲他的背景故事，再说委托；读完后是故事模式的任务卡（`stage_scenarioReady`，送货图标 `mq_배달`，左下角画收件人的立绘），按“开始”接任务。接了任务再找托付人按 T 会问要不要放弃。
- 头顶标记（`city-quest-markers.ts`）：有任务可接的人物头顶浮着金色“!”，送货途中收件人头顶是金色“?”，都在名牌上方。
- M 地图（`city-map-window.ts`）：送货途中在收件人位置画金色“?”和“送货目标 · 名字”，打开地图时自动缩放到能同时看到自己和目标；目标在视野外时“?”贴在地图边缘、箭头指向目标。
- 任务 HUD：屏幕上方一行显示物品 → 收件人、方位和直线距离，限速任务显示车速，易碎品显示碰撞次数，限时任务另有原版倒计时（`missionTimer.bml`）。
- 到收件人 12 m 内自动交货。成功或失败都在屏幕中间播放原版任务结果动画（`missionSuccess` / `missionFail`，跳过原版为终点横幅预留的约 1.9 s 空白，放大 1.8 倍居中），然后成功时收件人道谢，再弹出“任务成功”结算窗口（用时、路程、倍率、获得金币和经验、升级奖励、现有金币）；失败时弹出“任务失败”窗口（原因、限制、可以回去重接）。
- 本机记录每个任务送过几次（`localStorage` 的 `kartsim.city.questsDone`），找同一个人时先给送得最少的任务。
