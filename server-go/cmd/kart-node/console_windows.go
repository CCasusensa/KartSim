package main

import (
	"bufio"
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// setupConsole switches the console to UTF-8 (code page 65001) so Chinese
// output reads right in cmd.exe and Windows PowerShell 5.
func setupConsole() { _ = windows.SetConsoleOutputCP(65001) }

// pauseBeforeExit keeps the window of a double-clicked kart-node.exe (no
// arguments, a console of its own) open so the error can be read.
func pauseBeforeExit() {
	if len(os.Args) > 1 || !isTerminal(os.Stdin) || isWindowsService() {
		return
	}
	fmt.Fprint(os.Stderr, "按回车键退出…")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
