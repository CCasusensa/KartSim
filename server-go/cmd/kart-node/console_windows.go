package main

import "golang.org/x/sys/windows"

// setupConsole switches the console to UTF-8 (code page 65001) so Chinese
// output reads right in cmd.exe and Windows PowerShell 5.
func setupConsole() { _ = windows.SetConsoleOutputCP(65001) }
