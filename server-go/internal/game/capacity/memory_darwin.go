package capacity

import "golang.org/x/sys/unix"

// systemMemory reads hw.memsize; macOS has no cheap "available" figure.
func systemMemory() (total, available uint64) {
	total, _ = unix.SysctlUint64("hw.memsize")
	return total, 0
}

func containerMemoryLimit() uint64 { return 0 }
