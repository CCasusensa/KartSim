// Package config reads the game node settings from the environment
// (DESIGN.md 4.1).
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"kartsim/internal/shared/netcfg"
	"kartsim/internal/shared/ticket"
)

// SameOrigin is the KART_PUBLIC_ORIGIN value for a node reached through the
// data service's origin (a reverse proxy routes /multiplayer/ws).
const SameOrigin = "same-origin"

// MaxPlayersLimit bounds KART_MAX_PLAYERS: the data service rejects a
// heartbeat that lists more online players than this, which would drop the
// node from the game-server list.
const MaxPlayersLimit = 10_000

var nodeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Config is the validated node configuration.
type Config struct {
	Addr            string
	Port            int
	NodeID          string
	NodeName        string
	PublicOrigin    string // "" when SameOrigin
	DataInternalURL string
	DataNodeID      string
	Secret          []byte
	MaxPlayers      int
	OutboxDir       string
	Network         *netcfg.Network

	// TLSCert and TLSKey make the node serve HTTPS and WSS itself
	// (KART_TLS_CERT, KART_TLS_KEY: PEM files, both or neither). The node
	// reads them again when they change, so a renewed certificate needs no
	// restart.
	TLSCert, TLSKey string

	// AllowGuests admits guest tickets (KART_ALLOW_GUESTS, default false:
	// hello with a guest ticket answers 401 LOGIN_REQUIRED).
	AllowGuests bool
	// ItemTestGrants lets an item race cube request name the item it grants
	// (KART_ITEM_TEST_GRANTS, default false): a development switch for test
	// bots and manual testing, never for a public deployment.
	ItemTestGrants bool
	// ItemChangersInfinite gives every item racer unlimited item changers
	// (KART_ITEM_CHANGERS=infinite; default inventory: the cards and
	// vouchers each account owns), a playtest switch.
	ItemChangersInfinite bool
	// AntiCheatPlugin is the anti-cheat plugin to load
	// (KART_ANTICHEAT_PLUGIN: a path, or off; empty: the default places,
	// ANTICHEAT.md), and AntiCheatEnv the KART_ANTICHEAT* settings handed
	// to it (AntiCheatSettings).
	AntiCheatPlugin string
	AntiCheatEnv    map[string]string
	// Memory guards (DESIGN.md 4.5).
	MaxConnections  int           // WebSockets including those without hello
	MaxRooms        int           // rooms on this node
	SendBufferBytes int           // queued outbound bytes per connection
	MemoryLimitMB   int           // 0 = no limit
	HelloTimeout    time.Duration // close connections that do not say hello in time

	// WSCompression negotiates permessage-deflate on /multiplayer/ws
	// (KART_WS_COMPRESSION, default true).
	WSCompression bool

	// HeartbeatInterval is 5 s; tests shorten it.
	HeartbeatInterval time.Duration

	// WebRTC transport (POST /multiplayer/offer, internal/game/ws/rtc.go):
	// KART_WEBRTC (default true), KART_WEBRTC_UDP_PORT (0: a random port
	// per peer), KART_WEBRTC_PUBLIC_IPS (1:1 NAT addresses) and
	// KART_WEBRTC_LOOPBACK (default true: 127.0.0.1 candidates too).
	WebRTC          bool
	WebRTCUDPPort   int
	WebRTCPublicIPs []string
	WebRTCLoopback  bool

	// The city zone (CITY.md 6, internal/game/city): KART_CITY (default
	// true; off answers city-join CITY_DISABLED), KART_CITY_LINES (2),
	// KART_CITY_LINE_PLAYERS (60), KART_CITY_INTEREST_RADIUS (160 m),
	// KART_CITY_CHAT_RADIUS (60 m), KART_CITY_AFK_MINUTES (10),
	// KART_CITY_MAX_SPEED (150 m/s), KART_CITY_DAY_MINUTES (48),
	// KART_CITY_WEATHER (true), KART_CITY_RAIN_PERCENT (20) and
	// KART_CITY_SNOW_PERCENT (10).
	City               bool
	CityLines          int
	CityLinePlayers    int
	CityInterestRadius float64
	CityChatRadius     float64
	CityAFKMinutes     int
	CityMaxSpeed       float64
	CityDayMinutes     int
	CityWeather        bool
	CityRainPercent    int
	CitySnowPercent    int
}

