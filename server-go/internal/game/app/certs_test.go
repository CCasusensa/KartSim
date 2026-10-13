package app

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"kartsim/internal/game/config"
)

// writeCert writes a self-signed certificate for 127.0.0.1 named cn and its
// key, and returns the certificate.
func writeCert(t *testing.T, certPath, keyPath, cn string) *x509.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: cn},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)}, KeyUsage: x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, _ := x509.MarshalECPrivateKey(key)
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	return cert
}

func servedName(t *testing.T, c *certFiles) string {
	t.Helper()
	cert, err := c.certificate(nil)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := x509.ParseCertificate(cert.Certificate[0])
	return parsed.Subject.CommonName
}

// A renewed certificate is picked up at the first handshake a minute after
// the last look; a broken renewal keeps the working certificate.
func TestCertificateReload(t *testing.T) {
	dir := t.TempDir()
	certPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	writeCert(t, certPath, keyPath, "first")
	c, err := loadCertFiles(certPath, keyPath, quiet)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	c.now = func() time.Time { return now }
	c.checked = now

	writeCert(t, certPath, keyPath, "second")
	later := time.Now().Add(time.Minute)
	for _, path := range []string{certPath, keyPath} {
		_ = os.Chtimes(path, later, later)
	}
	if servedName(t, c) != "first" {
		t.Fatal("reloaded before the recheck interval")
	}
	now = now.Add(certRecheck)
	if servedName(t, c) != "second" {
		t.Fatal("renewal not picked up")
	}

	_ = os.WriteFile(certPath, []byte("not a certificate"), 0o600)
	_ = os.Chtimes(certPath, later.Add(time.Minute), later.Add(time.Minute))
	now = now.Add(certRecheck)
	if servedName(t, c) != "second" {
		t.Fatal("a broken renewal replaced the working certificate")
	}

	if _, err := loadCertFiles(filepath.Join(dir, "missing.pem"), keyPath, quiet); err == nil {
		t.Fatal("missing certificate accepted")
	}
}

// With KART_TLS_CERT the node itself serves https:// and wss://.
func TestNodeServesTLS(t *testing.T) {
	dir := t.TempDir()
	certPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	cert := writeCert(t, certPath, keyPath, "node")
	data := newFakeData()
	dataServer := httptest.NewServer(data)
	defer dataServer.Close()

	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()
	cfg, err := config.FromEnv(func(name string) string {
		return map[string]string{"KART_CLUSTER_SECRET": e2eSecret, "KART_GAME_PORT": strconv.Itoa(port),
			"KART_DATA_INTERNAL_URL": dataServer.URL, "KART_OUTBOX_DIR": t.TempDir(),
			"KART_TLS_CERT": certPath, "KART_TLS_KEY": keyPath, "KART_ANTICHEAT_PLUGIN": "off",
			"KART_WEBRTC": "false"}[name]
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicOrigin != "https://127.0.0.1:"+strconv.Itoa(port) {
		t.Fatalf("default origin %q", cfg.PublicOrigin)
	}
	node, err := New(cfg, quiet, Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- node.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()

	pool := x509.NewCertPool()
	pool.AddCert(cert)
	tlsConfig := &tls.Config{RootCAs: pool}
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: tlsConfig}, Timeout: 5 * time.Second}
	base := "127.0.0.1:" + strconv.Itoa(port)
	var health map[string]any
	eventually(t, "https healthz", func() bool {
		resp, err := client.Get("https://" + base + "/multiplayer/healthz")
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		return json.NewDecoder(resp.Body).Decode(&health) == nil
	})
	if health["service"] != "game" {
		t.Fatalf("healthz %v", health)
	}
	dialer := websocket.Dialer{TLSClientConfig: tlsConfig, HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.Dial("wss://"+base+"/multiplayer/ws", nil)
	if err != nil {
		t.Fatalf("wss: %v", err)
	}
	_ = conn.Close()
	// Plain HTTP gets Go's "Client sent an HTTP request to an HTTPS server".
	if resp, err := http.Get("http://" + base + "/multiplayer/healthz"); err == nil {
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("plain HTTP on the TLS port: HTTP %d", resp.StatusCode)
		}
	}
}
