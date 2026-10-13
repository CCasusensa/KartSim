# 卡丁城加油：玩法与服务端约定

本文是卡丁城加油的权威约定，包括油箱、耗油、加油站、加油、熄火与道路救援。城市本身的协议见 `CITY.md`，钱包与流水见 `ECONOMY.md`。原版跑跑卡丁车没有油量，下面的数值都是本项目设定的。

## 0. 玩法一览

- 每个账号拥有的每辆车都有自己的油箱。油量长期保存，离开卡丁城再进来，还是上次剩下的量。第一次开进城的车是满箱。
- 在卡丁城里开车会耗油，按服务器收到的实际行驶距离计算。比赛、计时赛、驾照考试都不耗油。下车步行、坐别人车的后座都不耗油。
- 油箱跟着车走：开别人的车（`CITY.md` §7）耗的是车主这辆车的油；在车里加油、叫救援，钱由开车的人付。
- 车越大，油箱越大，满箱跑得越远，但每公里的油钱也越多（§2）。
- 油用完会熄火：车失去动力、自动刹停，不能用氮气，只能叫“道路救援”。救援花金币，把车拖到最近的加油站。
- 加油站在地图上（§1）。把车开进加油站停稳，按 F 打开加油窗口，选好加油量（每次 ±5 L 或加满），用金币付款。
- 管理后台“经济设置 → 卡丁城加油”可以设置开关、油价、救援费和油耗倍率（§4.1）。

## 1. 加油站

罪恶都市原图里只有一个带加油机的加油站：海洋海滩，加油机贴图为 `PETROLPUMPBASE_256` / `PETROLPUMPTOP_128`，旁边有 `GASSIGN1_256` 招牌和洗车招牌。`AP_FUEL*` 是机场油库，不算加油站。为了让全城都能加到油，另外在 6 个城区补建了加油站。补建用的是 Tripo 生成的跑跑风格加油站模型 `design/open-world/tripo/c_gasstation.glb`，带碰撞。

地图数据 `city-map.json` 里，每个加油站是一个 `kind: "fuel"` 的兴趣点：

```json
{"id":"fuel-washington","name":"华盛顿海滩加油站","kind":"fuel","at":[x,z],"y":地面高度,"heading":度,
 "zone":[[x,z],…],"park":{"at":[x,z],"y":地面高度,"heading":度},"source":"tripo"|"original"}
```

- `zone` 是加油区。车的位置在这个多边形内，或离它的边不超过 1.5 m，就算在加油站里。浏览器给提示时按 1 m 判断，所以凡是浏览器提示能加的，服务器都会接受。
- `park` 是停车位。被救援拖来的车，以及油箱空着进城的车，都会停在这里，并朝着出口的方向。

补建加油站的模型摆放记录在地图数据的 `props` 里，由 `client/tools/city/blender/import-city.mjs` 放进原生地图（见 `design/open-world/PLAN.md`）。

## 2. 油箱与耗油

- **油箱容量**：每辆车的容量由 `client/tools/export-kart-tanks.mjs` 生成，写在 `internal/data/economy/kart-tanks.json`。工具从每辆车模型 `kart_/<id>/model.1s` 的包围盒（`rootBounds`）读出长、宽、高，算出体积 V。
  - 公式：`容量 L = clamp(round(40 × (V / V中位)^0.6), 20, 100)`。V中位 是全部 1545 辆目录车体积的中位数，3.652 m³。
  - 按容量分档：小于 30 L 为小型，小于 45 L 为中型，小于 65 L 为大型，其余为巨型。目前小型 55 辆、中型 1003 辆、大型 437 辆、巨型 50 辆。
  - 例子：练习用卡丁车 V1 28 L，爆烈 C1 30 L，消防车 9 40 L，挖掘机 HT 63 L，擎天柱 82 L，小苹果 9 100 L。
  - 系统车按 `systemKart` 名（如 `practiceKart`）对应表里的条目。表里查不到的车按 40 L 中型处理。
- **耗油率**：每公里耗油 `0.8 L + 0.015 L × 油箱容量`，再乘后台设置的油耗倍率（2026-10-13 起减半，满箱里程是原来的 2 倍）。
  - 例子：30 L 的车每公里 1.25 L，满箱约 24 km；40 L 的车每公里 1.4 L，满箱约 29 km；100 L 的车每公里 2.3 L，满箱约 43 km。大车跑得更远，但每公里花的钱更多。
