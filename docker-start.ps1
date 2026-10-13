# KartSim 一键启动（Windows，Docker Desktop）：三个镜像 kartsim-client、kartsim-data、kartsim-node 加 MySQL、Redis。
#
#   docker-start.cmd             # 第一次：生成 .env（随机密码、密钥与管理员），构建镜像并启动
#   docker-start.cmd -NoBuild    # 不重新构建镜像，直接启动
#   docker-start.cmd -Pull       # 不在本机构建：拉取 Docker Hub 上的 kbl13350/kartsim-…（docker-push.sh 推送的）
#   docker-stop.cmd              # 停止（数据保留在 Docker 卷里）
#
# 与 docker-start.sh 相同；端口、管理员、注册方式等写在 .env（第一次运行生成，之后不会覆盖）。
param([switch]$NoBuild, [switch]$Pull)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Fail([string]$message) {
  Write-Host ""
  Write-Host "错误：$message" -ForegroundColor Red
  exit 1
}

function Invoke-Quiet([scriptblock]$block) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $block *> $null; return $LASTEXITCODE -eq 0 } catch { return $false } finally { $ErrorActionPreference = $previous }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "没有找到 docker。请先安装并启动 Docker Desktop。" }
if (-not (Invoke-Quiet { docker compose version })) { Fail "没有 docker compose（Compose v2），请更新 Docker Desktop。" }
if (-not (Invoke-Quiet { docker info })) { Fail "Docker 没有运行。先启动 Docker Desktop，等它显示 Engine running。" }

# 游戏资源包在 git LFS 里；只拉了指针文件时页面能打开但进不了游戏。
$pack = Join-Path $PSScriptRoot 'mirror\p3553\DataPack1_00000.rho5'
if (-not (Test-Path -LiteralPath $pack)) { Fail "缺少游戏资源 mirror\p3553。请先安装 git-lfs 后运行：git lfs pull" }
if ((Get-Item -LiteralPath $pack).Length -lt 4096) { Fail "mirror\p3553 只有 LFS 指针文件。请先安装 git-lfs 后运行：git lfs install; git lfs pull" }

