# 独立游戏节点 `kart-node`

`kart-node` 是可以单独放在任何一台 Linux 或 Windows 机器上运行的游戏节点。它运行的就是 `kart-game` 的节点代码（`internal/game/app`），另外加了这些：

- 配置文件 `kart-node.conf` 和命令行选项（数据服务地址、集群密钥、对外地址等）；
- 按本机 CPU、内存（含容器限制）和填写的上行带宽**自动设置人数**及相关上限；
- `check` 自检：数据服务地址、集群密钥、端口；
- 注册为系统服务：Linux 用 systemd，Windows 用系统服务（开机启动、异常退出自动重启）；
- 可选的内置 HTTPS/WSS（`--tls-cert`/`--tls-key`），节点前面不必再放 Nginx。

一个数据服务可以带任意多个节点，节点可以在不同机器、不同机房、不同云厂商（架构见 [`README.md`](README.md)“架构”与“分布式部署”）。

## 跨服务器部署需要什么

```
 浏览器 ──HTTPS──► 数据服务 kart-data（公网口 8787，通常在 Nginx 之后）     登录、选服、入场票据
   │
   └──TCP + UDP──► 各台机器上的 kart-node（默认 8788/tcp 与 8788/udp）     房间与比赛，直连，不经数据服务

 kart-node ──HTTP(S)──► 数据服务内部端口（KART_INTERNAL_LISTEN，默认 8790）   心跳、昵称占用、装备核对、结算
```

游戏节点**不访问** MySQL 与 Redis，只访问数据服务的内部端口。数据服务那边要做三件事：

1. **让内部端口能被节点访问。** `KART_INTERNAL_LISTEN` 默认 `127.0.0.1:8790`，只给同一台机器上的节点用。改成节点能到达的地址，例如内网 `10.0.0.10:8790`、或 VPN 地址。
2. **只放行节点。** 防火墙/安全组里 8790 只对各游戏节点的 IP 开放，绝不对公网开放。
3. **跨公网时加密。** 内部 API 的集群密钥在请求头里明文传输。节点和数据服务不在同一个内网时，用 WireGuard、Tailscale 这类 VPN 连起来；或者在 8790 前面放一个 TLS 反向代理，并让节点用 `--data https://…`。`kart-node` 发现数据服务地址是公网 IP 且使用明文 `http://` 时会给出警告。

其他要求：

- 所有节点与数据服务使用同一个 `KART_CLUSTER_SECRET`；节点的 `--data-node-id` 等于数据服务的 `KART_DATA_NODE_ID`（默认都是 `data-1`）。
- 每台节点机器的防火墙与云安全组放行节点的 **TCP 和 UDP** 端口（默认同一个号码 8788）。UDP 不通时浏览器会在 8 秒后改用 WebSocket，游戏照常能玩，只是运动帧回到 TCP。
- 机器开着系统自动校时即可：入场票据有效期 2 分钟，节点与数据服务的时钟偏差要远小于它。

## 快速开始

### Linux

```sh
tar xzf kart-node-<版本>-linux-amd64.tar.gz
cd kart-node-<版本>-linux-amd64

# 生成配置文件（密钥从环境变量读入，不出现在命令行历史的参数里）
read -rs -p '集群密钥：' KART_CLUSTER_SECRET; echo; export KART_CLUSTER_SECRET
./kart-node init --data 10.0.0.10:8790 --name 华东一区 \
  --public-origin https://game1.example.com --page-host kart.example.com \
  --tls-cert /etc/kart/game1/fullchain.pem --tls-key /etc/kart/game1/privkey.pem \
  --uplink 100
unset KART_CLUSTER_SECRET

./kart-node check                      # 检查数据服务、密钥与端口，并打印防火墙命令
./kart-node                            # 前台运行，Ctrl-C 停止
sudo ./kart-node service install       # 或者安装为 systemd 服务（开机启动）
```

### Windows

在 PowerShell 中：

```powershell
Expand-Archive kart-node-<版本>-windows-amd64.zip -DestinationPath C:\kart-node
cd C:\kart-node\kart-node-<版本>-windows-amd64

$env:KART_CLUSTER_SECRET = Read-Host '集群密钥'
.\kart-node.exe init --data 10.0.0.10:8790 --name 华南一区 --public-ip 203.0.113.7 --page-host kart.example.com --uplink 50
Remove-Item Env:KART_CLUSTER_SECRET

.\kart-node.exe check
.\kart-node.exe                        # 前台运行
.\kart-node.exe service install        # 或者（管理员 PowerShell）安装为 Windows 服务
```

`check` 会打印放行端口的 `netsh` 命令（管理员执行）。云服务器还要在控制台的安全组里放行同样的 TCP 与 UDP 端口。

## 命令

