package main

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"kartsim/internal/game/capacity"
)

// option is a command-line flag that sets one configuration key.
type option struct {
	flag, key, usage string
}

// options are the flags every subcommand accepts; any other KART_* setting
// goes in the configuration file or the environment.
var options = []option{
	{"data", "KART_DATA_INTERNAL_URL", "数据服务内部地址（数据服务的 KART_INTERNAL_LISTEN），如 10.0.0.10:8790、https://data.example.com:8790"},
	{"data-node-id", "KART_DATA_NODE_ID", "数据服务的 KART_DATA_NODE_ID（默认 data-1）"},
	{"secret-file", "KART_CLUSTER_SECRET_FILE", "集群密钥文件（或用 KART_CLUSTER_SECRET 环境变量 / 配置项）"},
	{"id", "KART_NODE_ID", "节点 ID，集群内唯一（默认 主机名-端口）"},
	{"name", "KART_NODE_NAME", "选服列表里显示的名称（默认同节点 ID）"},
	{"listen", "KART_GAME_ADDR", "监听地址（默认 0.0.0.0）"},
	{"port", "KART_GAME_PORT", "TCP 端口（默认 8788）"},
	{"udp-port", "KART_WEBRTC_UDP_PORT", "WebRTC 的 UDP 端口（默认与 TCP 端口相同）"},
	{"public-origin", "KART_PUBLIC_ORIGIN", "玩家浏览器访问本节点的地址，如 https://game1.example.com"},
	{"public-ip", "KART_PUBLIC_IP", "本机公网 IP：WebRTC 候选地址，没有 --public-origin 时也用它拼地址"},
	{"page-host", "KART_LAN_HOSTS", "前端页面的域名（与本节点不同域名时必填），逗号分隔"},
	{"tls-cert", "KART_TLS_CERT", "PEM 证书文件：节点直接提供 https/wss"},
	{"tls-key", "KART_TLS_KEY", "PEM 私钥文件"},
	{"players", "KART_MAX_PLAYERS", "最大人数：数字或 auto（默认 auto，按硬件计算）"},
	{"uplink", "KART_UPLINK_MBPS", "本机上行带宽（Mbps），auto 人数按它封顶"},
	{"players-per-core", "KART_PLAYERS_PER_CORE", "auto 时每个 CPU 承载的人数（默认 40）"},
	{"reserve-mb", "KART_RESERVE_MB", "auto 时给系统与其他程序预留的内存（MB，默认总内存的 15%，256–2048）"},
	{"outbox", "KART_OUTBOX_DIR", "结算发件箱目录（默认 配置文件所在目录/data/outbox-<节点ID>）"},
	{"log-file", "KART_LOG_FILE", "日志文件（默认写到标准错误；Windows 服务默认 logs/kart-node.log）"},
}

// flags are the parsed command line.
type flags struct {
	config      string
	serviceName string
	serviceUser string
	force       bool
	noConf      bool              // init: ignore existing configuration files
	set         map[string]string // keys of the flags given
	args        []string
}

