// Command kart-node runs one game node on its own machine (Linux or
// Windows): kart-game's node, configured from a file, flags and the
// environment, sized from the hardware, and installable as a system
// service. See NODE.md.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"

	"kartsim/internal/game/app"
	"kartsim/internal/game/capacity"
	"kartsim/internal/game/config"
	"kartsim/internal/shared/buildinfo"
)

const help = `kart-node — KartSim 独立游戏节点（Linux / Windows）

用法：
  kart-node [run] [选项]          启动节点（默认命令）
  kart-node init [选项]           生成配置文件 kart-node.conf（写入本次的选项与检测到的硬件）
  kart-node detect [选项]         只检测硬件，打印将使用的人数与配置
  kart-node check [选项]          检查数据服务地址、集群密钥与端口
  kart-node service <动作> [选项]  系统服务：install | uninstall | start | stop | status
                                  （Linux 为 systemd，需要 root；Windows 为系统服务，需要管理员）
  kart-node version

选项写成 -data 或 --data 都可以。配置的优先级：命令行选项 > 环境变量 > 配置文件。配置文件是 KART_变量=值 的文本，
可以写任何 kart-game 的变量（server-go/README.md“kart-game”表）。

例子：
  KART_CLUSTER_SECRET=<集群密钥> ./kart-node init --data 10.0.0.10:8790 \
      --public-origin https://game1.example.com --page-host kart.example.com --uplink 100
  ./kart-node check
  sudo ./kart-node service install

选项：
`

func usage(fs *flag.FlagSet) {
	fmt.Fprint(fs.Output(), help)
	fs.PrintDefaults()
}

func main() {
	setupConsole()
	command, args := "run", os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}
	var err error
	switch command {
	case "run":
		err = cmdRun(args)
	case "init":
		err = cmdInit(args)
	case "detect":
		err = cmdDetect(args)
	case "check":
		err = cmdCheck(args)
	case "service":
		err = cmdService(args)
	case "version":
		fmt.Println("kart-node", buildinfo.Version())
	case "help":
		_, err = parseFlags("help", []string{"-h"})
	default:
		err = fmt.Errorf("未知命令 %q（kart-node help 查看用法）", command)
	}
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "kart-node：", err)
		os.Exit(1)
	}
}

func loadSettings(command string, args []string) (*flags, *settings, error) {
	f, err := parseFlags(command, args)
	if err != nil {
		return nil, nil, err
	}
	s, err := load(f, os.Environ(), capacity.Detect())
	if err != nil {
		return nil, nil, err
	}
	return f, s, nil
}

// nodeConfig validates the merged settings as kart-game would.
func nodeConfig(s *settings) (config.Config, error) {
	cfg, err := config.FromEnv(s.get)
	if err != nil {
		return config.Config{}, err
	}
	cfg.AntiCheatEnv = config.AntiCheatSettings(s.environ())
	return cfg, nil
}

