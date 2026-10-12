#!/usr/bin/env bash
# 停止 KartSim 一键启动的全部容器（docker-start.sh）。账号、库存等数据留在 Docker 卷 mysql-data 里，
# 下次 ./docker-start.sh 继续使用。连数据一起删除：docker compose down -v（不可恢复）。
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null 2>&1 || { echo "没有找到 docker" >&2; exit 1; }
# down 需要 compose 文件里的变量；没有 .env 时用占位值，只用来删除容器与网络。
if [ -f .env ]; then
  docker compose down
else
  MYSQL_ROOT_PASSWORD=x KART_MYSQL_PASSWORD=x KART_REDIS_PASSWORD=x KART_CLUSTER_SECRET=x docker compose down
fi
echo "KartSim 已停止（数据保留）。"
