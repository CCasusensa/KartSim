package main

import (
	"strings"
	"testing"
)

func TestRenderUnit(t *testing.T) {
	unit := renderUnit("kart-node", "/opt/kart node/kart-node", "/opt/kart node/kart-node.conf", "/opt/kart node", "kart")
	for _, want := range []string{
		`ExecStart="/opt/kart node/kart-node" run --config "/opt/kart node/kart-node.conf"`,
		`WorkingDirectory="/opt/kart node"`, "User=kart\nAmbientCapabilities=CAP_NET_BIND_SERVICE\n", "Restart=always\n", "LimitNOFILE=1048576\n",
		"WantedBy=multi-user.target\n",
	} {
		if !strings.Contains(unit, want) {
			t.Errorf("missing %q in\n%s", want, unit)
		}
	}
	if systemdQuote(`a"b%c$d`) != `"a\"b%%c$$d"` {
		t.Fatal(systemdQuote(`a"b%c$d`))
	}
}
