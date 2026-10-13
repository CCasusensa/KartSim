# 卡丁城（开放世界自由驾驶）服务端约定

本文是游戏节点 `kart-game` 上"城市实例"（zone）的权威约定；整体计划与地图见 `design/open-world/PLAN.md`。城市不是房间：玩家 `hello` 之后用 `city-join` 进入节点上常驻的城市实例（"线路"），没有倒计时、完赛、结算与奖励；运动帧由服务器按兴趣范围转发。现有的房间与比赛协议（协议 40）不改动。

## 1. 实例与线路

- 节点启动时建立 `KART_CITY_LINES`（默认 2）条线路，实例 ID `city-<n>`，名称"卡丁城 线路 n"。实例常驻，空了也不销毁；节点重启后由浏览器自动重连重进。
- 每条线路最多 `KART_CITY_LINE_PLAYERS`（默认 60）人。`city-join` 不带 `line` 时进人最多且未满的线路（先把一条线路聚满）；指定满员线路 `CITY_LINE_FULL`；所有线路满员 `CITY_FULL`。
- 一个连接同一时刻只能在城市或房间之一：在房间内（任何阶段）`city-join` 返回 `IN_ROOM`；在城市内 `create`/`join` 返回 `IN_CITY`。`city-leave` 之后可以照常建房/进房（传送门就是这样开房）。断开连接等同 `city-leave`。
- 每个实例一把自己的锁，不占大厅锁。节点总人数仍受 `KART_MAX_PLAYERS` 约束；节点心跳里城市玩家的 `room` 字段报 `"city:<n>"`，供管理后台在线页显示。
- 成员编号 `id` 是实例内唯一的 uint16（1–65535，回收复用），运动帧与雷达包用它标识发送者；JSON 里同时带 `playerId`。

## 2. JSON 消息

所有请求带 `requestId`，答复回显；错误 `{"type":"error","requestId":…,"code":…}`。文本命令沿用连接级限流（30/s，突发 60）。

| 请求 | 字段 | 答复 / 说明 |
| --- | --- | --- |
| `city-join` | `line?`（整数） | `{"type":"city","requestId":…, …快照字段}`（快照字段直接放在答复里）；进入后广播 `city-joined` 给实例内其他人 |
| `city-leave` | — | `{"type":"city-left","requestId":…}`；广播 `city-left` |
| `city-chat` | `text`（1–60 个码点，不含换行）、`channel`（`"near"`、`"district"`、`"city"`） | 成功答复 `{"type":"ok","requestId":…}`；广播 `city-chat` 事件。`near` 只发给发送者 `KART_CITY_CHAT_RADIUS`（默认 60 m）内的成员，`district` 发给同分区（见 §5 分区判定）的成员，`city` 发给全实例。限流：每秒 1 条、突发 5，超出后禁言 10 秒（`CHAT_MUTED`），与小屋聊天相同 |
| `city-emote` | `emote`（整数 1–16） | `{"type":"ok"}`；广播 `city-emote` 给 `KART_CITY_INTEREST_RADIUS` 内的成员。限流每秒 2 条 |
| `city-state` | `state`（`"driving"`、`"parked"`） | `{"type":"ok"}`；广播 `city-state`。`parked` 的成员不发运动帧也不会被判 AFK |
| `city-respawn` | `spawn`（出生点 ID 字符串，来自地图数据）或 `pose {x,y,z,heading}` | `{"type":"ok"}`；服务器把该成员的"上次位置"重置为出生点，随后第一帧不做瞬移检查；广播 `city-respawn` 给兴趣范围内成员，让他们立刻重置预测 |
| `city-equipment` | `equipment`（与房间 `equipment` 命令相同的装备文档） | 在城里打开车库换车、换角色、换装扮后发送。大厅按房间换装同样的规则核对（`INVALID_EQUIPMENT`、`ITEM_NOT_OWNED`、`DATA_SERVICE_UNAVAILABLE`，核对次数受连接的校验令牌桶约束），通过后成为该连接的当前装备（之后建房/进房从它开始）。答复 `{"type":"city-equipment","requestId":…,"instanceId":…,"id":…,"playerId":…,"equipment":…}`（装备已压缩）；同样内容作为事件广播给线路上除本人外的所有成员（不限兴趣范围：远处的成员走近时才需要加载，但要先知道）。限流每 2 秒 1 次、突发 3（被拒的也计数）。在房间里时 `IN_ROOM` |
| `city-refuel` | `requestId`、`addMl?` | 在加油站加油，详见 `FUEL.md` §4.2；答复 `{"type":"city-refuel", station, addedMl, cost, stale, fuel}` |
| `city-rescue` | `requestId` | 油箱空了叫道路救援，详见 `FUEL.md` §4.3；答复 `{"type":"city-rescue", station, stationName, pose, cost, free, fuel}` |
| `city-exit` | `pose?` | 下车，详见 §7；答复 `{"type":"city-seat","seat":"foot","pose":…,"vehicle":<车辆>}` |
| `city-enter` | `vehicle`（车辆 id） | 上车，详见 §7；答复 `{"type":"city-seat","seat":"driver"|"passenger","pose":…,"vehicle":<车辆>,"fuel"?}` |
| `city-lock` | `locked`（布尔） | 给自己的车上锁或解锁，详见 §7；答复 `{"type":"city-vehicle","vehicle":<车辆>}` |

