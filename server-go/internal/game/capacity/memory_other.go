//go:build !linux && !windows && !darwin

package capacity

// systemMemory is unknown here; the plan then ignores memory.
func systemMemory() (total, available uint64) { return 0, 0 }

func containerMemoryLimit() uint64 { return 0 }
