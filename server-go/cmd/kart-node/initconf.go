package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"kartsim/internal/game/capacity"
)

// confLine is one setting of the generated file: always written (derived
// or defaulted), or commented out unless given.
type confLine struct {
	key, comment string
	always       bool
}

var confSections = []struct {
	title string
	lines []confLine
}{
	{"数据服务", []confLine{
		{"KART_DATA_INTERNAL_URL", "数据服务内部地址：数据服务的 KART_INTERNAL_LISTEN（默认端口 8790），必须能从本机访问", true},
		{"KART_DATA_NODE_ID", "数据服务的 KART_DATA_NODE_ID", true},
		{"KART_CLUSTER_SECRET", "集群密钥，与数据服务相同（至少 32 个字符）；也可以改用 KART_CLUSTER_SECRET_FILE=密钥文件", false},
		{"KART_CLUSTER_SECRET_FILE", "", false},
	}},
	{"本节点", []confLine{
		{"KART_NODE_ID", "节点 ID：集群内唯一，定下后不要再改（发件箱目录与它有关）", true},
		{"KART_NODE_NAME", "选服列表里显示的名称（最多 32 个字符，默认同节点 ID）", false},
		{"KART_GAME_ADDR", "", true},
		{"KART_GAME_PORT", "", true},
		{"KART_WEBRTC_UDP_PORT", "WebRTC 共用的 UDP 端口；防火墙与安全组放行上面的 TCP 端口和这个 UDP 端口", true},
	}},
	{"玩家怎么访问本节点", []confLine{
		{"KART_PUBLIC_ORIGIN", "浏览器访问本节点的地址；游戏页面是 https 时这里也必须是 https（配下面的证书，或在前面加 TLS 反向代理）", true},
		{"KART_PUBLIC_IP", "本机公网 IP（云服务器、NAT 后面）：WebRTC 的候选地址", false},
		{"KART_LAN_HOSTS", "游戏页面的域名（与本节点不同域名时必填），逗号分隔", false},
		{"KART_TLS_CERT", "节点直接提供 https/wss 的证书与私钥（PEM；证书续期后自动重新读取）", false},
		{"KART_TLS_KEY", "", false},
	}},
	{"人数（auto：每次启动按本机硬件重新计算）", []confLine{
		{"KART_MAX_PLAYERS", "", true},
		{"KART_UPLINK_MBPS", fmt.Sprintf("本机上行带宽（Mbps）：设置后 auto 人数按每人约 %.2f Mbps 封顶", capacity.UplinkPerPlayerMbps), false},
		{"KART_PLAYERS_PER_CORE", fmt.Sprintf("每个可用 CPU 承载的人数（默认 %d）", capacity.DefaultPlayersPerCore), false},
		{"KART_RESERVE_MB", "给系统与其他程序预留的内存（MB）", false},
	}},
}

func cmdInit(args []string) error {
	f, err := parseFlags("init", args)
	if err != nil {
		return err
	}
	path := f.config
	if path == "" {
		path = confName
	}
	if path, err = filepath.Abs(path); err != nil {
		return err
	}
	if _, err := os.Stat(path); err == nil && !f.force {
		return fmt.Errorf("%s 已存在（加 --force 覆盖）", path)
	}

	// The file holds what was asked for, plus the identity kart-node
	// derives; sizing stays "auto" unless given.
	given := map[string]string{}
	if secret := strings.TrimSpace(os.Getenv("KART_CLUSTER_SECRET")); secret != "" {
		given["KART_CLUSTER_SECRET"] = secret
	}
	for key, value := range f.set {
		given[key] = value
	}
	for _, key := range []string{"KART_CLUSTER_SECRET_FILE", "KART_TLS_CERT", "KART_TLS_KEY", "KART_OUTBOX_DIR", "KART_LOG_FILE"} {
		if file := given[key]; file != "" {
			if given[key], err = filepath.Abs(file); err != nil {
				return err
			}
		}
	}
	s, err := load(&flags{noConf: true, set: given}, nil, capacity.Detect())
	if err != nil {
		return err
	}
	s.confPath, s.baseDir = path, filepath.Dir(path)

	var b strings.Builder
	fmt.Fprintf(&b, "# KartSim 游戏节点配置，由 kart-node init 生成于 %s。\n", time.Now().Format("2006-01-02 15:04"))
	b.WriteString("# 格式 KART_变量=值；优先级：命令行选项 > 环境变量 > 本文件。说明见 server-go/NODE.md，\n")
	b.WriteString("# 这里没列出的 kart-game 变量（server-go/README.md“kart-game”表）也可以写进来。\n")
	fmt.Fprintf(&b, "# 生成时的本机：%s\n", s.hw.Describe())
	written := map[string]bool{}
	for _, section := range confSections {
		fmt.Fprintf(&b, "\n# —— %s ——\n", section.title)
		if strings.HasPrefix(section.title, "人数") {
			fmt.Fprintf(&b, "# 生成时按本机算出 %d 人（瓶颈：%s）\n", s.plan.MaxPlayers, capacity.LimitName(s.plan.LimitedBy))
		}
		for _, line := range section.lines {
			if line.comment != "" {
				fmt.Fprintf(&b, "# %s\n", line.comment)
			}
			value, ok := given[line.key]
			switch {
			case line.key == "KART_MAX_PLAYERS":
				if !ok {
					value, ok = "auto", true
				}
			case line.always: // as kart-node resolved it (the data URL normalized)
				value, ok = s.get(line.key), true
				if value == "" && line.key == "KART_DATA_INTERNAL_URL" {
					value = "http://127.0.0.1:8790"
				}
				if value == "" && line.key == "KART_DATA_NODE_ID" {
					value = "data-1"
				}
			}
			if ok {
				fmt.Fprintf(&b, "%s=%s\n", line.key, value)
			} else {
				fmt.Fprintf(&b, "# %s=\n", line.key)
			}
			written[line.key] = true
		}
	}
	var extra []string
	for key := range given {
		if !written[key] {
			extra = append(extra, key)
		}
	}
	if len(extra) > 0 {
		slices.Sort(extra)
		b.WriteString("\n# —— 其他 ——\n")
		for _, key := range extra {
			fmt.Fprintf(&b, "%s=%s\n", key, given[key])
		}
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600) // an overwritten file keeps its old mode otherwise

	printSummary(os.Stdout, s)
	if runtime.GOOS == "windows" {
		fmt.Printf("\n已写入 %s。它含集群密钥，请放在只有管理员能访问的目录。\n", path)
	} else {
		fmt.Printf("\n已写入 %s（只有当前用户可读）。\n", path)
	}
	if given["KART_CLUSTER_SECRET"] == "" && given["KART_CLUSTER_SECRET_FILE"] == "" {
		fmt.Println("还没有集群密钥：编辑文件填写 KART_CLUSTER_SECRET（与数据服务相同），或用 --secret-file。")
	}
	fmt.Println("下一步：kart-node check 检查数据服务与端口；kart-node 前台运行；或 kart-node service install 安装为系统服务。")
	return nil
}
