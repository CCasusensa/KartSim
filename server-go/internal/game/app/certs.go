package app

import (
	"crypto/tls"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"
)

// certRecheck is how often a handshake looks at the certificate files again.
const certRecheck = time.Minute

// certFiles serves the PEM certificate and key of KART_TLS_CERT and
// KART_TLS_KEY, reloading them when either file changes (a renewal), at
// most once a minute. A reload that fails keeps the previous certificate.
type certFiles struct {
	certPath, keyPath string
	log               *slog.Logger
	now               func() time.Time

	mu       sync.Mutex
	current  *tls.Certificate
	modified [2]time.Time
	checked  time.Time
}

func loadCertFiles(certPath, keyPath string, log *slog.Logger) (*certFiles, error) {
	c := &certFiles{certPath: certPath, keyPath: keyPath, log: log, now: time.Now}
	if err := c.load(); err != nil {
		return nil, err
	}
	c.checked = c.now()
	return c, nil
}

func (c *certFiles) stamps() ([2]time.Time, error) {
	var stamps [2]time.Time
	for i, path := range []string{c.certPath, c.keyPath} {
		info, err := os.Stat(path)
		if err != nil {
			return stamps, err
		}
		stamps[i] = info.ModTime()
	}
	return stamps, nil
}

func (c *certFiles) load() error {
	stamps, err := c.stamps()
	if err != nil {
		return fmt.Errorf("TLS 证书：%w", err)
	}
	cert, err := tls.LoadX509KeyPair(c.certPath, c.keyPath)
	if err != nil {
		return fmt.Errorf("TLS 证书：%w", err)
	}
	c.current, c.modified = &cert, stamps
	return nil
}

// certificate is tls.Config.GetCertificate.
func (c *certFiles) certificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if now := c.now(); now.Sub(c.checked) >= certRecheck {
		c.checked = now
		if stamps, err := c.stamps(); err == nil && stamps != c.modified {
			if err := c.load(); err != nil {
				c.log.Error("TLS certificate reload failed; keeping the previous one", "error", err)
			} else {
				c.log.Info("TLS certificate reloaded", "cert", c.certPath)
			}
		}
	}
	return c.current, nil
}
