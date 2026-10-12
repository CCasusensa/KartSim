package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Log files rotate at maxLogBytes and keep keptLogs old files
// (kart-node.log.1 … .3).
const (
	maxLogBytes = 20 << 20
	keptLogs    = 3
)

// logFile is an appending log file that rotates by size.
type logFile struct {
	mu   sync.Mutex
	path string
	file *os.File
	size int64
}

func openLog(path string) (*logFile, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("日志目录：%w", err)
	}
	l := &logFile{path: path}
	if err := l.open(); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *logFile) open() error {
	file, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
	if err != nil {
		return fmt.Errorf("日志文件：%w", err)
	}
	l.file, l.size = file, 0
	if info, err := file.Stat(); err == nil {
		l.size = info.Size()
	}
	return nil
}

func (l *logFile) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return 0, os.ErrClosed
	}
	if l.size > 0 && l.size+int64(len(p)) > maxLogBytes {
		l.rotate()
	}
	n, err := l.file.Write(p)
	l.size += int64(n)
	return n, err
}

// rotate shifts kart-node.log → .1 → .2 → .3; on failure it keeps writing
// to the current file.
func (l *logFile) rotate() {
	_ = l.file.Close()
	for i := keptLogs - 1; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", l.path, i), fmt.Sprintf("%s.%d", l.path, i+1))
	}
	_ = os.Rename(l.path, l.path+".1")
	if err := l.open(); err != nil {
		l.file = nil
	}
}

func (l *logFile) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return nil
	}
	err := l.file.Close()
	l.file = nil
	return err
}

// defaultServiceLog is where a Windows service logs without KART_LOG_FILE.
func defaultServiceLog(baseDir string) string {
	return filepath.Join(baseDir, "logs", "kart-node.log")
}

// serviceFailure records why a service could not start, where its log
// would have been.
func serviceFailure(f *flags, problem error) {
	dir := filepath.Dir(f.config)
	if f.config == "" {
		if exe, err := os.Executable(); err == nil {
			dir = filepath.Dir(exe)
		}
	}
	if l, err := openLog(defaultServiceLog(dir)); err == nil {
		fmt.Fprintf(l, "%s kart-node 无法启动：%v\n", time.Now().Format(time.RFC3339), problem)
		_ = l.Close()
	}
}