客户端聊天界面只提供「全城」（`city`，当前线路的全部成员）和「附近」（`near`，当前线路内水平距离不超过聊天半径的成员，默认含 60 m 边界），两个频道都向发送者回传消息，不跨线路广播。`district` 保留协议兼容，界面不提供发送选项。

无 `requestId` 的事件：

| 事件 | 内容 |
| --- | --- |
| `city-joined` | `{"type":"city-joined","instanceId":…,"member":<成员>,"vehicle":<车辆>}`，`vehicle` 是他带进城的车 |
| `city-left` | `{"type":"city-left","instanceId":…,"id":…,"playerId":…}` |
| `city-chat` | `{"type":"city-chat","instanceId":…,"sequence":n,"id":…,"playerId":…,"name":…,"channel":…,"text":…}` |
| `city-emote` | `{"type":"city-emote","instanceId":…,"id":…,"emote":n}` |
| `city-state` | `{"type":"city-state","instanceId":…,"id":…,"state":…}` |
| `city-respawn` | `{"type":"city-respawn","instanceId":…,"id":…,"pose":{x,y,z,heading}}` |
| `city-equipment` | `{"type":"city-equipment","instanceId":…,"id":…,"playerId":…,"equipment":{…}}`：该成员换了装备，浏览器用新装备重新加载他的车与角色 |
| `city-clock` | `{"type":"city-clock","instanceId":…,"clock":<时钟>}`，进入时在快照里，之后每 30 秒一次，天气变化时立即发 |
| `city-fuel` | `{"type":"city-fuel","instanceId":…,"reason":"drive"|"empty",…,"fuel":<油箱>}`，只发给本人，见 `FUEL.md` §4.4；快照的 `you.fuel` 是进城时的油箱，加油功能关闭时没有这个字段 |
| `city-vehicle` | `{"type":"city-vehicle","instanceId":…,"vehicle":<车辆>}`：某辆车有人上下、停到了新位置或改了锁，发给全线路 |
| `city-vehicle-gone` | `{"type":"city-vehicle-gone","instanceId":…,"id":…}`：车主离开城市，车随他收回 |
| `city-seat` | `{"type":"city-seat","instanceId":…,"id":…,"playerId":…,"seat":…,"vehicle":…,"pose":…,"reason"?}`：某成员换了座位，发给全线路。`reason` 只出现在本人没有要求的变化上：`"dropped"`（司机下车，乘客跟着下）、`"recalled"`（车主离开城市，车上的人被放下） |
| `city-kicked` | `{"type":"city-kicked","instanceId":…,"reason":"ADMIN"|"CHEAT"|"SHUTDOWN"}`，之后该连接视为已离开城市 |

