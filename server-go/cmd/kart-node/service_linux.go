package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

const defaultServiceName = "kart-node"

func isWindowsService() bool { return false }

func runService(string, func(context.Context) error) error {
	return errors.New("not a Windows service")
}

func unitPath(name string) string { return "/etc/systemd/system/" + name + ".service" }

// systemdQuote quotes a word of an ExecStart= line.
func systemdQuote(word string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "$", "$$").Replace(word) + `"`
}

func renderUnit(name, exe, conf, workDir, runAs string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# 由 kart-node service install 生成；卸载：kart-node service uninstall --service-name %s\n", name)
	b.WriteString("[Unit]\nDescription=KartSim game node (kart-node)\nWants=network-online.target\nAfter=network-online.target\n\n")
	b.WriteString("[Service]\nType=simple\n")
	fmt.Fprintf(&b, "ExecStart=%s run --config %s\n", systemdQuote(exe), systemdQuote(conf))
	fmt.Fprintf(&b, "WorkingDirectory=%s\n", systemdQuote(workDir))
	if runAs != "" {
		// A non-root user may still listen on 443 (KART_TLS_CERT).
		fmt.Fprintf(&b, "User=%s\nAmbientCapabilities=CAP_NET_BIND_SERVICE\n", runAs)
	}
	// On stop the node sends players 1001, tells the data service and
	// flushes its outbox (up to 5 s).
	b.WriteString("Restart=always\nRestartSec=3\nTimeoutStopSec=20\nLimitNOFILE=1048576\n\n")
	b.WriteString("[Install]\nWantedBy=multi-user.target\n")
	return b.String()
}

func systemctl(args ...string) error {
	cmd := exec.Command("systemctl", args...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("systemctl %s：%w", strings.Join(args, " "), err)
	}
	return nil
}

func needRoot() error {
	if os.Geteuid() != 0 {
		return errors.New("需要 root 权限（sudo）")
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return errors.New("没有 systemctl：这台机器不用 systemd，请用其他方式（supervisor、screen 等）运行 kart-node")
	}
	return nil
}

func installService(f *flags, s *settings, exe string) error {
	if err := needRoot(); err != nil {
		return err
	}
	if _, err := os.Stat(unitPath(f.serviceName)); err == nil {
		return fmt.Errorf("服务 %s 已存在（先 kart-node service uninstall --service-name %[1]s）", f.serviceName)
	}
	runAs := f.serviceUser
	if runAs == "" {
		runAs = os.Getenv("SUDO_USER")
	}
	if runAs == "root" {
		runAs = ""
	}
	if runAs != "" {
		// The service user must read the configuration and write the
		// outbox and the log.
		account, err := user.Lookup(runAs)
		if err != nil {
			return fmt.Errorf("用户 %s：%w", runAs, err)
		}
		uid, _ := strconv.Atoi(account.Uid)
		gid, _ := strconv.Atoi(account.Gid)
		paths := []string{s.confPath, s.get("KART_OUTBOX_DIR")}
		if log := s.get("KART_LOG_FILE"); log != "" {
			paths = append(paths, filepath.Dir(log))
		}
		for _, path := range paths[1:] {
			if err := os.MkdirAll(path, 0o700); err != nil {
				return err
			}
		}
		if secret := s.get("KART_CLUSTER_SECRET_FILE"); secret != "" {
			paths = append(paths, secret)
		}
		for _, path := range paths {
			if err := os.Chown(path, uid, gid); err != nil {
				return fmt.Errorf("把 %s 交给用户 %s：%w", path, runAs, err)
			}
		}
	} else {
		fmt.Println("注意：服务将以 root 运行；建议用 --user 指定普通用户（或用 sudo 从普通用户运行本命令）。")
	}
	unit := renderUnit(f.serviceName, exe, s.confPath, s.baseDir, runAs)
	if err := os.WriteFile(unitPath(f.serviceName), []byte(unit), 0o644); err != nil {
		return err
	}
	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	if err := systemctl("enable", "--now", f.serviceName); err != nil {
		return err
	}
	fmt.Printf("已安装并启动 systemd 服务 %s（%s），开机自动启动。\n", f.serviceName, unitPath(f.serviceName))
	fmt.Printf("查看日志：journalctl -u %s -f\n", f.serviceName)
	return nil
}

func uninstallService(name string) error {
	if err := needRoot(); err != nil {
		return err
	}
	if _, err := os.Stat(unitPath(name)); err != nil {
		return fmt.Errorf("服务 %s 不存在", name)
	}
	_ = systemctl("disable", "--now", name)
	if err := os.Remove(unitPath(name)); err != nil {
		return err
	}
	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	fmt.Printf("已停止并删除服务 %s（配置文件与发件箱保留）。\n", name)
	return nil
}

func startService(name string) error {
	if err := needRoot(); err != nil {
		return err
	}
	return systemctl("start", name)
}

func stopService(name string) error {
	if err := needRoot(); err != nil {
		return err
	}
	return systemctl("stop", name)
}

func serviceStatus(name string) error {
	return systemctl("status", "--no-pager", name)
}
