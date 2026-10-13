#!/usr/bin/env bash
# 构建三个镜像并推到 Docker Hub（或其他镜像仓库），amd64 与 arm64 两种架构一起：
#
#   ./docker-push.sh                  # 推到 kbl13350/kartsim-client、kartsim-data、kartsim-node
#   ./docker-push.sh 名字             # 推到 名字/kartsim-…（Docker Hub 用户或组织；也可以是 ghcr.io/名字）
#   ./docker-push.sh --build-only     # 只构建（检查能否构建、预热缓存），不推送
#
# 标签：latest 和当前提交号（如 cc55ba69）。工作区有未提交的改动时拒绝推送（标签要对得上提交），
# 加 --dirty 强制。推送前先登录：Docker Desktop 里登录，或 docker login。
# 架构用 KART_PLATFORMS 改，如 KART_PLATFORMS=linux/amd64 ./docker-push.sh。
set -euo pipefail
cd "$(dirname "$0")"

die() { printf '\n错误：%s\n' "$*" >&2; exit 1; }

namespace=kbl13350
push=1
dirty=
for arg in "$@"; do
  case "$arg" in
    --build-only) push= ;;
    --dirty) dirty=1 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "不认识的参数 $arg" ;;
    *) namespace=$arg ;;
  esac
done
platforms=${KART_PLATFORMS:-linux/amd64,linux/arm64}

command -v docker >/dev/null 2>&1 || die "没有找到 docker"
docker buildx version >/dev/null 2>&1 || die "没有 docker buildx（Docker Desktop 自带；Linux 安装 docker-buildx-plugin）"
[ -f mirror/assets/VorbisDecodeWorker-IhDQFtip.js ] || die "缺少 mirror/assets（客户端构建要用）"
[ -f server-go/plugins/anticheat.wasm ] || die "缺少 server-go/plugins/anticheat.wasm（节点镜像要带反作弊插件）"

revision=$(git rev-parse HEAD)
tag=$(git rev-parse --short=8 HEAD)
if [ -n "$push" ] && [ -z "$dirty" ] && [ -n "$(git status --porcelain | grep -v 'node_modules$' || true)" ]; then
  git status --short | grep -v 'node_modules$' >&2
  die "工作区有未提交的改动，镜像会和提交 $tag 对不上。先提交，或加 --dirty"
fi

# 多架构镜像要用 docker-container 驱动的构建器（默认的 docker 驱动只能构建本机架构）。
builder=kartsim-multiarch
if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container >/dev/null
fi

output=()
if [ -n "$push" ]; then
  output=(--push)
  echo "推送到 $namespace/kartsim-{client,data,node}:{latest,$tag}（$platforms）"
else
  echo "只构建（$platforms），不推送"
fi

build() { # 镜像名 构建参数…
  local name=$1
  shift
  echo ""
  echo "== $namespace/$name"
  docker buildx build --builder "$builder" --platform "$platforms" --provenance=false \
    --label "org.opencontainers.image.source=https://github.com/kbl13350/KartSim" \
    --label "org.opencontainers.image.revision=$revision" \
    -t "$namespace/$name:latest" -t "$namespace/$name:$tag" ${output[@]+"${output[@]}"} "$@"
}

build kartsim-data --target data server-go
build kartsim-node --target node server-go
build kartsim-client -f client/Dockerfile .

echo ""
if [ -n "$push" ]; then
  echo "完成：$namespace/kartsim-client、$namespace/kartsim-data、$namespace/kartsim-node（latest、$tag）"
  echo "用它们一键启动：./docker-start.sh --pull；其他机器上的节点：docker run … $namespace/kartsim-node（server-go/NODE.md）"
else
  echo "构建完成（没有推送）"
fi