| 命令 | 作用 |
| --- | --- |
| `kart-node` / `kart-node run` | 启动节点。先打印硬件、人数、对外地址等摘要与注意事项，然后运行到 Ctrl-C / SIGTERM / 服务停止；停止时向玩家发 1001、通知数据服务、冲刷发件箱 |
| `kart-node init` | 生成配置文件（默认当前目录的 `kart-node.conf`，`--config` 指定位置，已存在时要加 `--force`），权限 600。写入本次给出的选项、环境变量里的 `KART_CLUSTER_SECRET`、推导出的节点 ID、端口与对外地址；人数写 `auto` |
| `kart-node detect` | 只检测硬件，打印将使用的人数与各项上限（不需要密钥） |
| `kart-node check` | 用当前配置检查：配置是否有效、数据服务内部端口能否连上且接受集群密钥、TCP/UDP 端口是否空闲；并打印防火墙命令。有问题时退出码 1 |
| `kart-node service install` | 安装并启动系统服务（见下文） |
| `kart-node service uninstall\|start\|stop\|status` | 管理已安装的服务 |
| `kart-node version` / `help` | 版本 / 用法 |

## 选项与配置文件

优先级：**命令行选项 > 环境变量 > 配置文件**。选项写成 `-data` 或 `--data` 都可以。不带 `--config` 时依次找当前目录、程序所在目录的 `kart-node.conf`，都没有就只用选项与环境变量。

配置文件是 `KART_变量=值` 的纯文本（`#` 开头为注释，值可加引号，可以有 Windows 记事本的 BOM），除下表外，[`README.md`](README.md)“kart-game”表中的任何变量都可以写进去（例如 `KART_CITY=false`、`KART_ANTICHEAT=log`）。配置文件中的相对路径相对于配置文件所在目录。

| 选项 | 配置项 | `kart-node` 的默认值 | 说明 |
| --- | --- | --- | --- |
| `--data` | `KART_DATA_INTERNAL_URL` | `http://127.0.0.1:8790` | 数据服务内部地址。可写 `10.0.0.10`、`10.0.0.10:8790` 或完整 URL；没写端口时补 8790，没写协议时用 `http://` |
| `--data-node-id` | `KART_DATA_NODE_ID` | `data-1` | 数据服务的 `KART_DATA_NODE_ID` |
| `--secret-file` | `KART_CLUSTER_SECRET_FILE` | — | 从文件读集群密钥（去掉首尾空白）。也可以直接用 `KART_CLUSTER_SECRET`（环境变量或配置项） |
| `--id` | `KART_NODE_ID` | `主机名-端口`，如 `hk-01-8788` | 集群内唯一、定下后不要改。两台机器用同一个 ID 会互相释放对方玩家的在线占用；克隆出来的云主机主机名相同，务必手动设置 |
| `--name` | `KART_NODE_NAME` | 同节点 ID | 选服列表显示的名称，最多 32 个字符 |
| `--listen` | `KART_GAME_ADDR` | `0.0.0.0` | 监听地址。前面有本机 Nginx 时可设 `127.0.0.1` |
| `--port` | `KART_GAME_PORT` | `8788` | TCP 端口（WebSocket 与 WebRTC 信令） |
| `--udp-port` | `KART_WEBRTC_UDP_PORT` | 与 TCP 端口相同 | WebRTC 共用的 UDP 端口；`0` 为每个连接随机端口（不推荐，防火墙难放行） |
| `--public-origin` | `KART_PUBLIC_ORIGIN` | 见下 | 浏览器访问本节点的地址，例如 `https://game1.example.com`。没设置时用 `http(s)://<--public-ip 或本机第一个非回环 IPv4>:<端口>`（配了证书用 https），并给出警告 |
| `--public-ip` | `KART_PUBLIC_IP` | — | 本机公网 IP（云主机、NAT 后面的机器，公网 IP 不在网卡上）：作为 WebRTC 候选地址（`KART_WEBRTC_PUBLIC_IPS`），没有 `--public-origin` 时也用来拼地址 |
| `--page-host` | `KART_LAN_HOSTS` | — | 游戏页面的域名，逗号分隔。页面与节点不是同一个域名时**必须**设置，否则浏览器连接被 Origin 校验拒绝 |
| `--tls-cert` / `--tls-key` | `KART_TLS_CERT` / `KART_TLS_KEY` | — | 节点直接提供 https/wss（见下文“HTTPS”） |
| `--players` | `KART_MAX_PLAYERS` | `auto` | 最大人数，数字或 `auto` |
| `--uplink` | `KART_UPLINK_MBPS` | — | 本机上行带宽（Mbps），`auto` 人数按它封顶 |
| `--players-per-core` | `KART_PLAYERS_PER_CORE` | `40` | `auto` 时每个可用 CPU 承载的人数 |
| `--reserve-mb` | `KART_RESERVE_MB` | 总内存的 15%（256–2048） | `auto` 时留给系统与其他程序的内存 |
| `--outbox` | `KART_OUTBOX_DIR` | `<配置文件目录>/data/outbox-<节点ID>` | 结算发件箱（没有配置文件时在当前目录下） |
| `--log-file` | `KART_LOG_FILE` | 标准错误；Windows 服务为 `<配置文件目录>\logs\kart-node.log` | 日志文件，20 MB 轮换、保留 3 个旧文件 |
| `--config`、`-c` | — | 见上 | 配置文件 |
| `--service-name` | — | Linux `kart-node`，Windows `KartSimNode` | 系统服务名（一台机器跑多个节点时区分） |
| `--user` | — | `sudo` 前的用户 | Linux `service install`：运行服务的用户 |

