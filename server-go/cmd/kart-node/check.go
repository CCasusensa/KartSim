package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"kartsim/internal/shared/contract"
)

// probeData asks the data service's internal API something harmless: an
// empty presence release, which a correct cluster key turns into 400
// INVALID_NODE_ID and a wrong one into 401 CLUSTER_KEY_INVALID. It returns
// nil when the address and the key both work.
func probeData(ctx context.Context, dataURL, secret string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dataURL+contract.PathPresenceRelease,
		strings.NewReader("{}"))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(contract.ClusterKeyHeader, secret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("连不上数据服务 %s：%v。检查地址与端口、数据服务的 KART_INTERNAL_LISTEN 是否监听在本机能访问的网卡上（默认只监听 127.0.0.1）、两边的防火墙/安全组是否放行", dataURL, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	switch {
	case resp.StatusCode == http.StatusBadRequest && strings.Contains(string(body), "INVALID_NODE_ID"):
		return nil
	case resp.StatusCode == http.StatusUnauthorized:
		return fmt.Errorf("数据服务 %s 拒绝了集群密钥：本节点的 KART_CLUSTER_SECRET 与数据服务不同", dataURL)
	}
	return fmt.Errorf("%s 不像 KartSim 数据服务的内部端口（HTTP %d：%s）；--data 应指向 KART_INTERNAL_LISTEN（默认 8790），不是公网端口 8787",
		dataURL, resp.StatusCode, strings.TrimSpace(string(body)))
}

// checkPorts tries to bind the TCP and UDP ports the node will use.
func checkPorts(s *settings) []error {
	var problems []error
	addr := net.JoinHostPort(s.get("KART_GAME_ADDR"), s.get("KART_GAME_PORT"))
	if l, err := net.Listen("tcp", addr); err != nil {
		problems = append(problems, fmt.Errorf("TCP %s 不可用（节点已在运行时属正常）：%v", addr, err))
	} else {
		_ = l.Close()
	}
	if s.get("KART_WEBRTC") != "false" && s.get("KART_WEBRTC_UDP_PORT") != "0" {
		udp := net.JoinHostPort("", s.get("KART_WEBRTC_UDP_PORT"))
		if c, err := net.ListenPacket("udp", udp); err != nil {
			problems = append(problems, fmt.Errorf("UDP %s 不可用（节点已在运行时属正常）：%v", udp, err))
		} else {
			_ = c.Close()
		}
	}
	return problems
}

// firewallHint is how to open the node's ports on this system.
func firewallHint(s *settings) string {
	tcp, udp := s.get("KART_GAME_PORT"), s.get("KART_WEBRTC_UDP_PORT")
	if s.hw.OS == "windows" {
		return fmt.Sprintf("防火墙（管理员 PowerShell）：\n"+
			"  netsh advfirewall firewall add rule name=\"KartSim node TCP %[1]s\" dir=in action=allow protocol=TCP localport=%[1]s\n"+
			"  netsh advfirewall firewall add rule name=\"KartSim node UDP %[2]s\" dir=in action=allow protocol=UDP localport=%[2]s", tcp, udp)
	}
	return fmt.Sprintf("防火墙（任选其一，云服务器另需在安全组放行）：\n"+
		"  sudo ufw allow %[1]s/tcp && sudo ufw allow %[2]s/udp\n"+
		"  sudo firewall-cmd --permanent --add-port=%[1]s/tcp --add-port=%[2]s/udp && sudo firewall-cmd --reload", tcp, udp)
}