// ListenAddr is the host:port the HTTP server binds.
func (c Config) ListenAddr() string {
	return net.JoinHostPort(c.Addr, strconv.Itoa(c.Port))
}

// FromEnv reads and validates the configuration through getenv.
func FromEnv(getenv func(string) string) (Config, error) {
	env := func(name, fallback string) string {
		if value := strings.TrimSpace(getenv(name)); value != "" {
			return value
		}
		return fallback
	}
	var cfg Config
	var problems []error

	cfg.Addr = env("KART_GAME_ADDR", env("SERVER_ADDRESS", "127.0.0.1"))
	port, err := strconv.Atoi(env("KART_GAME_PORT", "8788"))
	if err != nil || port < 1 || port > 65535 {
		problems = append(problems, errors.New("KART_GAME_PORT 必须是 1–65535 的端口号"))
	}
	cfg.Port = port

	cfg.NodeID = env("KART_NODE_ID", "game-"+strconv.Itoa(port))
	if !nodeIDPattern.MatchString(cfg.NodeID) {
		problems = append(problems, errors.New("KART_NODE_ID 只允许 [A-Za-z0-9_-]，长度 1–64"))
	}
	cfg.NodeName = env("KART_NODE_NAME", cfg.NodeID)
	if utf8.RuneCountInString(cfg.NodeName) > 32 || hasControl(cfg.NodeName) {
		problems = append(problems, errors.New("KART_NODE_NAME 最多 32 个字符且不能含控制字符"))
	}

	cfg.TLSCert, cfg.TLSKey = env("KART_TLS_CERT", ""), env("KART_TLS_KEY", "")
	if (cfg.TLSCert == "") != (cfg.TLSKey == "") {
		problems = append(problems, errors.New("KART_TLS_CERT 与 KART_TLS_KEY 要同时设置"))
	}
	scheme := "http"
	if cfg.TLSCert != "" {
		scheme = "https"
	}
	origin := env("KART_PUBLIC_ORIGIN", scheme+"://127.0.0.1:"+strconv.Itoa(port))
	if origin == SameOrigin {
		cfg.PublicOrigin = ""
	} else if normalized, err := normalizeOrigin(origin); err != nil {
		problems = append(problems, fmt.Errorf("KART_PUBLIC_ORIGIN: %w", err))
	} else {
		cfg.PublicOrigin = normalized
	}

	dataURL := strings.TrimRight(env("KART_DATA_INTERNAL_URL", "http://127.0.0.1:8790"), "/")
	if parsed, err := url.Parse(dataURL); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" {
		problems = append(problems, errors.New("KART_DATA_INTERNAL_URL 必须是 http(s) URL"))
	}
	cfg.DataInternalURL = dataURL

	cfg.DataNodeID = env("KART_DATA_NODE_ID", "data-1")
	if !nodeIDPattern.MatchString(cfg.DataNodeID) {
		problems = append(problems, errors.New("KART_DATA_NODE_ID 只允许 [A-Za-z0-9_-]，长度 1–64"))
	}

	secret := getenv("KART_CLUSTER_SECRET")
	if len(secret) < ticket.MinSecretLength {
		problems = append(problems, fmt.Errorf("KART_CLUSTER_SECRET 必填且至少 %d 个字符", ticket.MinSecretLength))
	}
	cfg.Secret = []byte(secret)

	maxPlayers, err := strconv.Atoi(env("KART_MAX_PLAYERS", "400"))
	if err != nil || maxPlayers < 1 || maxPlayers > MaxPlayersLimit {
		problems = append(problems, fmt.Errorf("KART_MAX_PLAYERS 必须是 1–%d 的整数", MaxPlayersLimit))
	}
	cfg.MaxPlayers = maxPlayers

	// Memory guards (DESIGN.md 4.5).
	atLeast := func(name, fallback string, minimum int) int {
		value, err := strconv.Atoi(env(name, fallback))
		if err != nil || value < minimum {
			problems = append(problems, fmt.Errorf("%s 必须是不小于 %d 的整数", name, minimum))
		}
		return value
	}
	cfg.MaxConnections = atLeast("KART_MAX_CONNECTIONS", strconv.Itoa(max(maxPlayers, 0)+50), 1)
	if maxPlayers >= 1 && cfg.MaxConnections < maxPlayers {
		problems = append(problems, errors.New("KART_MAX_CONNECTIONS 不能小于 KART_MAX_PLAYERS"))
	}
	cfg.MaxRooms = atLeast("KART_MAX_ROOMS", "200", 1)
	cfg.SendBufferBytes = atLeast("KART_SEND_BUFFER_BYTES", "1048576", 64<<10)
	cfg.MemoryLimitMB = atLeast("KART_MEMORY_LIMIT_MB", "0", 0)
	if cfg.MemoryLimitMB > 0 && cfg.MemoryLimitMB < 64 {
		problems = append(problems, errors.New("KART_MEMORY_LIMIT_MB 为 0（不限）或至少 64"))
	}
	helloTimeout, err := time.ParseDuration(env("KART_HELLO_TIMEOUT", "15s"))
	if err != nil || helloTimeout < time.Second || helloTimeout > 5*time.Minute {
		problems = append(problems, errors.New("KART_HELLO_TIMEOUT 必须是 1s–5m 的时长，例如 15s"))
	}
	cfg.HelloTimeout = helloTimeout

	wsCompression, ok := parseBool(env("KART_WS_COMPRESSION", "true"))
	if !ok {
		problems = append(problems, errors.New("KART_WS_COMPRESSION 必须是 true 或 false"))
	}
	cfg.WSCompression = wsCompression

	cfg.OutboxDir = env("KART_OUTBOX_DIR", "./data/outbox-"+cfg.NodeID)

	allowGuests, ok := parseBool(env("KART_ALLOW_GUESTS", "false"))
	if !ok {
		problems = append(problems, errors.New("KART_ALLOW_GUESTS 必须是 true 或 false"))
	}
	cfg.AllowGuests = allowGuests

	itemTestGrants, ok := parseBool(env("KART_ITEM_TEST_GRANTS", "false"))
	if !ok {
		problems = append(problems, errors.New("KART_ITEM_TEST_GRANTS 必须是 true 或 false"))
	}
	cfg.ItemTestGrants = itemTestGrants

	switch changers := env("KART_ITEM_CHANGERS", "inventory"); changers {
	case "inventory":
	case "infinite":
		cfg.ItemChangersInfinite = true
	default:
		problems = append(problems, errors.New("KART_ITEM_CHANGERS 必须是 inventory 或 infinite"))
	}
	cfg.AntiCheatPlugin = env("KART_ANTICHEAT_PLUGIN", "")

	webRTC, ok := parseBool(env("KART_WEBRTC", "true"))
	if !ok {
		problems = append(problems, errors.New("KART_WEBRTC 必须是 true 或 false"))
	}
	cfg.WebRTC = webRTC
	udpPort, err := strconv.Atoi(env("KART_WEBRTC_UDP_PORT", "0"))
	if err != nil || udpPort < 0 || udpPort > 65535 {
		problems = append(problems, errors.New("KART_WEBRTC_UDP_PORT 必须是 0（随机端口）或 1–65535 的端口号"))
	}
	cfg.WebRTCUDPPort = udpPort
	for _, raw := range strings.Split(getenv("KART_WEBRTC_PUBLIC_IPS"), ",") {
		ip := strings.TrimSpace(raw)
		if ip == "" {
			continue
		}
		if net.ParseIP(ip) == nil {
			problems = append(problems, fmt.Errorf("KART_WEBRTC_PUBLIC_IPS：%q 不是 IP 地址", ip))
			continue
		}
		cfg.WebRTCPublicIPs = append(cfg.WebRTCPublicIPs, ip)
	}
	loopback, ok := parseBool(env("KART_WEBRTC_LOOPBACK", "true"))
	if !ok {
		problems = append(problems, errors.New("KART_WEBRTC_LOOPBACK 必须是 true 或 false"))
	}
	cfg.WebRTCLoopback = loopback

	city, ok := parseBool(env("KART_CITY", "true"))
	if !ok {
		problems = append(problems, errors.New("KART_CITY 必须是 true 或 false"))
	}
	cfg.City = city
	within := func(name, fallback string, minimum, maximum int) int {
		value, err := strconv.Atoi(env(name, fallback))
		if err != nil || value < minimum || value > maximum {
			problems = append(problems, fmt.Errorf("%s 必须是 %d–%d 的整数", name, minimum, maximum))
		}
		return value
	}
	meters := func(name, fallback string, minimum, maximum float64) float64 {
		value, err := strconv.ParseFloat(env(name, fallback), 64)
		if err != nil || value < minimum || value > maximum {
			problems = append(problems, fmt.Errorf("%s 必须是 %g–%g 的数", name, minimum, maximum))
		}
		return value
	}
	cfg.CityLines = within("KART_CITY_LINES", "2", 1, 32)
	cfg.CityLinePlayers = within("KART_CITY_LINE_PLAYERS", "60", 2, 200)
	cfg.CityInterestRadius = meters("KART_CITY_INTEREST_RADIUS", "160", 10, 5000)
	cfg.CityChatRadius = meters("KART_CITY_CHAT_RADIUS", "60", 1, 5000)
	cfg.CityAFKMinutes = within("KART_CITY_AFK_MINUTES", "10", 1, 1440)
	cfg.CityMaxSpeed = meters("KART_CITY_MAX_SPEED", "150", 1, 10000)
	cfg.CityDayMinutes = within("KART_CITY_DAY_MINUTES", "48", 1, 1440)
	weather, ok := parseBool(env("KART_CITY_WEATHER", "true"))
	if !ok {
		problems = append(problems, errors.New("KART_CITY_WEATHER 必须是 true 或 false"))
	}
	cfg.CityWeather = weather
	cfg.CityRainPercent = within("KART_CITY_RAIN_PERCENT", "20", 0, 100)
	cfg.CitySnowPercent = within("KART_CITY_SNOW_PERCENT", "10", 0, 100)
	if cfg.CityRainPercent+cfg.CitySnowPercent > 100 {
		problems = append(problems, errors.New("KART_CITY_RAIN_PERCENT 与 KART_CITY_SNOW_PERCENT 之和不能超过 100"))
	}

	lanHosts := getenv("KART_LAN_HOSTS")
	if lanHosts == "" {
		lanHosts = getenv("KART_LANHOSTS")
	}
	cfg.Network = netcfg.New(lanHosts)
	cfg.HeartbeatInterval = 5 * time.Second

	if len(problems) > 0 {
		return Config{}, errors.Join(problems...)
	}
	return cfg, nil
}

// normalizeOrigin accepts an http(s) origin without path, query or user info
// and returns it without a trailing slash.
func normalizeOrigin(origin string) (string, error) {
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("必须是 http(s)://主机[:端口] 或 same-origin")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// parseBool accepts true/false, 1/0, yes/no and on/off in any case.
func parseBool(value string) (bool, bool) {
	switch strings.ToLower(value) {
	case "true", "1", "yes", "on":
		return true, true
	case "false", "0", "no", "off":
		return false, true
	}
	return false, false
}

func hasControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || (r >= 0x7F && r <= 0x9F) {
			return true
		}
	}
	return false
}

// AntiCheatSettings picks the KART_ANTICHEAT* variables (but
// KART_ANTICHEAT_PLUGIN) of an environment (os.Environ): the anti-cheat
// plugin reads its own settings from them.
func AntiCheatSettings(environ []string) map[string]string {
	settings := map[string]string{}
	for _, entry := range environ {
		name, value, ok := strings.Cut(entry, "=")
		if ok && strings.HasPrefix(name, "KART_ANTICHEAT") && name != "KART_ANTICHEAT_PLUGIN" {
			settings[name] = value
		}
	}
	return settings
}
