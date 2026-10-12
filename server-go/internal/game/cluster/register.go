package cluster

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/buildinfo"
	"kartsim/internal/shared/contract"
)

// ErrKeyRejected means the data service does not know the node key: a
// typo, a key replaced in the console, or a deleted node. Retrying with the
// same key cannot help.
var ErrKeyRejected = errors.New("数据服务不认识这个节点密钥（填错了、已在后台重置，或节点已被删除）")

// Register asks the data service who a keyed node is (NODE.md "后台添加
// 节点"). It retries until it gets an answer, the key is refused or ctx
// ends: the node cannot check tickets before it has its ticket key.
func Register(ctx context.Context, client *DataClient, log *slog.Logger) (contract.NodeRegistration, error) {
	request := contract.NodeRegisterRequest{ProtocolVersion: contract.ProtocolVersion, Version: buildinfo.Version()}
	wait := 2 * time.Second
	for attempt := 1; ; attempt++ {
		var reg contract.NodeRegistration
		callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := client.Call(callCtx, contract.PathNodeRegister, request, &reg)
		cancel()
		if err == nil {
			return reg, nil
		}
		var refused *apierr.Error
		switch {
		case ctx.Err() != nil:
			return contract.NodeRegistration{}, ctx.Err()
		case errors.As(err, &refused) && refused.Status == http.StatusUnauthorized:
			return contract.NodeRegistration{}, ErrKeyRejected
		case errors.As(err, &refused) && refused.Code == "NODE_DISABLED":
			log.Error("这个节点已在后台停用，启用后会自动连上", "attempt", attempt)
		case errors.As(err, &refused) && refused.Status == http.StatusNotFound:
			log.Error("数据服务地址不对：那里没有节点接口（应填数据服务的网址，反向代理要转发 /multiplayer/）",
				"attempt", attempt, "error", err)
		default:
			log.Warn("暂时连不上数据服务，稍后重试", "attempt", attempt, "error", fmt.Sprint(err))
		}
		select {
		case <-ctx.Done():
			return contract.NodeRegistration{}, ctx.Err()
		case <-time.After(wait):
		}
		wait = min(wait*2, 30*time.Second)
	}
}
