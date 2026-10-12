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
		{"KART_DATA_URL", "数据服务地址：游戏网站的网址（如 https://kart.example.com）；不用节点密钥时是数据服务的内部端口（默认 8790）", true},
		{"KART_NODE_KEY", "节点密钥：管理后台“游戏节点 → 添加节点”给出的 kn1.… 整串。有它就不用下面三项", false},
		{"KART_CLUSTER_SECRET", "不用节点密钥时：集群密钥，与数据服务相同（至少 32 个字符），或 KART_CLUSTER_SECRET_FILE=密钥文件", false},
		{"KART_CLUSTER_SECRET_FILE", "", false},
		{"KART_DATA_NODE_ID", "不用节点密钥时：数据服务的 KART_DATA_NODE_ID", true},
	}},
	{"本节点", []confLine{
		{"KART_NODE_ID", "不用节点密钥时：节点 ID，集群内唯一，定下后不要再改（发件箱目录与它有关）", true},
		{"KART_NODE_NAME", "不用节点密钥时：选服列表里的名称（有密钥时以后台为准）", false},
		{"KART_GAME_ADDR", "", true},
		{"KART_GAME_PORT", "", true},
		{"KART_WEBRTC_UDP_PORT", "WebRTC 共用的 UDP 端口；防火墙与安全组放行上面的 TCP 端口和这个 UDP 端口", true},
	}},
	{"玩家怎么访问本节点", []confLine{
		{"KART_PUBLIC_ORIGIN", "浏览器访问本节点的地址（不填：后台设置的对外地址，否则数据服务看到的本机 IP）；游戏页面是 https 时这里也必须是 https", true},
		{"KART_PUBLIC_IP", "本机公网 IP（云服务器、NAT 后面）：WebRTC 的候选地址", false},
		{"KART_LAN_HOSTS", "额外信任的游戏页面域名，逗号分隔（有节点密钥时自动从数据服务获得）", false},
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

// keyedOnlyDerived are written for a node on the cluster secret only: a
// keyed node gets them from the data service.
var keyedOnlyDerived = map[string]bool{"KART_DATA_NODE_ID": true, "KART_NODE_ID": true}

func cmdInit(args []string) error {
	f, err := parseFlags("init", args)
	if err != nil {
		return err
	}
	path := f.config
	if path == "" {
		path = confName
	}
	given := map[string]string{}
	if secret := strings.TrimSpace(os.Getenv("KART_CLUSTER_SECRET")); secret != "" && f.set["KART_NODE_KEY"] == "" {
		given["KART_CLUSTER_SECRET"] = secret
	}
	for key, value := range f.set {
		given[key] = value
	}
	s, err := writeConf(path, given, f.force)
	if err != nil {
		return err
	}
	printSummary(os.Stdout, s)
	if runtime.GOOS == "windows" {
		fmt.Printf("\n已写入 %s。它含密钥，请放在只有管理员能访问的目录。\n", s.confPath)
	} else {
		fmt.Printf("\n已写入 %s（只有当前用户可读）。\n", s.confPath)
	}
	if !s.keyed() && given["KART_CLUSTER_SECRET"] == "" && given["KART_CLUSTER_SECRET_FILE"] == "" {
		fmt.Println("还没有密钥：在管理后台“游戏节点 → 添加节点”拿到节点密钥，填进 KART_NODE_KEY。")
	}
	fmt.Println("下一步：kart-node check 检查数据服务与端口；kart-node 前台运行；或 kart-node service install 安装为系统服务。")
	return nil
}

// writeConf writes a configuration file holding given (what was asked
// for) plus what kart-node derives; sizing stays "auto" unless given.
func writeConf(path string, given map[string]string, force bool) (*settings, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); err == nil && !force {
		return nil, fmt.Errorf("%s 已存在（加 --force 覆盖）", path)
	}
	for _, key := range []string{"KART_CLUSTER_SECRET_FILE", "KART_TLS_CERT", "KART_TLS_KEY", "KART_OUTBOX_DIR", "KART_LOG_FILE"} {
		if file := given[key]; file != "" {
			if given[key], err = filepath.Abs(file); err != nil {
				return nil, err
			}
		}
	}
	s, err := load(&flags{noConf: true, set: given}, nil, capacity.Detect())
	if err != nil {
		return nil, err
	}
	s.confPath, s.baseDir = path, filepath.Dir(path)

	var b strings.Builder
	fmt.Fprintf(&b, "# KartSim 游戏节点配置，由 kart-node 生成于 %s。\n", time.Now().Format("2006-01-02 15:04"))
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
			case line.always && !(s.keyed() && keyedOnlyDerived[line.key] && !ok):
				// As kart-node resolved it (the data URL normalized).
				value = s.get(line.key)
				if value == "" && line.key == "KART_DATA_URL" {
					value = "http://127.0.0.1:8790"
				}
				if value == "" && line.key == "KART_DATA_NODE_ID" {
					value = "data-1"
				}
				ok = value != ""
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
		if !written[key] && key != "KART_DATA_INTERNAL_URL" {
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
		return nil, err
	}
	_ = os.Chmod(path, 0o600) // an overwritten file keeps its old mode otherwise
	return s, nil
}
