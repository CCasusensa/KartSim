package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// confName is the configuration file kart-node looks for in the working
// directory and beside the executable.
const confName = "kart-node.conf"

// parseConf reads KEY=VALUE lines (the .env format): # comments, blank
// lines, an optional "export " prefix and optional matching quotes. Keys
// must be KART_* or SERVER_ADDRESS.
func parseConf(r io.Reader) (map[string]string, error) {
	values := map[string]string{}
	lines := bufio.NewScanner(r)
	for n := 1; lines.Scan(); n++ {
		line := strings.TrimSpace(lines.Text())
		if n == 1 {
			line = strings.TrimPrefix(line, "\ufeff") // Notepad's UTF-8 BOM
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if !ok || !knownKey(key) {
			return nil, fmt.Errorf("第 %d 行：应为 KART_变量名=值", n)
		}
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		values[key] = value
	}
	return values, lines.Err()
}

func knownKey(key string) bool {
	if key == "SERVER_ADDRESS" {
		return true
	}
	rest, ok := strings.CutPrefix(key, "KART_")
	if !ok || rest == "" {
		return false
	}
	for _, r := range rest {
		if !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

func readConf(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	values, err := parseConf(f)
	if err != nil {
		return nil, fmt.Errorf("%s：%w", path, err)
	}
	return values, nil
}

// findConf is the configuration file to read: the --config path (which
// must exist), else kart-node.conf in the working directory, else beside
// the executable; "" when there is none.
func findConf(explicit string) (string, error) {
	if explicit != "" {
		abs, err := filepath.Abs(explicit)
		if err != nil {
			return "", err
		}
		if _, err := os.Stat(abs); err != nil {
			return "", fmt.Errorf("配置文件 %s 不存在（先运行 kart-node init 生成）", explicit)
		}
		return abs, nil
	}
	candidates := []string{confName}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), confName))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return filepath.Abs(candidate)
		}
	}
	return "", nil
}