### 快照

```json
{
  "instanceId": "city-1", "line": 1, "name": "卡丁城 线路 1", "capacity": 60,
  "clock": { "serverTick": 123456.7, "timeOfDay": 0.37, "dayLengthMs": 2880000,
             "weather": "clear", "weatherUntilTick": 180000.0 },
  "you": { "id": 7, "spawn": { "id": "spawn-main", "x": 0, "y": 0, "z": 95, "heading": 0 } },
  "members": [ <成员>, … ],
  "vehicles": [ <车辆>, … ]
}
```

成员：`{"id":7,"playerId":"…","name":"Alice","equipment":{…},"state":"driving","pose":{"x":0,"y":0,"z":95,"heading":0},"seat":"driver","vehicle":7}`。`seat` 是 `"driver"`、`"passenger"` 或 `"foot"`，`vehicle` 是他所在车辆的 id（步行时为 0）。`equipment` 是 `hello` 中核对过的装备，或之后 `city-equipment` 换上的装备（浏览器据此加载车与角色）；`pose` 是服务器从运动帧记录的最近位置（世界坐标：x 东、y 上、z 南，`heading` 为绕 y 轴的角度，0 = 北，顺时针，度）。出生点由服务器从 5 个出生点里轮流分配（主出生点优先）。

### 时钟与天气

- `timeOfDay` ∈ [0,1)，0 = 午夜，0.5 = 正午，按 `serverTick` 线性推进，一天 `dayLengthMs`（`KART_CITY_DAY_MINUTES`，默认 48 分钟）。浏览器用快照的 `serverTick` 与本地校时推算，不需要每帧同步。
- 天气状态机：`clear` → 随机进入 `rain`（概率 `KART_CITY_RAIN_PERCENT`，默认 20）或 `snow`（`KART_CITY_SNOW_PERCENT`，默认 10），每段持续 5–15 分钟，`weatherUntilTick` 告诉浏览器何时切换（提前做过渡）。`KART_CITY_WEATHER=false` 时恒为 `clear`。管理指令可强制设定。

## 3. 二进制帧

城市帧与比赛帧共用同一条 `motion` 通道（WebRTC `motion` 数据通道或 WebSocket 二进制），靠首字节区分；连接在城市中时，节点把二进制帧交给城市实例而不是大厅。

**上行 / 转发：城市运动帧**（协议 41）

| 偏移 | 长度 | 内容 |
| --- | --- | --- |
| 0 | 1 | `0xC1` |
| 1 | 1 | 运动种类 `kind`（1–10，与比赛帧相同的载荷种类） |
| 2 | 2 | 发送者 `id`（uint16 LE）。上行时浏览器填 0，节点盖写为真实 id |
| 4 | 4 | 序号 uint32 LE（发送者递增，接收方丢弃回绕前的旧序号） |
| 8 | … | 与比赛帧相同的运动载荷（`motion_payload.go` 的各 kind 长度，80–163 字节） |

转发规则：

