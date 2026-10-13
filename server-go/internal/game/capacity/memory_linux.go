package capacity

import (
	"bufio"
	"os"
	"path"
)

// systemMemory reads MemTotal and MemAvailable from /proc/meminfo.
func systemMemory() (total, available uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	return parseMeminfo(bufio.NewScanner(f))
}

// containerMemoryLimit is the cgroup memory limit of this process: cgroup
// v2 at the process's own cgroup (a systemd MemoryMax=) or the namespace
// root (a container), then cgroup v1; 0 when there is none.
func containerMemoryLimit() uint64 {
	var paths []string
	if data, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		if own := cgroupV2Path(string(data)); own != "" && own != "/" {
			paths = append(paths, path.Join("/sys/fs/cgroup", own, "memory.max"))
		}
	}
	paths = append(paths, "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes")
	for _, file := range paths {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		return parseCgroupLimit(string(data))
	}
	return 0
}
