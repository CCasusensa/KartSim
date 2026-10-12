#!/usr/bin/env bash
# KartSim 一键启动（macOS / Linux）：三个镜像 kartsim-client、kartsim-data、kartsim-node 加 MySQL、Redis。
#
#   ./docker-start.sh             # 第一次：生成 .env（随机密码、密钥与管理员），构建镜像并启动
#   ./docker-start.sh --no-build  # 不重新构建镜像，直接启动
#   ./docker-stop.sh              # 停止（数据保留在 Docker 卷里）
#
# 端口、管理员用户名、注册方式、经济倍率等写在 .env（第一次运行生成，之后不会覆盖）。
# 需要 Docker（Docker Desktop 或 Docker Engine + compose 插件）与 curl。
set -euo pipefail
cd "$(dirname "$0")"

die() { printf '\n错误：%s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

build=--build
for arg in "$@"; do
  case "$arg" in
    --no-build) build= ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "不认识的参数 $arg（可用 --no-build）" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "没有找到 docker。请先安装 Docker Desktop（macOS）或 Docker Engine（Linux）。"
docker compose version >/dev/null 2>&1 || die "没有 docker compose 插件（Compose v2）。Linux 上安装 docker-compose-plugin。"
docker info >/dev/null 2>&1 || die "Docker 没有运行（或当前用户无权访问它）。先启动 Docker Desktop / systemctl start docker。"
command -v curl >/dev/null 2>&1 || die "没有找到 curl。"

# 游戏资源包在 git LFS 里；只拉了指针文件时页面能打开但进不了游戏。
pack=mirror/p3553/DataPack1_00000.rho5
if [ ! -f "$pack" ]; then
  die "缺少游戏资源 mirror/p3553。请先安装 git-lfs 后运行：git lfs pull"
fi
if [ "$(wc -c <"$pack" | tr -d ' ')" -lt 4096 ] && head -c 64 "$pack" | grep -q 'git-lfs'; then
  die "mirror/p3553 只有 LFS 指针文件。请先安装 git-lfs 后运行：git lfs install && git lfs pull"
fi

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# 本机的局域网 IPv4（默认路由所在网卡）。
lan_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  fi
  if [ -z "$ip" ] && command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    local dev
    dev=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }')
    [ -n "$dev" ] && ip=$(ipconfig getifaddr "$dev" 2>/dev/null || true)
    # 默认路由走 VPN（utun）时它没有 IPv4：改用有线或 Wi-Fi 网卡。
    for dev in en0 en1 en2 en3 en4 en5 en6 en7 en8; do
      [ -z "$ip" ] || break
      ip=$(ipconfig getifaddr "$dev" 2>/dev/null || true)
    done
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)
  fi
  printf '%s' "$ip"
}

# 读一个设置：环境变量优先（与 docker compose 相同），否则取 .env 里的值（不 source：值里可能有 shell 特殊字符）。
env_value() {
  if [ -n "$(printenv "$1" 2>/dev/null)" ]; then printenv "$1"; return 0; fi
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

if [ ! -f .env ]; then
  say "第一次运行：生成 .env（随机密码与密钥，只有你自己可读）"
  (
    umask 077
    cat >.env <<EOF
# KartSim 一键启动的配置（docker-start.sh 生成）。含密码与密钥：不要提交、不要发给别人。
# 改完重新运行 ./docker-start.sh 生效。MySQL 的两个密码只在第一次初始化数据库时使用，之后改它们
# 要先在 MySQL 里改（见 server-go/README.md“修改密码”）。

# 对外端口：网页 http 与 https、游戏节点的 WebRTC（UDP）。
KART_HTTP_PORT=8780
KART_HTTPS_PORT=8443
KART_GAME_PORT=8788
# 发布端口绑定的地址；0.0.0.0 让局域网的其他设备也能玩，127.0.0.1 只允许本机。
KART_BIND_ADDR=0.0.0.0

# 玩家访问这台机器用的主机名或 IP（逗号分隔），写进自签名证书，也作为 WebRTC 的候选地址。
# 留空时每次启动自动检测本机的局域网 IP。有域名或公网 IP 时写在这里。
KART_HOST=
# WebRTC（UDP）的候选地址只能是 IP：留空时用 127.0.0.1、局域网 IP 和 KART_HOST 里的 IP；
# KART_HOST 写的是域名时，在这里写服务器的公网 IP。
KART_WEBRTC_PUBLIC_IPS=

# 管理员：登录后打开 /multiplayer/admin。docker-start.sh 第一次启动时自动注册这个账号。
KART_ADMIN_USERNAMES=admin
KART_ADMIN_PASSWORD=$(random_secret 9)

# 注册方式 open / invite / closed；新账号的初始货币与每局点券；经验与金币倍率。
KART_REGISTRATION=open
KART_STARTING_LUCCI=20000
KART_STARTING_COUPON=20000
KART_STARTING_KOIN=20000
KART_RACE_COUPON=100
KART_EXP_RATE=1
KART_LUCCI_RATE=1

# 游戏节点：人数 auto 按容器分到的 CPU 与内存计算；上行带宽（Mbps）留空不限；反作弊 kick / log / off。
KART_GAME_NAME=游戏服 1
KART_MAX_PLAYERS=auto
KART_UPLINK_MBPS=
KART_ANTICHEAT=kick

# 密钥（随机生成）。KART_CLUSTER_SECRET 是数据服务与本机游戏节点的共享密钥；其他机器上的节点
# 用后台“游戏节点 → 添加节点”给出的节点密钥，不用它。
KART_CLUSTER_SECRET=$(random_secret 32)
KART_BOOTSTRAP_INVITE=$(random_secret 12)
MYSQL_ROOT_PASSWORD=$(random_secret 24)
KART_MYSQL_PASSWORD=$(random_secret 24)
KART_REDIS_PASSWORD=$(random_secret 24)
EOF
  )
else
  chmod 600 .env 2>/dev/null || true
fi

http_port=$(env_value KART_HTTP_PORT); http_port=${http_port:-8780}
https_port=$(env_value KART_HTTPS_PORT); https_port=${https_port:-8443}
host=$(env_value KART_HOST)
ip=$(lan_ip)
if [ -z "$host" ]; then
  host=$ip
  export KART_HOST="$ip"
fi
if [ -z "$(env_value KART_WEBRTC_PUBLIC_IPS)" ]; then
  # WebRTC 候选地址只能是 IP：本机 + 局域网 IP（+ KART_HOST 里写的 IP）。
  ips=127.0.0.1
  for candidate in $ip $(printf '%s' "$host" | tr ',' ' '); do
    case "$candidate" in
      *[!0-9.]*|'') ;;
      *) case ",$ips," in *",$candidate,"*) ;; *) ips="$ips,$candidate" ;; esac ;;
    esac
  done
  export KART_WEBRTC_PUBLIC_IPS="$ips"
