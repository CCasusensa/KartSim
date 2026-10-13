package nodekey

import (
	"strings"
	"testing"
)

func TestKeys(t *testing.T) {
	key := New("hk-01")
	if id, ok := NodeID(key); !ok || id != "hk-01" || !strings.HasPrefix(key, "kn1.hk-01.") {
		t.Fatalf("%q → %q %v", key, id, ok)
	}
	if id, ok := NodeID("  " + key + "\n"); !ok || id != "hk-01" {
		t.Fatal("surrounding space")
	}
	if Digest(key) != Digest(key+"\n") || Digest(key) == Digest(New("hk-01")) || len(Digest(key)) != 43 {
		t.Fatal("digest")
	}
	for _, bad := range []string{"", "kn1.", "kn1.hk-01", "kn1.hk.01." + strings.Repeat("a", 43), "kn2.a." + strings.Repeat("a", 43),
		"kn1.a." + strings.Repeat("a", 42), "kn1.a b." + strings.Repeat("a", 43)} {
		if _, ok := NodeID(bad); ok {
			t.Errorf("%q accepted", bad)
		}
	}
	a, b := TicketKey([]byte("secret-1"), "n1"), TicketKey([]byte("secret-1"), "n2")
	if a == b || a != TicketKey([]byte("secret-1"), "n1") || a == TicketKey([]byte("secret-2"), "n1") || len(a) != 43 {
		t.Fatal("ticket keys")
	}
}
