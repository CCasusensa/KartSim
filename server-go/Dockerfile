# syntax=docker/dockerfile:1
# KartSim 服务端镜像，一个文件两个目标，共用一次 Go 编译：
#   docker build --target data -t kartsim-data:local server-go   # 数据服务 kart-data（含全局大厅、管理后台）与 kart-migrate-sqlite
#   docker build --target node -t kartsim-node:local server-go   # 游戏节点 kart-node（NODE.md）与反作弊插件
# 网页客户端镜像见 client/Dockerfile；一键启动见仓库根目录的 docker-compose.yml 与 docker-start.sh。

# 编译在构建机的架构上进行、交叉编译到目标架构，多架构镜像（buildx --platform）不必模拟运行 Go。
FROM --platform=$BUILDPLATFORM golang:1.26 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
# 纯 Go 构建（modernc sqlite 不需要 cgo），产物是静态二进制，可在 Alpine 上运行。
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/ \
      ./cmd/kart-data ./cmd/kart-node ./cmd/kart-migrate-sqlite

FROM alpine:3.22 AS runtime
# ca-certificates：连接启用 TLS 的 MySQL/Redis 或 https 数据服务；tzdata：日志时间；wget（busybox）供健康检查。
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 kart \
 && adduser -S -D -H -u 10001 -G kart -h /var/lib/kart kart \
 && mkdir -p /var/lib/kart/outbox \
 && chown -R kart:kart /var/lib/kart \
 && chmod 0700 /var/lib/kart /var/lib/kart/outbox
USER 10001:10001
WORKDIR /var/lib/kart

# ---- 数据服务 ----
FROM runtime AS data
COPY --from=build /out/kart-data /out/kart-migrate-sqlite /usr/local/bin/
# 容器内必须监听所有网卡才能被端口映射与同一网络的其他容器访问；内部 API 只在容器网络里给游戏节点，
# 不要发布到宿主机（compose 只发布 8787 或干脆经网页客户端转发）。
ENV KART_DATA_ADDR=0.0.0.0 \
    KART_DATA_PORT=8787 \
    KART_INTERNAL_LISTEN=0.0.0.0:8790
EXPOSE 8787 8790
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -T 3 -O /dev/null http://127.0.0.1:8787/multiplayer/healthz || exit 1
CMD ["kart-data"]

# ---- 游戏节点 ----
FROM runtime AS node
COPY --from=build /out/kart-node /usr/local/bin/
# 反作弊插件：kart-node 在 /usr/local/lib/kart/plugins 找 anticheat.wasm；也可以挂载别处的插件，
# 再用 KART_ANTICHEAT_PLUGIN 指定路径。
COPY plugins/ /usr/local/lib/kart/plugins/
# 配置全用 KART_* 环境变量（NODE.md）。在其他机器上只需 KART_DATA_URL 与 KART_NODE_KEY：
#   docker run -d -e KART_DATA_URL=https://kart.example.com -e KART_NODE_KEY=kn1.… \
#     -p 8788:8788 -p 8788:8788/udp kartsim-node:local
# 人数默认按容器分到的 CPU 与内存自动计算（KART_MAX_PLAYERS=auto）。
ENV KART_GAME_ADDR=0.0.0.0 \
    KART_GAME_PORT=8788 \
    KART_OUTBOX_DIR=/var/lib/kart/outbox \
    KART_WEBRTC_LOOPBACK=false
EXPOSE 8788 8788/udp
VOLUME /var/lib/kart/outbox
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -T 3 -O /dev/null http://127.0.0.1:${KART_GAME_PORT}/multiplayer/healthz || exit 1
ENTRYPOINT ["kart-node"]
CMD ["run"]