fi

say "启动 KartSim（第一次构建镜像要几分钟）…"
# --wait：等所有容器健康；MySQL 第一次初始化约 1 分钟。
if ! docker compose up -d $build --wait --wait-timeout 600; then
  say ""
  docker compose ps -a || true
  die "启动失败。查看日志：docker compose logs --tail 100（端口被占用时在 .env 里换 KART_HTTP_PORT 等端口）"
fi

base="http://127.0.0.1:$http_port"
ok=
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$base/multiplayer/healthz" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || die "网页客户端 $base 没有响应：docker compose logs client kart-data"

# 管理员账号：用后台登录（不会顶掉游戏里的会话）判断是否已注册，没有就用引导邀请码注册。
admin=$(env_value KART_ADMIN_USERNAMES | cut -d, -f1 | tr -d ' ')
admin_password=$(env_value KART_ADMIN_PASSWORD)
invite=$(env_value KART_BOOTSTRAP_INVITE)
admin_note=""
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
if [ -n "$admin" ] && [ -n "$admin_password" ]; then
  body=$(printf '{"username":"%s","password":"%s","console":true}' "$(json_escape "$admin")" "$(json_escape "$admin_password")")
  reply=$(curl -sS -X POST -H 'Content-Type: application/json' -d "$body" "$base/multiplayer/auth/login" || true)
  token=$(printf '%s' "$reply" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  if [ -n "$token" ]; then
    curl -sS -o /dev/null -X POST -H "Authorization: Bearer $token" "$base/multiplayer/auth/logout" || true
    admin_note="管理员 $admin（密码见 .env 的 KART_ADMIN_PASSWORD）"
  else
    body=$(printf '{"username":"%s","nickname":"管理员","password":"%s","invite":"%s"}' \
      "$(json_escape "$admin")" "$(json_escape "$admin_password")" "$(json_escape "$invite")")
    reply=$(curl -sS -X POST -H 'Content-Type: application/json' -d "$body" "$base/multiplayer/auth/register" || true)
    if printf '%s' "$reply" | grep -q '"token"'; then
      admin_note="已创建管理员 $admin，密码 $admin_password（也在 .env 的 KART_ADMIN_PASSWORD）"
    elif printf '%s' "$reply" | grep -q 'USERNAME_TAKEN\|INVALID_INVITE'; then
      admin_note="管理员 $admin 已存在（密码已不是 .env 里的 KART_ADMIN_PASSWORD）"
    else
      admin_note="没能自动注册管理员 $admin：$reply"
    fi
  fi
fi

say ""
say "KartSim 已启动"
say "  本机：      http://localhost:$http_port"
if [ -n "$host" ]; then
  for name in $(printf '%s' "$host" | tr ',' ' '); do
    say "  局域网：    https://$name:$https_port   （自签名证书，第一次打开要在浏览器里点“继续访问”）"
  done
fi
say "  管理后台：  http://localhost:$http_port/multiplayer/admin"
[ -z "$admin_note" ] || say "  $admin_note"
say ""
say "  在其他机器加游戏节点：后台“游戏节点 → 添加节点”拿到密钥，再按 server-go/NODE.md 的“Docker”一节运行 kartsim-node"
say "  停止：./docker-stop.sh    日志：docker compose logs -f"