function New-Secret([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

# 本机的局域网 IPv4（默认路由所在网卡）。
function Get-LanIp {
  if (Get-Command Get-NetRoute -ErrorAction SilentlyContinue) {
    try {
      $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
      $address = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction Stop | Select-Object -First 1
      if ($address.IPAddress) { return [string]$address.IPAddress }
    } catch {}
  }
  # 没有 NetTCPIP 模块时：有默认网关、已连接的网卡。
  try {
    foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
      $properties = $nic.GetIPProperties()
      if (-not ($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' })) { continue }
      foreach ($unicast in $properties.UnicastAddresses) {
        if ($unicast.Address.AddressFamily -eq 'InterNetwork') { return $unicast.Address.ToString() }
      }
    }
  } catch {}
  return ''
}

$envPath = Join-Path $PSScriptRoot '.env'
# 读一个设置：环境变量优先（与 docker compose 相同），否则取 .env 里的值。
function Get-EnvValue([string]$key) {
  $fromEnvironment = [Environment]::GetEnvironmentVariable($key)
  if ($fromEnvironment) { return $fromEnvironment.Trim() }
  if (-not (Test-Path -LiteralPath $envPath)) { return '' }
  $value = ''
  foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line.StartsWith("$key=")) { $value = $line.Substring($key.Length + 1).Trim().Trim('"').Trim("'") }
  }
  return $value
}

if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Host "第一次运行：生成 .env（随机密码与密钥）"
  $content = @"
# KartSim 一键启动的配置（docker-start 生成）。含密码与密钥：不要提交、不要发给别人。
# 改完重新运行 docker-start.cmd 生效。MySQL 的两个密码只在第一次初始化数据库时使用，之后改它们
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

# ./docker-start.sh --pull 时拉取的镜像：留空为 Docker Hub 上的 kbl13350/kartsim-…:latest；
# 标签可以固定成某个提交号（如 cc55ba69）。不加 --pull 时在本机构建 kartsim-…:local。
KART_IMAGE_PREFIX=
KART_IMAGE_TAG=

# 管理员：登录后打开 /multiplayer/admin。docker-start 第一次启动时自动注册这个账号。
KART_ADMIN_USERNAMES=admin
KART_ADMIN_PASSWORD=$(New-Secret 9)

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
KART_CLUSTER_SECRET=$(New-Secret 32)
KART_BOOTSTRAP_INVITE=$(New-Secret 12)
MYSQL_ROOT_PASSWORD=$(New-Secret 24)
KART_MYSQL_PASSWORD=$(New-Secret 24)
KART_REDIS_PASSWORD=$(New-Secret 24)
"@
  # docker compose 读 .env 要 UTF-8（无 BOM）与 LF 换行。
  [System.IO.File]::WriteAllText($envPath, ($content -replace "`r`n", "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
  try {
    # 只让当前用户可读。
    $acl = Get-Acl -LiteralPath $envPath
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $envPath -AclObject $acl
  } catch {}
}

$httpPort = Get-EnvValue 'KART_HTTP_PORT'; if (-not $httpPort) { $httpPort = '8780' }
$httpsPort = Get-EnvValue 'KART_HTTPS_PORT'; if (-not $httpsPort) { $httpsPort = '8443' }
$hostNames = Get-EnvValue 'KART_HOST'
$ip = Get-LanIp
if (-not $hostNames) {
  $hostNames = $ip
  $env:KART_HOST = $ip
}
if (-not (Get-EnvValue 'KART_WEBRTC_PUBLIC_IPS')) {
  # WebRTC 候选地址只能是 IP：本机 + 局域网 IP（+ KART_HOST 里写的 IP）。
  $ips = New-Object System.Collections.Generic.List[string]
  $ips.Add('127.0.0.1')
  foreach ($candidate in @($ip) + ($hostNames -split ',')) {
    $candidate = "$candidate".Trim()
    if ($candidate -match '^\d{1,3}(\.\d{1,3}){3}$' -and -not $ips.Contains($candidate)) { $ips.Add($candidate) }
  }
  $env:KART_WEBRTC_PUBLIC_IPS = ($ips -join ',')
}

$ErrorActionPreference = 'Continue'
if ($Pull) {
  $prefix = Get-EnvValue 'KART_IMAGE_PREFIX'; if (-not $prefix) { $prefix = 'kbl13350/kartsim' }
  $imageTag = Get-EnvValue 'KART_IMAGE_TAG'; if (-not $imageTag) { $imageTag = 'latest' }
  $env:KART_IMAGE_PREFIX = $prefix
  $env:KART_IMAGE_TAG = $imageTag
  Write-Host "拉取镜像 $prefix-{client,data,node}:$imageTag …"
  & docker compose pull
  if ($LASTEXITCODE -ne 0) { Fail "拉取镜像失败（网络，或镜像名 KART_IMAGE_PREFIX / 标签 KART_IMAGE_TAG 不对）" }
  Write-Host "启动 KartSim…"
} else {
  Write-Host "启动 KartSim（第一次构建镜像要几分钟）…"
}
# --wait：等所有容器健康；MySQL 第一次初始化约 1 分钟。
$arguments = @('compose', 'up', '-d', '--wait', '--wait-timeout', '600')
if (-not $NoBuild -and -not $Pull) { $arguments += '--build' }
& docker @arguments
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) {
  & docker compose ps -a
  Fail "启动失败。查看日志：docker compose logs --tail 100（端口被占用时在 .env 里换 KART_HTTP_PORT 等端口）"
}

$base = "http://127.0.0.1:$httpPort"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "$base/multiplayer/healthz" | Out-Null; $ok = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { Fail "网页客户端 $base 没有响应：docker compose logs client kart-data" }

function Send-Json([string]$path, $body, [hashtable]$headers = @{}) {
  $json = [System.Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  try {
    $reply = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base$path" -ContentType 'application/json; charset=utf-8' -Headers $headers -Body $json
    return @{ ok = $true; text = $reply.Content }
  } catch {
    $text = "$($_.ErrorDetails.Message)"
    if (-not $text) { $text = "$($_.Exception.Message)" }
    return @{ ok = $false; text = $text }
  }
}

# 管理员账号：用后台登录（不会顶掉游戏里的会话）判断是否已注册，没有就用引导邀请码注册。
$admin = ((Get-EnvValue 'KART_ADMIN_USERNAMES') -split ',')[0].Trim()
$adminPassword = Get-EnvValue 'KART_ADMIN_PASSWORD'
$adminNote = ''
if ($admin -and $adminPassword) {
  $login = Send-Json '/multiplayer/auth/login' @{ username = $admin; password = $adminPassword; console = $true }
  if ($login.ok) {
    $token = ($login.text | ConvertFrom-Json).token
    Send-Json '/multiplayer/auth/logout' @{} @{ Authorization = "Bearer $token" } | Out-Null
    $adminNote = "管理员 $admin（密码见 .env 的 KART_ADMIN_PASSWORD）"
  } else {
    $register = Send-Json '/multiplayer/auth/register' @{ username = $admin; nickname = '管理员'; password = $adminPassword; invite = (Get-EnvValue 'KART_BOOTSTRAP_INVITE') }
    if ($register.ok) {
      $adminNote = "已创建管理员 $admin，密码 $adminPassword（也在 .env 的 KART_ADMIN_PASSWORD）"
    } elseif ($register.text -match 'USERNAME_TAKEN|INVALID_INVITE') {
      $adminNote = "管理员 $admin 已存在（密码已不是 .env 里的 KART_ADMIN_PASSWORD）"
    } else {
      $adminNote = "没能自动注册管理员 ${admin}：$($register.text)"
    }
  }
}

Write-Host ""
Write-Host "KartSim 已启动" -ForegroundColor Green
Write-Host "  本机：      http://localhost:$httpPort"
foreach ($name in ($hostNames -split ',')) {
  if ($name.Trim()) { Write-Host "  局域网：    https://$($name.Trim()):$httpsPort   （自签名证书，第一次打开要在浏览器里点「继续访问」）" }
}
Write-Host "  管理后台：  http://localhost:$httpPort/multiplayer/admin"
if ($adminNote) { Write-Host "  $adminNote" }
Write-Host ""
Write-Host "  在其他机器加游戏节点：后台「游戏节点 → 添加节点」拿到密钥，再按 server-go/NODE.md 的「Docker」一节运行 kartsim-node"
Write-Host "  停止：docker-stop.cmd    日志：docker compose logs -f"
Write-Host "  局域网的其他设备连不上时，在 Windows 防火墙放行 TCP $httpPort、$httpsPort 与 UDP $(if (Get-EnvValue 'KART_GAME_PORT') { Get-EnvValue 'KART_GAME_PORT' } else { '8788' })。"
