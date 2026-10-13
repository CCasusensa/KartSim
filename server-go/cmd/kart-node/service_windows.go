package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const defaultServiceName = "KartSimNode"

func isWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

// runService runs node under the service control manager: Stop and
// Shutdown cancel its context.
func runService(name string, node func(context.Context) error) error {
	return svc.Run(name, serviceHandler(node))
}

type serviceHandler func(context.Context) error

func (h serviceHandler) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- h(ctx) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case err := <-done:
			if err != nil {
				// A service-specific exit code lets the recovery actions restart it.
				return true, 1
			}
			return false, 0
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				status <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending, WaitHint: 20_000}
				cancel()
				if err := <-done; err != nil {
					return true, 1
				}
				return false, 0
			}
		}
	}
}

func connect() (*mgr.Mgr, error) {
	m, err := mgr.Connect()
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return nil, errors.New("需要管理员权限：以管理员身份打开 PowerShell 或命令提示符再运行")
	}
	return m, err
}

func installService(f *flags, s *settings, exe string) error {
	m, err := connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	if existing, err := m.OpenService(f.serviceName); err == nil {
		existing.Close()
		return fmt.Errorf("服务 %s 已存在（先 kart-node service uninstall --service-name %[1]s）", f.serviceName)
	}
	service, err := m.CreateService(f.serviceName, exe, mgr.Config{
		DisplayName:      "KartSim 游戏节点 (" + f.serviceName + ")",
		Description:      "KartSim 独立游戏节点 kart-node，配置 " + s.confPath,
		StartType:        mgr.StartAutomatic,
		DelayedAutoStart: true,
	}, "run", "--config", s.confPath, "--service-name", f.serviceName)
	if err != nil {
		return err
	}
	defer service.Close()
	_ = service.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
	}, 24*60*60)
	if err := service.Start(); err != nil {
		return fmt.Errorf("服务已安装但启动失败：%w", err)
	}
	log := s.get("KART_LOG_FILE")
	if log == "" {
		log = defaultServiceLog(s.baseDir)
	}
	fmt.Printf("已安装并启动 Windows 服务 %s，开机自动启动，异常退出后自动重启。\n", f.serviceName)
	fmt.Printf("日志：%s\n", log)
	return nil
}

func openService(name string) (*mgr.Mgr, *mgr.Service, error) {
	m, err := connect()
	if err != nil {
		return nil, nil, err
	}
	service, err := m.OpenService(name)
	if err != nil {
		m.Disconnect()
		return nil, nil, fmt.Errorf("服务 %s 不存在", name)
	}
	return m, service, nil
}

// stopAndWait stops a running service and waits up to 30 s for it.
func stopAndWait(service *mgr.Service) error {
	status, err := service.Query()
	if err != nil || status.State == svc.Stopped {
		return err
	}
	if _, err := service.Control(svc.Stop); err != nil {
		return err
	}
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(300 * time.Millisecond) {
		if status, err = service.Query(); err != nil || status.State == svc.Stopped {
			return err
		}
	}
	return errors.New("等待服务停止超时")
}

func uninstallService(name string) error {
	m, service, err := openService(name)
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer service.Close()
	if err := stopAndWait(service); err != nil {
		return err
	}
	if err := service.Delete(); err != nil {
		return err
	}
	fmt.Printf("已停止并删除服务 %s（配置文件、发件箱与日志保留）。\n", name)
	return nil
}

func startService(name string) error {
	m, service, err := openService(name)
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer service.Close()
	return service.Start()
}

func stopService(name string) error {
	m, service, err := openService(name)
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer service.Close()
	return stopAndWait(service)
}

func serviceStatus(name string) error {
	m, service, err := openService(name)
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer service.Close()
	status, err := service.Query()
	if err != nil {
		return err
	}
	states := map[svc.State]string{svc.Stopped: "已停止", svc.StartPending: "正在启动", svc.StopPending: "正在停止",
		svc.Running: "运行中", svc.ContinuePending: "正在继续", svc.PausePending: "正在暂停", svc.Paused: "已暂停"}
	fmt.Fprintf(os.Stdout, "%s：%s\n", name, states[status.State])
	return nil
}