1. 只接受在城市中、`state != "parked"` 以外也允许（停车时也可发一帧）、载荷长度与 kind 匹配的帧；每连接 200 帧/秒（突发 400），超出丢弃。坐后座的成员（§7）的帧一律丢弃，他的位置跟着司机走；步行的成员照常发帧（走路的角色），检查与转发同开车。
2. 节点从载荷取位置（与反作弊相同的偏移）。**帧内坐标 = 设计坐标 + 偏移**：载荷里的位置是赛道物理坐标的线框形式（x、−z、y），而城市赛道整体平移到了正坐标（客户端 x = 设计 x + offsetX，客户端 y = offsetZ − 设计 z，`offsetX = −meta.extent[0][0]`、`offsetZ = meta.extent[1][1]`，当前都是 1200），节点换算回 `city-map.json` 的设计坐标（x 东、z 南、y 上、原点喷泉）：设计 x = p[0] − offsetX，设计 y = p[2]，设计 z = offsetZ − p[1]；JSON 里的所有坐标（`pose`、`spawn`、`city-respawn` 的 `pose`）、雷达包与分区判定都用设计坐标。随后更新成员的最近位置与 `lastMotionTick`，并做合理性检查：相邻两帧速度超过 `KART_CITY_MAX_SPEED`（默认 150 m/s）或位移超过 200 m 且没有 `city-respawn` 声明 → 丢弃该帧并计数，10 秒内 20 次 → `city-kicked {reason:"CHEAT"}`。
3. 接收者由节点决定：实例维护 100 m 网格；发送者 `KART_CITY_INTEREST_RADIUS`（默认 160 m）内的其他成员收到。60 m 内每帧都发；60–160 m 只发序号为偶数的帧。超出范围不发（他们靠雷达包知道位置）。
4. 转发的帧原样（盖写 id 后）写入接收者的 `motion` 通道，与比赛帧一样不保证送达。

**下行：雷达包**，每实例每秒一次发给所有成员：

| 偏移 | 长度 | 内容 |
| --- | --- | --- |
| 0 | 1 | `0xC2` |
| 1 | 1 | 保留 0 |
| 2 | 2 | 成员数 uint16 LE |
| 4 + 7k | 2 | 成员 `id` |
| 6 + 7k | 2 | x × 4，int16 LE（0.25 m 精度） |
| 8 + 7k | 2 | z × 4，int16 LE |
| 10 + 7k | 1 | heading / 360 × 256，uint8 |

没有位置记录的成员不在雷达包里。

## 4. 房间与心跳的衔接

- `hello` 流程、票据、昵称与账号占用、装备核对、单点登录、`clock` 校时全部不变。
- 节点心跳 `Players[].room` 对城市成员填 `"city:<n>"`。
- 管理后台（ADMIN.md）新增：按线路列出成员、踢人（`city-kicked ADMIN`）、禁言、强制天气与时刻、关闭线路（成员收到 `city-kicked SHUTDOWN`）。第一版只要求节点内部 HTTP 调试口或管理指令的 Go 接口，页面可以后做。
- 反作弊 WASM 插件暂不介入城市帧；§3 的速度/瞬移检查在 Go 侧实现。

## 5. 分区判定

实例加载 `server-go/internal/game/city/city-map.json`（由 `design/open-world/city-map.json` 复制，构建时由 `client/tools/city/export-city-data.mjs` 同步；手改会被测试拦住）。分区用其中 `districts[].polygon`（或 `circle`）按成员最近位置做点在多边形内判定；出生点用 `pois[]` 中 `kind:"spawn"` 的项（`id`、`at`、`heading`）。`district` 频道发给同分区成员；不在任何分区内的成员视为 `"plaza"` 之外的 `"outside"` 分区。

## 6. 限制与配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KART_CITY` | `true` | 关闭后 `city-join` 返回 `CITY_DISABLED` |
| `KART_CITY_LINES` | `2` | 线路数（1–32） |
| `KART_CITY_LINE_PLAYERS` | `60` | 每线路上限（2–200） |
| `KART_CITY_INTEREST_RADIUS` | `160` | 米 |
| `KART_CITY_CHAT_RADIUS` | `60` | 米 |
| `KART_CITY_AFK_MINUTES` | `10` | 没有运动帧且未 `parked` 的成员自动置 `afk`（广播 `city-state`），再过同样时长仍无动静则 `city-kicked` 并关闭连接 |
| `KART_CITY_MAX_SPEED` | `150` | m/s |
| `KART_CITY_DAY_MINUTES` | `48` | 一天的真实分钟数 |
| `KART_CITY_WEATHER` / `KART_CITY_RAIN_PERCENT` / `KART_CITY_SNOW_PERCENT` | `true` / `20` / `10` | |

