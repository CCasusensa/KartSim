#!/bin/sh
# 证书：/etc/nginx/tls 下有 cert.pem 与 key.pem（自己的证书）就直接用；没有时生成一张
# 自签名证书，覆盖 localhost、127.0.0.1 与 KART_HOST，KART_HOST 改变后重新生成。
set -eu
# 私钥只给 root（Nginx 的主进程以 root 读取证书）。
umask 077
dir=/etc/nginx/tls
mkdir -p "$dir"
san="DNS:localhost,IP:127.0.0.1"
for host in $(echo "${KART_HOST:-}" | tr ',' ' '); do
  case "$host" in
    *[!0-9.]*) case "$host" in *:*) san="$san,IP:$host" ;; *) san="$san,DNS:$host" ;; esac ;;
    *) san="$san,IP:$host" ;;
  esac
done
if [ -f "$dir/cert.pem" ] && [ -f "$dir/key.pem" ] && [ ! -f "$dir/self-signed.san" ]; then
  echo "kart-tls: using the certificate in $dir"
  exit 0
fi
if [ ! -f "$dir/cert.pem" ] || [ "$(cat "$dir/self-signed.san" 2>/dev/null)" != "$san" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=KartSim" \
    -addext "subjectAltName=$san" -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
  echo "$san" > "$dir/self-signed.san"
  echo "kart-tls: generated a self-signed certificate for $san"
fi
