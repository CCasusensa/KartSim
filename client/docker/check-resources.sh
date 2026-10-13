#!/bin/sh
# 游戏资源检查：挂载进来的 mirror/p3553 与镜像里的资源清单（构建镜像时的 mirror/__p3553）是否是同一版本。
# 不一致时页面照常打开，但读到那些文件就失败，玩家看到“…与资源清单版本不一致”（例如进不了卡丁城）。
# Nginx 启动时运行（/docker-entrypoint.d/），docker-start 启动后再运行一次把结果告诉你；只提示，不阻止启动。
# 一切正常时什么也不输出。
manifest=/srv/web/__p3553/resources
dir=/srv/web/p3553
[ -f "$manifest" ] && [ -d "$dir" ] || exit 0
# 先是文件名与大小（跟随符号链接），再是清单：格式化的 JSON，每个文件的 "name" 行在 "size" 行之前。
{
  (cd "$dir" && stat -L -c '%n %s' -- * 2>/dev/null)
  echo "@@manifest"
  cat "$manifest"
} | awk '
  $0 == "@@manifest" { listed = 1; next }
  !listed { have[$1] = $2; next }
  /"name":/ { split($0, part, "\""); name = part[4] }
  /"size":/ {
    size = $2; sub(/,.*/, "", size)
    if (!(name in have)) { missing++; if (missing <= 5) gone = gone "\n  " name }
    else if (have[name] != size) {
      bad++
      if (bad <= 10) wrong = wrong sprintf("\n  %s：清单 %s 字节，mirror/p3553 里是 %s 字节", name, size, have[name])
    }
  }
  END {
    if (!bad && !missing) exit
    printf "警告：mirror/p3553 的游戏资源和网页镜像的资源清单不是同一版本"
    if (bad) printf "\n%d 个文件大小不同：%s%s", bad, wrong, (bad > 10 ? "\n  …" : "")
    if (missing) printf "\n缺少 %d 个文件：%s%s", missing, gone, (missing > 5 ? "\n  …" : "")
    printf "\n玩家读到这些文件时会失败（例如进入卡丁城失败）。在仓库目录运行 git pull 和 git lfs pull，\n"
    printf "让 mirror/p3553 与镜像同一版本后重启；用 --pull 时也可以在 .env 把 KART_IMAGE_TAG 改成与检出相同的提交号。\n"
  }
' >&2
exit 0
