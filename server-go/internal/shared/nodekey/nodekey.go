// Package nodekey is the per-node key an admin creates for a game node in
// the console (NODE.md): "kn1.<nodeId>.<secret>". The node sends it to the
// data service in place of the shared cluster secret; the data service
// keeps only its digest. Tickets for the node are signed with a key derived
// from the cluster secret and the node ID (TicketKey), which the node gets
// when it registers, so a node can neither forge tickets for another node
// nor act as one.
package nodekey

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"strings"
)

const prefix = "kn1."

var (
	idPattern     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	secretPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
)

// ValidID reports whether id is a node ID ([A-Za-z0-9_-]{1,64}).
func ValidID(id string) bool { return idPattern.MatchString(id) }

// New returns a fresh key for nodeID: 32 random bytes.
func New(nodeID string) string {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(err)
	}
	return prefix + nodeID + "." + base64.RawURLEncoding.EncodeToString(secret)
}

// NodeID is the node a well-formed key names.
func NodeID(key string) (string, bool) {
	rest, ok := strings.CutPrefix(strings.TrimSpace(key), prefix)
	if !ok {
		return "", false
	}
	id, secret, ok := strings.Cut(rest, ".")
	if !ok || !idPattern.MatchString(id) || !secretPattern.MatchString(secret) {
		return "", false
	}
	return id, true
}

// Digest is the stored form of a key: unpadded base64url SHA-256.
func Digest(key string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(key)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// TicketKey is the HMAC key of the entry tickets for nodeID, derived from
// the cluster secret: 43 base64url characters.
func TicketKey(clusterSecret []byte, nodeID string) string {
	mac := hmac.New(sha256.New, clusterSecret)
	mac.Write([]byte("kart-node-ticket/v1|" + nodeID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
