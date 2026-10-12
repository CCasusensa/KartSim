#!/usr/bin/env bash
# 打包独立游戏节点 kart-node（NODE.md）：交叉编译并把程序、反作弊插件与说明打成
# server-go/dist/kart-node/kart-node-<版本>-<系统>-<架构>.tar.gz（Windows 为 .zip）。
#
#   server-go/scripts/package-node.sh
#   KART_NODE_TARGETS="linux/amd64 windows/amd64" server-go/scripts/package-node.sh
set -euo pipefail

cd "$(dirname "$0")/.."
targets=${KART_NODE_TARGETS:-"linux/amd64 linux/arm64 windows/amd64"}
version=$(git describe --always --dirty 2>/dev/null || echo dev)
out=dist/kart-node

if [[ ! -f plugins/anticheat.wasm ]]; then
  echo "缺少 plugins/anticheat.wasm（反作弊插件），无法打包" >&2
  exit 1
fi
command -v zip >/dev/null || { echo "需要 zip 命令" >&2; exit 1; }

rm -rf "$out"
mkdir -p "$out"
for target in $targets; do
  os=${target%/*}
  arch=${target#*/}
  name="kart-node-$version-$os-$arch"
  dir="$out/$name"
  exe=kart-node
  [[ $os == windows ]] && exe=kart-node.exe
  mkdir -p "$dir/plugins"
  echo "构建 $target …"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags="-s -w" -o "$dir/$exe" ./cmd/kart-node
  cp plugins/anticheat.wasm "$dir/plugins/"
  cp NODE.md "$dir/"
  if [[ $os == windows ]]; then
    (cd "$out" && zip -qr "$name.zip" "$name")
  else
    tar -C "$out" -czf "$out/$name.tar.gz" "$name"
  fi
  rm -rf "$dir"
done
ls -l "$out"
