package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"kartsim/internal/game/capacity"
)

const serviceHelp = "用法：kart-node service install|uninstall|start|stop|status [--config 文件] [--service-name 名称]"

func cmdService(args []string) error {
	if len(args) == 0 {
		return errors.New(serviceHelp)
	}
	action := args[0]
	f, err := parseFlags("service "+action, args[1:])
	if err != nil {
		return err
	}
	switch action {
	case "install":
		s, err := load(f, os.Environ(), capacity.Detect())
		if err != nil {
			return err
		}
		if s.confPath == "" {
			return errors.New("没有找到配置文件：先运行 kart-node init 生成 kart-node.conf，或用 --config 指定")
		}
		// A service that cannot start would only restart in a loop.
		if _, err := nodeConfig(s); err != nil {
			return fmt.Errorf("配置无效，未安装：%w", err)
		}
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		if exe, err = filepath.EvalSymlinks(exe); err != nil {
			return err
		}
		if err := installService(f, s, exe); err != nil {
			return err
		}
		fmt.Println(firewallHint(s))
		return nil
	case "uninstall":
		return uninstallService(f.serviceName)
	case "start":
		return startService(f.serviceName)
	case "stop":
		return stopService(f.serviceName)
	case "status":
		return serviceStatus(f.serviceName)
	}
	return errors.New(serviceHelp)
}