- **怎么算**：游戏节点在司机每个通过合理性检查的城市运动帧上，按这一帧和上一帧位置的三维距离，扣他所开那辆车的油。以下几种不扣：进城后的第一帧、R 键复位、`city-respawn` 声明的复位、救援拖车之后的第一帧、上下车之后的第一帧。步行的帧不扣油，后座乘客不发帧。

## 3. 存储（数据服务）

- 表 `kart_fuel`（schema v22），主键 `(account_id, kart_key)`。
  - `kart_key` 的格式：目录车是 `item:<itemId>`，系统车是 `system:<systemKart>`。`kartSerial` 不参与，同一辆车的不同改装共用一个油箱。
  - 每行存油量 `fuel_ml`（毫升，≥ 0）和版本号 `rev`。没有行的车视为满箱，版本号为 0。
- 每次写入都要带上节点最后看到的版本号，版本号对得上才写，写完版本号加 1。这样同一个请求重试不会生效两次，迟到的保存也不会盖掉刚加的油。保存时油量只能减少，不能增加。
- 读出的油量不会超过当前容量：如果油箱表重新生成后容量变小，多出的部分直接截掉。

### 3.1 内部接口（游戏节点 → 数据服务）

接口约定在 `internal/shared/contract/cityfuel.go`，鉴权方式与其他内部接口相同。

| 路径 | 请求 | 答复 |
| --- | --- | --- |
| `/internal/v1/city/fuel/state` | `accountId`、`equipment`（同装备校验） | `CityFuel`：`enabled`、`kartKey`、`kartName`、`sizeClass`、`capacityMl`、`fuelMl`、`rev`、`useMlPerKm`、`pricePerLiter`、`rescueFee`、`lucci` |
| `/internal/v1/city/fuel/save` | `accountId`、`kartKey`、`fuelMl`、`rev` | `{fuelMl, rev, applied}`；版本号不符时 `applied:false`，并带回库里的值 |
| `/internal/v1/city/fuel/refuel` | `accountId`（付钱的人）、`tankAccountId?`（油箱的主人，和付钱的人不同时才给）、`kartKey`、`requestId`、`fuelMl`（节点量得的当前油量）、`rev`、`addMl`（0 表示加满） | `{fuelMl, rev, addedMl, cost, lucci}`，`lucci` 是付钱的人的余额；版本号不符时 `stale:true`。错误：`INSUFFICIENT_FUNDS`、`TANK_FULL`、`CITY_FUEL_OFF`（403） |
| `/internal/v1/city/fuel/rescue` | `accountId`、`tankAccountId?`、`kartKey`、`requestId`、`fuelMl`、`rev` | `{fuelMl, rev, cost, lucci, free?}`。余额不够付救援费时免费，并带 `free:true` |

## 4. 加油与救援

### 4.1 价格（管理后台“经济设置”）

所有价格都存在 `app_settings` 的 `economy` 行里，字段名为 `cityFuel`，从玩家下一次进城开始生效。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | 开 | 关闭时不耗油、不显示油表，也不能加油或叫救援 |
| `pricePerLiter` | 5 金币/L | 费用按 `ceil(加油毫升 × 单价 / 1000)` 计算，只要加了油就至少收 1 金币 |
| `rescueFee` | 300 金币 | 一次救援的费用 |
| `consumptionPercent` | 100 | 油耗倍率，范围 10–1000%；填 0 等于 100 |

按默认价格，40 L 的车加满要 200 金币，大约一场联机比赛的奖励；100 L 的车加满要 500 金币。

### 4.2 加油 `city-refuel {requestId, addMl?}`

- 能加油的条件：
  - 车在某个加油站的加油区内，否则返回 `NOT_AT_STATION`；
  - 车停稳，最近一帧的地面速度不超过 2.5 m/s，或者 1 秒内没有新的运动帧，否则返回 `KART_MOVING`；
  - 坐在驾驶座上，否则返回 `NOT_DRIVING`（步行和坐后座都不行）；
  - 油箱没满，否则返回 `TANK_FULL`。剩余空间不到 0.1 L（浏览器显示的最小单位）也算满，免得花 1 金币只加几毫升；
  - 上一次加油或救援已经处理完，否则返回 `FUEL_BUSY`；
  - 每秒最多 1 次，可连续 3 次，超出返回 `RATE_LIMITED`。