// summary describes the node in a few lines.
func summary(s *settings) []string {
	p := s.plan
	sizing := "手动设置"
	if s.auto {
		parts := []string{fmt.Sprintf("CPU 允许 %d", p.CPUPlayers)}
		if p.MemoryLimitMB > 0 {
			parts = append(parts, fmt.Sprintf("内存允许 %d", p.MemoryPlayers))
		}
		if p.UplinkPlayers > 0 {
			parts = append(parts, fmt.Sprintf("上行带宽允许 %d", p.UplinkPlayers))
		}
		sizing = fmt.Sprintf("自动：%s，取最小（%s）", strings.Join(parts, "，"), capacity.LimitName(p.LimitedBy))
	}
	conf := s.confPath
	if conf == "" {
		conf = "（无，只用命令行与环境变量）"
	}
	name := s.get("KART_NODE_NAME")
	if name == "" {
		name = s.get("KART_NODE_ID")
	}
	memory := s.get("KART_MEMORY_LIMIT_MB") + " MB"
	if memory == "0 MB" {
		memory = "不限"
	}
	return []string{
		"硬件：" + s.hw.Describe(),
		fmt.Sprintf("人数：%s（%s）", s.get("KART_MAX_PLAYERS"), sizing),
		fmt.Sprintf("房间上限 %s，连接上限 %s，内存上限 %s，卡丁城线路 %s", s.get("KART_MAX_ROOMS"),
			s.get("KART_MAX_CONNECTIONS"), memory, s.get("KART_CITY_LINES")),
		fmt.Sprintf("节点：%s（%s），监听 %s:%s/tcp，WebRTC %s/udp", s.get("KART_NODE_ID"), name,
			s.get("KART_GAME_ADDR"), s.get("KART_GAME_PORT"), s.get("KART_WEBRTC_UDP_PORT")),
		"玩家访问：" + s.get("KART_PUBLIC_ORIGIN"),
		fmt.Sprintf("数据服务：%s（数据节点 %s）", orDefault(s.get("KART_DATA_INTERNAL_URL"), "http://127.0.0.1:8790"),
			orDefault(s.get("KART_DATA_NODE_ID"), "data-1")),
		"配置文件：" + conf,
	}
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func printSummary(w io.Writer, s *settings) {
	fmt.Fprintln(w, "KartSim 游戏节点 kart-node", buildinfo.Version())
	for _, line := range summary(s) {
		fmt.Fprintln(w, "  "+line)
	}
	for _, note := range s.notes {
		fmt.Fprintln(w, "  注意："+note)
	}
}

func cmdDetect(args []string) error {
	_, s, err := loadSettings("detect", args)
	if err != nil {
		return err
	}
	printSummary(os.Stdout, s)
	fmt.Printf("\n估算依据（NODE.md“自动人数”）：每个可用 CPU %d 人、每人内存 %.1f MB（另加基础 %d MB）、每人上行 %.2f Mbps。\n",
		s.perCore, capacity.MemoryPerPlayerMB, capacity.BaseMemoryMB, capacity.UplinkPerPlayerMbps)
	return nil
}

func cmdCheck(args []string) error {
	_, s, err := loadSettings("check", args)
	if err != nil {
		return err
	}
	printSummary(os.Stdout, s)
	fmt.Println()
	failed := false
	report := func(what string, err error) {
		if err != nil {
			failed = true
			fmt.Printf("✗ %s：%v\n", what, err)
		} else {
			fmt.Printf("✓ %s\n", what)
		}
	}
	cfg, err := nodeConfig(s)
	report("配置", err)
	if err == nil {
		report("数据服务与集群密钥", probeData(context.Background(), cfg.DataInternalURL, string(cfg.Secret)))
	}
	report("端口", errors.Join(checkPorts(s)...))
	fmt.Println()
	fmt.Println(firewallHint(s))
	if failed {
		return errors.New("检查未通过")
	}
	return nil
}

func cmdRun(args []string) error {
	if isWindowsService() {
		f, err := parseFlags("run", args)
		if err != nil {
			return err
		}
		return runService(f.serviceName, func(ctx context.Context) error {
			s, err := load(f, os.Environ(), capacity.Detect())
			if err != nil {
				serviceFailure(f, err)
				return err
			}
			if s.get("KART_LOG_FILE") == "" {
				s.values["KART_LOG_FILE"] = defaultServiceLog(s.baseDir)
			}
			return runNode(ctx, s)
		})
	}
	_, s, err := loadSettings("run", args)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runNode(ctx, s)
}

// runNode runs the node until ctx ends.
func runNode(ctx context.Context, s *settings) error {
	out := io.Writer(os.Stderr)
	if path := s.get("KART_LOG_FILE"); path != "" {
		file, err := openLog(path)
		if err != nil {
			return err
		}
		defer file.Close()
		out = file
	}
	printSummary(out, s)
	log := slog.New(slog.NewTextHandler(out, nil))
	slog.SetDefault(log)
	fail := func(what string, err error) error {
		log.Error(what, "error", err)
		return fmt.Errorf("%s：%w", what, err)
	}

	cfg, err := nodeConfig(s)
	if err != nil {
		return fail("配置无效", err)
	}
	if cfg.MemoryLimitMB > 0 {
		// Same as GOMEMLIMIT; the node also refuses new players near the limit.
		debug.SetMemoryLimit(int64(cfg.MemoryLimitMB) << 20)
	}
	node, err := app.New(cfg, log, app.Options{})
	if err != nil {
		return fail("启动失败", err)
	}
	go func() {
		// Advice only: the heartbeat keeps retrying either way.
		if err := probeData(ctx, cfg.DataInternalURL, string(cfg.Secret)); err != nil && ctx.Err() == nil {
			log.Error("数据服务检查未通过，节点会继续重试", "problem", err.Error())
		}
	}()
	if err := node.Run(ctx); err != nil {
		return fail("节点异常退出", err)
	}
	return nil
}
