# 全局大厅：房间在数据服务，开局才分配节点

多人游戏的大厅和等待中的房间放在**数据服务**上，所有地区的玩家看到同一个房间列表；房主点“开始”时，数据服务为这个房间挑一个游戏节点，全房间的人连到同一个节点比赛，赛后房间回到大厅。游戏节点不连接 MySQL 与 Redis：它从数据服务领取房间与玩家数据，比赛结果照旧经发件箱交回。节点的部署见 [`NODE.md`](NODE.md)。

房间规则代码只有一份：数据服务运行的是游戏节点的同一个 `internal/game/lobby` 包，大厅用 `Home` 模式（等待阶段的全部命令、开局检查），节点用 `RaceHost` 模式（比赛阶段）。

## 流程

```
 浏览器 ──WS /multiplayer/lobby/ws──► 数据服务大厅       建房、加入、准备、换车、聊天、踢人投票、开始
    │                                   │ 开始：选节点，给每个成员签一张该节点的票据（race-host）
    │                                   ▼
    └──WebRTC / WS──► 被选中的节点 ── POST /internal/v1/rooms/claim ──► 数据服务   领取房间（第一个车手 hello 时）
                          │ 载入、倒计时、比赛、结算（发件箱 → /internal/v1/races，照旧）
                          │ 全员“返回房间”后
                          └── 发件箱 → /internal/v1/rooms/return ──► 数据服务   房间回到大厅，推送给成员
```

1. **进入大厅**：浏览器 `POST /multiplayer/lobby/ticket`（带 Bearer）得到大厅票据，连 `/multiplayer/lobby/ws`（只有 WebSocket；`POST /multiplayer/lobby/offer` 回 501 `USE_WEBSOCKET`），`hello` 与游戏节点相同。大厅以 `lobby` 的身份登记在节点注册表里（`contract.LobbyNodeID`，游戏服列表与后台节点表不列出它），它的会话像节点一样占用昵称与账号：单点登录、踢下线、封禁都照常生效（大厅的心跳在 5 秒内断开冲突会话）。不再弹选服对话框。
2. **测延迟**：浏览器进入大厅后读 `GET /multiplayer/game-servers`，对每个节点的 `/multiplayer/healthz` 取两次往返的较小值，用 `{"type":"node-latency","latency":{"节点ID":毫秒}}` 告诉大厅，之后每 3 分钟一次。
3. **等待中的房间**：命令与节点完全相同（`list-*`、`create`、`join`、`ready`、`team`、`track`、`kick`、`kick-vote`、`chat`……）。房间规则由数据服务直接写入 `room_rules`。
4. **开始**：`start` 的检查与节点相同（房主、准备、队伍、一账号一座位、装备归属；道具赛在这里读取各账号的道具换位卡与变更卡）。通过后大厅把房间标为“比赛中”（列表 `gaming:true`，`join` 回 409 `ROOM_RACING`，修改回 `ROOM_NOT_OPEN`），回复 `start` 的仍是 `phase:"open"` 的房间快照，并在后台选节点：
   - 候选：在线、协议版本相同、`players + 房间人数 ≤ capacity` 的节点；
   - 分数：房间里**延迟最高的那个人**到该节点的延迟（没测到的按 250 毫秒），取最小；同分取负载（人数/容量）低的，再按节点 ID；
   - 每个成员收到 `{"type":"race-host","roomId","nodeId","name","origin","ticket"}`，票据声明里带大厅里的 `pid`（玩家 ID 不变）、`use:"race"` 与 `rh`（交接 ID），用该节点的票据密钥签发。
   - 没有可用节点时房间立刻回到等待，`raceError:"NO_GAME_SERVER"`。
5. **节点上的比赛**：浏览器另开一条到节点的连接（与以前相同的 WebRTC/WebSocket），`hello` 带 race 票据。节点第一次见到这个交接 ID 时向数据服务 `POST /internal/v1/rooms/claim` 领取房间（`contract.RoomHandoff`：房间设置、成员与装备、修订号、道具换位卡与变更卡），建房后立即开始载入；`welcome` 之后紧接着发房间快照（修订号接着大厅的往上加）。节点**不为这些会话占用昵称**（`hello` 不调 presence claim），心跳里把它们标 `lobby:true`：数据服务只检查大厅是否仍为该玩家持有账号，不是就列为冲突，节点断开它。装备用大厅交来的，不再核对。比赛、结算、奖励、反作弊与以前完全相同。
6. **回大厅**：全员“返回房间”（或开赛前取消、所有车手离开）后，节点把房间状态经发件箱 `POST /internal/v1/rooms/return`（排在这局的结算之后），删除房间，给这些会话发 `{"type":"room-home","roomId"}`，2 秒后以 1000 关闭连接。大厅收到后：成员以**大厅自己的名单**为准（只留仍连着大厅、仍在这个房间的人；比赛中主动离开的人已在大厅离开），从节点取房主、聊天、比赛错误、每人赛后的座位、队伍与准备状态（座位冲突时重新分配），修订号取两边较大者再加一，推送给成员。浏览器收到大厅的房间快照后关闭节点连接，命令回到大厅。
7. **兜底**（数据服务每 5 秒检查）：交出 30 秒仍没有节点来领取 → 房间回来，`raceError:"RACE_SERVER_UNREACHABLE"`；节点从注册表消失（宕机、下线）或比赛超过 45 分钟 → 房间回来，`raceError:"RACE_SERVER_LOST"`；之后节点再交回的同一房间被忽略。数据服务重启时大厅与房间都在内存里，玩家回到首页重新进入（与节点重启相同）。