func parseFlags(command string, args []string) (*flags, error) {
	fs := flag.NewFlagSet("kart-node "+command, flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	f := &flags{set: map[string]string{}}
	fs.StringVar(&f.config, "config", "", "配置文件（默认：当前目录或程序旁的 "+confName+"）")
	fs.StringVar(&f.config, "c", "", "同 --config")
	fs.StringVar(&f.serviceName, "service-name", defaultServiceName, "系统服务名（一台机器跑多个节点时区分）")
	fs.StringVar(&f.serviceUser, "user", "", "service install：Linux 下运行服务的用户（默认 sudo 前的用户）")
	fs.BoolVar(&f.force, "force", false, "init：覆盖已有的配置文件")
	values := map[string]*string{}
	for _, o := range options {
		values[o.flag] = fs.String(o.flag, "", o.usage)
	}
	fs.Usage = func() { usage(fs) }
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	fs.Visit(func(fl *flag.Flag) {
		for _, o := range options {
			if o.flag == fl.Name {
				f.set[o.key] = strings.TrimSpace(*values[o.flag])
			}
		}
	})
	f.args = fs.Args()
	return f, nil
}

// settings are the merged configuration of one run.
type settings struct {
	values   map[string]string // KART_* for config.FromEnv
	confPath string            // "" without a configuration file
	baseDir  string            // relative paths and the default outbox live here
	hw       capacity.Hardware
	plan     capacity.Plan
	auto     bool     // KART_MAX_PLAYERS was auto
	perCore  int      // players per usable CPU in the plan
	notes    []string // warnings for the operator
}

func (s *settings) get(key string) string { return s.values[key] }

func (s *settings) note(format string, args ...any) {
	s.notes = append(s.notes, fmt.Sprintf(format, args...))
}

// environ is the merged configuration as os.Environ entries.
func (s *settings) environ() []string {
	entries := make([]string, 0, len(s.values))
	for key, value := range s.values {
		entries = append(entries, key+"="+value)
	}
	return entries
}

// load merges defaults < configuration file < environment < flags and
// fills in what kart-node derives (node ID, origin, sizing).
func load(f *flags, environ []string, hw capacity.Hardware) (*settings, error) {
	s := &settings{values: map[string]string{}, hw: hw}
	var path string
	var err error
	if !f.noConf {
		if path, err = findConf(f.config); err != nil {
			return nil, err
		}
	}
	if path != "" {
		file, err := readConf(path)
		if err != nil {
			return nil, err
		}
		for key, value := range file {
			s.values[key] = value
		}
		s.confPath, s.baseDir = path, filepath.Dir(path)
	} else if s.baseDir, err = os.Getwd(); err != nil {
		return nil, err
	}
	for _, entry := range environ {
		key, value, ok := strings.Cut(entry, "=")
		if ok && knownKey(key) && strings.TrimSpace(value) != "" {
			s.values[key] = value
		}
	}
	for key, value := range f.set {
		s.values[key] = value
	}
	for key, value := range s.values {
		s.values[key] = strings.TrimSpace(value)
	}
	if err := s.derive(); err != nil {
		return nil, err
	}
	return s, nil
}

var nodeIDChars = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

func (s *settings) derive() error {
	v := s.values
	setDefault := func(key, value string) {
		if v[key] == "" {
			v[key] = value
		}
	}
	setDefault("KART_GAME_ADDR", v["SERVER_ADDRESS"])
	setDefault("KART_GAME_ADDR", "0.0.0.0")
	setDefault("KART_GAME_PORT", "8788")
	port := v["KART_GAME_PORT"]
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return errors.New("端口必须是 1–65535")
	}
	setDefault("KART_NODE_ID", defaultNodeID(s.hw.Hostname, port))
	setDefault("KART_WEBRTC_UDP_PORT", port)

	for _, key := range []string{"KART_CLUSTER_SECRET_FILE", "KART_TLS_CERT", "KART_TLS_KEY", "KART_OUTBOX_DIR",
		"KART_LOG_FILE", "KART_ANTICHEAT_PLUGIN"} {
		if v[key] != "" && v[key] != "off" && !filepath.IsAbs(v[key]) {
			v[key] = filepath.Join(s.baseDir, v[key])
		}
	}
	setDefault("KART_OUTBOX_DIR", filepath.Join(s.baseDir, "data", "outbox-"+v["KART_NODE_ID"]))
	if v["KART_CLUSTER_SECRET"] == "" && v["KART_CLUSTER_SECRET_FILE"] != "" {
		data, err := os.ReadFile(v["KART_CLUSTER_SECRET_FILE"])
		if err != nil {
			return fmt.Errorf("集群密钥文件：%w", err)
		}
		v["KART_CLUSTER_SECRET"] = strings.TrimSpace(string(data))
	}

	if raw := v["KART_DATA_INTERNAL_URL"]; raw != "" {
		normalized, err := normalizeDataURL(raw)
		if err != nil {
			return err
		}
		v["KART_DATA_INTERNAL_URL"] = normalized
		if host := hostOf(normalized); strings.HasPrefix(normalized, "http://") && isPublicHost(host) {
			s.note("数据服务地址 %s 是公网明文 HTTP：集群密钥会明文经过公网。请走内网/VPN（WireGuard），或在数据服务内部端口前加 TLS 并用 https://", normalized)
		}
	} else {
		s.note("没有设置数据服务地址（--data），使用 http://127.0.0.1:8790，只适合数据服务在同一台机器")
	}

	publicIP := v["KART_PUBLIC_IP"]
	if publicIP != "" {
		if net.ParseIP(publicIP) == nil {
			return fmt.Errorf("--public-ip %q 不是 IP 地址", publicIP)
		}
		setDefault("KART_WEBRTC_PUBLIC_IPS", publicIP)
	}
	if v["KART_PUBLIC_ORIGIN"] == "" {
		scheme := "http"
		if v["KART_TLS_CERT"] != "" {
			scheme = "https"
		}
		host := publicIP
		if host == "" {
			host = localAddress()
			s.note("没有设置 --public-origin 或 --public-ip，玩家将用 %s://%s:%s 访问本节点；云服务器的公网 IP 通常不在网卡上，请设置它们",
				scheme, host, port)
		}
		v["KART_PUBLIC_ORIGIN"] = scheme + "://" + net.JoinHostPort(host, port)
	}
	if strings.HasPrefix(v["KART_PUBLIC_ORIGIN"], "http://") {
		s.note("玩家访问地址是 http://：如果游戏页面是 https://，浏览器不允许连 ws://，需要 --tls-cert/--tls-key 或在前面加 TLS 反向代理")
	}
	if v["KART_LAN_HOSTS"] == "" {
		s.note("没有设置 --page-host：游戏页面与本节点不是同一个域名时，浏览器的连接会被 Origin 校验拒绝")
	}
	return s.size()
}

