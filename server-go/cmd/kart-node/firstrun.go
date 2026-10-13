package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"kartsim/internal/game/capacity"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/nodekey"
)

// needsFirstRun reports whether kart-node starts with nothing configured:
// no configuration file and no key or secret in the flags or environment.
func needsFirstRun(f *flags, environ []string) bool {
	if f.config != "" || f.set["KART_NODE_KEY"] != "" || f.set["KART_CLUSTER_SECRET_FILE"] != "" {
		return false
	}
	if path, err := findConf(""); err != nil || path != "" {
		return false
	}
	for _, entry := range environ {
		key, value, _ := strings.Cut(entry, "=")
		if (key == "KART_NODE_KEY" || key == "KART_CLUSTER_SECRET" || key == "KART_CLUSTER_SECRET_FILE") &&
			strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

// isTerminal reports whether file is an interactive console.
func isTerminal(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// firstRun asks for the data service address and the node key, checks
// them with the data service and writes kart-node.conf beside the program
// (or in the working directory), returning its path.
func firstRun(f *flags, in io.Reader, out io.Writer) (string, error) {
	lines := bufio.NewReader(in)
	ask := func(prompt string) (string, error) {
		fmt.Fprint(out, prompt)
		line, err := lines.ReadString('\n')
		if err != nil && line == "" {
			return "", errors.New("没有输入")
		}
		return strings.TrimSpace(line), nil
	}
	fmt.Fprintln(out, "没有找到配置文件 kart-node.conf。请填写两项（管理后台“游戏节点 → 添加节点”会给出）：")
	for attempt := 1; attempt <= 3; attempt++ {
		dataURL, err := ask("数据服务地址（游戏网站的网址，如 https://kart.example.com）：")
		if err != nil {
			return "", err
		}
		key, err := ask("节点密钥（kn1. 开头的整串）：")
		if err != nil {
			return "", err
		}
		given := map[string]string{"KART_DATA_URL": dataURL, "KART_NODE_KEY": key}
		for flag, value := range f.set {
			if _, asked := given[flag]; !asked {
				given[flag] = value
			}
		}
		if _, ok := nodekey.NodeID(key); !ok {
			fmt.Fprintln(out, "节点密钥格式不对，请完整复制后台给出的整串。")
			continue
		}
		fmt.Fprintln(out, "正在连接数据服务…")
		reg, err := tryKey(given)
		if err != nil {
			fmt.Fprintln(out, "不行：", err)
			continue
		}
		fmt.Fprintf(out, "已连上：本节点是“%s”（%s）。\n", reg.Name, reg.NodeID)
		path := confName
		if exe, err := os.Executable(); err == nil {
			path = filepath.Join(filepath.Dir(exe), confName)
		}
		written, err := writeConf(path, given, false)
		if err != nil {
			if written, err = writeConf(confName, given, false); err != nil {
				return "", err
			}
		}
		fmt.Fprintf(out, "已保存到 %s，以后直接启动即可。\n\n", written.confPath)
		return written.confPath, nil
	}
	return "", errors.New("三次都没有填对；也可以用 kart-node init --data <地址> --key <密钥> 生成配置文件")
}

// tryKey registers once with the settings given.
func tryKey(given map[string]string) (contract.NodeRegistration, error) {
	s, err := load(&flags{noConf: true, set: given}, nil, capacity.Detect())
	if err != nil {
		return contract.NodeRegistration{}, err
	}
	cfg, err := nodeConfig(s)
	if err != nil {
		return contract.NodeRegistration{}, err
	}
	return registerOnce(context.Background(), cfg)
}
