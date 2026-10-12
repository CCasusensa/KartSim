package capacity

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// memoryStatusEx is MEMORYSTATUSEX.
type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

var globalMemoryStatusEx = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

// systemMemory asks GlobalMemoryStatusEx.
func systemMemory() (total, available uint64) {
	status := memoryStatusEx{Length: uint32(unsafe.Sizeof(memoryStatusEx{}))}
	if ok, _, _ := globalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&status))); ok == 0 {
		return 0, 0
	}
	return status.TotalPhys, status.AvailPhys
}

// containerMemoryLimit: job object limits are not read.
func containerMemoryLimit() uint64 { return 0 }