**卡丁城**：大厅命令 `city-host` 回复 `{"type":"city-host","nodeId","name","origin","ticket"}`（`use:"city"` 票据，按该玩家的延迟选节点），浏览器另开一条到该节点的连接，`city-join` 等命令与以前相同；离开卡丁城时关闭这条连接。

## 浏览器（`client/src/multiplayer/race-host.ts`）

- 进入多人时直接进入大厅（`game-servers.ts` 的 `LOBBY_SERVER`，不再选服）；大厅连接失败且属于“换服可解决”的错误时，才退回旧的选服流程。
- `host.lobbyClient` 是大厅连接；收到 `race-host` 后新建节点连接 `host.raceClient`，并让 `host.client` 指向它，原有的房间与比赛代码不用改就把命令发给节点。节点发来的 `phase:"open"` 快照被忽略（房间正在回大厅，大厅的快照随后到）。
- 收到大厅推送的这个房间的快照，或节点的 `room-home` 之后连接关闭，就切回大厅连接并释放节点连接。
- 比赛中节点连接意外断开（含反作弊踢出）：退出这局并在大厅离开房间，回到房间列表，提示原因；大厅连接断开仍按原来的处理回到首页。
- 在节点上离开比赛（`left`）时，同时在大厅离开房间。
- 连不上被选中的节点：留在大厅的房间里，提示本局无法参加；节点载入超时把他算作未载入，其他人照常比赛，房间回来后继续。

## 接口一览

| 位置 | 新增 |
| --- | --- |
| 数据服务公网 | `POST /multiplayer/lobby/ticket`、`GET /multiplayer/lobby/ws`、`POST /multiplayer/lobby/offer`（501） |
| 大厅命令 | `node-latency`（回 `{"type":"ok"}`）、`city-host`；事件 `race-host` |
| 数据服务内部 API | `/internal/v1/rooms/claim`、`/internal/v1/rooms/return`（共享密钥或节点密钥；节点只能领取 / 交回交给自己的房间） |
| 节点 | 接受带 `use` 的票据；事件 `room-home`；心跳 `players[].lobby` |
| 错误码 | `ROOM_RACING`（409）、`NOT_RACE_PARTICIPANT`（403）、`INVALID_LATENCY`；房间 `raceError`：`NO_GAME_SERVER`、`RACE_SERVER_UNREACHABLE`、`RACE_SERVER_LOST` |

旧的“在节点上开房间”的方式仍然可用（节点照常接受普通票据与 `create`/`join`），`run-full-local.sh` 的冒烟脚本、`item-bot.mjs` 等测试工具继续走它；新版浏览器只走全局大厅。

## 部署要点

- 反向代理要把 `/multiplayer/lobby/ws` 当 WebSocket 转发给数据服务（README“分布式部署”的 Nginx 示例已加），超时大于 30 秒的 ping 间隔。
- 节点的对外地址必须是玩家浏览器能直连的地址（游戏页面是 HTTPS 时节点也要 HTTPS），见 NODE.md。
- 大厅最多 10000 人；房间状态都在数据服务内存里。

## 测试

- Go：`internal/game/lobby/handoff_test.go`（大厅与节点两侧、交接、回大厅、领取失败、卡丁城）、`internal/data/api/lobby_home_test.go`（经真实 WebSocket 与内部 API 的全流程、选节点规则）。
- 前端：`client/src/multiplayer/race-host.test.ts`。
- 端到端：`node test/lobby-smoke.mjs`（对已运行的集群：三个账号、交接、比赛、回大厅、结算、卡丁城；节点要 `KART_ANTICHEAT=log`）。
- 手动：`node test/lobby-bot.mjs --room <房间名>` 是一个会自动加入房间、准备、跟着去节点比赛、回来再准备的陪练，用来在浏览器里试玩。
