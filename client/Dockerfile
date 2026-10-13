# syntax=docker/dockerfile:1
# KartSim 客户端镜像：构建浏览器客户端（同源连接数据服务），由 Nginx 提供页面，并把联机
# 接口转给数据服务与游戏节点（client/docker/default.conf.template）。
# 游戏资源包 mirror/p3553（约 3.5 GB，git LFS）不进镜像，运行时挂载到 /srv/web/p3553。
# 构建上下文是仓库根目录（见根目录 .dockerignore）：
#   docker build -f client/Dockerfile -t kartsim-client:local .
# 运行时要能解析到 kart-data 与 kart-node 两个主机名（compose 的服务名），见 docker-compose.yml。

# 构建产物与架构无关：在构建机的架构上只构建一次。
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
# vite 的 publicDir 是 ../mirror：构建时要解析其中的 /assets/…（音频解码 worker 等）。
COPY mirror/assets/ /src/mirror/assets/
COPY mirror/sw.js mirror/manifest.webmanifest /src/mirror/
COPY client/ ./
# 同源：页面、数据服务与游戏节点都经这台 Nginx（auth/config 返回 backendOrigin null）。
# link-build-assets 复制原版的小件运行时资源（样式、音频 wasm、service worker、manifest），它给大资源目录
# 建的符号链接删掉：那些目录在下一阶段复制或运行时挂载。
RUN VITE_MULTIPLAYER_SAME_ORIGIN=1 npx vite build \
 && node tools/link-build-assets.mjs \
 && find dist -maxdepth 1 -type l -delete \
 && node tools/precompress-build.mjs

FROM nginx:1.27-alpine
# openssl：首次启动时生成自签名证书（client/docker/tls.sh）。
RUN apk add --no-cache openssl
COPY --from=build /src/client/dist /srv/web
COPY mirror/__p3553 /srv/web/__p3553
COPY mirror/ui /srv/web/ui
COPY mirror/classic-hud /srv/web/classic-hud
COPY client/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 client/docker/tls.sh /docker-entrypoint.d/05-kart-tls.sh
# 启动时核对挂载的 mirror/p3553 与上面复制的资源清单是同一版本（不一致只在日志里警告）。
COPY --chmod=0755 client/docker/check-resources.sh /docker-entrypoint.d/06-kart-resources.sh
# 在 Windows 上检出时可能被改成 CRLF：去掉行尾的 \r，否则 sh 无法运行它。
RUN sed -i 's/\r$//' /docker-entrypoint.d/05-kart-tls.sh /docker-entrypoint.d/06-kart-resources.sh \
  /etc/nginx/templates/default.conf.template
EXPOSE 8780 8443