错误码：`CITY_DISABLED`、`CITY_FULL`、`CITY_LINE_FULL`、`IN_ROOM`、`IN_CITY`、`NOT_IN_CITY`、`CHAT_MUTED`、`INVALID_REQUEST`、`RATE_LIMITED`，`city-equipment` 另有 `INVALID_EQUIPMENT`、`ITEM_NOT_OWNED`、`DATA_SERVICE_UNAVAILABLE`、`NOT_IN_OWN_KART`；`city-respawn` 另有 `PASSENGER`、`FUEL_EMPTY`；上下车见 §7。

## 7. 下车步行与车辆

每个成员带一辆车进城，就是他当前装备的车，叫他的“车辆”，车辆 id 等于车主的成员 id。进城时坐在自己车的驾驶座上。

车辆：`{"id":7,"owner":7,"playerId":"…","ownerName":"Alice","equipment":{…},"pose":{…},"locked":false,"driver":7,"passenger":0}`。`equipment` 是车主的装备（浏览器只取其中车的部分，见下）；`pose` 是车的位置，有人开时是司机的最近位置；`driver`、`passenger` 是坐在驾驶座、后座的成员 id，0 表示空着。

- **下车** `city-exit {pose?}`：司机下车时车停在原地，所有人都看得到；后座的人跟着下车（`city-seat` 带 `reason:"dropped"`）。`pose` 是下车后站的位置，离车不超过 8 m，不给时放在车左侧 1.4 m（乘客放在右侧）。步行时没有座位，返回 `NOT_IN_KART`。
- **上车** `city-enter {vehicle}`：站在车旁 5 m 以内才能上，否则 `TOO_FAR`。驾驶座空着就坐驾驶座（开走），否则坐后座。车被别人锁上 `VEHICLE_LOCKED`（车主自己不受锁限制），两个座位都有人 `VEHICLE_FULL`，车不存在 `VEHICLE_NOT_FOUND`，已经在车上 `ALREADY_IN_KART`。坐驾驶座时答复带这辆车的油箱 `fuel`。
- **锁车** `city-lock {locked}`：只锁车主自己的车。锁上后别人既不能开也不能坐，已经在车上的人不受影响。
- 上下车与锁车共用一个限流：每秒 2 次，突发 4 次。上下车都按一次声明的复位处理：节点把成员放到新位置并广播 `city-respawn`，下一帧不做瞬移检查。
- **开别人的车**：浏览器把车主装备里的车（`itemIds` 的 2、3、4、20、27 槽以及 `kartSerial`、`exceedType`、`valueAt3E`、`systemKart`、`systemKartVariant`）和司机自己的角色、装扮拼在一起显示。耗的是车主这辆车的油，加油和救援由司机付钱（`FUEL.md` §4）。
- **坐后座**：乘客不能复位（`PASSENGER`），不能加油、叫救援（`NOT_DRIVING`），也不能开车库。
- **车库**只能坐在自己车的驾驶座上打开，否则 `city-equipment` 返回 `NOT_IN_OWN_KART`。换车后车辆的 `equipment` 与油箱一起换成新车的（广播 `city-vehicle`）。
- **离开城市**（`city-leave`、断线、换线路）：他开着的别人的车停在原地；他自己的车随他收回，广播 `city-vehicle-gone`，车上的人被放到车旁（`reason:"recalled"`）；他用过的油箱都保存一次。
- 浏览器：E 上下车，L 锁车，M 打开卡丁城地图（标出自己、自己的车、加油站和其他成员），步行时 WASD/方向键走、按住 Shift 跑（原版角色只有走路动作 f11，跑步用同一套动作加快 1.9 倍播放，2.4 m/s），R 回到最近的路上。步行和坐后座时用跟随镜头，隐藏速度表与油表。代码在 `client/src/city/`：`city-onfoot.ts`、`city-foot-motion.ts`、`city-walker.ts`、`city-map-window.ts`。
