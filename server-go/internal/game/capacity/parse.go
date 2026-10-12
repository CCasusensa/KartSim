package capacity

import (
	"bufio"
	"strconv"
	"strings"
)

// parseMeminfo reads MemTotal and MemAvailable from /proc/meminfo lines.
func parseMeminfo(lines *bufio.Scanner) (total, available uint64) {
	for lines.Scan() {
		name, rest, ok := strings.Cut(lines.Text(), ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		kb, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		switch name {
		case "MemTotal":
			total = kb << 10
		case "MemAvailable":
			available = kb << 10
		}
	}
	return total, available
}

// parseCgroupLimit reads a cgroup limit file: "max" (v2) or a huge number
// (v1, about 2^63 rounded to the page size) mean no limit.
func parseCgroupLimit(text string) uint64 {
	value, err := strconv.ParseUint(strings.TrimSpace(text), 10, 64)
	if err != nil || value >= 1<<60 {
		return 0
	}
	return value
}

// cgroupV2Path is the cgroup v2 path in /proc/self/cgroup ("0::/path");
// "" without one.
func cgroupV2Path(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "0::"); ok {
			return rest
		}
	}
	return ""
}