`KART_MAX_ROOMS`、`KART_MAX_CONNECTIONS`、`KART_MEMORY_LIMIT_MB`、`KART_CITY_LINES` 不写或写 `auto` 时也由下面的规则推导，写了数字则以数字为准。

## 自动人数

`--players auto`（默认）在**每次启动时**按本机重新计算，升级云主机配置后重启即可。

**人数 = min(CPU 允许, 内存允许, 上行带宽允许)**，并限制在 8（一个满房）到 10000（数据服务心跳接受的上限）之间：

| 资源 | 计算 | 读取方式 |
| --- | --- | --- |
| CPU | 可用 CPU × 40 | 可用 CPU 是 Go 的 `GOMAXPROCS`，会自动降到容器的 CPU 配额 |
| 内存 | (内存 − 预留 − 160 MB) ÷ 2.5 MB | 物理内存与容器/服务内存限制（cgroup v1、v2，含 systemd `MemoryMax=`）中较小的；Windows 用 `GlobalMemoryStatusEx` |
| 上行带宽 | 上行 Mbps × 0.85 ÷ 0.25 | 无法自动检测（云主机网卡速率不代表购买的公网带宽），用 `--uplink` 填写；不填则不按带宽限制 |

由人数推导：房间上限 = 人数 ÷ 2，连接上限 = 人数 + max(人数的 10%, 20)，内存上限（等同 `GOMEMLIMIT`，存活堆超过它的 90% 时拒绝新玩家）= 内存 − 预留，卡丁城线路 = ⌈人数 ÷ 120⌉（1–32）。

**数字的来源**（2026-10-12 实测，一个节点进程，8 人房、每人每 64 毫秒发一帧，反作弊插件开启）：在 Apple M2 Max 上 WebRTC 400 人约用 3.3 个核心、常驻内存约 790 MB，200 → 400 人基本线性；WebSocket 200 人约 0.4 个核心。WebRTC 的 DTLS/SCTP 是主要开销（每个连接约 57 个协程）。云服务器的一个 vCPU（一个超线程）按这种核心的一半算，再留 30% 余量，得到每个 vCPU 40 人。上行每人约 0.25 Mbps：7 个对手 × 15.6 帧/秒 × 约 245 字节（171 字节运动帧加 DTLS/SCTP/UDP/IP 头）。

| 机器 | `--uplink` | 自动人数 | 瓶颈 |
| --- | --- | --- | --- |
| 1 vCPU / 1 GB | 不填 | 40 | CPU |
| 2 vCPU / 4 GB | 5 | 17 | 上行带宽 |
| 4 vCPU / 8 GB | 100 | 160 | CPU |
| 8 vCPU / 16 GB | 100 | 320 | CPU |
| 16 vCPU / 32 GB | 200 | 640 | CPU |

国内云服务器常见的 5–10 Mbps 公网带宽只能带 17–34 人，这时带宽才是瓶颈，一定要填 `--uplink`。50 人乱斗与卡丁城每人要转发给更多的人，单人开销约为普通房间的两倍：主要跑这两种玩法的节点可以把 `--players-per-core` 调到 20。实际负载可以在管理后台的节点页（堆内存、协程、连接数）观察后再调整。

## 系统服务

安装前先用 `kart-node check` 确认配置能用；`service install` 也会先校验配置，无效时不安装。服务的命令行是 `kart-node run --config <配置文件的绝对路径>`，以后改配置文件后重启服务即可。

**Linux（systemd）**：`sudo ./kart-node service install`

