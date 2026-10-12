package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kartsim/internal/game/capacity"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
)

const secret = "0123456789abcdef0123456789abcdef"

var box = capacity.Hardware{OS: "linux", Arch: "amd64", LogicalCPUs: 4, UsableCPUs: 4, TotalMemoryMB: 8192,
	Hostname: "hk-01.example.internal"}

func mustLoad(t *testing.T, args []string, environ []string) *settings {
	t.Helper()
	f, err := parseFlags("run", args)
	if err != nil {
		t.Fatal(err)
	}
	s, err := load(f, environ, box)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestParseConf(t *testing.T) {
	values, err := parseConf(strings.NewReader("\ufeff# comment\n\nKART_GAME_PORT=9000\nexport KART_NODE_NAME=\"华东 一区\"\n" +
		"KART_LAN_HOSTS='kart.example.com'\n  KART_MAX_PLAYERS = auto  \n"))
	if err != nil {
		t.Fatal(err)
	}
	if values["KART_GAME_PORT"] != "9000" || values["KART_NODE_NAME"] != "华东 一区" ||
		values["KART_LAN_HOSTS"] != "kart.example.com" || values["KART_MAX_PLAYERS"] != "auto" {
		t.Fatalf("%v", values)
	}
	for _, bad := range []string{"PATH=/bin\n", "KART_=1\n", "just words\n", "kart_port=1\n"} {
		if _, err := parseConf(strings.NewReader(bad)); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

// Flags win over the environment, which wins over the file.
func TestLayering(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "node.conf")
	_ = os.WriteFile(conf, []byte("KART_GAME_PORT=9000\nKART_NODE_NAME=file\nKART_LAN_HOSTS=file.example\n"+
		"KART_CLUSTER_SECRET="+secret+"\n"), 0o600)
	s := mustLoad(t, []string{"--config", conf, "--name", "flag"},
		[]string{"KART_NODE_NAME=env", "KART_LAN_HOSTS=env.example", "KART_GAME_ADDR=", "HOME=/root"})
	if s.get("KART_GAME_PORT") != "9000" || s.get("KART_NODE_NAME") != "flag" || s.get("KART_LAN_HOSTS") != "env.example" {
		t.Fatalf("%v", s.values)
	}
	if s.confPath != conf || s.get("KART_OUTBOX_DIR") != filepath.Join(dir, "data", "outbox-hk-01-9000") {
		t.Fatalf("paths %q %q", s.confPath, s.get("KART_OUTBOX_DIR"))
	}
	if _, err := nodeConfig(s); err != nil {
		t.Fatal(err)
	}
	if _, err := parseFlags("run", []string{"--config", filepath.Join(dir, "missing.conf")}); err != nil {
		t.Fatal(err)
	}
	f, _ := parseFlags("run", []string{"--config", filepath.Join(dir, "missing.conf")})
	if _, err := load(f, nil, box); err == nil {
		t.Fatal("a missing --config file was accepted")
	}
}

func TestDerivedDefaults(t *testing.T) {
	s := mustLoad(t, []string{"--data", "10.0.0.10", "--public-ip", "203.0.113.7", "--port", "8800"}, nil)
	want := map[string]string{
		"KART_GAME_ADDR":         "0.0.0.0",
		"KART_NODE_ID":           "hk-01-8800",
		"KART_WEBRTC_UDP_PORT":   "8800",
		"KART_DATA_INTERNAL_URL": "http://10.0.0.10:8790",
		"KART_WEBRTC_PUBLIC_IPS": "203.0.113.7",
		"KART_PUBLIC_ORIGIN":     "http://203.0.113.7:8800",
		// 4 CPUs × 40; memory allows (8192-1228-160)/2.5 = 2721.
		"KART_MAX_PLAYERS": "160", "KART_MAX_ROOMS": "80", "KART_MAX_CONNECTIONS": "180",
		"KART_MEMORY_LIMIT_MB": "6964", "KART_CITY_LINES": "2",
	}
	for key, value := range want {
		if s.get(key) != value {
			t.Errorf("%s = %q, want %q", key, s.get(key), value)
		}
	}
	if !s.auto || s.plan.LimitedBy != "cpu" {
		t.Fatalf("plan %+v", s.plan)
	}

	// TLS makes the guessed origin https; explicit limits stay.
	s = mustLoad(t, []string{"--tls-cert", "c.pem", "--tls-key", "k.pem", "--public-ip", "203.0.113.7",
		"--players", "500", "--uplink", "20"}, []string{"KART_MAX_ROOMS=30"})
	if s.get("KART_PUBLIC_ORIGIN") != "https://203.0.113.7:8788" || s.get("KART_MAX_PLAYERS") != "500" ||
		s.get("KART_MAX_ROOMS") != "30" || s.get("KART_MAX_CONNECTIONS") != "550" || s.auto ||
		!filepath.IsAbs(s.get("KART_TLS_CERT")) {
		t.Fatalf("%v", s.values)
	}
	if !strings.Contains(strings.Join(s.notes, "\n"), "超过按本机硬件估算的 68") {
		t.Fatalf("notes %q", s.notes)
	}

	// The uplink caps auto sizing.
	s = mustLoad(t, []string{"--uplink", "10"}, nil)
	if s.get("KART_MAX_PLAYERS") != "34" || s.plan.LimitedBy != "uplink" {
		t.Fatalf("%v", s.values)
	}

	for _, bad := range [][]string{{"--players", "lots"}, {"--uplink", "-1"}, {"--data", "ftp://x"},
		{"--public-ip", "example.com"}, {"--port", "70000"}, {"--players-per-core", "0"}} {
		f, _ := parseFlags("run", bad)
		if _, err := load(f, nil, box); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestSecretFile(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "secret"), []byte(secret+"\n"), 0o600)
	conf := filepath.Join(dir, "kart-node.conf")
	_ = os.WriteFile(conf, []byte("KART_CLUSTER_SECRET_FILE=secret\n"), 0o600)
	s := mustLoad(t, []string{"-c", conf}, nil)
	if s.get("KART_CLUSTER_SECRET") != secret {
		t.Fatalf("secret %q", s.get("KART_CLUSTER_SECRET"))
	}
}

func TestNotes(t *testing.T) {
	s := mustLoad(t, []string{"--data", "http://203.0.113.9:8790"}, nil)
	notes := strings.Join(s.notes, "\n")
	for _, want := range []string{"公网明文 HTTP", "没有设置 --public-origin", "没有设置 --page-host", "没有设置上行带宽",
		"浏览器不允许连 ws://"} {
		if !strings.Contains(notes, want) {
			t.Errorf("missing note %q in\n%s", want, notes)
		}
	}
	s = mustLoad(t, []string{"--data", "100.101.1.2", "--public-origin", "https://game1.example.com",
		"--page-host", "kart.example.com", "--uplink", "100"}, nil)
	if len(s.notes) != 0 {
		t.Fatalf("notes %q", s.notes)
	}
}

func TestHelpers(t *testing.T) {
	for in, want := range map[string]string{
		"10.0.0.10":                    "http://10.0.0.10:8790",
		"10.0.0.10:9000":               "http://10.0.0.10:9000",
		"https://data.example.com":     "https://data.example.com:8790",
		"https://data.example.com/k/":  "https://data.example.com:8790/k",
		"[fd00::1]":                    "http://[fd00::1]:8790",
		"http://data.example.com:8790": "http://data.example.com:8790",
	} {
		if got, err := normalizeDataURL(in); err != nil || got != want {
			t.Errorf("%s → %q %v, want %q", in, got, err, want)
		}
	}
	for in, want := range map[string]string{"hk-01.example.com": "hk-01-8788", "WIN_SERVER 2022": "WIN_SERVER-2022-8788",
		"": "game-8788", "...": "game-8788", strings.Repeat("a", 80): strings.Repeat("a", 59) + "-8788"} {
		if got := defaultNodeID(in, "8788"); got != want {
			t.Errorf("node ID of %q = %q, want %q", in, got, want)
		}
	}
}

func TestProbeData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path != contract.PathPresenceRelease:
			apierr.WriteError(w, apierr.New(http.StatusNotFound, "NOT_FOUND"))
		case r.Header.Get(contract.ClusterKeyHeader) != secret:
			apierr.WriteError(w, apierr.New(http.StatusUnauthorized, "CLUSTER_KEY_INVALID"))
		default:
			apierr.WriteError(w, apierr.New(http.StatusBadRequest, "INVALID_NODE_ID"))
		}
	}))
	defer server.Close()
	ctx := context.Background()
	if err := probeData(ctx, server.URL, secret); err != nil {
		t.Fatal(err)
	}
	if err := probeData(ctx, server.URL, "wrong"); err == nil || !strings.Contains(err.Error(), "集群密钥") {
		t.Fatalf("wrong key: %v", err)
	}
	if err := probeData(ctx, server.URL+"/elsewhere", secret); err == nil || !strings.Contains(err.Error(), "8790") {
		t.Fatalf("wrong port: %v", err)
	}
	server.Close()
	if err := probeData(ctx, server.URL, secret); err == nil || !strings.Contains(err.Error(), "连不上") {
		t.Fatalf("down: %v", err)
	}
}