// size resolves the auto values of the limits from the hardware.
func (s *settings) size() error {
	v := s.values
	var in capacity.Inputs
	if raw := v["KART_UPLINK_MBPS"]; raw != "" {
		mbps, err := strconv.ParseFloat(raw, 64)
		if err != nil || mbps <= 0 || mbps > 1_000_000 {
			return errors.New("KART_UPLINK_MBPS（--uplink）必须是正数（Mbps）")
		}
		in.UplinkMbps = mbps
	}
	if raw := v["KART_PLAYERS_PER_CORE"]; raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 1000 {
			return errors.New("KART_PLAYERS_PER_CORE（--players-per-core）必须是 1–1000 的整数")
		}
		in.PlayersPerCore = n
	}
	if raw := v["KART_RESERVE_MB"]; raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return errors.New("KART_RESERVE_MB（--reserve-mb）必须是不小于 0 的整数")
		}
		in.ReserveMB = n
	}
	s.plan = capacity.Suggest(s.hw, in)
	s.perCore = in.PlayersPerCore
	if s.perCore == 0 {
		s.perCore = capacity.DefaultPlayersPerCore
	}
	isAuto := func(key string) bool { return v[key] == "" || strings.EqualFold(v[key], "auto") }
	s.auto = isAuto("KART_MAX_PLAYERS")
	if !s.auto {
		n, err := strconv.Atoi(v["KART_MAX_PLAYERS"])
		if err != nil || n < 1 || n > capacity.MaxPlayers {
			return fmt.Errorf("KART_MAX_PLAYERS（--players）必须是 auto 或 1–%d 的整数", capacity.MaxPlayers)
		}
		if n > s.plan.MaxPlayers {
			s.note("设置的人数 %d 超过按本机硬件估算的 %d（瓶颈：%s）", n, s.plan.MaxPlayers, capacity.LimitName(s.plan.LimitedBy))
		}
		s.plan.MaxPlayers = n
		s.plan.Derive()
	} else if in.UplinkMbps == 0 {
		s.note("没有设置上行带宽（--uplink），人数只按 CPU 与内存计算；小带宽云服务器（如 5–10 Mbps）请设置，每人约需 %.2f Mbps",
			capacity.UplinkPerPlayerMbps)
	}
	v["KART_MAX_PLAYERS"] = strconv.Itoa(s.plan.MaxPlayers)
	for key, value := range map[string]int{"KART_MAX_ROOMS": s.plan.MaxRooms,
		"KART_MAX_CONNECTIONS": s.plan.MaxConnections, "KART_MEMORY_LIMIT_MB": s.plan.MemoryLimitMB,
		"KART_CITY_LINES": s.plan.CityLines} {
		if isAuto(key) {
			v[key] = strconv.Itoa(value)
		}
	}
	return nil
}

// defaultNodeID is the host name and port, e.g. "hk-01-8788".
func defaultNodeID(hostname, port string) string {
	host := strings.Trim(nodeIDChars.ReplaceAllString(strings.Split(hostname, ".")[0], "-"), "-")
	if host == "" {
		return "game-" + port
	}
	return host[:min(len(host), 64-len(port)-1)] + "-" + port
}

// normalizeDataURL accepts host, host:port or an http(s) URL; the port
// defaults to 8790 (the data service's internal listener).
func normalizeDataURL(raw string) (string, error) {
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("数据服务地址 %q 无效，应为 主机:端口 或 http(s)://主机:端口", raw)
	}
	if parsed.Port() == "" {
		parsed.Host = net.JoinHostPort(parsed.Hostname(), "8790")
	}
	return parsed.Scheme + "://" + parsed.Host + strings.TrimRight(parsed.Path, "/"), nil
}

func hostOf(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

// isPublicHost reports whether host is a public IP address. Names are not
// resolved and count as private.
func isPublicHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	// 100.64.0.0/10 (carrier-grade NAT) is also where Tailscale puts its peers.
	_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
	return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || cgnat.Contains(ip))
}

// localAddress is the first non-loopback IPv4 address of the machine, else
// 127.0.0.1.
func localAddress() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "127.0.0.1"
	}
	for _, addr := range addrs {
		if ipNet, ok := addr.(*net.IPNet); ok {
			if ip := ipNet.IP.To4(); ip != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
				return ip.String()
			}
		}
	}
	return "127.0.0.1"
}