- 写入 `/etc/systemd/system/kart-node.service` 并 `systemctl enable --now`：开机启动、退出后 3 秒重启、`LimitNOFILE=1048576`、停止时最多等 20 秒。
- 服务以执行 `sudo` 的普通用户运行（`--user kart` 指定其他用户），并把配置文件、发件箱目录（以及密钥文件）交给该用户；单元带 `AmbientCapabilities=CAP_NET_BIND_SERVICE`，普通用户也能监听 443 等低端口。直接以 root 登录执行时服务以 root 运行，会给出提示。
- 日志：`journalctl -u kart-node -f`。管理：`sudo ./kart-node service stop|start|status|uninstall`（卸载保留配置与发件箱）。

**Windows**：在管理员 PowerShell 中 `.\kart-node.exe service install`

- 创建服务 `KartSimNode`（显示名“KartSim 游戏节点”），自动（延迟）启动；异常退出后 5、10、30 秒自动重启。
- 日志写到配置文件旁的 `logs\kart-node.log`。也可以在“服务”（services.msc）里管理，或 `.\kart-node.exe service stop|start|status|uninstall`。

**一台机器跑多个节点**：每个节点一个目录与配置文件，`--port`、`--id` 不同，安装服务时用不同的 `--service-name`，例如 `sudo ./kart-node service install --config /opt/kart-node-2/kart-node.conf --service-name kart-node-2`。

## HTTPS

游戏页面是 `https://` 时，浏览器只允许连 `wss://`，所以节点地址也必须是 `https://`。两种做法：

1. **节点自己提供 TLS**：`--tls-cert fullchain.pem --tls-key privkey.pem`（PEM，如 Let's Encrypt 的 `fullchain.pem`/`privkey.pem`）。没写 `--public-origin` 时地址自动用 `https://`。证书文件变化后，节点在一分钟内的下一次握手时重新读取，续期不用重启；读取失败时继续用旧证书并记录错误。注意服务用户要能读这两个文件（`/etc/letsencrypt/live` 默认只有 root 可读，可以用 certbot 的 deploy hook 复制到节点目录）。
2. **前面放反向代理**：按 [`README.md`](README.md)“分布式部署”的 Nginx 示例转发 `/multiplayer/ws`、`/multiplayer/offer`、`/multiplayer/healthz`，节点 `--listen 127.0.0.1`、`--public-origin https://game1.example.com`。

两种做法中 WebRTC 的 UDP 都由浏览器直连节点，不经过 TLS 代理（数据通道本身用 DTLS 加密）。

## 排查

| 现象 | 原因与处理 |
| --- | --- |
| `check`：连不上数据服务 | 地址或端口错；数据服务的 `KART_INTERNAL_LISTEN` 还是默认的 `127.0.0.1`；两边防火墙或安全组没放行 8790 |
| `check`：拒绝了集群密钥 | 本节点的 `KART_CLUSTER_SECRET` 与数据服务不同 |
| `check`：不像数据服务的内部端口 | `--data` 指向了公网端口 8787 或别的服务，应指向内部端口（默认 8790） |
| 节点在选服列表里，但玩家进入时 `DATA_NODE_MISMATCH` | `--data-node-id` 与数据服务的 `KART_DATA_NODE_ID` 不同（节点日志也有 `data service reports a different data node`） |
| 进入时 `TICKET_EXPIRED` | 两台机器时钟相差太大，打开系统自动校时 |
| 浏览器连不上节点 | 依次检查：`--public-origin` 是否是玩家能访问的地址；页面是 https 而节点是 http；没设置 `--page-host`；TCP 端口没放行 |
| 能玩，但其他车有时卡顿 | UDP 端口没放行，浏览器退回了 WebSocket；或上行带宽不够，用 `--uplink` 降低人数 |
| 两个节点互相踢人 | 两台机器的节点 ID 相同，用 `--id` 改成不同的值 |

发件箱的处理与 `kart-game` 相同（[`README.md`](README.md)“备份与运维”）：不要删除主目录里的文件，也不要让两个节点共用一个目录。

## 构建与打包

```sh
server-go/scripts/package-node.sh                                  # linux/amd64、linux/arm64、windows/amd64
KART_NODE_TARGETS="windows/arm64" server-go/scripts/package-node.sh
```

产物在 `server-go/dist/kart-node/`：每个包含 `kart-node`（或 `kart-node.exe`）、`plugins/anticheat.wasm`（反作弊插件，节点在程序旁的 `plugins/` 找它）和本文件。也可以直接构建：

```sh
cd server-go
go build -o kart-node ./cmd/kart-node                                        # 本机
GOOS=windows GOARCH=amd64 go build -o kart-node.exe ./cmd/kart-node          # 交叉编译 Windows
```

直接构建时把 `plugins/anticheat.wasm` 放到程序旁的 `plugins/` 目录，否则节点只做运动帧格式校验（日志会说明）。纯 Go、不需要 cgo，产物没有其他依赖。Docker 镜像（[`Dockerfile`](Dockerfile)）里也带有 `kart-node`。