- 节点用量得的油量和当前版本号向数据服务下单：付钱的是司机，加进的是车主那辆车的油箱。成功后答复 `{type:"city-refuel", station, addedMl, cost, stale, fuel}`，`fuel.lucci` 是司机的余额。`stale:true` 表示节点的油箱记录过期了，答复里已经换成库里的值，浏览器提示再确认一次。数据服务的拒绝原样转给玩家。数据服务联系不上时返回 `DATA_SERVICE_UNAVAILABLE`。
- 流水原因记为 `cityfuel`，引用号用 `requestId`。

### 4.3 熄火与救援 `city-rescue {requestId}`

- 油量降到 0 时，节点推送 `city-fuel {reason:"empty"}`。浏览器随即锁住车辆，使用和起跑前一样的锁定：没有驱动力、自动刹车、不能用氮气。
- 节点会把空油箱车的移动帧限制在熄火点 80 m 以内，超出部分既不转发，也不更新它的位置。空油箱时的 `city-respawn`（R 键复位）只能移动到 150 m 以内的位置，按出生点复位返回 `FUEL_EMPTY`。
- 只有空油箱才能叫救援，否则返回 `TANK_NOT_EMPTY`。救援的流程：
  1. 向数据服务扣救援费，流水原因 `cityrescue`。金币不够时免费。
  2. 把车放到离车最近的加油站的停车位，并向附近成员广播 `city-respawn`。
  3. 答复 `{type:"city-rescue", station, stationName, pose, cost, free, fuel}`，浏览器把本地车移到 `pose`。
  4. 拖到加油站后油箱仍然是空的，要在这里加油，加上油之后才能开走。
- 油箱空着进城的车直接停在离出生点最近的加油站。

### 4.4 推送与保存

- 快照里的 `you.fuel` 和事件 `city-fuel {reason, fuel}` 都带油量对象：`kartName`、`sizeClass`、`capacityMl`、`fuelMl`、`useMlPerKm`、`pricePerLiter`、`rescueFee`、`lucci`、`empty`。
  - 行驶中，节点每 2 秒最多推送一次，并且要比上次推送少了至少 0.1 L 才推。
  - 油箱空了、加油、救援之后会立刻更新。
- 节点每 30 秒保存一次有变化的油箱。离开城市、断线、换线路时也会保存一次。换线路要等上一次保存写完，再读新线路的油箱。节点关闭时最多等 3 秒，让最后几次保存写完。
- 油箱挂在车辆上。成员缓存自己用过的每辆车的油箱：在城里开车库换车，旧车的油箱先保存，新车的油箱读出来挂到车辆上，并推送 `city-fuel {reason:"equip"}`。开别人的车时，用的是车主缓存里那辆车的油箱。
- 数据服务不可用时，进城的成员不带油箱，不耗油，也看不到油表，节点会记一条警告日志。

## 5. 浏览器

- **油表**：放在右下角（左下角是聊天框，下方正中是速度表）。
  - 外观用原版首领模式第 3 阶段的血量框：`stage_bossGame` 的 `screenui.bml` 里的 `hpStage3`，贴图是 `hpbox_0`。左边八角形的头像槽改画加油机图标，右边的长条显示油量。
  - 长条按剩余油量换颜色：100%–60% 用绿色 `hp_1_1`，60%–20% 用黄色 `hp_1_2`，20%–0 用红色 `hp_1_3`。加油窗口里的油量条也用同样的分档。
  - 长条上方写升数和油箱档位，再往上写还能开多远、最近的加油站，以及指向它的箭头。
  - 两次服务器推送之间，油表按本地里程预估平滑下降。预估不会高于服务器给的值，也不会低于 0。
  - 剩余低于 20% 时提示“油量不足”，低于 10% 时提示“严重不足”并闪烁。
- **提示**：提示横幅显示在画面中上方，避开车和速度表。在加油站里停稳，提示“按 F 加油”。还在开或油箱已满，也会给出对应提示。油箱空了且不在加油站，提示“按 F 呼叫道路救援（费用）”。
- **窗口**：加油窗口和救援窗口都用发行版窗口渲染器（`CaptionDialog`）画，Enter 确认，Esc 取消。关闭窗口用的 Esc 不会算进“连按两次 Esc 离开卡丁城”。窗口（以及卡丁城地图、车库）打开期间聊天框不响应 Enter，Enter 只给窗口的确认按钮。
- 步行和坐后座时不显示油表；开别人的车时油表显示那辆车的油。
- 代码在 `client/src/city/`：`city-fuel.ts`（加油站、油表、提示）、`city-fuel-hud.ts`、`city-fuel-window.ts`、`city-fuel-controller.ts`。