// init writes a file that run reads back to the same node.
func TestInitWritesARunnableFile(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "kart-node.conf")
	t.Setenv("KART_CLUSTER_SECRET", secret)
	err := cmdInit([]string{"--config", conf, "--data", "10.0.0.10", "--public-origin", "https://game1.example.com",
		"--page-host", "kart.example.com", "--uplink", "50", "--name", "华东一区"})
	if err != nil {
		t.Fatal(err)
	}
	if err := cmdInit([]string{"--config", conf}); err == nil {
		t.Fatal("init overwrote a file without --force")
	}
	data, _ := os.ReadFile(conf)
	text := string(data)
	for _, want := range []string{"KART_DATA_INTERNAL_URL=http://10.0.0.10:8790\n", "KART_CLUSTER_SECRET=" + secret + "\n",
		"KART_MAX_PLAYERS=auto\n", "KART_UPLINK_MBPS=50\n", "KART_NODE_NAME=华东一区\n", "# KART_TLS_CERT=\n",
		"KART_PUBLIC_ORIGIN=https://game1.example.com\n", "KART_WEBRTC_UDP_PORT=8788\n"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in\n%s", want, text)
		}
	}
	if info, _ := os.Stat(conf); info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Fatalf("mode %v", info.Mode())
	}
	t.Setenv("KART_CLUSTER_SECRET", "")
	s := mustLoad(t, []string{"--config", conf}, nil)
	if _, err := nodeConfig(s); err != nil {
		t.Fatal(err)
	}
	if s.get("KART_NODE_NAME") != "华东一区" || !s.auto || s.plan.LimitedBy != "cpu" {
		t.Fatalf("%v %+v", s.values, s.plan)
	}
}
