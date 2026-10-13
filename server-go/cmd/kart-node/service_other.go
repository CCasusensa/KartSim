//go:build !linux && !windows

package main

import (
	"context"
	"errors"
)

const defaultServiceName = "kart-node"

var errNoService = errors.New("这个系统不支持 kart-node service；请用 launchd、supervisor 等方式运行 kart-node")

func isWindowsService() bool { return false }

func runService(string, func(context.Context) error) error { return errNoService }

func installService(*flags, *settings, string) error { return errNoService }
func uninstallService(string) error                  { return errNoService }
func startService(string) error                      { return errNoService }
func stopService(string) error                       { return errNoService }
func serviceStatus(string) error                     { return errNoService }
